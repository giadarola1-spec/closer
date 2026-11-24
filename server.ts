import express, { Request, Response } from 'express';
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

const json16kb = express.json({ limit: '16kb' });
app.use((req, res, next) => {
  if (req.path === '/api/statistics/parse-screenshot') {
    return next();
  }
  return json16kb(req, res, next);
});

const TOKEN_SIGNING_SECRET =
  (process.env.SUPERVISOR_SESSION_SECRET || '').trim() ||
  crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    projectId: String(parsed.projectId || ''),
    firestoreDatabaseId: String(parsed.firestoreDatabaseId || '(default)'),
  };
}

const FIREBASE_CONFIG = loadFirebaseAppletConfig();
let cachedGoogleCerts: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > now) {
    return cachedGoogleCerts.certs;
  }
  const res = await fetch(FIREBASE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase auth certificates (HTTP ${res.status}).`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 300_000;
  cachedGoogleCerts = {
    certs,
    expiresAt: now + Math.max(60_000, maxAgeMs),
  };
  return certs;
}

async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; emailVerified: boolean } | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) return null;

  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return null;

    const certs = await getGoogleSecureTokenCerts();
    const pem = certs[header.kid];
    if (!pem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signatureValid = verifier.verify(pem, Buffer.from(sigB64, 'base64url'));
    if (!signatureValid) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    const projectId = FIREBASE_CONFIG.projectId;
    if (
      !projectId ||
      payload.aud !== projectId ||
      payload.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof payload.sub !== 'string' ||
      !isValidUid(payload.sub) ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSec ||
      typeof payload.iat !== 'number' ||
      payload.iat > nowSec + 300
    ) {
      return null;
    }

    return {
      uid: payload.sub,
      emailVerified: payload.email_verified === true,
    };
  } catch {
    return null;
  }
}

async function isActiveSupervisorInFirestore(uid: string, idToken: string): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      FIREBASE_CONFIG.projectId
    )}/databases/${encodeURIComponent(
      FIREBASE_CONFIG.firestoreDatabaseId
    )}/documents/supervisors/${encodeURIComponent(uid)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!res.ok) return false;
    const docData = await res.json();
    return docData?.fields?.active?.booleanValue === true;
  } catch {
    return false;
  }
}

function parseDurationToSecondsServer(raw: string): number {
  const clean = (raw || '').trim();
  if (!clean || clean === '-' || clean === '--') return 0;
  const parts = clean.split(':').map((p) => parseInt(p.replace(/\D/g, ''), 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return Math.max(0, Math.min(864000, parts[0] * 60 + parts[1]));
  }
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return Math.max(0, Math.min(864000, parts[0] * 3600 + parts[1] * 60 + parts[2]));
  }
  const hMatch = clean.match(/(\d+)\s*h/i);
  const mMatch = clean.match(/(\d+)\s*m/i);
  const sMatch = clean.match(/(\d+)\s*s/i);
  if (hMatch || mMatch || sMatch) {
    const total =
      (hMatch ? parseInt(hMatch[1], 10) * 3600 : 0) +
      (mMatch ? parseInt(mMatch[1], 10) * 60 : 0) +
      (sMatch ? parseInt(sMatch[1], 10) : 0);
    return Math.max(0, Math.min(864000, total));
  }
  return 0;
}

function clampInt(val: unknown, max: number): number {
  const num = typeof val === 'number' ? val : parseInt(String(val || '0'), 10);
  if (!Number.isFinite(num) || Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(max, Math.round(num)));
}

interface ClaimedCredential {
  salt: string;
  hashHex: string;
  syncKey: string;
}

let claimedCredential: ClaimedCredential | null = null;
const activeSupervisorSessions = new Map<string, number>();
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

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

app.post(
  '/api/statistics/parse-screenshot',
  express.json({ limit: '10mb' }),
  async (req: Request, res: Response) => {
    const idToken = getBearerToken(req);
    if (!idToken) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const verifiedUser = await verifyFirebaseIdToken(idToken);
    if (!verifiedUser || !verifiedUser.emailVerified) {
      return res.status(401).json({ error: 'Verified Firebase session required.' });
    }

    const headerSupToken =
      typeof req.headers['x-supervisor-token'] === 'string'
        ? req.headers['x-supervisor-token'].trim()
        : '';

    const hasSupervisorSession =
      (headerSupToken && verifySupervisorToken(headerSupToken, verifiedUser.uid)) ||
      (await isActiveSupervisorInFirestore(verifiedUser.uid, idToken));

    if (!hasSupervisorSession) {
      return res.status(403).json({ error: 'Supervisor access is required to import screenshots.' });
    }

    const { imageBase64, mimeType } = req.body || {};
    const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (typeof mimeType !== 'string' || !allowedMimeTypes.has(mimeType)) {
      return res.status(400).json({ error: 'Supported image formats: PNG, JPEG, or WebP.' });
    }
    if (
      typeof imageBase64 !== 'string' ||
      imageBase64.length < 32 ||
      imageBase64.length > 8_000_000 ||
      !/^[A-Za-z0-9+/=]+$/.test(imageBase64)
    ) {
      return res.status(400).json({ error: 'Invalid screenshot image payload.' });
    }

    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!geminiKey || geminiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured yet. Add your Gemini API key in Settings > Secrets to parse screenshots automatically.',
      });
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
              {
                text:
                  'Extract the closer call statistics rows from this RingCentral Analytics call report screenshot. ' +
                  'Return ONLY individual closer/user rows (exclude any Total, Summary, Average, or header rows). ' +
                  'For each row extract: name, ext (extension digits/string without "Ext." prefix, empty string if missing), ' +
                  'liveTalk (duration formatted as MM:SS or HH:MM:SS, or "00:00" if zero/dash), ' +
                  'outboundCalls, connectedCalls, inboundCalls, and totalCalls (treat "-" or empty cells as 0). ' +
                  'If a single report date is clearly shown in the report header, also return detectedDate in YYYY-MM-DD format, otherwise empty string.',
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedDate: {
                type: Type.STRING,
                description: 'Report date in YYYY-MM-DD format if clearly visible, otherwise empty string.',
              },
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: {
                      type: Type.STRING,
                      description: 'Closer name from the report row.',
                    },
                    ext: {
                      type: Type.STRING,
                      description: 'Extension number (empty string if not visible).',
                    },
                    liveTalk: {
                      type: Type.STRING,
                      description: 'Live talk duration as MM:SS or HH:MM:SS.',
                    },
                    outboundCalls: {
                      type: Type.INTEGER,
                      description: 'Number of outbound calls.',
                    },
                    connectedCalls: {
                      type: Type.INTEGER,
                      description: 'Number of connected calls.',
                    },
                    inboundCalls: {
                      type: Type.INTEGER,
                      description: 'Number of inbound calls.',
                    },
                    totalCalls: {
                      type: Type.INTEGER,
                      description: 'Total calls count.',
                    },
                  },
                  required: [
                    'name',
                    'ext',
                    'liveTalk',
                    'outboundCalls',
                    'connectedCalls',
                    'inboundCalls',
                    'totalCalls',
                  ],
                },
              },
            },
            required: ['detectedDate', 'rows'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const cleanedJson = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      const parsed = JSON.parse(cleanedJson || '{}');
      const rawRows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      const sanitizedRows = rawRows
        .slice(0, 50)
        .map((r: any, idx: number) => {
          const name = String(r?.name || '').trim().slice(0, 80);
          if (!name || /^(total|summary|average)$/i.test(name)) return null;
          const ext = String(r?.ext || '')
            .replace(/^ext\.?\s*/i, '')
            .trim()
            .slice(0, 20);
          const outbound = clampInt(r?.outboundCalls, 100000);
          const connected = clampInt(r?.connectedCalls, 100000);
          const inbound = clampInt(r?.inboundCalls, 100000);
          const parsedTotal = clampInt(r?.totalCalls, 200000);
          const total = parsedTotal > 0 ? parsedTotal : outbound + inbound;
          const liveTalkSeconds = parseDurationToSecondsServer(String(r?.liveTalk || '0:00'));

          return {
            id: `row_${Date.now()}_${idx}`,
            name,
            ext,
            liveTalkSeconds,
            outbound,
            connected,
            inbound,
            total,
          };
        })
        .filter(Boolean);

      const detectedDate =
        typeof parsed?.detectedDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(parsed.detectedDate.trim())
          ? parsed.detectedDate.trim()
          : '';

      if (sanitizedRows.length === 0) {
        return res.status(422).json({
          error:
            'No call report rows were detected in that image. Make sure the RingCentral table columns are clearly visible.',
        });
      }

      return res.json({
        detectedDate,
        rows: sanitizedRows,
      });
    } catch (error: any) {
      console.error('[statistics/parse-screenshot] error:', error);
      const status = typeof error?.status === 'number' ? error.status : 500;
      const rawMsg = error instanceof Error ? error.message : String(error || 'Failed to parse screenshot.');
      const lowerMsg = rawMsg.toLowerCase();

      if (
        status === 403 ||
        lowerMsg.includes('api_key_invalid') ||
        lowerMsg.includes('api key not valid') ||
        lowerMsg.includes('permission_denied')
      ) {
        return res.status(403).json({
          error:
            'Gemini API key was rejected or is missing permissions. Please verify GEMINI_API_KEY in Settings > Secrets.',
        });
      }
      if (status === 429 || lowerMsg.includes('resource_exhausted')) {
        return res.status(429).json({
          error: 'Gemini API rate limit reached. Wait a moment and try pasting again.',
        });
      }
      if (status === 404 || lowerMsg.includes('not_found')) {
        return res.status(502).json({
          error: 'Configured Gemini model was unavailable for this API key. Please check Settings > Secrets.',
        });
      }

      // Extract clean message if error.message is serialized Google API JSON
      let detail = rawMsg;
      try {
        const parsedErr = JSON.parse(rawMsg);
        if (typeof parsedErr?.error?.message === 'string') {
          detail = parsedErr.error.message;
        }
      } catch {
        // Keep rawMsg
      }

      return res.status(500).json({
        error: `Could not parse screenshot (${detail.slice(0, 160)}). Please try a clearer crop or add rows manually.`,
      });
    }
  }
);

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
