import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  setDoc,
  deleteDoc,
  doc,
  query,
  where,
  limit,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { Eraser, Undo2, Trash2 } from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../firebase.ts';
import {
  TEAM_ID,
  ACCEPTED_TEAM_IDS,
  LIMITS,
  TeamMember,
  DrawboardPoint,
  DrawboardStroke,
  DrawboardColor,
  DrawboardSize,
  DRAWBOARD_BG,
  DRAWBOARD_SWATCHES,
  DRAWBOARD_SIZES,
} from '../types/team.ts';

interface TeamScratchpadProps {
  currentMember: TeamMember;
  membersById: Record<string, TeamMember>;
  onNotify: (msg: string) => void;
}

function round4(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 10000) / 10000;
}

function downsamplePoints(points: DrawboardPoint[], maxPoints: number): DrawboardPoint[] {
  if (points.length <= maxPoints) return points;
  const result: DrawboardPoint[] = [points[0]];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(points[Math.round(i * step)]);
  }
  result.push(points[points.length - 1]);
  return result;
}

function renderStrokeOnContext(
  ctx: CanvasRenderingContext2D,
  points: DrawboardPoint[],
  color: string,
  width: number,
  canvasWidth: number,
  canvasHeight: number
) {
  if (points.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    const px = points[0].x * canvasWidth;
    const py = points[0].y * canvasHeight;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, width / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x * canvasWidth, points[0].y * canvasHeight);

  if (points.length === 2) {
    ctx.lineTo(points[1].x * canvasWidth, points[1].y * canvasHeight);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const currX = points[i].x * canvasWidth;
      const currY = points[i].y * canvasHeight;
      const nextX = points[i + 1].x * canvasWidth;
      const nextY = points[i + 1].y * canvasHeight;
      const midX = (currX + nextX) / 2;
      const midY = (currY + nextY) / 2;
      ctx.quadraticCurveTo(currX, currY, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x * canvasWidth, last.y * canvasHeight);
  }

  ctx.stroke();
  ctx.restore();
}

