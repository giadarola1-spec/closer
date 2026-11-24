import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import {
  BarChart3,
  Upload,
  Calendar,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Check,
  Plus,
  Trash2,
  X,
  Loader2,
  Pencil,
  ClipboardPaste,
} from 'lucide-react';
import { auth, db, OperationType, handleFirestoreError } from '../firebase.ts';
import {
  ACCEPTED_TEAM_IDS,
  TEAM_ID,
  LIMITS,
  TeamMember,
  DailyCallStatRow,
  DailyCallStatsDoc,
} from '../types/team.ts';
import {
  getEstDateKey,
  shiftDateKey,
  formatDateLabel,
  formatEstUpdateTime,
  parseDurationToSeconds,
  formatSecondsToMMSS,
  formatSecondsToHoursMinutes,
  matchCloserMember,
  sanitizeRowInt,
  sanitizeStatRowForFirestore,
  prepareScreenshotForOcr,
} from '../utils/callStats.ts';

interface StatisticsViewProps {
  currentMember: TeamMember;
  members: TeamMember[];
  isSupervisor: boolean;
  supervisorToken: string | null;
  onNotify: (msg: string) => void;
}

type SortField = 'liveTalkSeconds' | 'outbound' | 'connected' | 'inbound' | 'total';
type SortDirection = 'asc' | 'desc';

interface DraftRow extends DailyCallStatRow {
  liveTalkInput: string;
}

