import React, { useEffect, useMemo, useState } from 'react';
import {
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  runTransaction,
  increment,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { Plus, RotateCcw } from 'lucide-react';
import { db } from '../firebase.ts';
import {
  LIMITS,
  TeamMember,
  FloorStatMetric,
  FloorStatLogEntry,
  FloorStatsDoc,
} from '../types/team.ts';
import { Avatar } from './Avatar.tsx';

interface FloorStatsCardProps {
  currentMember: TeamMember;
  membersById: Record<string, TeamMember>;
  isSupervisor: boolean;
  onOpenDm?: (targetUid: string) => void;
  onNotify: (msg: string) => void;
}

interface MetricTileConfig {
  key: FloorStatMetric;
  label: string;
  articleLabel: string;
}

const METRIC_TILES: MetricTileConfig[] = [
  { key: 'dmSpoken', label: 'DMs Spoken', articleLabel: 'a DM Spoken' },
  { key: 'mql', label: 'MQL', articleLabel: 'an MQL' },
  { key: 'sql', label: 'SQL', articleLabel: 'an SQL' },
  { key: 'opportunity', label: 'Opportunity', articleLabel: 'an Opportunity' },
];

const METRIC_LABEL_MAP: Record<FloorStatMetric, string> = {
  dmSpoken: 'a DM Spoken',
  mql: 'an MQL',
  sql: 'an SQL',
  opportunity: 'an Opportunity',
};

const MAX_STORED_LOGS = 50;
const VISIBLE_TILE_AVATARS = 3;
const RECENT_ACTIVITY_COUNT = 5;

function getEstDateKey(date: Date = new Date()): string {
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

function formatEstTimestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(epochMs));
}

function formatActivityTime(epochMs: number, nowMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - epochMs) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  return formatEstTimestamp(epochMs);
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

function createLogId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeHttpsPhotoUrl(url?: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('https://') && trimmed.length <= 500) {
    return trimmed;
  }
  return '';
}

