import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface SupervisorBadgeProps {
  compact?: boolean;
  className?: string;
}

export const SupervisorBadge: React.FC<SupervisorBadgeProps> = ({
  compact = false,
  className = '',
}) => {
  return (
    <span
      title="Supervisor"
      className={`inline-flex items-center gap-1 rounded-md border border-[#4a3518] bg-[#231b10] text-[#f2c46d] font-medium whitespace-nowrap shrink-0 select-none ${
        compact ? 'px-1.5 py-0.5 text-[10px] leading-none' : 'px-2 py-0.5 text-[11px]'
      } ${className}`}
    >
      <ShieldCheck
        className={`${compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-[#eab308] shrink-0`}
      />
      <span>Supervisor</span>
    </span>
  );
};
