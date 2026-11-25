import { PresenceStatus, TeamMember } from '../types/team.ts';

export const PRESENCE_HEARTBEAT_MS = 2 * 60 * 1000;
export const PRESENCE_STALE_MS = 4.5 * 60 * 1000;
export const PRESENCE_IDLE_AFK_MS = 5 * 60 * 1000;

export const PRESENCE_OPTIONS: readonly PresenceStatus[] = [
  'online',
  'busy',
  'afk',
  'offline',
] as const;

export const PRESENCE_META: Record<
  PresenceStatus,
  {
    label: string;
    dotClass: string;
    textClass: string;
  }
> = {
  online: {
    label: 'Online',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-400',
  },
  busy: {
    label: 'Busy',
    dotClass: 'bg-red-500',
    textClass: 'text-red-400',
  },
  afk: {
    label: 'AFK',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-300',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-[#52525b]',
    textClass: 'text-[#71706b]',
  },
};

function getTimestampMillis(ts: any): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  if (typeof ts.seconds === 'number') {
    return ts.seconds * 1000;
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return ts;
  }
  const parsed = Date.parse(String(ts));
  return Number.isNaN(parsed) ? null : parsed;
}

export function inferPresenceFromStatusText(statusText?: string): PresenceStatus | null {
  const normalized = (statusText || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'offline') return 'offline';
  if (
    normalized === 'in a call' ||
    normalized === 'busy' ||
    normalized === 'do not disturb' ||
    normalized === 'dnd'
  ) {
    return 'busy';
  }
  if (normalized === 'on break' || normalized === 'afk' || normalized === 'away') {
    return 'afk';
  }
  return null;
}

export function resolveEffectivePresence(
  member: Pick<TeamMember, 'presenceState' | 'lastActiveAt' | 'updatedAt' | 'statusText'> | null | undefined,
  nowMs: number = Date.now()
): PresenceStatus {
  if (!member) return 'offline';
  if (member.presenceState === 'offline') return 'offline';

  const activeMs =
    getTimestampMillis(member.lastActiveAt) ?? getTimestampMillis(member.updatedAt);

  if (activeMs === null) {
    return 'offline';
  }

  if (nowMs - activeMs > PRESENCE_STALE_MS) {
    return 'offline';
  }

  if (
    member.presenceState === 'online' ||
    member.presenceState === 'busy' ||
    member.presenceState === 'afk'
  ) {
    return member.presenceState;
  }

  return inferPresenceFromStatusText(member.statusText) ?? 'online';
}