function getInitials(name: string): string {
  const parts = (name || 'C').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const CloserAvatar32: React.FC<{ name: string; photoUrl?: string }> = ({
  name,
  photoUrl,
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  const showImg = Boolean(photoUrl && !imgError);

  return (
    <div className="w-8 h-8 rounded-full bg-[#222222] border border-[#262626] text-[#e5e5e5] text-[11px] font-medium flex items-center justify-center overflow-hidden shrink-0 select-none">
      {showImg ? (
        <img
          src={photoUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
};

export const StatisticsView: React.FC<StatisticsViewProps> = ({
  currentMember,
  members,
  isSupervisor,
  supervisorToken,
  onNotify,
}) => {
  const todayKey = useMemo(() => getEstDateKey(), []);
  const yesterdayKey = useMemo(() => shiftDateKey(todayKey, -1), [todayKey]);

  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [docsByDate, setDocsByDate] = useState<Record<string, DailyCallStatsDoc>>({});
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const [sortField, setSortField] = useState<SortField>('total');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  // Supervisor OCR / Preview & Confirm state
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [detectedScreenshotDate, setDetectedScreenshotDate] = useState<string>('');
  const [draftRows, setDraftRows] = useState<DraftRow[] | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const membersById = useMemo(() => {
    const map: Record<string, TeamMember> = {};
    for (const m of members) {
      map[m.uid] = m;
    }
    return map;
  }, [members]);

  // Real-time listener for team daily_call_stats documents
  useEffect(() => {
    setIsLoadingStats(true);
    const statsQuery = query(
      collection(db, 'daily_call_stats'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsub = onSnapshot(
      statsQuery,
      (snap) => {
        const next: Record<string, DailyCallStatsDoc> = {};
        for (const d of snap.docs) {
          const data = d.data() as DailyCallStatsDoc;
          next[d.id] = { ...data, id: d.id };
        }
        setDocsByDate(next);
        setIsLoadingStats(false);
      },
      (error) => {
        setIsLoadingStats(false);
        handleFirestoreError(error, OperationType.LIST, 'daily_call_stats');
      }
    );

    return () => unsub();
  }, []);

  const availableDates = useMemo(() => {
    const set = new Set<string>([todayKey, yesterdayKey, ...Object.keys(docsByDate)]);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [docsByDate, todayKey, yesterdayKey]);

  const savedPreviousDates = useMemo(() => {
    return Object.keys(docsByDate)
      .filter((d) => d !== todayKey && d !== yesterdayKey)
      .sort((a, b) => b.localeCompare(a));
  }, [docsByDate, todayKey, yesterdayKey]);

  const activeDoc = docsByDate[selectedDate] || null;
  const activeRows = activeDoc?.rows || [];

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedRows = useMemo(() => {
    return [...activeRows].sort((a, b) => {
      const diff = (a[sortField] || 0) - (b[sortField] || 0);
      if (diff !== 0) {
        return sortDir === 'desc' ? -diff : diff;
      }
      return a.name.localeCompare(b.name);
    });
  }, [activeRows, sortField, sortDir]);

  const summary = useMemo(() => {
    let totalCalls = 0;
    let totalConnected = 0;
    let totalLiveTalkSeconds = 0;
    let maxRowTotal = 0;

    for (const row of activeRows) {
      totalCalls += row.total || 0;
      totalConnected += row.connected || 0;
      totalLiveTalkSeconds += row.liveTalkSeconds || 0;
      if ((row.total || 0) > maxRowTotal) {
        maxRowTotal = row.total || 0;
      }
    }

    const connectRate =
      totalCalls > 0 ? Math.min(100, (totalConnected / totalCalls) * 100) : 0;

    return {
      totalCalls,
      totalConnected,
      connectRate,
      totalLiveTalkSeconds,
      maxRowTotal,
      repCount: activeRows.length,
    };
  }, [activeRows]);

  const processScreenshotFile = useCallback(
    async (file: File) => {
      if (!isSupervisor || isParsing) return;
      setParseError(null);
      setDetectedScreenshotDate('');
      setIsParsing(true);

      try {
        const prepared = await prepareScreenshotForOcr(file);
        setPreviewImageUrl(prepared.previewUrl);

        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          throw new Error('Please sign in again before parsing screenshots.');
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        };
        if (supervisorToken) {
          headers['X-Supervisor-Token'] = supervisorToken;
        }

        const res = await fetch('/api/statistics/parse-screenshot', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            imageBase64: prepared.base64,
            mimeType: prepared.mimeType,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            data?.error || `Failed to parse screenshot (HTTP ${res.status}).`
          );
        }

        const parsedRows = Array.isArray(data?.rows) ? data.rows : [];
        const mappedDrafts: DraftRow[] = parsedRows.map((raw: any, idx: number) => {
          const rawName = String(raw?.name || '').trim();
          const matched = matchCloserMember(rawName, members);
          const liveTalkSeconds = sanitizeRowInt(raw?.liveTalkSeconds, 864000);
          return {
            id: String(raw?.id || `row_${Date.now()}_${idx}`),
            uid: matched?.uid || '',
            name: matched?.displayName || rawName,
            ext: String(raw?.ext || '').trim().slice(0, LIMITS.EXT_MAX),
            liveTalkSeconds,
            liveTalkInput: formatSecondsToMMSS(liveTalkSeconds),
            outbound: sanitizeRowInt(raw?.outbound, 100000),
            connected: sanitizeRowInt(raw?.connected, 100000),
            inbound: sanitizeRowInt(raw?.inbound, 100000),
            total: sanitizeRowInt(raw?.total, 200000),
          };
        });

        setDraftRows(mappedDrafts);
        if (typeof data?.detectedDate === 'string' && data.detectedDate) {
          setDetectedScreenshotDate(data.detectedDate);
        }
        onNotify(
          `Parsed ${mappedDrafts.length} ${mappedDrafts.length === 1 ? 'closer' : 'closers'} from screenshot`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to parse screenshot.';
        setParseError(message);
      } finally {
        setIsParsing(false);
      }
    },
    [isSupervisor, isParsing, members, supervisorToken, onNotify]
  );

  // Global Ctrl+V / Cmd+V screenshot paste handler on Statistics view (Supervisor only)
  useEffect(() => {
    if (!isSupervisor) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processScreenshotFile(file);
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isSupervisor, processScreenshotFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      processScreenshotFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isSupervisor) return;
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processScreenshotFile(file);
    } else if (file) {
      setParseError('Please drop a PNG, JPEG, or WebP screenshot image.');
    }
  };

  const handleStartManualDraft = () => {
    if (!isSupervisor) return;
    setParseError(null);
    setPreviewImageUrl(null);
    setDetectedScreenshotDate('');
    if (activeRows.length > 0) {
      setDraftRows(
        activeRows.map((row) => ({
          ...row,
          liveTalkInput: formatSecondsToMMSS(row.liveTalkSeconds),
        }))
      );
    } else {
      const sortedMembers = [...members].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      );
      setDraftRows(
        sortedMembers.slice(0, LIMITS.STATS_ROWS_MAX).map((m, idx) => ({
          id: `manual_${Date.now()}_${idx}`,
          uid: m.uid,
          name: m.displayName,
          ext: '',
          liveTalkSeconds: 0,
          liveTalkInput: '00:00',
          outbound: 0,
          connected: 0,
          inbound: 0,
          total: 0,
        }))
      );
    }
  };

  const handleUpdateDraftRow = (
    rowId: string,
    patch: Partial<DraftRow>
  ) => {
    setDraftRows((prev) =>
      prev
        ? prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
        : prev
    );
  };

  const handleSelectDraftMember = (rowId: string, nextUid: string) => {
    const member = membersById[nextUid];
    setDraftRows((prev) =>
      prev
        ? prev.map((row) => {
            if (row.id !== rowId) return row;
            if (!nextUid || !member) {
              return { ...row, uid: '' };
            }
            return {
              ...row,
              uid: member.uid,
              name: member.displayName,
            };
          })
        : prev
    );
  };

  const handleAddDraftRow = () => {
    setDraftRows((prev) => {
      const base = prev || [];
      if (base.length >= LIMITS.STATS_ROWS_MAX) return base;
      return [
        ...base,
        {
          id: `row_${Date.now()}_${base.length}`,
          uid: '',
          name: '',
          ext: '',
          liveTalkSeconds: 0,
          liveTalkInput: '00:00',
          outbound: 0,
          connected: 0,
          inbound: 0,
          total: 0,
        },
      ];
    });
  };

  const handleRemoveDraftRow = (rowId: string) => {
    setDraftRows((prev) => (prev ? prev.filter((r) => r.id !== rowId) : null));
  };

  const handleDiscardDraft = () => {
    setDraftRows(null);
    setPreviewImageUrl(null);
    setDetectedScreenshotDate('');
    setParseError(null);
  };

  const handlePublishStats = async () => {
    if (!isSupervisor || !draftRows || isPublishing) return;

    const cleanRows = draftRows
      .slice(0, LIMITS.STATS_ROWS_MAX)
      .map((row, idx) =>
        sanitizeStatRowForFirestore(
          {
            ...row,
            liveTalkSeconds: parseDurationToSeconds(row.liveTalkInput),
          },
          idx
        )
      )
      .filter((r): r is DailyCallStatRow => r !== null);

    if (cleanRows.length === 0) {
      setParseError('Add at least one closer row with a name before publishing.');
      return;
    }

    setParseError(null);
    setIsPublishing(true);

    const targetPath = `daily_call_stats/${selectedDate}`;
    try {
      const batch = writeBatch(db);
      const statsRef = doc(db, 'daily_call_stats', selectedDate);
      const cleanUpdaterName =
        currentMember.displayName.trim().slice(0, LIMITS.DISPLAY_NAME_MAX) || 'Supervisor';

      batch.set(statsRef, {
        date: selectedDate,
        teamId: TEAM_ID,
        rows: cleanRows,
        updatedByUid: currentMember.uid,
        updatedByName: cleanUpdaterName,
        updatedAt: serverTimestamp(),
      });

      // When publishing today's report, sync matched closers' dailyCalls shown in the sidebar
      let syncedClosersCount = 0;
      if (selectedDate === todayKey) {
        const totalsByUid = new Map<string, number>();
        for (const row of cleanRows) {
          if (row.uid && membersById[row.uid]) {
            const existing = totalsByUid.get(row.uid) ?? 0;
            totalsByUid.set(
              row.uid,
              Math.min(LIMITS.DAILY_CALLS_MAX, existing + row.total)
            );
          }
        }
        for (const [uid, callsTotal] of totalsByUid.entries()) {
          batch.update(doc(db, 'members', uid), {
            dailyCalls: callsTotal,
            updatedAt: serverTimestamp(),
          });
          syncedClosersCount += 1;
        }
      }

      await batch.commit();
      setDraftRows(null);
      setPreviewImageUrl(null);
      setDetectedScreenshotDate('');
      onNotify(
        selectedDate === todayKey && syncedClosersCount > 0
          ? `Published ${selectedDate} stats & synced ${syncedClosersCount} closer ${
              syncedClosersCount === 1 ? 'profile' : 'profiles'
            }`
          : `Published stats for ${formatDateLabel(selectedDate, todayKey)}`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, targetPath);
    } finally {
      setIsPublishing(false);
    }
  };

  const matchedDraftCount = useMemo(() => {
    if (!draftRows) return 0;
    return draftRows.filter((r) => Boolean(r.uid && membersById[r.uid])).length;
  }, [draftRows, membersById]);

  const updatedAtLabel = activeDoc?.updatedAt
    ? formatEstUpdateTime(activeDoc.updatedAt)
    : '';

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-[#666666] opacity-70" />;
    }
    return sortDir === 'desc' ? (
      <ChevronDown className="w-3.5 h-3.5 text-[#e5e5e5]" />
    ) : (
      <ChevronUp className="w-3.5 h-3.5 text-[#e5e5e5]" />
    );
  };

  return (
    <div className="min-h-full bg-[#141414] text-[#e5e5e5] font-['Inter']">
      <div className="max-w-5xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-xl font-medium text-[#e5e5e5] tracking-tight">
              Statistics
            </h1>
            <span className="text-xs text-[#8e8e8e]">
              · {formatDateLabel(selectedDate, todayKey)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Date Selector */}
            <div className="inline-flex items-center bg-[#191919] border border-[#262626] rounded-[12px] p-1 gap-0.5">
              <button
                type="button"
                onClick={() => setSelectedDate(todayKey)}
                className={`px-2.5 py-1 rounded-[8px] text-xs transition-colors ${
                  selectedDate === todayKey
                    ? 'bg-[#262626] text-[#e5e5e5] font-medium'
                    : 'text-[#8e8e8e] hover:text-[#e5e5e5]'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(yesterdayKey)}
                className={`px-2.5 py-1 rounded-[8px] text-xs transition-colors ${
                  selectedDate === yesterdayKey
                    ? 'bg-[#262626] text-[#e5e5e5] font-medium'
                    : 'text-[#8e8e8e] hover:text-[#e5e5e5]'
                }`}
              >
                Yesterday
              </button>

              {savedPreviousDates.length > 0 && (
                <select
                  aria-label="Select earlier report date"
                  value={
                    savedPreviousDates.includes(selectedDate) ? selectedDate : ''
                  }
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  className="bg-transparent text-xs text-[#8e8e8e] hover:text-[#e5e5e5] px-2 py-1 outline-none cursor-pointer"
                >
                  <option value="" className="bg-[#191919] text-[#8e8e8e]">
                    History ({savedPreviousDates.length})
                  </option>
                  {savedPreviousDates.map((d) => (
                    <option
                      key={d}
                      value={d}
                      className="bg-[#191919] text-[#e5e5e5]"
                    >
                      {d}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
                className={`relative px-2 py-1 rounded-[8px] text-xs transition-colors inline-flex items-center gap-1.5 ${
                  selectedDate !== todayKey && selectedDate !== yesterdayKey
                    ? 'bg-[#262626] text-[#e5e5e5] font-medium'
                    : 'text-[#8e8e8e] hover:text-[#e5e5e5]'
                }`}
                title="Pick any date"
              >
                <Calendar className="w-3.5 h-3.5" />
                {selectedDate !== todayKey && selectedDate !== yesterdayKey && (
                  <span className="tabular-nums">{selectedDate}</span>
                )}
                <input
                  ref={dateInputRef}
                  type="date"
                  value={selectedDate}
                  max={todayKey}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  className="sr-only"
                  aria-label="Choose statistics date"
                />
              </button>
            </div>

            {/* Last updated badge */}
            {activeDoc && (
              <div className="px-3 py-1.5 rounded-[12px] bg-[#191919] border border-[#262626] text-[11px] text-[#8e8e8e] tabular-nums whitespace-nowrap">
                Last updated{updatedAtLabel ? ` at ${updatedAtLabel}` : ''} by{' '}
                <span className="text-[#e5e5e5] font-medium">
                  {activeDoc.updatedByName}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Supervisor-Only Upload & Paste Dropzone */}
        {isSupervisor && (
          <section className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => !isParsing && fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isParsing) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`w-full rounded-[12px] border border-dashed px-4 py-3.5 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                isDragging
                  ? 'bg-[#1f1f1f] border-[#666666]'
                  : 'bg-[#191919] border-[#262626] hover:border-[#404040]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-[10px] bg-[#141414] border border-[#262626] flex items-center justify-center shrink-0 text-[#8e8e8e]">
                  {isParsing ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#e5e5e5]" />
                  ) : (
                    <ClipboardPaste className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#e5e5e5] truncate">
                    {isParsing
                      ? 'Parsing RingCentral screenshot...'
                      : 'Paste RingCentral report screenshot (Ctrl+V) or click to upload'}
                  </p>
                  <p className="text-[11px] text-[#8e8e8e] truncate">
                    Extracts Name, Ext., Live talk, Outbound, Connected, Inbound &amp; Total calls
                  </p>
                </div>
              </div>

              <div
                className="flex items-center gap-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={isParsing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#141414] border border-[#262626] hover:border-[#404040] text-xs text-[#e5e5e5] transition-colors disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5 text-[#8e8e8e]" />
                  <span>Upload</span>
                </button>
                <button
                  type="button"
                  disabled={isParsing}
                  onClick={handleStartManualDraft}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-[#141414] border border-[#262626] hover:border-[#404040] text-xs text-[#8e8e8e] hover:text-[#e5e5e5] transition-colors disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>{activeRows.length > 0 ? 'Edit rows' : 'Manual'}</span>
                </button>
              </div>
            </div>

            {parseError && (
              <div className="rounded-[12px] bg-[#191919] border border-[#3a2828] px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-[#e5b4b4]">
                <span>{parseError}</span>
                <button
                  type="button"
                  onClick={() => setParseError(null)}
                  className="text-[#8e8e8e] hover:text-[#e5e5e5] shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Preview & Confirm Table */}
            {draftRows && (
              <div className="rounded-[12px] bg-[#191919] border border-[#262626] p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {previewImageUrl && (
                      <img
                        src={previewImageUrl}
                        alt="Uploaded RingCentral report"
                        className="w-12 h-9 object-cover rounded-[8px] border border-[#262626] shrink-0 bg-[#141414]"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-medium text-[#e5e5e5]">
                          Preview &amp; Confirm
                        </h2>
                        <span className="text-[11px] text-[#8e8e8e] tabular-nums">
                          · {matchedDraftCount}/{draftRows.length} matched to closers
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8e8e8e]">
                        Publishing to{' '}
                        <span className="text-[#e5e5e5]">
                          {formatDateLabel(selectedDate, todayKey)} ({selectedDate})
                        </span>
                        {selectedDate === todayKey
                          ? ' · Syncs sidebar daily call counts'
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {detectedScreenshotDate && detectedScreenshotDate !== selectedDate && (
                      <button
                        type="button"
                        onClick={() => setSelectedDate(detectedScreenshotDate)}
                        className="px-2.5 py-1.5 rounded-[10px] bg-[#141414] border border-[#262626] hover:border-[#404040] text-[11px] text-[#e5e5e5] transition-colors"
                      >
                        Use screenshot date ({detectedScreenshotDate})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleAddDraftRow}
                      disabled={draftRows.length >= LIMITS.STATS_ROWS_MAX}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] bg-[#141414] border border-[#262626] hover:border-[#404040] text-xs text-[#e5e5e5] transition-colors disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add row</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDiscardDraft}
                      disabled={isPublishing}
                      className="px-2.5 py-1.5 rounded-[10px] text-xs text-[#8e8e8e] hover:text-[#e5e5e5] transition-colors"
                    >
                      Discard
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishStats}
                      disabled={isPublishing || draftRows.length === 0}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] bg-[#e5e5e5] hover:bg-white text-[#141414] text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {isPublishing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>{isPublishing ? 'Publishing...' : 'Publish Stats'}</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto border border-[#262626] rounded-[10px] bg-[#141414]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#262626] text-[11px] text-[#8e8e8e]">
                        <th className="py-2 px-3 font-medium">Matched Profile</th>
                        <th className="py-2 px-2 font-medium">Report Name</th>
                        <th className="py-2 px-2 font-medium w-20">Ext.</th>
                        <th className="py-2 px-2 font-medium w-24 text-right">Live Talk</th>
                        <th className="py-2 px-2 font-medium w-20 text-right">Outbound</th>
                        <th className="py-2 px-2 font-medium w-20 text-right">Connected</th>
                        <th className="py-2 px-2 font-medium w-20 text-right">Inbound</th>
                        <th className="py-2 px-2 font-medium w-20 text-right">Total</th>
                        <th className="py-2 px-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222222]">
                      {draftRows.map((row) => {
                        const matchedMember = row.uid ? membersById[row.uid] : undefined;
                        return (
                          <tr key={row.id} className="hover:bg-[#191919]/70">
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2 min-w-[165px]">
                                <CloserAvatar32
                                  name={matchedMember?.displayName || row.name || '?'}
                                  photoUrl={matchedMember?.photoUrl}
                                />
                                <select
                                  value={row.uid}
                                  onChange={(e) =>
                                    handleSelectDraftMember(row.id, e.target.value)
                                  }
                                  className="w-full bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-[11px] text-[#e5e5e5] outline-none focus:border-[#404040]"
                                >
                                  <option value="">Unlinked</option>
                                  {members
                                    .slice()
                                    .sort((a, b) =>
                                      a.displayName.localeCompare(b.displayName)
                                    )
                                    .map((m) => (
                                      <option key={m.uid} value={m.uid}>
                                        {m.displayName}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={row.name}
                                maxLength={LIMITS.CALLER_NAME_MAX}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, { name: e.target.value })
                                }
                                placeholder="Closer name"
                                className="w-full min-w-[130px] bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-[#e5e5e5] outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={row.ext}
                                maxLength={LIMITS.EXT_MAX}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, { ext: e.target.value })
                                }
                                placeholder="120"
                                className="w-16 bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-[#e5e5e5] tabular-nums outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="text"
                                value={row.liveTalkInput}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, {
                                    liveTalkInput: e.target.value,
                                  })
                                }
                                onBlur={(e) => {
                                  const secs = parseDurationToSeconds(e.target.value);
                                  handleUpdateDraftRow(row.id, {
                                    liveTalkSeconds: secs,
                                    liveTalkInput: formatSecondsToMMSS(secs),
                                  });
                                }}
                                placeholder="00:00"
                                className="w-20 bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-right text-[#e5e5e5] tabular-nums outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={100000}
                                value={row.outbound}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, {
                                    outbound: sanitizeRowInt(e.target.value, 100000),
                                  })
                                }
                                className="w-16 bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-right text-[#e5e5e5] tabular-nums outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={100000}
                                value={row.connected}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, {
                                    connected: sanitizeRowInt(e.target.value, 100000),
                                  })
                                }
                                className="w-16 bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-right text-[#e5e5e5] tabular-nums outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={100000}
                                value={row.inbound}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, {
                                    inbound: sanitizeRowInt(e.target.value, 100000),
                                  })
                                }
                                className="w-16 bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-right text-[#e5e5e5] tabular-nums outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={200000}
                                value={row.total}
                                onChange={(e) =>
                                  handleUpdateDraftRow(row.id, {
                                    total: sanitizeRowInt(e.target.value, 200000),
                                  })
                                }
                                className="w-16 bg-[#191919] border border-[#262626] rounded-[8px] px-2 py-1 text-xs text-right font-medium text-[#e5e5e5] tabular-nums outline-none focus:border-[#404040]"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveDraftRow(row.id)}
                                className="p-1 rounded text-[#8e8e8e] hover:text-[#e5e5e5] hover:bg-[#222222] transition-colors"
                                title="Remove row"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Loading Shimmer State */}
        {isLoadingStats ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading call statistics">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="bg-[#191919] border border-[#262626] rounded-[12px] p-4 space-y-2.5"
                >
                  <div className="h-3 w-24 rounded-md skeleton-shimmer" />
                  <div className="h-7 w-20 rounded-md skeleton-shimmer" />
                  <div className="h-2.5 w-28 rounded-md skeleton-shimmer" />
                </div>
              ))}
            </div>
            <div className="bg-[#191919] border border-[#262626] rounded-[12px] p-4 space-y-3">
              {[0, 1, 2, 3, 4].map((idx) => (
                <div key={idx} className="flex items-center justify-between gap-4 py-1.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full skeleton-shimmer shrink-0" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-32 rounded-md skeleton-shimmer" />
                      <div className="h-2.5 w-16 rounded-md skeleton-shimmer" />
                    </div>
                  </div>
                  <div className="h-3.5 w-44 rounded-md skeleton-shimmer" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 animate-fade-150">
            {/* Top Summary Strip (3 Minimal Cards) */}
            <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-[#191919] border border-[#262626] rounded-[12px] p-4 space-y-1">
                <div className="text-xs text-[#8e8e8e]">Total Team Calls</div>
                <div className="text-2xl font-medium text-[#e5e5e5] tracking-tight tabular-nums">
                  {summary.totalCalls.toLocaleString()}
                </div>
                <div className="text-[11px] text-[#8e8e8e] tabular-nums">
                  {summary.repCount > 0
                    ? `Across ${summary.repCount} ${
                        summary.repCount === 1 ? 'closer' : 'closers'
                      }`
                    : 'No report uploaded yet'}
                </div>
              </div>

              <div className="bg-[#191919] border border-[#262626] rounded-[12px] p-4 space-y-1">
                <div className="text-xs text-[#8e8e8e]">Connected Calls</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-medium text-[#e5e5e5] tracking-tight tabular-nums">
                    {summary.totalConnected.toLocaleString()}
                  </span>
                  {summary.totalCalls > 0 && (
                    <span className="text-xs text-[#8e8e8e] tabular-nums">
                      {summary.connectRate.toFixed(1)}% rate
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#8e8e8e]">
                  Live conversations answered
                </div>
              </div>

              <div className="bg-[#191919] border border-[#262626] rounded-[12px] p-4 space-y-1">
                <div className="text-xs text-[#8e8e8e]">Total Live Talk</div>
                <div className="text-2xl font-medium text-[#e5e5e5] tracking-tight tabular-nums">
                  {formatSecondsToHoursMinutes(summary.totalLiveTalkSeconds)}
                </div>
                <div className="text-[11px] text-[#8e8e8e] tabular-nums">
                  {summary.repCount > 0
                    ? `Avg ${formatSecondsToHoursMinutes(
                        Math.round(summary.totalLiveTalkSeconds / summary.repCount)
                      )} / closer`
                    : 'Combined floor talk time'}
                </div>
              </div>
            </section>

            {/* Closer Leaderboard & Breakdown Table */}
            <section className="bg-[#191919] border border-[#262626] rounded-[12px] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#262626] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-[#e5e5e5]">
                  <BarChart3 className="w-3.5 h-3.5 text-[#8e8e8e]" />
                  <span>Closer Breakdown</span>
                </div>
                {isSupervisor && activeRows.length > 0 && !draftRows && (
                  <button
                    type="button"
                    onClick={handleStartManualDraft}
                    className="inline-flex items-center gap-1.5 text-[11px] text-[#8e8e8e] hover:text-[#e5e5e5] transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Edit report</span>
                  </button>
                )}
              </div>

              {sortedRows.length === 0 ? (
                <div className="px-6 py-12 text-center space-y-2">
                  <p className="text-sm font-medium text-[#e5e5e5]">
                    No call statistics for {formatDateLabel(selectedDate, todayKey)}
                  </p>
                  <p className="text-xs text-[#8e8e8e] max-w-md mx-auto">
                    {isSupervisor
                      ? 'Paste a RingCentral report screenshot above (Ctrl+V) or upload a screenshot to publish today’s closer breakdown.'
                      : 'A supervisor has not published a RingCentral call report for this date yet.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#262626] text-[11px] text-[#8e8e8e]">
                        <th className="py-2.5 px-4 font-medium">Closer</th>
                        <th className="py-2.5 px-3 font-medium text-right">
                          <button
                            type="button"
                            onClick={() => handleSort('liveTalkSeconds')}
                            className="inline-flex items-center justify-end gap-1 hover:text-[#e5e5e5] transition-colors"
                          >
                            <span>Live Talk</span>
                            {renderSortIcon('liveTalkSeconds')}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right">
                          <button
                            type="button"
                            onClick={() => handleSort('outbound')}
                            className="inline-flex items-center justify-end gap-1 hover:text-[#e5e5e5] transition-colors"
                          >
                            <span>Outbound</span>
                            {renderSortIcon('outbound')}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right">
                          <button
                            type="button"
                            onClick={() => handleSort('connected')}
                            className="inline-flex items-center justify-end gap-1 hover:text-[#e5e5e5] transition-colors"
                          >
                            <span>Connected</span>
                            {renderSortIcon('connected')}
                          </button>
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right">
                          <button
                            type="button"
                            onClick={() => handleSort('inbound')}
                            className="inline-flex items-center justify-end gap-1 hover:text-[#e5e5e5] transition-colors"
                          >
                            <span>Inbound</span>
                            {renderSortIcon('inbound')}
                          </button>
                        </th>
                        <th className="py-2.5 px-4 font-medium text-right w-36">
                          <button
                            type="button"
                            onClick={() => handleSort('total')}
                            className="inline-flex items-center justify-end gap-1 hover:text-[#e5e5e5] transition-colors"
                          >
                            <span>Total</span>
                            {renderSortIcon('total')}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#222222]">
                      {sortedRows.map((row) => {
                        const matchedMember = row.uid ? membersById[row.uid] : undefined;
                        const displayName = matchedMember?.displayName || row.name;
                        const relativePct =
                          summary.maxRowTotal > 0
                            ? Math.max(
                                row.total > 0 ? 4 : 0,
                                Math.round((row.total / summary.maxRowTotal) * 100)
                              )
                            : 0;

                        return (
                          <tr
                            key={row.id}
                            className="hover:bg-[#1f1f1f]/60 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3 min-w-[170px]">
                                <CloserAvatar32
                                  name={displayName}
                                  photoUrl={matchedMember?.photoUrl}
                                />
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium text-[#e5e5e5] truncate">
                                    {displayName}
                                  </div>
                                  <div className="text-[11px] text-[#8e8e8e] tabular-nums">
                                    {row.ext ? `Ext. ${row.ext}` : 'No ext.'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right text-xs text-[#e5e5e5] tabular-nums whitespace-nowrap">
                              {formatSecondsToMMSS(row.liveTalkSeconds)}
                            </td>
                            <td className="py-3 px-3 text-right text-xs text-[#8e8e8e] tabular-nums whitespace-nowrap">
                              {row.outbound.toLocaleString()}
                            </td>
                            <td className="py-3 px-3 text-right text-xs text-[#e5e5e5] tabular-nums whitespace-nowrap">
                              {row.connected.toLocaleString()}
                            </td>
                            <td className="py-3 px-3 text-right text-xs text-[#8e8e8e] tabular-nums whitespace-nowrap">
                              {row.inbound.toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex flex-col items-end gap-1.5 w-24">
                                <span className="text-xs font-semibold text-[#e5e5e5] tabular-nums">
                                  {row.total.toLocaleString()}
                                </span>
                                <div className="w-full h-1 rounded-full bg-[#262626] overflow-hidden">
                                  <div
                                    className="h-full bg-[#e5e5e5] rounded-full transition-all duration-300"
                                    style={{ width: `${relativePct}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
