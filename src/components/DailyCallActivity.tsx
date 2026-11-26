import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DailyCallStats, TeamMember } from '../types/team.ts';
import {
  buildCloserCallChartData,
  CallChartRange,
  CloserCallChartData,
  CloserChartSeries,
  DEFAULT_DAILY_CALL_GOAL,
  formatTalkDuration,
} from '../services/ringCentralCalls.ts';

interface DailyCallActivityProps {
  members: TeamMember[];
  dailyCallStats: DailyCallStats[];
  currentUserId?: string;
  selectedCloserId?: string | null;
  range?: CallChartRange;
  onRangeChange?: (nextRange: CallChartRange) => void;
  chartDataOverride?: CloserCallChartData;
  dailyGoal?: number;
  isLoading?: boolean;
  matchedMinHeightPx?: number | null;
  className?: string;
}

interface PlotPoint {
  x: number;
  y: number;
}

interface PlacedFloatingAvatar {
  x: number;
  y: number;
}

const DEFAULT_CHART_WIDTH = 480;
const DEFAULT_CHART_HEIGHT = 184;
const PAD_LEFT = 26;
const PAD_RIGHT = 14;
const PAD_TOP = 16;
const PAD_BOTTOM = 22;

const ACTIVE_LINE_COLOR = '#ede2be'; // Crisp warm ivory-gold foreground stroke
const INACTIVE_LINE_COLOR = '#7a7a74'; // Uniform desaturated muted slate/gray
const DEPTH_TRANSITION = 'all 350ms cubic-bezier(0.22, 1, 0.36, 1)';

