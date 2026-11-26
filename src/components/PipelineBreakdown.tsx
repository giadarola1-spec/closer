import React, { useState } from 'react';

interface PipelineBreakdownProps {
  className?: string;
}

interface PipelineStage {
  id: 'mql' | 'sql' | 'opportunity' | 'clients';
  label: string;
  color: string;
  count: number;
  percent: number;
}

// Sequential Right -> Left: Clients, Opportunity, SQL, MQL
// Rendered Left -> Right: MQL -> SQL -> Opportunity -> Clients
const MOCK_PIPELINE_STAGES: PipelineStage[] = [
  { id: 'mql', label: 'MQL', color: '#d5b4f7', count: 48, percent: 48 },
  { id: 'sql', label: 'SQL', color: '#0fd48b', count: 26, percent: 26 },
  { id: 'opportunity', label: 'Opportunity', color: '#9ee6f6', count: 18, percent: 18 },
  { id: 'clients', label: 'Clients', color: '#f5e027', count: 8, percent: 8 },
];

export const PipelineBreakdown: React.FC<PipelineBreakdownProps> = ({
  className = '',
}) => {
  const [hoveredStageId, setHoveredStageId] = useState<PipelineStage['id'] | null>(
    null
  );

  const totalCount = MOCK_PIPELINE_STAGES.reduce((sum, s) => sum + s.count, 0);

  return (
    <section
      aria-label="Pipeline"
      className={`pt-1 font-['Inter'] ${className}`}
    >
      <div className="mb-2 text-[13px] font-medium text-[#edece8]">
        Pipeline
      </div>

      <div
        role="img"
        aria-label="Pipeline stages from right to left: Clients, Opportunity, SQL, MQL"
        className="relative h-[88px] w-full flex items-stretch gap-[2px]"
      >
        {MOCK_PIPELINE_STAGES.map((stage, index) => {
          const widthPct = (stage.count / totalCount) * 100;
          const isHovered = hoveredStageId === stage.id;
          const isDimmed = hoveredStageId !== null && !isHovered;

          const tooltipAlignClass =
            index === 0
              ? 'left-0'
              : index === MOCK_PIPELINE_STAGES.length - 1
                ? 'right-0'
                : 'left-1/2 -translate-x-1/2';

          return (
            <div
              key={stage.id}
              tabIndex={0}
              aria-label={`${stage.label}: ${stage.percent}%`}
              onMouseEnter={() => setHoveredStageId(stage.id)}
              onMouseLeave={() =>
                setHoveredStageId((prev) => (prev === stage.id ? null : prev))
              }
              onFocus={() => setHoveredStageId(stage.id)}
              onBlur={() =>
                setHoveredStageId((prev) => (prev === stage.id ? null : prev))
              }
              style={{
                width: `${widthPct}%`,
                minWidth: '10px',
              }}
              className="relative h-full cursor-pointer focus:outline-none group"
            >
              <div
                style={{
                  backgroundColor: '#141413',
                  backgroundImage: `repeating-linear-gradient(to right, ${stage.color} 0px, ${stage.color} 3px, #141413 3px, #141413 5px)`,
                }}
                className={`w-full h-full transition-opacity duration-150 ${
                  isDimmed ? 'opacity-30' : 'opacity-100'
                }`}
              />

              {isHovered && (
                <div
                  role="tooltip"
                  className={`pointer-events-none absolute top-full mt-2 ${tooltipAlignClass} z-20 whitespace-nowrap rounded-md bg-[#191918] border border-[#2c2c29] px-2.5 py-1 shadow-lg flex items-center gap-1.5 text-[11px] font-medium text-[#edece8] tabular-nums`}
                >
                  <span
                    className="w-1.5 h-2.5 rounded-[1px] shrink-0"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden="true"
                  />
                  <span>{stage.label}</span>
                  <span className="text-[#8d8c85] font-normal">
                    {stage.percent}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
