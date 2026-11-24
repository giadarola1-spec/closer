import React from 'react';

type ShapeKind = 'square' | 'rect' | 'star4' | 'star5' | 'circle';
type ToneKind = 'solid-white' | 'solid-gray' | 'solid-gray-mid' | 'hollow-white' | 'hollow-gray';

interface AmbientShapeSpec {
  id: string;
  shape: ShapeKind;
  tone: ToneKind;
  size: number;
  driftClass: string;
  spinClass: string;
}

const AMBIENT_SHAPES: readonly AmbientShapeSpec[] = [
  {
    id: 's01',
    shape: 'square',
    tone: 'hollow-white',
    size: 22,
    driftClass: 'left-[7%] [--ambient-opacity:0.22] [animation-duration:28s] [animation-delay:-4s]',
    spinClass: 'ambient-spin-cw [animation-duration:38s] [animation-delay:-7s]',
  },
  {
    id: 's02',
    shape: 'circle',
    tone: 'solid-gray',
    size: 12,
    driftClass: 'left-[14%] [--ambient-opacity:0.32] [animation-duration:21s] [animation-delay:-15s]',
    spinClass: 'ambient-spin-ccw [animation-duration:26s] [animation-delay:-3s]',
  },
  {
    id: 's03',
    shape: 'star4',
    tone: 'solid-white',
    size: 16,
    driftClass: 'left-[21%] [--ambient-opacity:0.16] [animation-duration:34s] [animation-delay:-22s]',
    spinClass: 'ambient-spin-cw [animation-duration:44s] [animation-delay:-11s]',
  },
  {
    id: 's04',
    shape: 'rect',
    tone: 'hollow-gray',
    size: 30,
    driftClass: 'left-[28%] [--ambient-opacity:0.24] [animation-duration:25s] [animation-delay:-9s]',
    spinClass: 'ambient-spin-ccw [animation-duration:48s] [animation-delay:-19s]',
  },
  {
    id: 's05',
    shape: 'star5',
    tone: 'hollow-white',
    size: 18,
    driftClass: 'left-[35%] [--ambient-opacity:0.19] [animation-duration:31s] [animation-delay:-27s]',
    spinClass: 'ambient-spin-cw [animation-duration:32s] [animation-delay:-5s]',
  },
  {
    id: 's06',
    shape: 'square',
    tone: 'solid-gray-mid',
    size: 14,
    driftClass: 'left-[42%] [--ambient-opacity:0.28] [animation-duration:20s] [animation-delay:-2s]',
    spinClass: 'ambient-spin-ccw [animation-duration:29s] [animation-delay:-14s]',
  },
  {
    id: 's07',
    shape: 'circle',
    tone: 'hollow-white',
    size: 28,
    driftClass: 'left-[49%] [--ambient-opacity:0.13] [animation-duration:38s] [animation-delay:-18s]',
    spinClass: 'ambient-spin-cw [animation-duration:52s] [animation-delay:-8s]',
  },
  {
    id: 's08',
    shape: 'rect',
    tone: 'solid-white',
    size: 24,
    driftClass: 'left-[56%] [--ambient-opacity:0.11] [animation-duration:29s] [animation-delay:-11s]',
    spinClass: 'ambient-spin-cw [animation-duration:41s] [animation-delay:-21s]',
  },
  {
    id: 's09',
    shape: 'star4',
    tone: 'hollow-gray',
    size: 26,
    driftClass: 'left-[63%] [--ambient-opacity:0.25] [animation-duration:36s] [animation-delay:-31s]',
    spinClass: 'ambient-spin-ccw [animation-duration:46s] [animation-delay:-12s]',
  },
  {
    id: 's10',
    shape: 'square',
    tone: 'solid-white',
    size: 10,
    driftClass: 'left-[70%] [--ambient-opacity:0.21] [animation-duration:19s] [animation-delay:-7s]',
    spinClass: 'ambient-spin-cw [animation-duration:24s] [animation-delay:-6s]',
  },
  {
    id: 's11',
    shape: 'circle',
    tone: 'solid-gray-mid',
    size: 18,
    driftClass: 'left-[77%] [--ambient-opacity:0.29] [animation-duration:27s] [animation-delay:-20s]',
    spinClass: 'ambient-spin-ccw [animation-duration:35s] [animation-delay:-16s]',
  },
  {
    id: 's12',
    shape: 'star5',
    tone: 'solid-gray',
    size: 15,
    driftClass: 'left-[84%] [--ambient-opacity:0.34] [animation-duration:23s] [animation-delay:-13s]',
    spinClass: 'ambient-spin-cw [animation-duration:30s] [animation-delay:-4s]',
  },
  {
    id: 's13',
    shape: 'rect',
    tone: 'hollow-white',
    size: 34,
    driftClass: 'left-[89%] [--ambient-opacity:0.17] [animation-duration:39s] [animation-delay:-29s]',
    spinClass: 'ambient-spin-ccw [animation-duration:54s] [animation-delay:-25s]',
  },
  {
    id: 's14',
    shape: 'star4',
    tone: 'solid-gray-mid',
    size: 12,
    driftClass: 'left-[10%] [--ambient-opacity:0.26] [animation-duration:22s] [animation-delay:-17s]',
    spinClass: 'ambient-spin-ccw [animation-duration:27s] [animation-delay:-9s]',
  },
  {
    id: 's15',
    shape: 'rect',
    tone: 'solid-gray',
    size: 26,
    driftClass: 'left-[18%] [--ambient-opacity:0.31] [animation-duration:33s] [animation-delay:-6s]',
    spinClass: 'ambient-spin-cw [animation-duration:43s] [animation-delay:-18s]',
  },
  {
    id: 's16',
    shape: 'circle',
    tone: 'solid-white',
    size: 11,
    driftClass: 'left-[25%] [--ambient-opacity:0.14] [animation-duration:24s] [animation-delay:-19s]',
    spinClass: 'ambient-spin-cw [animation-duration:28s] [animation-delay:-10s]',
  },
  {
    id: 's17',
    shape: 'square',
    tone: 'hollow-gray',
    size: 32,
    driftClass: 'left-[32%] [--ambient-opacity:0.18] [animation-duration:40s] [animation-delay:-35s]',
    spinClass: 'ambient-spin-ccw [animation-duration:50s] [animation-delay:-22s]',
  },
  {
    id: 's18',
    shape: 'star5',
    tone: 'solid-white',
    size: 13,
    driftClass: 'left-[45%] [--ambient-opacity:0.15] [animation-duration:26s] [animation-delay:-14s]',
    spinClass: 'ambient-spin-cw [animation-duration:33s] [animation-delay:-7s]',
  },
  {
    id: 's19',
    shape: 'square',
    tone: 'solid-gray',
    size: 20,
    driftClass: 'left-[53%] [--ambient-opacity:0.27] [animation-duration:30s] [animation-delay:-24s]',
    spinClass: 'ambient-spin-ccw [animation-duration:39s] [animation-delay:-15s]',
  },
  {
    id: 's20',
    shape: 'circle',
    tone: 'hollow-gray',
    size: 22,
    driftClass: 'left-[60%] [--ambient-opacity:0.23] [animation-duration:35s] [animation-delay:-8s]',
    spinClass: 'ambient-spin-cw [animation-duration:45s] [animation-delay:-13s]',
  },
  {
    id: 's21',
    shape: 'rect',
    tone: 'solid-gray-mid',
    size: 22,
    driftClass: 'left-[67%] [--ambient-opacity:0.20] [animation-duration:21s] [animation-delay:-3s]',
    spinClass: 'ambient-spin-ccw [animation-duration:31s] [animation-delay:-17s]',
  },
  {
    id: 's22',
    shape: 'star4',
    tone: 'hollow-white',
    size: 20,
    driftClass: 'left-[74%] [--ambient-opacity:0.16] [animation-duration:32s] [animation-delay:-26s]',
    spinClass: 'ambient-spin-cw [animation-duration:40s] [animation-delay:-20s]',
  },
  {
    id: 's23',
    shape: 'square',
    tone: 'hollow-white',
    size: 15,
    driftClass: 'left-[81%] [--ambient-opacity:0.12] [animation-duration:18s] [animation-delay:-10s]',
    spinClass: 'ambient-spin-ccw [animation-duration:22s] [animation-delay:-5s]',
  },
  {
    id: 's24',
    shape: 'circle',
    tone: 'solid-gray',
    size: 30,
    driftClass: 'left-[87%] [--ambient-opacity:0.09] [animation-duration:37s] [animation-delay:-16s]',
    spinClass: 'ambient-spin-cw [animation-duration:49s] [animation-delay:-24s]',
  },
  {
    id: 's25',
    shape: 'star5',
    tone: 'hollow-gray',
    size: 24,
    driftClass: 'left-[38%] [--ambient-opacity:0.14] [animation-duration:34s] [animation-delay:-5s]',
    spinClass: 'ambient-spin-ccw [animation-duration:42s] [animation-delay:-11s]',
  },
  {
    id: 's26',
    shape: 'rect',
    tone: 'hollow-white',
    size: 28,
    driftClass: 'left-[4%] [--ambient-opacity:0.08] [animation-duration:36s] [animation-delay:-23s]',
    spinClass: 'ambient-spin-cw [animation-duration:47s] [animation-delay:-8s]',
  },
];