function getInitials(name: string): string {
  const parts = (name || 'C').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'C';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Computes Fritsch-Carlson monotone cubic spline segments for smooth curves
 * that never overshoot maxima or dip below zero.
 */
function buildMonotoneSplineSegments(points: PlotPoint[]): {
  path: string;
  samples: PlotPoint[];
} {
  const n = points.length;
  if (n === 0) return { path: '', samples: [] };
  if (n === 1) {
    return {
      path: `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`,
      samples: [points[0]],
    };
  }

  const slopes: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    const dx = points[i + 1].x - points[i].x;
    slopes[i] = dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx;
  }

  const tangents: number[] = new Array(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];

  for (let i = 1; i < n - 1; i += 1) {
    const prev = slopes[i - 1];
    const next = slopes[i];
    if (prev * next <= 0) {
      tangents[i] = 0;
    } else {
      tangents[i] = (2 * prev * next) / (prev + next);
    }
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
    } else {
      const a = tangents[i] / slopes[i];
      const b = tangents[i + 1] / slopes[i];
      const mag = Math.hypot(a, b);
      if (mag > 3) {
        const scale = 3 / mag;
        tangents[i] = scale * a * slopes[i];
        tangents[i + 1] = scale * b * slopes[i];
      }
    }
  }

  const parts: string[] = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  const samples: PlotPoint[] = [points[0]];

  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const thirdDx = (p1.x - p0.x) / 3;
    const cp1x = p0.x + thirdDx;
    const cp1y = p0.y + tangents[i] * thirdDx;
    const cp2x = p1.x - thirdDx;
    const cp2y = p1.y - tangents[i + 1] * thirdDx;
    parts.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`
    );

    for (const t of [0.25, 0.5, 0.75, 1]) {
      const mt = 1 - t;
      const x =
        mt * mt * mt * p0.x +
        3 * mt * mt * t * cp1x +
        3 * mt * t * t * cp2x +
        t * t * t * p1.x;
      const y =
        mt * mt * mt * p0.y +
        3 * mt * mt * t * cp1y +
        3 * mt * t * t * cp2y +
        t * t * t * p1.y;
      samples.push({ x, y });
    }
  }

  return { path: parts.join(' '), samples };
}

function buildMonotoneLinePath(points: PlotPoint[]): string {
  return buildMonotoneSplineSegments(points).path;
}

function buildMonotoneAreaPath(points: PlotPoint[], baselineY: number): string {
  if (points.length === 0) return '';
  const line = buildMonotoneLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function mapSeriesToPlotPoints(
  values: number[],
  maxY: number,
  plotWidth: number,
  plotHeight: number,
  plotBottomY: number
): PlotPoint[] {
  const count = values.length;
  if (count === 0) return [];
  return values.map((val, idx) => {
    const ratioX = count === 1 ? 0.5 : idx / (count - 1);
    const ratioY = Math.max(0, Math.min(1, val / Math.max(1, maxY)));
    return {
      x: PAD_LEFT + ratioX * plotWidth,
      y: plotBottomY - ratioY * plotHeight,
    };
  });
}

function shouldShowXLabel(
  index: number,
  total: number,
  range: CallChartRange,
  plotWidth: number
): boolean {
  if (total <= 1) return true;
  if (index === 0 || index === total - 1) return true;
  if (range === 'today') {
    return plotWidth < 340 ? index % 2 === 0 : true;
  }
  if (total <= 7) {
    if (plotWidth < 360) return index === 2 || index === 4;
    return true;
  }
  if (plotWidth < 360) {
    return index === 4 || index === 9;
  }
  return index % 3 === 0;
}

/**
 * Picks the clearest focal anchor directly along the active closer's curve
 * (near their highest visible peak inside the plot bounds).
 */
function pickActiveAvatarAnchor(
  samples: PlotPoint[],
  plotRightX: number,
  plotBottomY: number
): PlacedFloatingAvatar | null {
  if (samples.length === 0) return null;
  const minX = PAD_LEFT + 18;
  const maxX = plotRightX - 18;
  const minY = PAD_TOP + 16;
  const maxY = plotBottomY - 16;

  const interior = samples.filter((pt) => pt.x >= minX && pt.x <= maxX);
  const pool = interior.length > 0 ? interior : samples;

  // Prefer the prominent peak on the active line
  let best = pool[pool.length - 1];
  for (const pt of pool) {
    if (pt.y < best.y) {
      best = pt;
    }
  }

  return {
    x: Math.max(minX, Math.min(maxX, best.x)),
    y: Math.max(minY, Math.min(maxY, best.y)),
  };
}

export const DailyCallActivity: React.FC<DailyCallActivityProps> = ({
  members,
  dailyCallStats,
  currentUserId,
  selectedCloserId,
  range: controlledRange,
  onRangeChange,
  chartDataOverride,
  dailyGoal = DEFAULT_DAILY_CALL_GOAL,
  isLoading = false,
  matchedMinHeightPx = null,
  className = '',
}) => {
  const [internalRange, setInternalRange] = useState<CallChartRange>('7d');
  const range = controlledRange ?? internalRange;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [avatarImgFailedId, setAvatarImgFailedId] = useState<string | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({
    width: DEFAULT_CHART_WIDTH,
    height: DEFAULT_CHART_HEIGHT,
  });
  const chartBoxRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleSetRange = (nextRange: CallChartRange) => {
    if (onRangeChange) {
      onRangeChange(nextRange);
    } else {
      setInternalRange(nextRange);
    }
    setHoverIndex(null);
  };

  const chartWidth = chartSize.width;
  const chartHeight = chartSize.height;
  const plotWidth = Math.max(120, chartWidth - PAD_LEFT - PAD_RIGHT);
  const plotHeight = Math.max(96, chartHeight - PAD_TOP - PAD_BOTTOM);
  const plotBottomY = PAD_TOP + plotHeight;
  const plotRightX = PAD_LEFT + plotWidth;

  const computedChartData = useMemo(
    () =>
      chartDataOverride ??
      buildCloserCallChartData(members, dailyCallStats, range, dailyGoal),
    [chartDataOverride, members, dailyCallStats, range, dailyGoal]
  );
  const chartData = computedChartData;

  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;

    const updateSize = () => {
      const nextW = Math.max(220, Math.round(el.clientWidth));
      const nextH = Math.max(172, Math.round(el.clientHeight));
      setChartSize((prev) =>
        prev.width === nextW && prev.height === nextH
          ? prev
          : { width: nextW, height: nextH }
      );
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [chartData.closers.length, isLoading]);

  // Default focus to logged-in user if present in closers, otherwise top closer
  const defaultCloserId = useMemo(() => {
    if (chartData.closers.length === 0) return null;
    if (currentUserId) {
      const selfCloser = chartData.closers.find((c) => c.uid === currentUserId);
      if (selfCloser) return selfCloser.id;
    }
    return chartData.closers[0].id;
  }, [chartData.closers, currentUserId]);

  const effectiveSelectedId = useMemo(() => {
    if (
      selectedCloserId &&
      chartData.closers.some((c) => c.id === selectedCloserId)
    ) {
      return selectedCloserId;
    }
    return defaultCloserId;
  }, [selectedCloserId, chartData.closers, defaultCloserId]);

  const focusedCloser: CloserChartSeries | null = useMemo(() => {
    if (chartData.closers.length === 0) return null;
    if (effectiveSelectedId) {
      const found = chartData.closers.find((c) => c.id === effectiveSelectedId);
      if (found) return found;
    }
    return chartData.closers[0];
  }, [chartData.closers, effectiveSelectedId]);

  const teamAvgPoints = useMemo(
    () =>
      mapSeriesToPlotPoints(
        chartData.teamAverageValues,
        chartData.maxY,
        plotWidth,
        plotHeight,
        plotBottomY
      ),
    [chartData.teamAverageValues, chartData.maxY, plotWidth, plotHeight, plotBottomY]
  );

  const seriesWithPoints = useMemo(
    () =>
      chartData.closers.map((c) => {
        const points = mapSeriesToPlotPoints(
          c.values,
          chartData.maxY,
          plotWidth,
          plotHeight,
          plotBottomY
        );
        const spline = buildMonotoneSplineSegments(points);
        return {
          closer: c,
          points,
          path: spline.path,
          areaPath: buildMonotoneAreaPath(points, plotBottomY),
          samples: spline.samples,
        };
      }),
    [chartData.closers, chartData.maxY, plotWidth, plotHeight, plotBottomY]
  );

  // Compute depth rank relative to the active closer and sort background deepest-first so active always renders last on top
  const { backgroundEntries, primaryEntry } = useMemo(() => {
    if (!focusedCloser) {
      return {
        backgroundEntries: [] as {
          entry: (typeof seriesWithPoints)[number];
          depthRank: number;
          opacity: number;
          strokeWidth: number;
        }[],
        primaryEntry: null as (typeof seriesWithPoints)[number] | null,
      };
    }

    const activeIdx = chartData.closers.findIndex(
      (c) => c.id === focusedCloser.id
    );
    const primary =
      seriesWithPoints.find((s) => s.closer.id === focusedCloser.id) || null;

    const inactiveRanked = seriesWithPoints
      .map((entry, idx) => ({ entry, idx }))
      .filter((item) => item.entry.closer.id !== focusedCloser.id)
      .sort((a, b) => {
        const distA = Math.abs(a.idx - activeIdx);
        const distB = Math.abs(b.idx - activeIdx);
        if (distA !== distB) return distA - distB;
        return a.idx - b.idx;
      })
      .map((item, orderIdx) => {
        const depthRank = orderIdx + 1;
        return {
          entry: item.entry,
          depthRank,
          opacity: depthRank === 1 ? 0.15 : 0.07,
          strokeWidth: depthRank === 1 ? 1.4 : 1.15,
        };
      })
      .sort((a, b) => b.depthRank - a.depthRank);

    return { backgroundEntries: inactiveRanked, primaryEntry: primary };
  }, [chartData.closers, focusedCloser, seriesWithPoints]);

  const activeAvatarPos = useMemo(
    () =>
      primaryEntry
        ? pickActiveAvatarAnchor(primaryEntry.samples, plotRightX, plotBottomY)
        : null,
    [primaryEntry, plotRightX, plotBottomY]
  );

  const goalY = useMemo(() => {
    const ratio = Math.max(0, Math.min(1, chartData.dailyGoal / Math.max(1, chartData.maxY)));
    return plotBottomY - ratio * plotHeight;
  }, [chartData.dailyGoal, chartData.maxY, plotBottomY, plotHeight]);

  const yTicks = useMemo(() => {
    const mid = Math.round(chartData.maxY / 2);
    return [
      { value: chartData.maxY, y: PAD_TOP },
      { value: mid, y: PAD_TOP + plotHeight / 2 },
      { value: 0, y: plotBottomY },
    ];
  }, [chartData.maxY, plotHeight, plotBottomY]);

  const activePointIndex =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < chartData.labels.length
      ? hoverIndex
      : null;

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const pointCount = chartData.labels.length;
    if (!svg || pointCount === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;

    const svgX = ((e.clientX - rect.left) / rect.width) * chartWidth;
    const clampedRatio = Math.max(0, Math.min(1, (svgX - PAD_LEFT) / plotWidth));
    const idx = Math.round(clampedRatio * Math.max(0, pointCount - 1));
    setHoverIndex(idx);
  };

  const handleSvgKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const total = chartData.labels.length;
    if (total === 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHoverIndex((prev) => (prev === null ? 0 : Math.min(total - 1, prev + 1)));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHoverIndex((prev) => (prev === null ? total - 1 : Math.max(0, prev - 1)));
    } else if (e.key === 'Escape') {
      setHoverIndex(null);
    }
  };

  const activeTotalTeamCalls = useMemo(
    () =>
      chartData.closers.reduce(
        (acc, c) => acc + (range === 'today' ? c.latestCalls : c.periodTotalCalls),
        0
      ),
    [chartData.closers, range]
  );

  const focusedMetricValue = focusedCloser
    ? range === 'today'
      ? focusedCloser.latestCalls
      : focusedCloser.periodTotalCalls
    : 0;

  const primaryPoints = primaryEntry?.points ?? [];
  const activeHoverLabel =
    activePointIndex !== null ? chartData.labels[activePointIndex] : null;
  const activeHoverPrimaryVal =
    activePointIndex !== null && focusedCloser
      ? focusedCloser.values[activePointIndex] ?? 0
      : null;
  const activeHoverPointMeta =
    activePointIndex !== null && focusedCloser
      ? focusedCloser.points[activePointIndex] ?? null
      : null;
  const activeHoverTeamAvg =
    activePointIndex !== null ? chartData.teamAverageValues[activePointIndex] ?? 0 : null;
  const activeHoverPlotPoint =
    activePointIndex !== null ? primaryPoints[activePointIndex] ?? null : null;
  const activeHoverTeamPoint =
    activePointIndex !== null ? teamAvgPoints[activePointIndex] ?? null : null;

  const activeAvatarUrl =
    focusedCloser?.avatarUrl && avatarImgFailedId !== focusedCloser.id
      ? focusedCloser.avatarUrl.trim()
      : '';

  return (
    <section
      aria-label="Daily Call Activity"
      style={
        matchedMinHeightPx && matchedMinHeightPx > 0
          ? { minHeight: `${matchedMinHeightPx}px` }
          : undefined
      }
      className={`bg-[#191918] border border-[#262624] rounded-2xl font-['Inter'] flex flex-col ${className}`}
    >
      {/* Header (Compact, Zero Redundant Avatar Strip) */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-[#222220] shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {focusedCloser && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: ACTIVE_LINE_COLOR }}
                aria-hidden="true"
              />
            )}
            <span className="text-[13px] font-medium text-[#edece8] truncate">
              {focusedCloser ? focusedCloser.name : 'Daily Call Activity'}
            </span>
          </div>

          <div
            role="group"
            aria-label="Rango temporal"
            className="inline-flex items-center p-0.5 bg-[#141413] border border-[#262624] rounded-lg shrink-0"
          >
            {(
              [
                { id: 'today', label: 'Hoy' },
                { id: '7d', label: '7d' },
                { id: '14d', label: '14d' },
              ] as { id: CallChartRange; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSetRange(tab.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] transition-colors whitespace-nowrap ${
                  range === tab.id
                    ? 'bg-[#262624] text-[#edece8] font-medium'
                    : 'text-[#8d8c85] hover:text-[#edece8]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Highlighted Foreground Closer Readout & Reference Legend */}
        <div className="flex items-end justify-between gap-2 mt-2 pt-2 border-t border-[#222220]">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-xl font-medium text-[#edece8] tracking-tight leading-none">
                {focusedMetricValue}
              </span>
              <span className="text-[11px] text-[#71706b]">
                {focusedMetricValue === 1 ? 'call' : 'calls'}
              </span>
              <span className="text-[#3a3a36]" aria-hidden="true">
                ·
              </span>
              <span className="text-[11px] text-[#8d8c85] truncate">
                Eq: {activeTotalTeamCalls}
              </span>
            </div>
            {focusedCloser &&
            focusedCloser.hasRingCentralBreakdown &&
            focusedCloser.outboundCalls !== null &&
            focusedCloser.inboundCalls !== null ? (
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#8d8c85] tabular-nums truncate">
                <span>Sal {focusedCloser.outboundCalls}</span>
                <span className="text-[#3a3a36]" aria-hidden="true">
                  ·
                </span>
                <span>Ent {focusedCloser.inboundCalls}</span>
                {focusedCloser.talkTimeSeconds !== null &&
                  focusedCloser.talkTimeSeconds > 0 && (
                    <>
                      <span className="text-[#3a3a36]" aria-hidden="true">
                        ·
                      </span>
                      <span>{formatTalkDuration(focusedCloser.talkTimeSeconds)}</span>
                    </>
                  )}
              </div>
            ) : (
              <div className="mt-1 text-[10px] text-[#71706b] truncate">
                {range === 'today'
                  ? 'Hoy · Por hora'
                  : range === '7d'
                    ? 'Últimos 7 días'
                    : 'Últimos 14 días'}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-0.5 text-[10px] text-[#71706b] shrink-0">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="w-2.5 h-0 border-t border-dashed border-[#8d8c85]"
                aria-hidden="true"
              />
              <span>Prom.</span>
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap">
              <span
                className="w-2.5 h-0 border-t border-dashed border-[#5c5b56]"
                aria-hidden="true"
              />
              <span>
                Meta {chartData.dailyGoal}
                {range === 'today' ? '/h' : ''}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Clean Depth Chart Canvas (Zero CSS Blur) */}
      <div className="px-2.5 pt-2 pb-2.5 flex-1 flex flex-col min-h-0">
        {isLoading && chartData.closers.length === 0 ? (
          <div className="p-1 flex-1 flex flex-col" aria-busy="true" aria-label="Cargando gráfico de llamadas">
            <div className="flex-1 min-h-[152px] w-full rounded-xl skeleton-shimmer" />
          </div>
        ) : chartData.closers.length === 0 ? (
          <div className="py-10 px-4 flex-1 flex items-center justify-center text-center">
            <p className="text-xs text-[#8d8c85]">
              Aún no hay closers registrados para graficar llamadas.
            </p>
          </div>
        ) : (
          <div
            ref={chartBoxRef}
            className="relative flex-1 min-h-[152px] w-full overflow-hidden rounded-xl"
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="absolute inset-0 w-full h-full block select-none focus-visible:outline-none"
              role="img"
              tabIndex={0}
              aria-label={`Tendencia de llamadas de ${focusedCloser?.name || 'closers'} comparada con el promedio del equipo`}
              onPointerMove={handleSvgPointerMove}
              onPointerLeave={() => setHoverIndex(null)}
              onKeyDown={handleSvgKeyDown}
            >
              <defs>
                <linearGradient id="closerActiveAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACTIVE_LINE_COLOR} stopOpacity="0.22" />
                  <stop offset="72%" stopColor={ACTIVE_LINE_COLOR} stopOpacity="0.05" />
                  <stop offset="100%" stopColor={ACTIVE_LINE_COLOR} stopOpacity="0" />
                </linearGradient>
                <linearGradient id="closerTeamAvgAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8d8c85" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#8d8c85" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid Lines + Left Y-Axis Numerals */}
              {yTicks.map((tick) => (
                <g key={tick.value}>
                  <line
                    x1={PAD_LEFT}
                    y1={tick.y}
                    x2={plotRightX}
                    y2={tick.y}
                    stroke={tick.value === 0 ? '#2a2a27' : '#21211f'}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_LEFT - 6}
                    y={tick.y + 3}
                    textAnchor="end"
                    fill="#686761"
                    fontSize="9.5"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {tick.value}
                  </text>
                </g>
              ))}

              {/* Daily / Hourly Goal Dashed Ceiling */}
              {goalY >= PAD_TOP && goalY <= plotBottomY && (
                <g>
                  <line
                    x1={PAD_LEFT}
                    y1={goalY}
                    x2={plotRightX}
                    y2={goalY}
                    stroke="#3e3e39"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  {Math.abs(goalY - PAD_TOP) > 12 && (
                    <text
                      x={plotRightX - 4}
                      y={goalY - 4}
                      textAnchor="end"
                      fill="#65645e"
                      fontSize="8.5"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      Meta {chartData.dailyGoal}
                      {range === 'today' ? '/h' : ''}
                    </text>
                  )}
                </g>
              )}

              {/* Subtle Vertical Guide Lines under Active Closer Points */}
              {primaryPoints.map((pt, idx) => {
                if (pt.y >= plotBottomY - 1) return null;
                return (
                  <line
                    key={`drop-${idx}`}
                    x1={pt.x}
                    y1={pt.y}
                    x2={pt.x}
                    y2={plotBottomY}
                    stroke="#343430"
                    strokeWidth={1}
                    strokeOpacity={0.34}
                  />
                );
              })}

              {/* Team Average Baseline Reference */}
              {teamAvgPoints.length > 1 && (
                <>
                  <path
                    d={buildMonotoneAreaPath(teamAvgPoints, plotBottomY)}
                    fill="url(#closerTeamAvgAreaGrad)"
                  />
                  <path
                    d={buildMonotoneLinePath(teamAvgPoints)}
                    fill="none"
                    stroke="#78766f"
                    strokeWidth={1.1}
                    strokeDasharray="3 2.5"
                    strokeOpacity={0.28}
                  />
                </>
              )}

              {/* Background Closers: Faint, Uniform Desaturated Slate Trend Lines Only */}
              {backgroundEntries.map(({ entry, opacity, strokeWidth }) => {
                if (!entry.path) return null;
                return (
                  <path
                    key={entry.closer.id}
                    d={entry.path}
                    fill="none"
                    stroke={INACTIVE_LINE_COLOR}
                    strokeWidth={strokeWidth}
                    strokeOpacity={opacity}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: DEPTH_TRANSITION }}
                  />
                );
              })}

              {/* Active Foreground Closer Rendered Strictly LAST in DOM (Crisp White/Gold + Area Fill + Nodes) */}
              {primaryEntry && primaryPoints.length > 0 && (
                <g key={`active-${primaryEntry.closer.id}`}>
                  {primaryPoints.length > 1 && (
                    <path
                      d={primaryEntry.areaPath}
                      fill="url(#closerActiveAreaGrad)"
                      style={{ transition: DEPTH_TRANSITION }}
                    />
                  )}
                  <path
                    d={primaryEntry.path}
                    fill="none"
                    stroke={ACTIVE_LINE_COLOR}
                    strokeWidth={2.5}
                    strokeOpacity={1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transition: DEPTH_TRANSITION }}
                  />
                  {primaryPoints.map((pt, idx) => (
                    <circle
                      key={`node-${idx}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={idx === primaryPoints.length - 1 ? 3.2 : 2.4}
                      fill={ACTIVE_LINE_COLOR}
                      stroke="#191918"
                      strokeWidth={1.3}
                    />
                  ))}
                </g>
              )}

              {/* Bottom X-Axis Labels */}
              {chartData.labels.map((label, idx) => {
                if (!shouldShowXLabel(idx, chartData.labels.length, range, plotWidth)) return null;
                const x =
                  chartData.labels.length === 1
                    ? PAD_LEFT + plotWidth / 2
                    : PAD_LEFT + (idx / (chartData.labels.length - 1)) * plotWidth;
                const anchor =
                  idx === 0
                    ? 'start'
                    : idx === chartData.labels.length - 1
                      ? 'end'
                      : 'middle';
                const isPointActive = activePointIndex === idx;
                return (
                  <text
                    key={`${label}-${idx}`}
                    x={x}
                    y={chartHeight - 8}
                    textAnchor={anchor}
                    fill={isPointActive ? '#edece8' : '#686761'}
                    fontSize="9.5"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {label}
                  </text>
                );
              })}

              {/* Interactive Crosshair & Point Dots (Strictly Topmost Vector Layer) */}
              {activeHoverPlotPoint && (
                <g>
                  <line
                    x1={activeHoverPlotPoint.x}
                    y1={PAD_TOP}
                    x2={activeHoverPlotPoint.x}
                    y2={plotBottomY}
                    stroke="#52524c"
                    strokeWidth={1}
                  />
                  {activeHoverTeamPoint && (
                    <circle
                      cx={activeHoverTeamPoint.x}
                      cy={activeHoverTeamPoint.y}
                      r={2.5}
                      fill="#8d8c85"
                      stroke="#191918"
                      strokeWidth={1.2}
                    />
                  )}
                  <circle
                    cx={activeHoverPlotPoint.x}
                    cy={activeHoverPlotPoint.y}
                    r={4.2}
                    fill={ACTIVE_LINE_COLOR}
                    stroke="#191918"
                    strokeWidth={1.6}
                  />
                </g>
              )}
            </svg>

            {/* Single Crisp Floating Avatar Marker for Active Closer Only */}
            {focusedCloser && activeAvatarPos && (
              <div
                aria-hidden="true"
                style={{
                  left: `${(activeAvatarPos.x / chartWidth) * 100}%`,
                  top: `${(activeAvatarPos.y / chartHeight) * 100}%`,
                  borderColor: ACTIVE_LINE_COLOR,
                  boxShadow: '0 0 0 2.5px #191918, 0 6px 16px rgba(0,0,0,0.6)',
                  transition: DEPTH_TRANSITION,
                }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-20 w-[22px] h-[22px] rounded-full border-2 bg-[#191918] overflow-hidden flex items-center justify-center"
              >
                {activeAvatarUrl ? (
                  <img
                    src={activeAvatarUrl}
                    alt={focusedCloser.name}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onError={() => setAvatarImgFailedId(focusedCloser.id)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span
                    className="text-[9px] font-medium leading-none select-none"
                    style={{ color: ACTIVE_LINE_COLOR }}
                  >
                    {getInitials(focusedCloser.name)}
                  </span>
                )}
              </div>
            )}

            {/* Floating Crosshair Readout Tooltip */}
            {activePointIndex !== null &&
              activeHoverLabel &&
              activeHoverPrimaryVal !== null &&
              focusedCloser && (
                <div
                  role="tooltip"
                  className={`pointer-events-none absolute top-1 z-30 rounded-xl border border-[#343430] bg-[#121211]/95 px-2.5 py-2 shadow-xl text-[11px] tabular-nums animate-fade-150 ${
                    activePointIndex >= chartData.labels.length / 2
                      ? 'left-8'
                      : 'right-4'
                  }`}
                >
                  <div className="text-[10px] text-[#71706b] mb-1">
                    {activeHoverLabel}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-[#edece8] font-medium truncate max-w-[130px]">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: ACTIVE_LINE_COLOR }}
                      />
                      <span className="truncate">{focusedCloser.name}</span>
                    </span>
                    <span className="text-white font-medium">
                      {activeHoverPrimaryVal} calls
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[#8d8c85] mt-0.5">
                    <span>Prom. equipo</span>
                    <span>{activeHoverTeamAvg ?? 0} calls</span>
                  </div>
                  {activeHoverPointMeta &&
                    activeHoverPointMeta.outboundCalls !== null &&
                    activeHoverPointMeta.inboundCalls !== null && (
                      <div className="mt-1.5 pt-1 border-t border-[#262624] flex items-center gap-2 text-[10px] text-[#8d8c85]">
                        <span>Sal: {activeHoverPointMeta.outboundCalls}</span>
                        <span className="text-[#3a3a36]">|</span>
                        <span>Ent: {activeHoverPointMeta.inboundCalls}</span>
                        {activeHoverPointMeta.talkTimeSeconds !== null &&
                          activeHoverPointMeta.talkTimeSeconds > 0 && (
                            <>
                              <span className="text-[#3a3a36]">|</span>
                              <span>
                                {formatTalkDuration(activeHoverPointMeta.talkTimeSeconds)}
                              </span>
                            </>
                          )}
                      </div>
                    )}
                </div>
              )}
          </div>
        )}
      </div>
    </section>
  );
};