export const TeamScratchpad: React.FC<TeamScratchpadProps> = ({
  currentMember,
  membersById,
  onNotify,
}) => {
  const [strokes, setStrokes] = useState<DrawboardStroke[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedColor, setSelectedColor] = useState<(typeof DRAWBOARD_SWATCHES)[number]['hex']>(
    '#e5e5e5'
  );
  const [isEraser, setIsEraser] = useState(false);
  const [strokeWidth, setStrokeWidth] = useState<DrawboardSize>(2);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const isDrawingRef = useRef(false);
  const activePointsRef = useRef<DrawboardPoint[]>([]);
  const localOrderRef = useRef<Record<string, number>>({});
  const localSeqRef = useRef(0);

  // Subscribe to team drawboard_strokes (capped at 300 strokes to keep read usage minimal)
  useEffect(() => {
    const q = query(
      collection(db, 'drawboard_strokes'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS]),
      limit(300)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as DrawboardStroke)
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.();
            const tb = b.createdAt?.toMillis?.();
            if (ta != null && tb != null && ta !== tb) return ta - tb;
            if (ta == null && tb != null) return 1;
            if (ta != null && tb == null) return -1;
            const oa = localOrderRef.current[a.id] ?? 0;
            const ob = localOrderRef.current[b.id] ?? 0;
            return oa - ob;
          });
        setStrokes(list);
        setIsLoading(false);
      },
      (error) => {
        setIsLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'drawboard_strokes');
      }
    );

    return () => unsub();
  }, []);

  const getBrushColor = useCallback((): DrawboardColor => {
    return isEraser ? DRAWBOARD_BG : selectedColor;
  }, [isEraser, selectedColor]);

  const getEffectiveWidth = useCallback((): number => {
    return isEraser ? Math.min(24, strokeWidth * 3) : strokeWidth;
  }, [isEraser, strokeWidth]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvasSizeRef.current;
    if (width <= 0 || height <= 0) return;

    ctx.fillStyle = DRAWBOARD_BG;
    ctx.fillRect(0, 0, width, height);

    for (const stroke of strokes) {
      renderStrokeOnContext(
        ctx,
        stroke.points || [],
        stroke.color,
        stroke.width,
        width,
        height
      );
    }

    if (isDrawingRef.current && activePointsRef.current.length > 0) {
      renderStrokeOnContext(
        ctx,
        activePointsRef.current,
        getBrushColor(),
        getEffectiveWidth(),
        width,
        height
      );
    }
  }, [strokes, getBrushColor, getEffectiveWidth]);

  // Keep canvas backing store synchronized with responsive container dimensions
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvasSizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      redrawCanvas();
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>): DrawboardPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: round4((e.clientX - rect.left) / rect.width),
      y: round4((e.clientY - rect.top) / rect.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const point = getNormalizedPoint(e);
    if (!point) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic events
    }

    setConfirmClear(false);
    isDrawingRef.current = true;
    activePointsRef.current = [point];
    redrawCanvas();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const point = getNormalizedPoint(e);
    if (!point) return;

    const currentPoints = activePointsRef.current;
    const prev = currentPoints[currentPoints.length - 1];
    if (prev) {
      const dx = point.x - prev.x;
      const dy = point.y - prev.y;
      if (dx * dx + dy * dy < 0.000025) {
        return;
      }
    }

    currentPoints.push(point);
    redrawCanvas();
  };

  const finishStroke = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore capture release errors
    }

    const rawPoints = activePointsRef.current;
    activePointsRef.current = [];
    if (rawPoints.length === 0) {
      redrawCanvas();
      return;
    }

    const finalPoints = downsamplePoints(rawPoints, LIMITS.DRAWBOARD_POINTS_MAX);
    const color = getBrushColor();
    const width = getEffectiveWidth();
    const strokeRef = doc(collection(db, 'drawboard_strokes'));
    localOrderRef.current[strokeRef.id] = ++localSeqRef.current;

    const localStroke: DrawboardStroke = {
      id: strokeRef.id,
      teamId: TEAM_ID,
      points: finalPoints,
      color,
      width,
      userId: currentMember.uid,
      userName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
      createdAt: null,
    };
    setStrokes((prev) => [...prev, localStroke]);

    try {
      await setDoc(strokeRef, {
        teamId: TEAM_ID,
        points: finalPoints,
        color,
        width,
        userId: currentMember.uid,
        userName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      setStrokes((prev) => prev.filter((s) => s.id !== strokeRef.id));
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `drawboard_strokes/${strokeRef.id}`
      );
    }
  };

  const myLastStroke = [...strokes]
    .reverse()
    .find((s) => s.userId === currentMember.uid);

  const handleUndo = async () => {
    if (!myLastStroke || isMutating) return;
    const targetId = myLastStroke.id;
    setConfirmClear(false);
    setIsMutating(true);
    setStrokes((prev) => prev.filter((s) => s.id !== targetId));
    try {
      await deleteDoc(doc(db, 'drawboard_strokes', targetId));
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `drawboard_strokes/${targetId}`
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleClearBoard = async () => {
    if (strokes.length === 0 || isMutating) return;
    const toDelete = [...strokes];
    setIsMutating(true);
    setConfirmClear(false);
    setStrokes([]);
    try {
      for (let i = 0; i < toDelete.length; i += 450) {
        const chunk = toDelete.slice(i, i + 450);
        const batch = writeBatch(db);
        for (const stroke of chunk) {
          batch.delete(doc(db, 'drawboard_strokes', stroke.id));
        }
        await batch.commit();
      }
      onNotify('Scratchpad cleared');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'drawboard_strokes');
    } finally {
      setIsMutating(false);
    }
  };

  const lastStroke = strokes.length > 0 ? strokes[strokes.length - 1] : null;
  const lastAuthorName = lastStroke
    ? membersById[lastStroke.userId]?.displayName || lastStroke.userName
    : null;

  return (
    <section
      aria-label="Team Scratchpad"
      className="bg-[#191919] border border-[#262626] rounded-[12px] p-3.5 space-y-2.5 font-['Inter']"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-[#e5e5e5] tracking-tight">
          Team Scratchpad
        </h2>
        <span className="text-[11px] text-[#71706b]">
          {isLoading ? 'Syncing...' : 'Live board'}
        </span>
      </div>

      {/* Minimal Toolbar: Colors + Eraser, Sizes + Undo + Clear */}
      <div className="space-y-2 border-y border-[#262626] py-2">
        {/* Row 1: 8 Ink Swatches + Eraser */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {DRAWBOARD_SWATCHES.map((swatch) => {
              const active = !isEraser && selectedColor === swatch.hex;
              return (
                <button
                  key={swatch.hex}
                  type="button"
                  onClick={() => {
                    setSelectedColor(swatch.hex);
                    setIsEraser(false);
                  }}
                  title={swatch.label}
                  aria-label={swatch.label}
                  className={`w-4 h-4 rounded-full border transition-transform ${
                    active
                      ? 'border-white scale-110'
                      : 'border-[#333330] opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setIsEraser(!isEraser)}
            title="Eraser"
            aria-label="Eraser"
            className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] transition-colors shrink-0 ${
              isEraser
                ? 'bg-[#262626] border-[#52524e] text-[#e5e5e5]'
                : 'bg-[#141413] border-[#262626] text-[#8d8c85] hover:text-[#e5e5e5]'
            }`}
          >
            <Eraser className="w-3 h-3" />
            <span>Eraser</span>
          </button>
        </div>

        {/* Row 2: 4 Brush Sizes + Undo + Clear */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center bg-[#141413] border border-[#262626] rounded-md p-0.5 gap-0.5">
            {DRAWBOARD_SIZES.map((size) => {
              const active = strokeWidth === size;
              const dotSize =
                size === 1 ? 'w-1 h-1' : size === 2 ? 'w-1.5 h-1.5' : size === 4 ? 'w-2 h-2' : 'w-3 h-3';
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => setStrokeWidth(size)}
                  title={`${size}px stroke`}
                  aria-label={`${size}px stroke`}
                  className={`w-6 h-5 rounded flex items-center justify-center transition-colors ${
                    active
                      ? 'bg-[#262626] text-[#e5e5e5]'
                      : 'text-[#71706b] hover:text-[#e5e5e5]'
                  }`}
                >
                  <span className={`${dotSize} rounded-full bg-current`} />
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!myLastStroke || isMutating}
              title="Undo your last stroke"
              aria-label="Undo"
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#141413] border border-[#262626] text-[11px] text-[#9c9a92] hover:text-[#e5e5e5] disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              <span>Undo</span>
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={strokes.length === 0 || isMutating}
                title="Clear board"
                aria-label="Clear board"
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#141413] border border-[#262626] text-[11px] text-[#9c9a92] hover:text-[#e5e5e5] disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            ) : (
              <div className="flex items-center gap-1 bg-[#141413] border border-[#3a3a36] rounded-md px-1.5 py-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={handleClearBoard}
                  disabled={isMutating}
                  className="text-[#e5e5e5] hover:underline font-medium px-1"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="text-[#71706b] hover:text-[#e5e5e5] px-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Responsive HTML5 Canvas */}
      <div
        ref={containerRef}
        className="w-full h-[270px] bg-[#191919] border border-[#262626] rounded-[8px] overflow-hidden relative"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          className="block w-full h-full touch-none select-none cursor-crosshair"
        />
        {!isLoading && strokes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] text-[#5e5d58]">
              Draw anywhere to sketch with the team
            </span>
          </div>
        )}
      </div>

      {/* Bottom Attribution */}
      <div className="flex items-center justify-between text-[11px] text-[#71706b] min-h-[16px]">
        <span className="truncate">
          {lastAuthorName ? `Last drawn by ${lastAuthorName}` : 'No strokes yet'}
        </span>
        {strokes.length > 0 && (
          <span className="tabular-nums shrink-0">
            {strokes.length} {strokes.length === 1 ? 'stroke' : 'strokes'}
          </span>
        )}
      </div>
    </section>
  );
};
