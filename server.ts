import express, { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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
