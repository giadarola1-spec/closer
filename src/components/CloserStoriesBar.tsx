import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CallChartRange, CloserChartSeries } from '../services/ringCentralCalls.ts';
import { Avatar } from './Avatar.tsx';

interface CloserStoriesBarProps {
  closers: CloserChartSeries[];
  selectedCloserId: string | null;
  onSelectCloser: (closerId: string) => void;
  range: CallChartRange;
  isLoading?: boolean;
}

function getStoryRingClass(
  isSelected: boolean,
  presenceState: CloserChartSeries['presenceState']
): string {
  if (isSelected) {
    return 'bg-gradient-to-tr from-[#b89f64] via-[#ede2be] to-[#fff4d4] shadow-[0_0_0_1px_rgba(237,226,190,0.28)]';
  }
  if (presenceState === 'online') {
    return 'bg-gradient-to-tr from-[#3e5c4c] via-[#5d8c73] to-[#7fb597] opacity-85 group-hover:opacity-100';
  }
  if (presenceState === 'busy') {
    return 'bg-gradient-to-tr from-[#6e3a3a] via-[#964f4f] to-[#b56767] opacity-85 group-hover:opacity-100';
  }
  if (presenceState === 'afk') {
    return 'bg-gradient-to-tr from-[#6e5a34] via-[#9c7f48] to-[#bf9d5e] opacity-80 group-hover:opacity-100';
  }
  return 'bg-[#2e2e2a] opacity-75 group-hover:opacity-100 group-hover:bg-[#454540]';
}

function getFirstName(fullName: string): string {
  const trimmed = (fullName || 'Closer').trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts[0] || trimmed;
}

export const CloserStoriesBar: React.FC<CloserStoriesBarProps> = ({
  closers,
  selectedCloserId,
  onSelectCloser,
  range,
  isLoading = false,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState<{
    canScrollLeft: boolean;
    canScrollRight: boolean;
  }>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateScrollEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    const nextLeft = el.scrollLeft > 2;
    const nextRight = maxScroll > 2 && el.scrollLeft < maxScroll - 2;
    setScrollEdges((prev) =>
      prev.canScrollLeft === nextLeft && prev.canScrollRight === nextRight
        ? prev
        : { canScrollLeft: nextLeft, canScrollRight: nextRight }
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateScrollEdges();

    const handleScroll = () => updateScrollEdges();
    const handleWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.deltaY === 0) return;

      e.preventDefault();
      const scale =
        e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? el.clientHeight : 1;
      el.scrollLeft += e.deltaY * scale;
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('wheel', handleWheel, { passive: false });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateScrollEdges);
      observer.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('wheel', handleWheel);
      observer?.disconnect();
    };
  }, [closers.length, isLoading, updateScrollEdges]);

  const fadeMaskStyle = useMemo<React.CSSProperties | undefined>(() => {
    const { canScrollLeft, canScrollRight } = scrollEdges;
    if (!canScrollLeft && !canScrollRight) return undefined;

    const gradient =
      canScrollLeft && canScrollRight
        ? 'linear-gradient(to right, transparent 0px, black 28px, black calc(100% - 44px), transparent 100%)'
        : canScrollRight
          ? 'linear-gradient(to right, black 0px, black calc(100% - 44px), transparent 100%)'
          : 'linear-gradient(to right, transparent 0px, black 28px, black 100%)';

    return {
      maskImage: gradient,
      WebkitMaskImage: gradient,
    };
  }, [scrollEdges]);

  if (isLoading && closers.length === 0) {
    return (
      <div
        className="flex items-center gap-3.5 overflow-x-auto no-scrollbar py-1 px-0.5 min-w-0 flex-1"
        aria-busy="true"
        aria-label="Loading closers"
      >
        {[0, 1, 2, 3, 4, 5].map((idx) => (
          <div
            key={idx}
            aria-hidden="true"
            className="flex flex-col items-center gap-1.5 shrink-0 w-[52px]"
          >
            <div className="w-[46px] h-[46px] rounded-full skeleton-shimmer" />
            <div className="w-9 h-2 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (closers.length === 0) {
    return (
      <div className="flex items-center py-2 px-1 text-xs text-[#71706b] min-w-0">
        No active closers yet
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1" style={fadeMaskStyle}>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Select closer call activity"
        className="flex items-start gap-3 overflow-x-auto no-scrollbar py-0.5 pl-0.5 pr-4 min-w-0 w-full"
      >
        {closers.map((closer) => {
          const isSelected = selectedCloserId === closer.id;
          const callCount =
            range === 'today' ? closer.latestCalls : closer.periodTotalCalls;
          const shortName = getFirstName(closer.name);
          const ringClass = getStoryRingClass(isSelected, closer.presenceState);

          return (
            <button
              key={closer.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={`${closer.name} (${callCount} calls)`}
              title={`${closer.name} · ${callCount} ${callCount === 1 ? 'call' : 'calls'}`}
              onClick={() => onSelectCloser(closer.id)}
              className="group flex flex-col items-center gap-1.5 shrink-0 min-w-[50px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ede2be]/60 rounded-xl py-0.5 px-0.5 transition-transform duration-150"
            >
              <span
                className={`w-[46px] h-[46px] rounded-full p-[2px] transition-all duration-200 flex items-center justify-center ${ringClass} ${
                  isSelected ? 'scale-[1.04]' : 'group-hover:scale-[1.03]'
                }`}
              >
                <span className="w-full h-full rounded-full p-[2px] bg-[#141413] flex items-center justify-center">
                  <Avatar
                    name={closer.name}
                    photoUrl={closer.avatarUrl}
                    size="md"
                    className="w-full h-full"
                    presenceStatus={closer.presenceState}
                    presenceRingClass="ring-[#141413]"
                  />
                </span>
              </span>

              <span
                className={`text-[11px] leading-tight truncate max-w-[54px] text-center transition-colors ${
                  isSelected
                    ? 'text-[#edece8] font-medium'
                    : 'text-[#8d8c85] group-hover:text-[#d1d1cf]'
                }`}
              >
                {shortName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
