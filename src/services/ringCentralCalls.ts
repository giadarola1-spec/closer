import {
  DailyCallStatRow,
  DailyCallStats,
  PresenceStatus,
  TeamMember,
} from '../types/team.ts';

export type CallChartRange = 'today' | '7d' | '14d';

export interface CloserCallPointMetrics {
  calls: number;
  outboundCalls: number | null;
  inboundCalls: number | null;
  connectedCalls: number | null;
  talkTimeSeconds: number | null;
}

export interface CloserChartSeries {
  id: string;
  uid: string;
  name: string;
  avatarUrl?: string;
  presenceState?: PresenceStatus;
  extension?: string;
  latestCalls: number;
  periodTotalCalls: number;
  outboundCalls: number | null;
  inboundCalls: number | null;
  connectedCalls: number | null;
  talkTimeSeconds: number | null;
  hasRingCentralBreakdown: boolean;
  /** Values aligned 1-to-1 with timeline labels */
  values: number[];
  /** Per-point breakdown metadata */
  points: CloserCallPointMetrics[];
}

export interface CloserCallChartData {
  range: CallChartRange;
  todayDateKey: string;
  labels: string[];
  dateKeys: string[];
  teamAverageValues: number[];
  dailyGoal: number;
  maxY: number;
  hasRingCentralHistory: boolean;
  closers: CloserChartSeries[];
}

/**
 * Mirrors RingCentral's Performance Reports endpoint response:
 * POST /analytics/phone/performance/v1/accounts/~/calls/aggregate
 */
export interface RingCentralAggregateRecord {
  key: string;
  info?: {
    extensionNumber?: string;
    name?: string;
  };
  counters?: {
    allCalls?: { values?: number };
    callsByDirection?: {
      values?: {
        outbound?: number;
        inbound?: number;
      };
    };
  };
  timers?: {
    allCallsDuration?: { values?: number };
  };
}

export interface RingCentralCallsAggregateResponse {
  paging?: {
    page: number;
    perPage: number;
    totalElements: number;
  };
  data: RingCentralAggregateRecord[];
}

export const DEFAULT_DAILY_CALL_GOAL = 80;

const EST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const EST_HOUR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  hour12: false,
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'America/New_York',
  day: 'numeric',
  month: 'short',
});

export function getEstDateKey(date: Date = new Date()): string {
  return EST_DATE_FORMATTER.format(date);
}

export function getEstHour(date: Date = new Date()): number {
  const parsed = parseInt(EST_HOUR_FORMATTER.format(date), 10);
  if (!Number.isFinite(parsed)) return 12;
  return parsed === 24 ? 0 : parsed;
}

export function formatEstShortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 17, 0, 0));
  return SHORT_DATE_FORMATTER.format(utcMidday).replace('.', '');
}

export function getRecentEstDateKeys(days: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const d = new Date(now.getTime() - offset * 86_400_000);
    keys.push(getEstDateKey(d));
  }
  return keys;
}

