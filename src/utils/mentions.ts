import { TeamMember } from '../types/team.ts';

export interface ActiveMentionQuery {
  query: string;
  startIndex: number;
  endIndex: number;
}

export function getMentionHandle(displayName: string): string {
  const normalized = (displayName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24);
  return normalized || 'closer';
}

export function getCompactMentionHandle(displayName: string): string {
  const normalized = (displayName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
  return normalized || 'closer';
}

export function buildMembersByMentionHandle(
  members: TeamMember[]
): Record<string, TeamMember> {
  const map: Record<string, TeamMember> = {};
  for (const member of members) {
    const primary = getMentionHandle(member.displayName);
    const compact = getCompactMentionHandle(member.displayName);
    if (!map[primary]) map[primary] = member;
    if (!map[compact]) map[compact] = member;
  }
  return map;
}

export function resolveMentionedMember(
  rawHandle: string,
  membersByHandle: Record<string, TeamMember>
): TeamMember | null {
  const clean = rawHandle.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  return membersByHandle[clean] || null;
}

export function textMentionsMember(text: string, member: TeamMember | null): boolean {
  if (!text || !member) return false;
  const primary = getMentionHandle(member.displayName);
  const compact = getCompactMentionHandle(member.displayName);
  const regex = /(?:^|[\s(<"'])@([a-zA-Z0-9_]{1,30})/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[1].toLowerCase();
    if (token === primary || token === compact) {
      return true;
    }
  }
  return false;
}

export function findActiveMentionQuery(
  text: string,
  cursorPos: number
): ActiveMentionQuery | null {
  if (cursorPos < 0 || cursorPos > text.length) return null;

  const beforeCursor = text.slice(0, cursorPos);
  const atIndex = beforeCursor.lastIndexOf('@');
  if (atIndex === -1) return null;

  if (atIndex > 0) {
    const prevChar = beforeCursor[atIndex - 1];
    if (!/[\s(["']/.test(prevChar)) {
      return null;
    }
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (query.length > 28) return null;
  if (/[\n\r@]/.test(query)) return null;
  // Allow at most one space so users can type "@First Last" while filtering
  if ((query.match(/\s/g) || []).length > 1) return null;

  return {
    query,
    startIndex: atIndex,
    endIndex: cursorPos,
  };
}

export function filterMentionCandidates(
  members: TeamMember[],
  query: string,
  limit = 6
): TeamMember[] {
  const q = query.trim().toLowerCase();
  const qUnderscore = q.replace(/\s+/g, '_');

  const matches = members.filter((m) => {
    if (!q) return true;
    const nameLower = m.displayName.toLowerCase();
    const handle = getMentionHandle(m.displayName);
    const compact = getCompactMentionHandle(m.displayName);
    return (
      nameLower.includes(q) ||
      handle.includes(qUnderscore) ||
      compact.includes(qUnderscore)
    );
  });

  matches.sort((a, b) => {
    if (!q) return a.displayName.localeCompare(b.displayName);
    const aName = a.displayName.toLowerCase();
    const bName = b.displayName.toLowerCase();
    const aStarts =
      aName.startsWith(q) || getMentionHandle(a.displayName).startsWith(qUnderscore);
    const bStarts =
      bName.startsWith(q) || getMentionHandle(b.displayName).startsWith(qUnderscore);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return matches.slice(0, limit);
}

export function insertMentionAtCursor(
  text: string,
  startIndex: number,
  endIndex: number,
  member: TeamMember
): { nextValue: string; nextCursorPos: number } {
  const handle = getMentionHandle(member.displayName);
  const before = text.slice(0, startIndex);
  const after = text.slice(endIndex);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const inserted = `@${handle}${needsTrailingSpace ? ' ' : ''}`;
  const nextValue = `${before}${inserted}${after}`;
  const nextCursorPos = before.length + inserted.length;
  return { nextValue, nextCursorPos };
}
