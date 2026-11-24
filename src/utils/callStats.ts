import { DailyCallStatRow, LIMITS, TeamMember } from '../types/team.ts';

export function getEstDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateKey;
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return utc.toISOString().slice(0, 10);
}

export function formatDateLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Today';
  if (dateKey === shiftDateKey(todayKey, -1)) return 'Yesterday';
  const [y, m, d] = dateKey.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return dateKey;
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatEstUpdateTime(ts: any): string {
  if (!ts) return '';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function parseDurationToSeconds(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || Number.isNaN(raw)) return 0;
    return Math.max(0, Math.min(864000, Math.round(raw)));
  }

  const clean = (raw || '').trim();
  if (!clean || clean === '-' || clean === '--') return 0;

  if (clean.includes(':')) {
    const parts = clean.split(':').map((p) => parseInt(p.replace(/\D/g, '') || '0', 10));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      return Math.max(0, Math.min(864000, parts[0] * 60 + parts[1]));
    }
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return Math.max(0, Math.min(864000, parts[0] * 3600 + parts[1] * 60 + parts[2]));
    }
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

  const numericOnly = parseInt(clean.replace(/\D/g, ''), 10);
  return Number.isFinite(numericOnly) ? Math.max(0, Math.min(864000, numericOnly)) : 0;
}

export function formatSecondsToMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatSecondsToHoursMinutes(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const totalMinutes = Math.round(safe / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function normalizeName(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - levenshtein(a, b) / maxLen);
}

function scoreNameMatch(parsedRaw: string, memberRaw: string): number {
  const a = normalizeName(parsedRaw);
  const b = normalizeName(memberRaw);
  if (!a || !b) return 0;
  if (a === b) return 1.0;

  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);

  if (tokensA.length >= 2 && tokensB.length >= 2) {
    const firstA = tokensA[0];
    const firstB = tokensB[0];
    const lastA = tokensA[tokensA.length - 1];
    const lastB = tokensB[tokensB.length - 1];

    const lastSim = similarity(lastA, lastB);
    if (lastSim >= 0.8) {
      // Handle shortened first names like "Uli" <-> "Ulises"
      const minFirstLen = Math.min(firstA.length, firstB.length);
      if (minFirstLen >= 3 && (firstA.startsWith(firstB) || firstB.startsWith(firstA))) {
        return 0.94 * lastSim;
      }
      const firstSim = similarity(firstA, firstB);
      if (firstSim >= 0.55) {
        return (0.45 * firstSim + 0.55 * lastSim) * 0.96;
      }
    }
  }

  // Handle single-word displayName or partial match (e.g. "Gianfranco" vs "Gianfranco Iadarola")
  if (tokensA.length === 1 || tokensB.length === 1) {
    const single = tokensA.length === 1 ? tokensA[0] : tokensB[0];
    const otherTokens = tokensA.length === 1 ? tokensB : tokensA;
    if (single.length >= 4 && otherTokens.some((t) => t === single || t.startsWith(single))) {
      return 0.84;
    }
  }

  // Fallback full-string similarity
  return similarity(a, b);
}

export function matchCloserMember(
  parsedName: string,
  members: TeamMember[]
): TeamMember | null {
  let bestMember: TeamMember | null = null;
  let bestScore = 0;

  for (const member of members) {
    const score = scoreNameMatch(parsedName, member.displayName);
    if (score > bestScore) {
      bestScore = score;
      bestMember = member;
    }
  }

  return bestScore >= 0.72 ? bestMember : null;
}

export function sanitizeRowInt(val: number | string, max: number): number {
  const num = typeof val === 'number' ? val : parseInt(String(val || '0'), 10);
  if (!Number.isFinite(num) || Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(max, Math.round(num)));
}

export function sanitizeStatRowForFirestore(
  row: DailyCallStatRow,
  index: number
): DailyCallStatRow | null {
  const name = (row.name || '').trim().slice(0, LIMITS.CALLER_NAME_MAX);
  if (!name) return null;
  const rawId = (row.id || `row_${index}_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
  const id = (rawId || `row_${index}`).slice(0, 128);
  const uid = /^[a-zA-Z0-9_-]{1,128}$/.test(row.uid || '') ? row.uid : '';
  const ext = (row.ext || '').trim().slice(0, LIMITS.EXT_MAX);
  const liveTalkSeconds = sanitizeRowInt(row.liveTalkSeconds, 864000);
  const outbound = sanitizeRowInt(row.outbound, 100000);
  const connected = sanitizeRowInt(row.connected, 100000);
  const inbound = sanitizeRowInt(row.inbound, 100000);
  const total = sanitizeRowInt(row.total, 200000);

  return {
    id,
    uid,
    name,
    ext,
    liveTalkSeconds,
    outbound,
    connected,
    inbound,
    total,
  };
}

export async function prepareScreenshotForOcr(file: File): Promise<{
  base64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  previewUrl: string;
}> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please paste or select an image screenshot (PNG, JPG, or WebP).');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Screenshot is too large (max 15 MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load screenshot image.'));
      image.src = objectUrl;
    });

    const maxDim = 2000;
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Keep PNG for sharp text when compact; otherwise use high-quality WebP/JPEG to stay well under proxy body limits
    let dataUrl = canvas.toDataURL('image/png');
    let outMime: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png';
    if (dataUrl.length > 900_000) {
      const jpegHigh = canvas.toDataURL('image/jpeg', 0.9);
      if (jpegHigh.length <= 1_800_000) {
        dataUrl = jpegHigh;
        outMime = 'image/jpeg';
      } else {
        dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        outMime = 'image/jpeg';
      }
    }

    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) {
      throw new Error('Failed to encode screenshot.');
    }

    return {
      base64,
      mimeType: outMime,
      previewUrl: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