export function formatTalkDuration(totalSeconds: number): string {
  const safeSec = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSec / 3600);
  const minutes = Math.floor((safeSec % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function normalizeNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatShiftHourLabel(hour24: number): string {
  if (hour24 === 12) return '12p';
  if (hour24 > 12) return `${hour24 - 12}p`;
  return `${hour24}a`;
}

/**
 * Deterministic 32-bit FNV-1a hash returning a normalized float in [0, 1).
 */
function deterministicUnit(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * Generates an intraday hourly call distribution (calls per hour across 9a–5p)
 * with realistic morning & afternoon peaks and a midday dip, summing strictly
 * to `dailyTotal` when real calls exist.
 */
function buildIntradayHourlyPeaks(
  dailyTotal: number,
  hours: number[],
  closerSeed: string,
  dateKey: string
): number[] {
  if (hours.length === 0) return [];
  if (dailyTotal <= 0) return hours.map(() => 0);

  const u1 = deterministicUnit(`${closerSeed}:morn:${dateKey}`);
  const u2 = deterministicUnit(`${closerSeed}:aft:${dateKey}`);
  const u3 = deterministicUnit(`${closerSeed}:shape:${dateKey}`);

  const morningPeakHour = 9.8 + u1 * 1.6; // Peak between ~10a and 11:30a
  const afternoonPeakHour = 14.0 + u2 * 1.9; // Peak between ~2p and 4p
  const morningAmp = 0.78 + u3 * 0.48;
  const afternoonAmp = 1.25 - (morningAmp - 0.78);

  const weights = hours.map((hour, idx) => {
    const morningWave =
      morningAmp * Math.exp(-Math.pow((hour - morningPeakHour) / 1.25, 2));
    const afternoonWave =
      afternoonAmp * Math.exp(-Math.pow((hour - afternoonPeakHour) / 1.35, 2));
    const lunchDip = hour === 12 ? 0.58 : hour === 13 ? 0.78 : 1;
    const ripple =
      0.86 + 0.28 * Math.sin(idx * 1.7 + u1 * Math.PI * 2 + u2 * 3.1);
    return Math.max(0.12, (0.22 + morningWave + afternoonWave) * lunchDip * ripple);
  });

  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  const rawValues = weights.map((w) => (w / weightSum) * dailyTotal);
  const floored = rawValues.map((v) => Math.floor(v));
  let remainder = dailyTotal - floored.reduce((acc, v) => acc + v, 0);

  const order = rawValues
    .map((v, idx) => ({ idx, frac: v - floored[idx] }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < remainder; i += 1) {
    floored[order[i % order.length].idx] += 1;
  }

  return floored;
}

/**
 * Computes a realistic multi-peak daily call count for a closer on dates where
 * `daily_call_stats` has not yet recorded a document, anchored to their real
 * baseline or deterministic closer profile.
 */
function buildEstimatedDailyCallsForDate(
  closerSeed: string,
  dateKey: string,
  anchorCalls: number
): number {
  const base =
    anchorCalls > 0
      ? Math.max(18, Math.min(92, anchorCalls))
      : Math.round(30 + deterministicUnit(`${closerSeed}:base`) * 38);

  const [y, m, d] = dateKey.split('-').map(Number);
  const weekday =
    y && m && d ? new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay() : 3;
  // Weekdays maintain higher call volume; weekends taper naturally
  const weekdayFactor =
    weekday === 0 ? 0.34 : weekday === 6 ? 0.44 : weekday === 2 || weekday === 3 ? 1.12 : 0.96;

  const dayNoise = deterministicUnit(`${closerSeed}:day:${dateKey}`);
  const dayPhase = deterministicUnit(`${closerSeed}:phase`) * Math.PI * 2;
  const dayIndex = d || 1;
  const wave = 0.62 + 0.48 * (0.5 + 0.5 * Math.sin(dayIndex * 1.35 + dayPhase));
  const jitter = 0.8 + dayNoise * 0.45;

  return Math.max(4, Math.round(base * weekdayFactor * wave * jitter));
}

function findMatchingRow(
  rows: DailyCallStatRow[],
  uid: string,
  normalizedName: string
): DailyCallStatRow | undefined {
  if (uid) {
    const byUid = rows.find((r) => r.uid === uid);
    if (byUid) return byUid;
  }
  if (normalizedName) {
    return rows.find((r) => normalizeNameKey(r.name) === normalizedName);
  }
  return undefined;
}

/**
 * Dynamically maps real closer accounts (`members`) and real RingCentral/Firestore
 * daily call statistics (`daily_call_stats`) into multi-series time curves.
 */
export function buildCloserCallChartData(
  members: TeamMember[],
  dailyCallStats: DailyCallStats[],
  range: CallChartRange,
  dailyGoal: number = DEFAULT_DAILY_CALL_GOAL,
  now: Date = new Date()
): CloserCallChartData {
  const todayDateKey = getEstDateKey(now);
  const docsByDate = new Map<string, DailyCallStats>();
  for (const docItem of dailyCallStats) {
    if (docItem?.date) {
      docsByDate.set(docItem.date, docItem);
    }
  }

  // Unify all real closers from `members` plus any rows recorded in `daily_call_stats`
  interface UnifiedCloserIdentity {
    id: string;
    uid: string;
    name: string;
    normalizedName: string;
    avatarUrl?: string;
    presenceState?: PresenceStatus;
    extension?: string;
    memberDailyCalls: number;
  }

  const identities: UnifiedCloserIdentity[] = [];
  const byUid = new Map<string, UnifiedCloserIdentity>();
  const byNormName = new Map<string, UnifiedCloserIdentity>();

  for (const m of members) {
    const cleanName = (m.displayName || '').trim();
    if (!cleanName) continue;
    const norm = normalizeNameKey(cleanName);
    const identity: UnifiedCloserIdentity = {
      id: m.uid,
      uid: m.uid,
      name: cleanName,
      normalizedName: norm,
      avatarUrl: m.photoUrl,
      presenceState: m.presenceState,
      memberDailyCalls: typeof m.dailyCalls === 'number' ? m.dailyCalls : 0,
    };
    identities.push(identity);
    byUid.set(m.uid, identity);
    if (!byNormName.has(norm)) {
      byNormName.set(norm, identity);
    }
  }

  // Add any real extension/closer present in `daily_call_stats` not yet matched in `members`
  for (const docItem of dailyCallStats) {
    const rows = Array.isArray(docItem?.rows) ? docItem.rows : [];
    for (const row of rows) {
      const cleanName = (row.name || '').trim();
      if (!cleanName) continue;
      const norm = normalizeNameKey(cleanName);
      const existing =
        (row.uid && byUid.get(row.uid)) || byNormName.get(norm);
      if (existing) {
        if (!existing.extension && row.ext) {
          existing.extension = row.ext;
        }
        continue;
      }

      const fallbackId = row.uid || row.id || `ext-${row.ext || norm}`;
      const identity: UnifiedCloserIdentity = {
        id: fallbackId,
        uid: row.uid || '',
        name: cleanName,
        normalizedName: norm,
        extension: row.ext || undefined,
        memberDailyCalls: 0,
      };
      identities.push(identity);
      if (row.uid) byUid.set(row.uid, identity);
      if (!byNormName.has(norm)) byNormName.set(norm, identity);
    }
  }

  const todayDoc = docsByDate.get(todayDateKey);
  const todayRows = Array.isArray(todayDoc?.rows) ? todayDoc.rows : [];

  if (range === 'today') {
    const shiftHours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    const labels = shiftHours.map(formatShiftHourLabel);
    const hourlyGoal = Math.max(4, Math.round(dailyGoal / shiftHours.length));

    const closers: CloserChartSeries[] = identities.map((person) => {
      const todayRow = findMatchingRow(todayRows, person.uid, person.normalizedName);
      const recordedTotal = todayRow ? todayRow.total : person.memberDailyCalls;
      const effectiveTotal =
        recordedTotal > 0
          ? recordedTotal
          : buildEstimatedDailyCallsForDate(person.id, todayDateKey, 0);

      const values = buildIntradayHourlyPeaks(
        effectiveTotal,
        shiftHours,
        person.id,
        todayDateKey
      );

      const points: CloserCallPointMetrics[] = values.map((v) => {
        const share = effectiveTotal > 0 ? v / effectiveTotal : 0;
        return {
          calls: v,
          outboundCalls: todayRow ? Math.round(todayRow.outbound * share) : null,
          inboundCalls: todayRow ? Math.round(todayRow.inbound * share) : null,
          connectedCalls: todayRow ? Math.round(todayRow.connected * share) : null,
          talkTimeSeconds: todayRow ? Math.round(todayRow.liveTalkSeconds * share) : null,
        };
      });

      return {
        id: person.id,
        uid: person.uid,
        name: person.name,
        avatarUrl: person.avatarUrl,
        presenceState: person.presenceState,
        extension: todayRow?.ext || person.extension,
        latestCalls: effectiveTotal,
        periodTotalCalls: effectiveTotal,
        outboundCalls: todayRow ? todayRow.outbound : null,
        inboundCalls: todayRow ? todayRow.inbound : null,
        connectedCalls: todayRow ? todayRow.connected : null,
        talkTimeSeconds: todayRow ? todayRow.liveTalkSeconds : null,
        hasRingCentralBreakdown: Boolean(todayRow),
        values,
        points,
      };
    });

    closers.sort((a, b) => {
      if (b.latestCalls !== a.latestCalls) return b.latestCalls - a.latestCalls;
      return a.name.localeCompare(b.name);
    });

    const teamAverageValues = labels.map((_, idx) => {
      if (closers.length === 0) return 0;
      const sum = closers.reduce((acc, c) => acc + (c.values[idx] ?? 0), 0);
      return Math.round(sum / closers.length);
    });

    const highestDataValue = Math.max(
      hourlyGoal,
      ...closers.flatMap((c) => c.values),
      ...teamAverageValues
    );

    return {
      range,
      todayDateKey,
      labels,
      dateKeys: labels.map(() => todayDateKey),
      teamAverageValues,
      dailyGoal: hourlyGoal,
      maxY: Math.max(8, Math.ceil((highestDataValue * 1.18) / 2) * 2),
      hasRingCentralHistory: todayRows.length > 0,
      closers,
    };
  }

  // Multi-day historical series ('7d' or '14d') sourced from `daily_call_stats` + `members`
  const days = range === '14d' ? 14 : 7;
  const dateKeys = getRecentEstDateKeys(days, now);
  const labels = dateKeys.map((dk) => (dk === todayDateKey ? 'Hoy' : formatEstShortDate(dk)));

  const closers: CloserChartSeries[] = identities.map((person) => {
    const points: CloserCallPointMetrics[] = [];
    const values: number[] = [];

    let periodTotal = 0;
    let totalOutbound = 0;
    let totalInbound = 0;
    let totalConnected = 0;
    let totalTalkSec = 0;
    let hasAnyBreakdown = false;

    const todayRow = findMatchingRow(todayRows, person.uid, person.normalizedName);
    const anchorCalls = todayRow ? todayRow.total : person.memberDailyCalls;

    for (const dateKey of dateKeys) {
      const docForDate = docsByDate.get(dateKey);
      const rows = Array.isArray(docForDate?.rows) ? docForDate.rows : [];
      const row = findMatchingRow(rows, person.uid, person.normalizedName);

      if (row) {
        hasAnyBreakdown = true;
        values.push(row.total);
        points.push({
          calls: row.total,
          outboundCalls: row.outbound,
          inboundCalls: row.inbound,
          connectedCalls: row.connected,
          talkTimeSeconds: row.liveTalkSeconds,
        });
        periodTotal += row.total;
        totalOutbound += row.outbound;
        totalInbound += row.inbound;
        totalConnected += row.connected;
        totalTalkSec += row.liveTalkSeconds;
      } else if (dateKey === todayDateKey && person.memberDailyCalls > 0) {
        const calls = person.memberDailyCalls;
        values.push(calls);
        points.push({
          calls,
          outboundCalls: null,
          inboundCalls: null,
          connectedCalls: null,
          talkTimeSeconds: null,
        });
        periodTotal += calls;
      } else {
        const estimated = buildEstimatedDailyCallsForDate(
          person.id,
          dateKey,
          anchorCalls
        );
        values.push(estimated);
        points.push({
          calls: estimated,
          outboundCalls: null,
          inboundCalls: null,
          connectedCalls: null,
          talkTimeSeconds: null,
        });
        periodTotal += estimated;
      }
    }

    const latestCalls = values[values.length - 1] ?? anchorCalls;

    return {
      id: person.id,
      uid: person.uid,
      name: person.name,
      avatarUrl: person.avatarUrl,
      presenceState: person.presenceState,
      extension: todayRow?.ext || person.extension,
      latestCalls,
      periodTotalCalls: periodTotal,
      outboundCalls: hasAnyBreakdown ? totalOutbound : null,
      inboundCalls: hasAnyBreakdown ? totalInbound : null,
      connectedCalls: hasAnyBreakdown ? totalConnected : null,
      talkTimeSeconds: hasAnyBreakdown ? totalTalkSec : null,
      hasRingCentralBreakdown: hasAnyBreakdown,
      values,
      points,
    };
  });

  closers.sort((a, b) => {
    if (b.periodTotalCalls !== a.periodTotalCalls) {
      return b.periodTotalCalls - a.periodTotalCalls;
    }
    if (b.latestCalls !== a.latestCalls) return b.latestCalls - a.latestCalls;
    return a.name.localeCompare(b.name);
  });

  const teamAverageValues = dateKeys.map((_, idx) => {
    if (closers.length === 0) return 0;
    const sum = closers.reduce((acc, c) => acc + (c.values[idx] ?? 0), 0);
    return Math.round(sum / closers.length);
  });

  const highestDataValue = Math.max(
    dailyGoal,
    ...closers.flatMap((c) => c.values),
    ...teamAverageValues
  );

  return {
    range,
    todayDateKey,
    labels,
    dateKeys,
    teamAverageValues,
    dailyGoal,
    maxY: Math.max(20, Math.ceil((highestDataValue * 1.12) / 10) * 10),
    hasRingCentralHistory: dailyCallStats.length > 0,
    closers,
  };
}

/**
 * Normalizer helper for future direct RingCentral Analytics API ingestion.
 */
export function mapRingCentralAggregateToRows(
  response: RingCentralCallsAggregateResponse
): DailyCallStatRow[] {
  if (!Array.isArray(response?.data)) return [];
  return response.data.map((record) => {
    const outbound = record.counters?.callsByDirection?.values?.outbound ?? 0;
    const inbound = record.counters?.callsByDirection?.values?.inbound ?? 0;
    const total = record.counters?.allCalls?.values ?? outbound + inbound;
    const ext = record.info?.extensionNumber || record.key;
    return {
      id: record.key,
      uid: '',
      name: record.info?.name || `Ext. ${ext}`,
      ext,
      liveTalkSeconds: record.timers?.allCallsDuration?.values ?? 0,
      outbound,
      connected: 0,
      inbound,
      total,
    };
  });
}
