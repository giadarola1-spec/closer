import React, { useEffect, useState } from 'react';

interface LaunchSplashProps {
  onComplete: () => void;
}

interface SplashKeyframe {
  x: number;
  tiltDeg: number;
  shackleOpen: number; // 1 = open, 0 = locked shut
  scaleX: number;
  scaleY: number;
  streakIntensity: number; // 0..1 comic speed streaks behind padlock
  impactBurst: number; // 0..1 Spider-Verse snap sparks on lock
}

const FRAME_DURATION_MS = 74; // ~13.5 FPS (animation on twos/threes)

const CAPSULE_X = 28;
const CAPSULE_Y = 35;
const CAPSULE_W = 264;
const CAPSULE_H = 60;
const CAPSULE_R = 30;

const TRAVEL_START_X = 66;
const TRAVEL_END_X = 254;
const TRAVEL_SPAN = TRAVEL_END_X - TRAVEL_START_X;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const KEYFRAMES: SplashKeyframe[] = (() => {
  const frames: SplashKeyframe[] = [];

  // Frames 0-1: Anticipation crouch on far left with shackle open
  frames.push({
    x: TRAVEL_START_X,
    tiltDeg: -3,
    shackleOpen: 1,
    scaleX: 0.96,
    scaleY: 1.04,
    streakIntensity: 0,
    impactBurst: 0,
  });
  frames.push({
    x: TRAVEL_START_X - 2,
    tiltDeg: -5,
    shackleOpen: 1,
    scaleX: 1.03,
    scaleY: 0.97,
    streakIntensity: 0,
    impactBurst: 0,
  });

  // Frames 2-11: Stepped horizontal glide from left to right across the capsule
  const travelSteps = 10;
  for (let i = 1; i <= travelSteps; i++) {
    const progress = i / travelSteps;
    const eased = easeInOutCubic(progress);
    const velocityHint = Math.sin(progress * Math.PI);
    frames.push({
      x: TRAVEL_START_X + TRAVEL_SPAN * eased,
      tiltDeg: velocityHint * 5.5,
      shackleOpen: 1,
      scaleX: 1 + velocityHint * 0.05,
      scaleY: 1 - velocityHint * 0.04,
      streakIntensity: velocityHint > 0.45 ? velocityHint : 0,
      impactBurst: 0,
    });
  }

  // Frames 12-15: Arrival at far right & snapping shackle down into closed lock
  frames.push({
    x: TRAVEL_END_X + 2,
    tiltDeg: 3,
    shackleOpen: 0.9,
    scaleX: 0.98,
    scaleY: 1.03,
    streakIntensity: 0,
    impactBurst: 0,
  });
  frames.push({
    x: TRAVEL_END_X,
    tiltDeg: 1,
    shackleOpen: 0.52,
    scaleX: 0.99,
    scaleY: 1.02,
    streakIntensity: 0,
    impactBurst: 0,
  });
  frames.push({
    x: TRAVEL_END_X,
    tiltDeg: 0,
    shackleOpen: 0.14,
    scaleX: 1.02,
    scaleY: 0.98,
    streakIntensity: 0,
    impactBurst: 0.4,
  });

  // Frame 16: Impact clamp frame — shackle locks shut with comic burst
  frames.push({
    x: TRAVEL_END_X,
    tiltDeg: 0,
    shackleOpen: 0,
    scaleX: 1.06,
    scaleY: 0.94,
    streakIntensity: 0,
    impactBurst: 1,
  });

  // Frame 17: Crisp settle — locked closed, immediately concludes
  frames.push({
    x: TRAVEL_END_X,
    tiltDeg: 0,
    shackleOpen: 0,
    scaleX: 1,
    scaleY: 1,
    streakIntensity: 0,
    impactBurst: 0.25,
  });

  return frames;
})();