function getToneProps(tone: ToneKind): {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
} {
  switch (tone) {
    case 'solid-white':
      return { fill: '#e5e5e5' };
    case 'solid-gray':
      return { fill: '#404040' };
    case 'solid-gray-mid':
      return { fill: '#525252' };
    case 'hollow-white':
      return { fill: '#141414', stroke: '#e5e5e5', strokeWidth: 1.25 };
    case 'hollow-gray':
      return { fill: '#141414', stroke: '#a3a3a3', strokeWidth: 1.25 };
  }
}

const ShapeGraphic: React.FC<{ spec: AmbientShapeSpec }> = ({ spec }) => {
  const toneProps = getToneProps(spec.tone);
  const vectorEffect = spec.tone.startsWith('hollow') ? 'non-scaling-stroke' : undefined;

  if (spec.shape === 'rect') {
    const width = spec.size;
    const height = Math.max(8, Math.round(spec.size * 0.42));
    return (
      <svg
        width={width}
        height={height}
        viewBox="0 0 32 14"
        fill="none"
        className={`block ${spec.spinClass}`}
      >
        <rect
          x="1.5"
          y="1.5"
          width="29"
          height="11"
          rx="2"
          ry="2"
          vectorEffect={vectorEffect}
          {...toneProps}
        />
      </svg>
    );
  }

  return (
    <svg
      width={spec.size}
      height={spec.size}
      viewBox="0 0 24 24"
      fill="none"
      className={`block ${spec.spinClass}`}
    >
      {spec.shape === 'square' && (
        <rect
          x="2"
          y="2"
          width="20"
          height="20"
          rx="2"
          ry="2"
          vectorEffect={vectorEffect}
          {...toneProps}
        />
      )}
      {spec.shape === 'circle' && (
        <circle
          cx="12"
          cy="12"
          r="9.5"
          vectorEffect={vectorEffect}
          {...toneProps}
        />
      )}
      {spec.shape === 'star4' && (
        <path
          d="M12 1.8 L14.5 9.5 L22.2 12 L14.5 14.5 L12 22.2 L9.5 14.5 L1.8 12 L9.5 9.5 Z"
          strokeLinejoin="round"
          vectorEffect={vectorEffect}
          {...toneProps}
        />
      )}
      {spec.shape === 'star5' && (
        <polygon
          points="12,1.8 14.8,8.4 22,9.1 16.6,13.9 18.2,21 12,17.2 5.8,21 7.4,13.9 2,9.1 9.2,8.4"
          strokeLinejoin="round"
          vectorEffect={vectorEffect}
          {...toneProps}
        />
      )}
    </svg>
  );
};

interface AmbientGeometricCanvasProps {
  className?: string;
}

export const AmbientGeometricCanvas: React.FC<AmbientGeometricCanvasProps> = ({
  className = '',
}) => {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none overflow-hidden sticky top-0 ${className}`}
    >
      {AMBIENT_SHAPES.map((spec) => (
        <div key={spec.id} className={`ambient-drift ${spec.driftClass}`}>
          <ShapeGraphic spec={spec} />
        </div>
      ))}
    </div>
  );
};
