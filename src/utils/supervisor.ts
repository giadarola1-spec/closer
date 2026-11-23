export const SYNC_KEY_PATTERN = /^[a-f0-9]{64}$/;

export function isValidSyncKey(value: unknown): value is string {
  return typeof value === 'string' && SYNC_KEY_PATTERN.test(value);
}

export async function deriveSupervisorSyncKey(passcode: string): Promise<string> {
  const normalized = passcode.trim();
  const encoder = new TextEncoder();
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(normalized),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode('closer-supervisor-sync-v1')
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function constantTimeHexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
