import React from 'react';
import { TeamMember } from '../types/team.ts';
import { getMentionHandle } from '../utils/mentions.ts';
import { Avatar } from './Avatar.tsx';
import { SupervisorBadge } from './SupervisorBadge.tsx';

interface MentionSuggestionsProps {
  candidates: TeamMember[];
  highlightedIndex: number;
  supervisorIds?: Set<string>;
  placement?: 'above' | 'below';
  onHoverIndex: (index: number) => void;
  onSelect: (member: TeamMember) => void;
}

export const MentionSuggestions: React.FC<MentionSuggestionsProps> = ({
  candidates,
  highlightedIndex,
  supervisorIds,
  placement = 'below',
  onHoverIndex,
  onSelect,
}) => {
  if (candidates.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention a closer"
      className={`absolute left-0 right-0 sm:right-auto sm:w-72 z-50 rounded-xl border border-[#2c2c29] bg-[#191918] py-1 shadow-2xl ${
        placement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
      }`}
    >
      <div className="px-2.5 py-1 text-[10px] font-medium text-[#71706b] uppercase tracking-wider">
        Mention closer
      </div>
      <div className="max-h-52 overflow-y-auto">
        {candidates.map((member, index) => {
          const isHighlighted = index === highlightedIndex;
          const handle = getMentionHandle(member.displayName);
          return (
            <button
              key={member.uid}
              type="button"
              role="option"
              aria-selected={isHighlighted}
              onMouseEnter={() => onHoverIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(member);
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-1.5 text-left text-xs transition-colors ${
                isHighlighted
                  ? 'bg-[#262624] text-white'
                  : 'text-[#d1d1cf] hover:bg-[#222220]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Avatar
                  name={member.displayName}
                  photoUrl={member.photoUrl}
                  size="xs"
                />
                <span className="font-medium truncate">{member.displayName}</span>
                {supervisorIds?.has(member.uid) && <SupervisorBadge compact />}
              </div>
              <span className="text-[11px] text-[#71706b] shrink-0 truncate max-w-[110px]">
                @{handle}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
