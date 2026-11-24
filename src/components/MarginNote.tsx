import React from 'react';
import { AlertCircle, Copy, Loader2, RotateCcw, X } from 'lucide-react';
import { PostMarginNote } from '../types/team.ts';

export interface MarginNoteRequestStatus {
  status: 'generating' | 'error';
  message?: string;
  retryable?: boolean;
  force?: boolean;
}

interface MarginNoteProps {
  marginNote: PostMarginNote;
  canRemove: boolean;
  removing?: boolean;
  onCopyText: (text: string, label: string) => void;
  onRemove: () => void;
}

const MarginNoteContent: React.FC<{
  points: string[];
  canRemove: boolean;
  removing: boolean;
  onCopy: () => void;
  onRemove: () => void;
}> = ({ points, canRemove, removing, onCopy, onRemove }) => {
  return (
    <div className="group relative flex-1 min-w-0">
      {/* Subtle low-contrast top-right controls revealed on hover/focus */}
      <div
        className={`absolute -top-0.5 right-0 flex items-center gap-0.5 transition-opacity duration-150 ${
          removing
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={onCopy}
          className="p-1 rounded text-[#52525b] hover:text-[#d4d4d8] transition-colors"
          title="Copy margin note"
          aria-label="Copy margin note"
        >
          <Copy className="w-3 h-3" />
        </button>

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="p-1 rounded text-[#52525b] hover:text-[#d4d4d8] disabled:opacity-40 transition-colors"
            title="Remove margin note"
            aria-label="Remove margin note"
          >
            {removing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <X className="w-3 h-3" />
            )}
          </button>
        )}
      </div>

      <ul className="space-y-1.5 text-[13px] leading-[1.5] text-[#a3a3a3] pr-11">
        {points.map((point, index) => (
          <li key={`${index}-${point.slice(0, 16)}`} className="flex items-start gap-2">
            <span
              className="mt-[8px] w-1 h-1 rounded-full bg-[#52525b] shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const DesktopMarginNote: React.FC<MarginNoteProps> = ({
  marginNote,
  canRemove,
  removing = false,
  onCopyText,
  onRemove,
}) => {
  const points = (marginNote?.points || []).filter(Boolean);
  if (points.length === 0) return null;

  const handleCopy = () => {
    onCopyText(points.map((p) => `- ${p}`).join('\n'), 'Margin note copied');
  };

  return (
    <aside
      aria-label="Margin note"
      className="hidden min-[1120px]:flex items-start pt-5 animate-fade-150"
    >
      {/* Physical hairline tether connecting right edge of post card to margin text */}
      <div className="flex items-center shrink-0 pt-[9px] mr-3" aria-hidden="true">
        <span className="w-1 h-1 rounded-full bg-[#3f3f46] -ml-[2px] shrink-0" />
        <span className="w-[28px] h-px bg-[#262626] shrink-0" />
      </div>

      <MarginNoteContent
        points={points}
        canRemove={canRemove}
        removing={removing}
        onCopy={handleCopy}
        onRemove={onRemove}
      />
    </aside>
  );
};

export const MobileMarginNote: React.FC<MarginNoteProps> = ({
  marginNote,
  canRemove,
  removing = false,
  onCopyText,
  onRemove,
}) => {
  const points = (marginNote?.points || []).filter(Boolean);
  if (points.length === 0) return null;

  const handleCopy = () => {
    onCopyText(points.map((p) => `- ${p}`).join('\n'), 'Margin note copied');
  };

  return (
    <aside
      aria-label="Margin note"
      className="min-[1120px]:hidden mt-2.5 ml-3 pl-3 border-l border-[#262626] animate-fade-150"
    >
      <MarginNoteContent
        points={points}
        canRemove={canRemove}
        removing={removing}
        onCopy={handleCopy}
        onRemove={onRemove}
      />
    </aside>
  );
};

interface MarginNoteStatusProps {
  requestState: MarginNoteRequestStatus;
  onRetry: () => void;
  onDismiss: () => void;
}

const MarginNoteStatusInner: React.FC<MarginNoteStatusProps> = ({
  requestState,
  onRetry,
  onDismiss,
}) => {
  if (requestState.status === 'generating') {
    return (
      <div className="flex items-center gap-2 text-[12px] leading-[1.5] text-[#71706b]">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#71706b]" />
        <span>Writing margin note...</span>
      </div>
    );
  }

  return (
    <div className="group relative flex-1 min-w-0 pr-6" role="status">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute -top-0.5 right-0 p-1 rounded text-[#52525b] hover:text-[#d4d4d8] transition-colors"
        title="Dismiss notice"
        aria-label="Dismiss margin note notice"
      >
        <X className="w-3 h-3" />
      </button>

      <div className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-[#a3a3a3]">
        <AlertCircle className="w-3.5 h-3.5 text-[#d4a373] mt-[2px] shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="break-words">
            {requestState.message ||
              'The AI is currently being overused (high demand). Please try again in a moment.'}
          </p>
          {requestState.retryable !== false && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#edece8] hover:text-white underline underline-offset-2 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const DesktopMarginNoteStatus: React.FC<MarginNoteStatusProps> = ({
  requestState,
  onRetry,
  onDismiss,
}) => (
  <aside
    aria-label="Margin note status"
    className="hidden min-[1120px]:flex items-start pt-5 animate-fade-150"
  >
    <div className="flex items-center shrink-0 pt-[9px] mr-3" aria-hidden="true">
      <span className="w-1 h-1 rounded-full bg-[#3f3f46] -ml-[2px] shrink-0" />
      <span className="w-[28px] h-px bg-[#262626] shrink-0" />
    </div>
    <MarginNoteStatusInner
      requestState={requestState}
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  </aside>
);

export const MobileMarginNoteStatus: React.FC<MarginNoteStatusProps> = ({
  requestState,
  onRetry,
  onDismiss,
}) => (
  <aside
    aria-label="Margin note status"
    className="min-[1120px]:hidden mt-2.5 ml-3 pl-3 border-l border-[#262626] animate-fade-150"
  >
    <MarginNoteStatusInner
      requestState={requestState}
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  </aside>
);
