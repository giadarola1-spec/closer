import React, { useEffect, useRef, useState } from 'react';

interface PadlockMarkProps {
  /** Whether the padlock shackle is open (e.g. sidebar expanded) or locked shut */
  isOpen?: boolean;
  /** Animate at Spider-Verse stepped ~13.5 FPS when isOpen changes */
  animateOnChange?: boolean;
  /** Visual scale preset */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

interface ToggleFrame {
  shackleOpen: number;
  tiltDeg: number;
  scaleX: number;
  scaleY: number;
  impactBurst: number;
}

const FRAME_DURATION_MS = 74; // ~13.5 FPS matching LaunchSplash

const OPEN_FRAMES: ToggleFrame[] = [
  { shackleOpen: 0.15, tiltDeg: -3, scaleX: 1.03, scaleY: 0.97, impactBurst: 0 },
  { shackleOpen: 0.65, tiltDeg: -6, scaleX: 0.96, scaleY: 1.05, impactBurst: 0.5 },
  { shackleOpen: 1.12, tiltDeg: -4, scaleX: 0.98, scaleY: 1.02, impactBurst: 0.2 },
  { shackleOpen: 1.0, tiltDeg: 0, scaleX: 1, scaleY: 1, impactBurst: 0 },
];

const CLOSE_FRAMES: ToggleFrame[] = [
  { shackleOpen: 0.8, tiltDeg: 3, scaleX: 0.98, scaleY: 1.03, impactBurst: 0 },
  { shackleOpen: 0.35, tiltDeg: 1, scaleX: 1.01, scaleY: 0.99, impactBurst: 0.3 },
  { shackleOpen: 0.0, tiltDeg: 0, scaleX: 1.07, scaleY: 0.93, impactBurst: 1 },
  { shackleOpen: 0.0, tiltDeg: 0, scaleX: 1, scaleY: 1, impactBurst: 0 },
];

const SIZE_CLASSES: Record<NonNullable<PadlockMarkProps['size']>, string> = {
  sm: 'w-4 h-5',
  md: 'w-5 h-6',
  lg: 'w-6 h-7',
};

export const PadlockMark: React.FC<PadlockMarkProps> = ({
  isOpen = false,
  animateOnChange = true,
  size = 'md',
  className = '',
}) => {
  const prevOpenRef = useRef<boolean>(isOpen);
  const [frame, setFrame] = useState<ToggleFrame>(() => ({
    shackleOpen: isOpen ? 1 : 0,
    tiltDeg: 0,
    scaleX: 1,
    scaleY: 1,
    impactBurst: 0,
  }));

  useEffect(() => {
    if (prevOpenRef.current === isOpen) return;
    prevOpenRef.current = isOpen;

    const targetOpen = isOpen ? 1 : 0;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!animateOnChange || prefersReducedMotion) {
      setFrame({
        shackleOpen: targetOpen,
        tiltDeg: 0,
        scaleX: 1,
        scaleY: 1,
        impactBurst: 0,
      });
      return;
    }

    const sequence = isOpen ? OPEN_FRAMES : CLOSE_FRAMES;
    let step = 0;
    setFrame(sequence[0]);

    const intervalId = window.setInterval(() => {
      step += 1;
      if (step >= sequence.length) {
        window.clearInterval(intervalId);
        return;
      }
      setFrame(sequence[step]);
    }, FRAME_DURATION_MS);

    return () => window.clearInterval(intervalId);
  }, [isOpen, animateOnChange]);

  const shackleLiftY = -11 * frame.shackleOpen;
  const shackleTiltDeg = -16 * frame.shackleOpen;

  return (
    <svg
      viewBox="-26 -56 52 78"
      className={`${SIZE_CLASSES[size]} shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <g
        transform={`rotate(${frame.tiltDeg}) scale(${frame.scaleX}, ${frame.scaleY})`}
      >
        {/* Shackle */}
        <g
          transform={`translate(0, ${shackleLiftY}) rotate(${shackleTiltDeg}, -9, -15)`}
        >
          <path
            d="M -9 2 L -9 -35 A 9 9 0 0 1 9 -35 L 9 -15"
            fill="none"
            stroke="currentColor"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Padlock body */}
        <rect
          x={-17}
          y={-16}
          width={34}
          height={32}
          rx={6}
          fill="currentColor"
        />

        {/* Keyhole */}
        <circle cx={0} cy={-2.5} r={3.2} fill="#141413" />
        <path
          d="M -1.7 -1 L 1.7 -1 L 2.3 7.5 L -2.3 7.5 Z"
          fill="#141413"
        />

        {/* Spider-Verse stepped comic burst ticks on lock/unlock */}
        {frame.impactBurst > 0 && (
          <g
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            opacity={frame.impactBurst}
          >
            <line x1={13} y1={-22} x2={20} y2={-28} />
            <line x1={16} y1={-16} x2={24} y2={-17} />
            <line x1={8} y1={-25} x2={11} y2={-33} />
          </g>
        )}
      </g>
    </svg>
  );
};