export const FloorStatsCard: React.FC<FloorStatsCardProps> = ({
  currentMember,
  membersById,
  isSupervisor,
  onOpenDm,
  onNotify,
}) => {
  const [dateKey, setDateKey] = useState<string>(() => getEstDateKey());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [stats, setStats] = useState<FloorStatsDoc>({
    dmSpoken: 0,
    mql: 0,
    sql: 0,
    opportunity: 0,
    logs: [],
  });
  const [pendingMetric, setPendingMetric] = useState<FloorStatMetric | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!confirmingReset) return;
    const timer = window.setTimeout(() => {
      setConfirmingReset(false);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [confirmingReset]);

  // Roll over at midnight EST and keep relative timestamps fresh
  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextKey = getEstDateKey();
      setDateKey((prev) => (prev === nextKey ? prev : nextKey));
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Real-time subscription to today's single EST floor_stats document (1 read on load)
  useEffect(() => {
    const statsRef = doc(db, 'floor_stats', dateKey);
    const unsubscribe = onSnapshot(
      statsRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setStats({
            dmSpoken: 0,
            mql: 0,
            sql: 0,
            opportunity: 0,
            logs: [],
          });
          return;
        }
        const data = snapshot.data();
        const rawLogs = Array.isArray(data.logs) ? data.logs : [];
        const logs: FloorStatLogEntry[] = rawLogs.filter(
          (entry): entry is FloorStatLogEntry =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof entry.id === 'string' &&
            typeof entry.metric === 'string' &&
            typeof entry.uid === 'string' &&
            typeof entry.userName === 'string' &&
            typeof entry.createdAt === 'number'
        );

        setStats({
          dmSpoken: typeof data.dmSpoken === 'number' ? data.dmSpoken : 0,
          mql: typeof data.mql === 'number' ? data.mql : 0,
          sql: typeof data.sql === 'number' ? data.sql : 0,
          opportunity: typeof data.opportunity === 'number' ? data.opportunity : 0,
          logs,
          updatedAt: data.updatedAt,
        });
      },
      (error) => {
        console.error('Failed to subscribe to floor_stats:', error);
      }
    );

    return () => unsubscribe();
  }, [dateKey]);

  const logsByMetric = useMemo(() => {
    const grouped: Record<FloorStatMetric, FloorStatLogEntry[]> = {
      dmSpoken: [],
      mql: [],
      sql: [],
      opportunity: [],
    };
    for (const entry of stats.logs) {
      if (entry.metric in grouped) {
        grouped[entry.metric].push(entry);
      }
    }
    return grouped;
  }, [stats.logs]);

  const recentActivity = useMemo(() => {
    return [...stats.logs].reverse().slice(0, RECENT_ACTIVITY_COUNT);
  }, [stats.logs]);

  const totalWinsToday =
    (stats.dmSpoken || 0) +
    (stats.mql || 0) +
    (stats.sql || 0) +
    (stats.opportunity || 0);

  const hasStatsData = totalWinsToday > 0 || stats.logs.length > 0;

  const handleIncrement = async (metric: FloorStatMetric) => {
    if (pendingMetric) return;
    setPendingMetric(metric);

    const activeDateKey = getEstDateKey();
    if (activeDateKey !== dateKey) {
      setDateKey(activeDateKey);
    }

    const docRef = doc(db, 'floor_stats', activeDateKey);
    const newEntry: FloorStatLogEntry = {
      id: createLogId(),
      metric,
      uid: currentMember.uid,
      userName:
        currentMember.displayName.trim().slice(0, LIMITS.DISPLAY_NAME_MAX) || 'Closer',
      photoURL: sanitizeHttpsPhotoUrl(currentMember.photoUrl),
      createdAt: Date.now(),
    };

    try {
      if (stats.logs.length >= MAX_STORED_LOGS - 2) {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(docRef);
          const data = snap.exists() ? snap.data() : {};
          const existingLogs = Array.isArray(data.logs)
            ? (data.logs as FloorStatLogEntry[])
            : [];
          const trimmedLogs = [...existingLogs.slice(-(MAX_STORED_LOGS - 1)), newEntry];
          const currentCount =
            typeof data[metric] === 'number' ? (data[metric] as number) : 0;

          tx.set(
            docRef,
            {
              [metric]: currentCount + 1,
              logs: trimmedLogs,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        });
      } else {
        await setDoc(
          docRef,
          {
            [metric]: increment(1),
            logs: arrayUnion(newEntry),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setNowMs(Date.now());
    } catch (error) {
      console.error(`Failed to log ${metric}:`, error);
      onNotify('Could not save floor stat');
    } finally {
      setPendingMetric(null);
    }
  };

  const handleUndoLatest = async (metric: FloorStatMetric) => {
    if (pendingMetric) return;
    const metricLogs = logsByMetric[metric];
    const latestEntry = metricLogs[metricLogs.length - 1];
    if (!latestEntry || latestEntry.uid !== currentMember.uid || stats[metric] <= 0) {
      return;
    }

    setPendingMetric(metric);
    const docRef = doc(db, 'floor_stats', dateKey);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) return;
        const data = snap.data();
        const currentLogs = Array.isArray(data.logs)
          ? (data.logs as FloorStatLogEntry[])
          : [];

        let targetIdx = -1;
        for (let i = currentLogs.length - 1; i >= 0; i -= 1) {
          if (currentLogs[i]?.metric === metric) {
            targetIdx = i;
            break;
          }
        }

        if (targetIdx === -1) return;
        const targetEntry = currentLogs[targetIdx];
        if (!targetEntry || targetEntry.uid !== currentMember.uid) return;

        const currentCount =
          typeof data[metric] === 'number' ? (data[metric] as number) : 0;
        if (currentCount <= 0) return;

        const nextLogs = [
          ...currentLogs.slice(0, targetIdx),
          ...currentLogs.slice(targetIdx + 1),
        ];

        tx.update(docRef, {
          [metric]: currentCount - 1,
          logs: nextLogs,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (error) {
      console.error(`Failed to undo ${metric}:`, error);
      onNotify('Could not undo last entry');
    } finally {
      setPendingMetric(null);
    }
  };

  const handleResetDaily = async () => {
    if (!isSupervisor || resetting) return;
    setResetting(true);
    try {
      await deleteDoc(doc(db, 'floor_stats', dateKey));
      setConfirmingReset(false);
      onNotify('Daily floor stats cleared');
    } catch (error) {
      console.error('Failed to clear daily floor stats:', error);
      onNotify('Could not reset daily stats');
    } finally {
      setResetting(false);
    }
  };

  return (
    <section
      aria-label="Floor scoreboard and activity"
      className="bg-[#191918] border border-[#262624] rounded-2xl p-4 sm:p-5 space-y-4 font-['Inter']"
    >
      {/* Header matching TweetCard / Feed tone */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-sm font-medium text-[#edece8] tracking-tight">
            Floor pulse
          </h2>
          <span className="text-[11px] text-[#71706b] tabular-nums">
            {totalWinsToday > 0 ? `${totalWinsToday} today` : 'Daily'}
          </span>
        </div>

        {isSupervisor && (
          <div className="flex items-center gap-1.5 shrink-0">
            {confirmingReset ? (
              <>
                <button
                  type="button"
                  onClick={handleResetDaily}
                  disabled={resetting}
                  className="px-2 py-1 rounded-lg bg-[#2a1d1d] border border-[#4a2c2c] text-[11px] font-medium text-[#e5a4a4] hover:text-white hover:border-[#6b3c3c] transition-colors disabled:opacity-50"
                >
                  {resetting ? 'Resetting...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  disabled={resetting}
                  className="px-2 py-1 rounded-lg bg-[#141413] border border-[#262624] text-[11px] text-[#8d8c85] hover:text-[#edece8] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                disabled={!hasStatsData || resetting}
                title="Clear today's floor stats document"
                className="px-2.5 py-1 rounded-lg bg-[#141413] border border-[#262624] hover:border-[#3d3d39] text-[11px] text-[#8d8c85] hover:text-[#edece8] transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Reset Daily
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2x2 Social Scoreboard Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {METRIC_TILES.map((tile) => {
          const count = stats[tile.key] || 0;
          const metricLogs = logsByMetric[tile.key];
          // Deduplicate recent contributors cleanly while preserving recency
          const seenContributors = new Set<string>();
          const recentContributorLogs: FloorStatLogEntry[] = [];
          for (let i = metricLogs.length - 1; i >= 0; i -= 1) {
            const entry = metricLogs[i];
            if (!seenContributors.has(entry.uid)) {
              seenContributors.add(entry.uid);
              recentContributorLogs.unshift(entry);
              if (recentContributorLogs.length >= VISIBLE_TILE_AVATARS) break;
            }
          }
          const totalUniqueContributors = new Set(metricLogs.map((e) => e.uid)).size;
          const extraContributors = Math.max(
            0,
            totalUniqueContributors - recentContributorLogs.length
          );
          const extraBadgeLabel =
            extraContributors > 9 ? '+9' : `+${extraContributors}`;

          const latestEntry = metricLogs[metricLogs.length - 1];
          const canUndoLatest =
            Boolean(latestEntry) &&
            latestEntry.uid === currentMember.uid &&
            count > 0;
          const isBusy = pendingMetric === tile.key;

          return (
            <div
              key={tile.key}
              className="group relative flex flex-col justify-between gap-3 bg-[#141413] border border-[#262624] hover:border-[#343430] rounded-xl p-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs font-medium text-[#9c9a92] truncate">
                  {tile.label}
                </span>

                <div className="flex items-center gap-1 shrink-0">
                  {canUndoLatest && (
                    <button
                      type="button"
                      onClick={() => handleUndoLatest(tile.key)}
                      disabled={Boolean(pendingMetric)}
                      aria-label={`Undo last ${tile.label} entry`}
                      title="Undo your last click"
                      className="w-6 h-6 rounded-lg bg-[#1e1e1c] hover:bg-[#2a2a27] text-[#8d8c85] hover:text-[#edece8] flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity disabled:opacity-40"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleIncrement(tile.key)}
                    disabled={Boolean(pendingMetric)}
                    aria-label={`Log ${tile.articleLabel}`}
                    title={`+1 ${tile.label}`}
                    className="w-6 h-6 rounded-lg bg-[#242422] hover:bg-[#edece8] hover:text-[#141413] active:scale-[0.96] text-[#edece8] flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    <Plus className={`w-3.5 h-3.5 ${isBusy ? 'opacity-50' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2 min-h-[24px]">
                <span className="text-xl font-semibold text-[#edece8] tabular-nums leading-none tracking-tight">
                  {count}
                </span>

                {recentContributorLogs.length > 0 && (
                  <div className="flex items-center -space-x-1.5 shrink-0">
                    {recentContributorLogs.map((entry) => {
                      const liveMember = membersById[entry.uid];
                      const avatarName = liveMember?.displayName || entry.userName;
                      const avatarSrc = liveMember?.photoUrl || entry.photoURL || '';
                      const timeLabel = formatEstTimestamp(entry.createdAt);
                      const tooltipText = timeLabel
                        ? `${avatarName} · ${timeLabel}`
                        : avatarName;

                      return (
                        <div
                          key={`${tile.key}-${entry.uid}`}
                          className="relative group/avatar focus-within:z-20 hover:z-20"
                        >
                          <div
                            tabIndex={0}
                            aria-label={tooltipText}
                            className="w-5 h-5 rounded-full ring-[1.5px] ring-[#141413] bg-[#242422] overflow-hidden flex items-center justify-center text-[9px] font-medium text-[#edece8] select-none outline-none"
                          >
                            {avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={avatarName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span>{getInitials(avatarName)}</span>
                            )}
                          </div>

                          <div
                            role="tooltip"
                            className="pointer-events-none opacity-0 group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100 transition-opacity duration-100 absolute bottom-full right-0 mb-1.5 z-30 max-w-[190px] truncate px-2 py-1 rounded-lg bg-[#111110] border border-[#2e2e2b] text-[11px] text-[#edece8] whitespace-nowrap"
                          >
                            {tooltipText}
                          </div>
                        </div>
                      );
                    })}

                    {extraContributors > 0 && (
                      <span
                        title={`${extraContributors} more teammate${extraContributors === 1 ? '' : 's'} logged today`}
                        className="relative z-10 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full ring-[1.5px] ring-[#141413] bg-[#242422] text-[9px] font-medium text-[#8d8c85] tabular-nums"
                      >
                        {extraBadgeLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Social Activity Stream */}
      <div className="pt-3 border-t border-[#222220] space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-[#8d8c85]">
            Recent activity
          </span>
          {stats.logs.length > 0 && (
            <span className="text-[11px] text-[#71706b] tabular-nums">
              {stats.logs.length === 1 ? '1 update' : `${stats.logs.length} updates`}
            </span>
          )}
        </div>

        {recentActivity.length === 0 ? (
          <p className="text-xs text-[#71706b] py-1">
            No floor activity yet today. Tap + on any stat to log a win.
          </p>
        ) : (
          <ul className="space-y-2">
            {recentActivity.map((entry) => {
              const liveMember = membersById[entry.uid];
              const actorName = liveMember?.displayName || entry.userName;
              const actorPhoto = liveMember?.photoUrl || entry.photoURL || undefined;
              const canMessage = Boolean(onOpenDm && entry.uid !== currentMember.uid);

              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-2.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {canMessage ? (
                      <button
                        type="button"
                        onClick={() => onOpenDm?.(entry.uid)}
                        className="shrink-0 rounded-full hover:opacity-85 transition-opacity"
                        title={`Message ${actorName}`}
                      >
                        <Avatar name={actorName} photoUrl={actorPhoto} size="xs" />
                      </button>
                    ) : (
                      <div className="shrink-0">
                        <Avatar name={actorName} photoUrl={actorPhoto} size="xs" />
                      </div>
                    )}

                    <p className="text-[#9c9a92] truncate">
                      {canMessage ? (
                        <button
                          type="button"
                          onClick={() => onOpenDm?.(entry.uid)}
                          className="font-medium text-[#edece8] hover:underline"
                        >
                          {actorName}
                        </button>
                      ) : (
                        <span className="font-medium text-[#edece8]">{actorName}</span>
                      )}{' '}
                      logged{' '}
                      <span className="text-[#d6d5cf]">
                        {METRIC_LABEL_MAP[entry.metric]}
                      </span>
                    </p>
                  </div>

                  <span
                    title={formatEstTimestamp(entry.createdAt)}
                    className="text-[11px] text-[#71706b] tabular-nums shrink-0"
                  >
                    {formatActivityTime(entry.createdAt, nowMs)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};
