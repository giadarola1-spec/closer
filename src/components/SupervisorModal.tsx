import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  PinOff,
  Eraser,
  AlertCircle,
} from 'lucide-react';
import { TeamMember, TeamPost, SupervisorRecord } from '../types/team.ts';
import { SupervisorBadge } from './SupervisorBadge.tsx';

interface SupervisorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMember: TeamMember;
  isSupervisor: boolean;
  supervisors: SupervisorRecord[];
  posts: TeamPost[];
  statusMode: 'env' | 'claimed' | 'unconfigured' | 'loading';
  busy: boolean;
  error: string | null;
  onClearError: () => void;
  onLogin: (passcode: string) => Promise<void>;
  onClaim: (passcode: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onUnpinAllPosts: () => Promise<void>;
  onClearScratchpad: () => Promise<void>;
}

export const SupervisorModal: React.FC<SupervisorModalProps> = ({
  isOpen,
  onClose,
  currentMember,
  isSupervisor,
  supervisors,
  posts,
  statusMode,
  busy,
  error,
  onClearError,
  onLogin,
  onClaim,
  onLogout,
  onUnpinAllPosts,
  onClearScratchpad,
}) => {
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [showPasscode, setShowPasscode] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmUnpinAll, setConfirmUnpinAll] = useState(false);
  const [confirmClearBoard, setConfirmClearBoard] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPasscode('');
      setConfirmPasscode('');
      setShowPasscode(false);
      setLocalError(null);
      setConfirmUnpinAll(false);
      setConfirmClearBoard(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, busy, onClose]);

  if (!isOpen) return null;

  const pinnedCount = posts.filter((p) => p.pinned).length;
  const activeSupervisors = supervisors.filter((s) => s.active);
  const displayedError = localError || error;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    onClearError();
    if (!passcode.trim()) {
      setLocalError('Please enter the supervisor password.');
      return;
    }
    await onLogin(passcode);
  };

  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    onClearError();
    if (passcode.trim().length < 6) {
      setLocalError('Passcode must be at least 6 characters.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setLocalError('Passcodes do not match.');
      return;
    }
    await onClaim(passcode);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 font-['Inter']"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-[#191918] border border-[#2a2a27] rounded-2xl p-5 space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Supervisor profile"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#f2c46d]" />
              <h2 className="text-sm font-medium text-white">
                {isSupervisor
                  ? 'Supervisor Profile'
                  : statusMode === 'unconfigured'
                    ? 'Set Supervisor Passcode'
                    : 'Supervisor Login'}
              </h2>
              {isSupervisor && <SupervisorBadge compact />}
            </div>
            <p className="text-xs text-[#8d8c85]">
              {isSupervisor
                ? `Active on ${currentMember.displayName}'s profile.`
                : statusMode === 'unconfigured'
                  ? 'Configure the shared Supervisor password to unlock moderation status.'
                  : 'Enter the supervisor password to unlock your badge and moderation controls.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-lg text-[#71706b] hover:text-white hover:bg-[#242422] disabled:opacity-50 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {displayedError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-xl border border-[#4a2c2c] bg-[#1e1515] px-3 py-2 text-xs text-[#e5a4a4]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{displayedError}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setLocalError(null);
                onClearError();
              }}
              className="p-0.5 rounded text-[#c98b8b] hover:text-white shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {isSupervisor ? (
          <div className="space-y-4">
            <div className="bg-[#141413] border border-[#262624] rounded-xl p-3.5 space-y-2">
              <div className="text-[11px] font-medium text-[#edece8]">
                Supervisor privileges active
              </div>
              <ul className="space-y-1 text-xs text-[#9c9a92]">
                <li>· Special Supervisor badge shown across Feed, Closers, and DMs</li>
                <li>· Delete any post or threaded reply in the team feed</li>
                <li>· Pin or unpin any post across the feed</li>
                <li>· Update closer statuses and daily call counts in the roster</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-medium text-[#8d8c85]">
                Quick moderation actions
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {!confirmUnpinAll ? (
                  <button
                    type="button"
                    disabled={busy || pinnedCount === 0}
                    onClick={() => {
                      setConfirmClearBoard(false);
                      setConfirmUnpinAll(true);
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#141413] hover:bg-[#222220] border border-[#262624] hover:border-[#363632] disabled:opacity-45 text-xs text-[#edece8] transition-colors"
                  >
                    <PinOff className="w-3.5 h-3.5 text-[#8d8c85]" />
                    <span>Unpin all ({pinnedCount})</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 bg-[#141413] border border-[#3d3d39] rounded-xl p-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        await onUnpinAllPosts();
                        setConfirmUnpinAll(false);
                      }}
                      className="flex-1 px-2 py-1 rounded-lg bg-white text-black text-[11px] font-medium hover:bg-[#e0dfd9] disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmUnpinAll(false)}
                      className="px-2 py-1 text-[11px] text-[#8d8c85] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {!confirmClearBoard ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmUnpinAll(false);
                      setConfirmClearBoard(true);
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#141413] hover:bg-[#222220] border border-[#262624] hover:border-[#363632] disabled:opacity-45 text-xs text-[#edece8] transition-colors"
                  >
                    <Eraser className="w-3.5 h-3.5 text-[#8d8c85]" />
                    <span>Clear scratchpad</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 bg-[#141413] border border-[#3d3d39] rounded-xl p-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        await onClearScratchpad();
                        setConfirmClearBoard(false);
                      }}
                      className="flex-1 px-2 py-1 rounded-lg bg-white text-black text-[11px] font-medium hover:bg-[#e0dfd9] disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmClearBoard(false)}
                      className="px-2 py-1 text-[11px] text-[#8d8c85] hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {activeSupervisors.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-[#242422]">
                <div className="text-[11px] text-[#71706b]">
                  Active supervisors ({activeSupervisors.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {activeSupervisors.map((sup) => (
                    <span
                      key={sup.uid}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141413] border border-[#262624] text-xs text-[#edece8]"
                    >
                      <span>{sup.displayName}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#242422]">
              <button
                type="button"
                disabled={busy}
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#141413] hover:bg-[#222220] border border-[#2a2a27] text-xs text-[#b5b4ad] hover:text-white disabled:opacity-50 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{busy ? 'Exiting...' : 'Sign out of Supervisor'}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] text-black text-xs font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : statusMode === 'loading' ? (
          <div className="py-6 text-center text-xs text-[#8d8c85]">
            Checking supervisor access...
          </div>
        ) : statusMode === 'unconfigured' ? (
          <form onSubmit={handleClaimSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-[11px] text-[#8d8c85] block">
                Supervisor passcode
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPasscode ? 'text' : 'password'}
                  value={passcode}
                  onChange={(e) => {
                    setLocalError(null);
                    onClearError();
                    setPasscode(e.target.value);
                  }}
                  placeholder="Enter supervisor password..."
                  autoFocus
                  disabled={busy}
                  className="w-full bg-[#141413] border border-[#2c2c29] rounded-xl pl-9 pr-9 py-2 text-xs text-white placeholder-[#5e5d58] outline-none focus:border-[#4d4d48]"
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71706b] hover:text-white p-0.5"
                  title={showPasscode ? 'Hide password' : 'Show password'}
                >
                  {showPasscode ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-[#8d8c85] block">
                Confirm passcode
              </label>
              <input
                type={showPasscode ? 'text' : 'password'}
                value={confirmPasscode}
                onChange={(e) => {
                  setLocalError(null);
                  onClearError();
                  setConfirmPasscode(e.target.value);
                }}
                placeholder="Re-enter password..."
                disabled={busy}
                className="w-full bg-[#141413] border border-[#2c2c29] rounded-xl px-3 py-2 text-xs text-white placeholder-[#5e5d58] outline-none focus:border-[#4d4d48]"
              />
            </div>

            <p className="text-[11px] text-[#71706b] leading-relaxed">
              This initializes the passcode for this session. Set{' '}
              <code className="text-[#b5b4ad]">SUPERVISOR_PASSCODE</code> in
              Settings → Secrets before sharing broadly.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl text-xs text-[#8d8c85] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !passcode.trim() || !confirmPasscode.trim()}
                className="px-4 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] disabled:bg-[#262624] disabled:text-[#5e5d58] text-black text-xs font-medium transition-colors"
              >
                {busy ? 'Activating...' : 'Set & Sign in'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            <div className="space-y-1.5">
              <label className="text-[11px] text-[#8d8c85] block">
                Supervisor password
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPasscode ? 'text' : 'password'}
                  value={passcode}
                  onChange={(e) => {
                    setLocalError(null);
                    onClearError();
                    setPasscode(e.target.value);
                  }}
                  placeholder="Enter password..."
                  autoFocus
                  disabled={busy}
                  className="w-full bg-[#141413] border border-[#2c2c29] rounded-xl pl-9 pr-9 py-2 text-xs text-white placeholder-[#5e5d58] outline-none focus:border-[#4d4d48]"
                />
                <button
                  type="button"
                  onClick={() => setShowPasscode((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71706b] hover:text-white p-0.5"
                  title={showPasscode ? 'Hide password' : 'Show password'}
                >
                  {showPasscode ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-xl text-xs text-[#8d8c85] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !passcode.trim()}
                className="px-4 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] disabled:bg-[#262624] disabled:text-[#5e5d58] text-black text-xs font-medium transition-colors"
              >
                {busy ? 'Verifying...' : 'Sign in'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