export const LaunchSplash: React.FC<LaunchSplashProps> = ({ onComplete }) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const onCompleteRef = React.useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setFrameIndex(KEYFRAMES.length - 1);
      const timer = window.setTimeout(() => {
        onCompleteRef.current();
      }, 120);
      return () => window.clearTimeout(timer);
    }

    let current = 0;
    const intervalId = window.setInterval(() => {
      current += 1;
      if (current >= KEYFRAMES.length) {
        window.clearInterval(intervalId);
        onCompleteRef.current();
        return;
      }
      setFrameIndex(current);
    }, FRAME_DURATION_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  const frame = KEYFRAMES[Math.min(frameIndex, KEYFRAMES.length - 1)];

  // Padlock vertical center = 65 (dead center of capsule [35..95])
  // Body: 34x32 -> top y = 49 (-16 local), bottom y = 81 (+16 local)
  // Capsule top outline is at y = 35 (-30 local); shackle arch peaks at -44 local (above capsule)
  const shackleLiftY = -13 * frame.shackleOpen;
  const shackleTiltDeg = -16 * frame.shackleOpen;

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#141413] flex items-center justify-center select-none pointer-events-auto"
      role="presentation"
      aria-label="Launching closer"
    >
      <div className="w-[min(86vw,340px)] flex items-center justify-center">
        <svg
          viewBox="0 -16 320 162"
          className="w-full h-auto overflow-visible"
          aria-hidden="true"
        >
          {/* Capsule outline rectangle: white outline only, transparent fill */}
          <rect
            x={CAPSULE_X}
            y={CAPSULE_Y}
            width={CAPSULE_W}
            height={CAPSULE_H}
            rx={CAPSULE_R}
            ry={CAPSULE_R}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={2.5}
          />

          {/* Comic speed streaks trailing behind during stepped horizontal travel */}
          {frame.streakIntensity > 0 && (
            <g opacity={0.85} stroke="#FFFFFF" strokeLinecap="round">
              <line
                x1={frame.x - 24}
                y1={56}
                x2={frame.x - 24 - 18 * frame.streakIntensity}
                y2={56}
                strokeWidth={2}
              />
              <line
                x1={frame.x - 22}
                y1={66}
                x2={frame.x - 22 - 26 * frame.streakIntensity}
                y2={66}
                strokeWidth={2.5}
              />
              <line
                x1={frame.x - 25}
                y1={75}
                x2={frame.x - 25 - 14 * frame.streakIntensity}
                y2={75}
                strokeWidth={1.75}
              />
            </g>
          )}

          {/* Padlock element translated horizontally along the capsule centerline */}
          <g
            transform={`translate(${frame.x}, 65) rotate(${frame.tiltDeg}) scale(${frame.scaleX}, ${frame.scaleY})`}
          >
            {/* Shackle arching OUTSIDE (above) the capsule top border (local y=-30) */}
            <g
              transform={`translate(0, ${shackleLiftY}) rotate(${shackleTiltDeg}, -9, -15)`}
            >
              {/* Dark background knockout so shackle reads crisply across the white top border */}
              <path
                d="M -9 2 L -9 -35 A 9 9 0 0 1 9 -35 L 9 -15"
                fill="none"
                stroke="#141413"
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Crisp white shackle */}
              <path
                d="M -9 2 L -9 -35 A 9 9 0 0 1 9 -35 L 9 -15"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={4.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>

            {/* Solid white padlock body centered vertically inside the capsule */}
            <rect
              x={-17}
              y={-16}
              width={34}
              height={32}
              rx={6}
              fill="#FFFFFF"
            />

            {/* Minimalist dark keyhole */}
            <circle cx={0} cy={-2.5} r={3.2} fill="#141413" />
            <path
              d="M -1.7 -1 L 1.7 -1 L 2.3 7.5 L -2.3 7.5 Z"
              fill="#141413"
            />

            {/* Spider-Verse comic impact snap ticks when locking closed */}
            {frame.impactBurst > 0 && (
              <g
                stroke="#FFFFFF"
                strokeWidth={2}
                strokeLinecap="round"
                opacity={frame.impactBurst}
              >
                <line x1={13} y1={-22} x2={20} y2={-28} />
                <line x1={16} y1={-16} x2={25} y2={-17} />
                <line x1={8} y1={-25} x2={11} y2={-33} />
              </g>
            )}
          </g>
        </svg>
      </div>
    </div>
  );
};
