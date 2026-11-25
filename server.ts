import express, { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '16kb' }));

const TOKEN_SIGNING_SECRET =
  (process.env.SUPERVISOR_SESSION_SECRET || '').trim() ||
  crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;

interface ClaimedCredential {
  salt: string;
  hashHex: string;
  syncKey: string;
}

let claimedCredential: ClaimedCredential | null = null;
const activeSupervisorSessions = new Map<string, number>();
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const marginNoteRateLimits = new Map<string, { count: number; resetAt: number }>();

const MARGIN_NOTE_WINDOW_MS = 10 * 60 * 1000;
const MARGIN_NOTE_MAX_REQUESTS = 20;

const FIREBASE_PROJECT_ID = (() => {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.projectId === 'string' ? parsed.projectId : '';
  } catch {
    return '';
  }
})();

let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > now) {
    return cachedGoogleCerts.certs;
  }

  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch public verification certificates (${resp.status})`);
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  cachedGoogleCerts = {
    certs,
    expiresAt: now + ttlSec * 1000,
  };
  return certs;
}

async function verifyFirebaseIdToken(token: string): Promise<{ uid: string } | null> {
  if (!FIREBASE_PROJECT_ID || !token) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = segments;

  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return null;

    const certs = await getFirebasePublicCerts();
    const cert = certs[header.kid];
    if (!cert) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();

    const sigBuffer = Buffer.from(encodedSignature, 'base64url');
    if (!verifier.verify(cert, sigBuffer)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    const expectedIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;

    if (
      payload?.iss !== expectedIssuer ||
      payload?.aud !== FIREBASE_PROJECT_ID ||
      typeof payload?.exp !== 'number' ||
      payload.exp <= nowSec ||
      typeof payload?.iat !== 'number' ||
      payload.iat > nowSec + 300 ||
      !isValidUid(payload?.sub) ||
      payload?.email_verified !== true
    ) {
      return null;
    }

    return { uid: payload.sub };
  } catch {
    return null;
  }
}

function checkMarginNoteRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = marginNoteRateLimits.get(uid);
  if (!entry || entry.resetAt <= now) {
    marginNoteRateLimits.set(uid, { count: 1, resetAt: now + MARGIN_NOTE_WINDOW_MS });
    return true;
  }
  if (entry.count >= MARGIN_NOTE_MAX_REQUESTS) {
    return false;
  }
  entry.count += 1;
  return true;
}

const URL_EXTRACT_REGEX = /https?:\/\/[^\s<>"')]+/gi;

function extractUniqueUrls(text: string): string[] {
  const matches = text.match(URL_EXTRACT_REGEX) || [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of matches) {
    const trimmed = raw.replace(/[.,!?;:\]]+$/g, '');
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      clean.push(trimmed);
    }
    if (clean.length >= 5) break;
  }
  return clean;
}

function parseMarginNoteJson(rawText: string): { shouldGenerate: boolean; points: string[] } | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonSlice =
    firstBrace !== -1 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : candidate;

  try {
    const parsed = JSON.parse(jsonSlice);
    const shouldGenerate = Boolean(parsed?.shouldGenerate);
    const rawPoints: unknown[] = Array.isArray(parsed?.points) ? parsed.points : [];
    const points = rawPoints
      .filter((item: unknown): item is string => typeof item === 'string')
      .map((line: string) =>
        line
          .replace(/^[\s•\-*–—\d.)]+/, '')
          .replace(/^(summary|key takeaways?|takeaways?|ai|gemini|youtube|generated by[^:]*|closer note|margin note)\s*:\s*/i, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(
        (line: string) =>
          line.length >= 8 &&
          !/\b(gemini|generated by|youtube|ai assistant|language model)\b/i.test(line)
      )
      .map((line: string) => (line.length > 260 ? `${line.slice(0, 257).trimEnd()}...` : line))
      .slice(0, 3);

    if (!shouldGenerate || points.length === 0) {
      return { shouldGenerate: false, points: [] };
    }
    return { shouldGenerate: true, points };
  } catch {
    return null;
  }
}

function getConfiguredEnvPasscode(): string {
  return (process.env.SUPERVISOR_PASSCODE || '').trim();
}

function isValidUid(uid: unknown): uid is string {
  return typeof uid === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(uid);
}

function deriveSyncKey(passcode: string): string {
  return crypto
    .createHmac('sha256', passcode)
    .update('closer-supervisor-sync-v1')
    .digest('hex');
}

function constantTimeEqualsText(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function verifyPasscodeCandidate(candidate: string): { ok: boolean; syncKey?: string } {
  const envPasscode = getConfiguredEnvPasscode();
  if (envPasscode) {
    if (constantTimeEqualsText(candidate, envPasscode)) {
      return { ok: true, syncKey: deriveSyncKey(envPasscode) };
    }
    return { ok: false };
  }

  if (claimedCredential) {
    const derived = crypto.scryptSync(candidate, claimedCredential.salt, 64);
    const stored = Buffer.from(claimedCredential.hashHex, 'hex');
    if (derived.length === stored.length && crypto.timingSafeEqual(derived, stored)) {
      return { ok: true, syncKey: claimedCredential.syncKey };
    }
    return { ok: false };
  }

  return { ok: false };
}

function issueSupervisorToken(uid: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ uid, exp: expiresAt })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', TOKEN_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');
  activeSupervisorSessions.set(uid, expiresAt);
  return { token: `${payload}.${sig}`, expiresAt };
}

function verifySupervisorToken(token: string, expectedUid: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SIGNING_SECRET)
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      decoded?.uid !== expectedUid ||
      typeof decoded?.exp !== 'number' ||
      decoded.exp <= Date.now()
    ) {
      return false;
    }
    const activeExp = activeSupervisorSessions.get(expectedUid);
    return typeof activeExp === 'number' && activeExp > Date.now();
  } catch {
    return false;
  }
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return '';
  return authHeader.slice(7).trim();
}

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = failedAttempts.get(uid);
  if (!entry || entry.resetAt <= now) return true;
  return entry.count < MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(uid: string) {
  const now = Date.now();
  const entry = failedAttempts.get(uid);
  if (!entry || entry.resetAt <= now) {
    failedAttempts.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    company: 'Go To Truckers',
    workspace: 'closers-hub',
  });
});

app.get('/api/supervisor/status', (_req: Request, res: Response) => {
  const envConfigured = Boolean(getConfiguredEnvPasscode());
  const mode = envConfigured ? 'env' : claimedCredential ? 'claimed' : 'unconfigured';
  res.json({
    configured: mode !== 'unconfigured',
    mode,
  });
});

app.post('/api/supervisor/claim', (req: Request, res: Response) => {
  const { uid, passcode } = req.body || {};

  if (!isValidUid(uid)) {
    return res.status(400).json({ error: 'Valid user session is required.' });
  }
  if (typeof passcode !== 'string' || passcode.trim().length < 6 || passcode.length > 128) {
    return res
      .status(400)
      .json({ error: 'Passcode must be between 6 and 128 characters.' });
  }

  if (getConfiguredEnvPasscode() || claimedCredential) {
    return res
      .status(409)
      .json({ error: 'Supervisor passcode is already configured. Please sign in.' });
  }

  const normalized = passcode.trim();
  const salt = crypto.randomBytes(16).toString('hex');
  const hashHex = crypto.scryptSync(normalized, salt, 64).toString('hex');
  const syncKey = deriveSyncKey(normalized);

  claimedCredential = { salt, hashHex, syncKey };
  failedAttempts.delete(uid);

  const { token, expiresAt } = issueSupervisorToken(uid);
  return res.json({
    ok: true,
    mode: 'claimed',
    token,
    expiresAt,
    syncKey,
  });
});

app.post('/api/supervisor/verify', (req: Request, res: Response) => {
  const { uid, passcode } = req.body || {};

  if (!isValidUid(uid)) {
    return res.status(400).json({ error: 'Valid user session is required.' });
  }
  if (typeof passcode !== 'string' || !passcode.trim() || passcode.length > 128) {
    return res.status(400).json({ error: 'Please enter the supervisor password.' });
  }

  if (!getConfiguredEnvPasscode() && !claimedCredential) {
    return res
      .status(400)
      .json({ error: 'Supervisor passcode has not been configured yet.' });
  }

  if (!checkRateLimit(uid)) {
    return res
      .status(429)
      .json({ error: 'Too many failed attempts. Please wait a few minutes and try again.' });
  }

  const result = verifyPasscodeCandidate(passcode.trim());
  if (!result.ok || !result.syncKey) {
    recordFailedAttempt(uid);
    return res.status(401).json({ error: 'Incorrect supervisor password.' });
  }

  failedAttempts.delete(uid);
  const { token, expiresAt } = issueSupervisorToken(uid);
  return res.json({
    ok: true,
    token,
    expiresAt,
    syncKey: result.syncKey,
  });
});

app.get('/api/supervisor/session', (req: Request, res: Response) => {
  const uid = req.query.uid;
  const token = getBearerToken(req);
  if (!isValidUid(uid) || !token) {
    return res.json({ active: false });
  }
  return res.json({ active: verifySupervisorToken(token, uid) });
});

app.post('/api/supervisor/logout', (req: Request, res: Response) => {
  const { uid } = req.body || {};
  const token = getBearerToken(req);
  if (isValidUid(uid) && token && verifySupervisorToken(token, uid)) {
    activeSupervisorSessions.delete(uid);
  }
  return res.json({ ok: true });
});

function extractUpstreamError(err: any): {
  status: number;
  upstreamStatus?: string;
  message: string;
} {
  let status =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.code === 'number'
        ? err.code
        : typeof err?.error?.code === 'number'
          ? err.error.code
          : 502;
  let upstreamStatus =
    typeof err?.error?.status === 'string' ? err.error.status : undefined;
  const rawMessage = err instanceof Error ? err.message : String(err || '');

  const firstBrace = rawMessage.indexOf('{');
  const lastBrace = rawMessage.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(rawMessage.slice(firstBrace, lastBrace + 1));
      const nested = parsed?.error || parsed;
      if (typeof nested?.code === 'number') status = nested.code;
      if (typeof nested?.status === 'string') upstreamStatus = nested.status;
    } catch {
      // Ignore non-JSON error fragments
    }
  }

  if (
    upstreamStatus === 'UNAVAILABLE' ||
    /\b503\b/.test(rawMessage) ||
    /high demand|temporarily unavailable/i.test(rawMessage)
  ) {
    status = 503;
    upstreamStatus = 'UNAVAILABLE';
  } else if (/quota|rate limit|429|RESOURCE_EXHAUSTED/i.test(rawMessage) && status === 502) {
    status = 429;
  }

  return { status, upstreamStatus, message: rawMessage };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post('/api/posts/margin-note', async (req: Request, res: Response) => {
  try {
    const bearerToken = getBearerToken(req);
    const verifiedUser = await verifyFirebaseIdToken(bearerToken);
    if (!verifiedUser) {
      return res.status(401).json({ ok: false, error: 'Authentication required.', retryable: false });
    }

    if (!checkMarginNoteRateLimit(verifiedUser.uid)) {
      return res.status(429).json({
        ok: false,
        error: 'The AI rate limit was reached right now. Please try again shortly.',
        retryable: true,
      });
    }

    const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 140) : '';
    const rawBody = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 4000) : '';
    const force = req.body?.force === true;

    if (!rawTitle && !rawBody) {
      if (force) {
        return res.status(400).json({
          ok: false,
          error: 'Post needs text or a link to create a margin note.',
          retryable: false,
        });
      }
      return res.json({ ok: true, shouldGenerate: false, points: [] });
    }

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(200).json({
        ok: false,
        upstreamCode: 503,
        error: 'The AI key is not configured on the server right now.',
        retryable: false,
      });
    }

    const combinedText = [rawTitle, rawBody].filter(Boolean).join('\n\n');
    const urls = extractUniqueUrls(combinedText);

    const systemInstruction = force
      ? [
          'You write ultra-concise editorial margin notes for B2B freight brokerage sales closers.',
          'The user explicitly requested a margin note for this post, so you MUST always return shouldGenerate=true with 1 to 3 crisp, practical bullet strings in "points" (each under 200 characters).',
          'Extract the sharpest sales takeaway, actionable follow-up angle, key link insight, or practical freight context from the post.',
          'Start directly with the useful content like a sharp peer closer note.',
          'STRICTLY NEVER use the words "Gemini", "AI", "YouTube", "Summary", "Takeaways", "Generated by", or label prefixes like "Tip:" or "Note:".',
        ].join(' ')
      : [
          'You write ultra-concise editorial margin notes for B2B freight brokerage sales closers.',
          'First decide whether the post contains genuine actionable value for freight closers:',
          '- Cold-calling openers, call scripts, talk tracks, or objection handling',
          '- Educational or industry video/article links (extract the core practical points or key freight/sales insight directly)',
          '- Sales mindset, resilience, negotiation tactics, rate quoting, or carrier/shipper tips',
          'Return shouldGenerate=false and points=[] for casual chatter, memes, jokes, lunch/food banter, greetings, or short off-topic remarks with no sales/educational substance.',
          'When shouldGenerate=true, output 2 to 3 crisp, practical bullet strings in "points" (each under 200 characters).',
          'Start directly with the actionable insight like a sharp peer closer note.',
          'STRICTLY NEVER use the words "Gemini", "AI", "YouTube", "Summary", "Takeaways", "Generated by", or label prefixes like "Tip:" or "Note:".',
        ].join(' ');

    const prompt = [
      force
        ? 'Write a concise closer margin note for this team feed post and return ONLY valid JSON matching {"shouldGenerate": true, "points": string[]}:'
        : 'Evaluate this team feed post and return ONLY valid JSON matching {"shouldGenerate": boolean, "points": string[]}:',
      rawTitle ? `Title: ${rawTitle}` : null,
      rawBody ? `Body: ${rawBody}` : null,
      urls.length > 0 ? `Referenced links to inspect: ${urls.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const runGeneration = () =>
      urls.length > 0
        ? ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              systemInstruction,
              tools: [{ googleSearch: {} }, { urlContext: {} }],
            },
          })
        : ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  shouldGenerate: { type: Type.BOOLEAN },
                  points: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: ['shouldGenerate', 'points'],
              },
            },
          });

    let response;
    try {
      response = await runGeneration();
    } catch (firstErr: any) {
      const info = extractUpstreamError(firstErr);
      if (info.status === 503) {
        await sleepMs(900);
        response = await runGeneration();
      } else {
        throw firstErr;
      }
    }

    const parsed = parseMarginNoteJson(response.text || '');
    if (!parsed) {
      return res.status(200).json({ ok: true, shouldGenerate: false, points: [] });
    }
    return res.status(200).json({ ok: true, ...parsed });
  } catch (err: any) {
    const info = extractUpstreamError(err);
    // Return HTTP 200 with ok:false for upstream AI errors so Nginx proxy_intercept_errors
    // (which intercepts 403/502/503/504 with warmup.html) never strips our JSON error payload.
    if (info.status === 503) {
      return res.status(200).json({
        ok: false,
        upstreamCode: 503,
        status: 'UNAVAILABLE',
        error: 'The AI is currently being overused (high demand). Please try again in a moment.',
        retryable: true,
      });
    }
    if (info.status === 429) {
      return res.status(200).json({
        ok: false,
        upstreamCode: 429,
        error: 'The AI rate limit was reached right now. Please try again shortly.',
        retryable: true,
      });
    }
    if (info.status === 401 || info.status === 403) {
      return res.status(200).json({
        ok: false,
        upstreamCode: info.status,
        error: 'Upstream AI authorization error.',
        retryable: false,
      });
    }
    console.error('Margin note generation error:', info.message);
    return res.status(200).json({
      ok: false,
      upstreamCode: info.status,
      error: 'The AI service failed to respond properly right now. Please try again.',
      retryable: true,
    });
  }
});

app.use('/api', (_req: Request, res: Response) => {
  return res.status(404).json({
    ok: false,
    error: 'API route not found (404). Server may need a restart.',
    retryable: true,
  });
});

app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  const rawStatus = typeof err?.status === 'number' ? err.status : 500;
  // Avoid 403/502/503/504 HTTP statuses so Nginx never replaces JSON errors with HTML pages
  const safeHttpStatus = [403, 502, 503, 504].includes(rawStatus) ? 500 : rawStatus;
  return res.status(safeHttpStatus).json({
    ok: false,
    error:
      typeof err?.message === 'string' && err.message.trim()
        ? err.message.trim()
        : `Server error (${rawStatus}).`,
    retryable: rawStatus >= 500,
  });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`closer GTT Team Hub listening on port ${PORT}`);
  });
}

startServer();
