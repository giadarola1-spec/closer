import React, { useState, useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../firebase.ts';
import { TeamMember, LIMITS } from '../types/team.ts';
import { Check, Edit3, Phone } from 'lucide-react';

interface RosterViewProps {
  members: TeamMember[];
  currentUserId: string;
  onNotify: (msg: string) => void;
}

const STATUS_PRESETS = [
  'On the phones',
  'In a call',
  'Available',
  'On break',
  'Offline',
] as const;

function sanitizeCalls(value: number | string): number {
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(LIMITS.DAILY_CALLS_MAX, Math.floor(parsed)));
}

export const RosterView: React.FC<RosterViewProps> = ({
  members,
  currentUserId,
  onNotify,
}) => {
  const currentMember = members.find((m) => m.uid === currentUserId) || null;
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(currentMember?.displayName || '');
  const [statusText, setStatusText] = useState(currentMember?.statusText || '');
  const [dailyCallsInput, setDailyCallsInput] = useState(
    String(currentMember?.dailyCalls ?? 0)
  );
  const [quickCallsInput, setQuickCallsInput] = useState(
    String(currentMember?.dailyCalls ?? 0)
  );
  const [saving, setSaving] = useState(false);
  const [callsSaving, setCallsSaving] = useState(false);

  useEffect(() => {
    if (currentMember) {
      setDisplayName(currentMember.displayName);
      setStatusText(currentMember.statusText);
      const callsStr = String(currentMember.dailyCalls ?? 0);
      setDailyCallsInput(callsStr);
      setQuickCallsInput(callsStr);
    }
  }, [currentMember]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = displayName.trim().slice(0, LIMITS.DISPLAY_NAME_MAX);
    const cleanStatus = statusText.trim().slice(0, LIMITS.STATUS_TEXT_MAX);
    const cleanCalls = sanitizeCalls(dailyCallsInput);
    if (!cleanName || saving) return;

    setSaving(true);
    const path = `members/${currentUserId}`;
    try {
      await updateDoc(doc(db, 'members', currentUserId), {
        displayName: cleanName,
        statusText: cleanStatus,
        dailyCalls: cleanCalls,
        updatedAt: serverTimestamp(),
      });
      setIsEditing(false);
      onNotify('Profile updated');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateDailyCalls = async (nextValue: number) => {
    if (callsSaving) return;
    const cleanCalls = sanitizeCalls(nextValue);
    setQuickCallsInput(String(cleanCalls));
    setCallsSaving(true);
    const path = `members/${currentUserId}`;
    try {
      await updateDoc(doc(db, 'members', currentUserId), {
        dailyCalls: cleanCalls,
        updatedAt: serverTimestamp(),
      });
      onNotify(`Daily calls set to ${cleanCalls}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setCallsSaving(false);
    }
  };

  const handleQuickCallsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleUpdateDailyCalls(sanitizeCalls(quickCallsInput));
  };

  const sortedMembers = [...members].sort((a, b) => {
    if (a.uid === currentUserId) return -1;
    if (b.uid === currentUserId) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const totalDailyCalls = sortedMembers.reduce(
    (sum, m) => sum + (typeof m.dailyCalls === 'number' ? m.dailyCalls : 0),
    0
  );

  const savedCalls = currentMember?.dailyCalls ?? 0;
  const quickCallsDirty = sanitizeCalls(quickCallsInput) !== savedCalls;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6 font-['Inter']">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222220] pb-4">
        <div>
          <h1 className="text-xl font-medium text-[#edece8] tracking-tight">
            Closers Roster
          </h1>
          <p className="text-xs text-[#8d8c85] mt-1">
            {sortedMembers.length} {sortedMembers.length === 1 ? 'closer' : 'closers'} active
            {' · '}
            <span className="tabular-nums text-[#c9c8c2]">
              {totalDailyCalls} calls/day total
            </span>
          </p>
        </div>
        {currentMember && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e1e1c] hover:bg-[#282826] border border-[#2f2f2c] text-xs text-[#edece8] transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit my status</span>
          </button>
        )}
      </div>

      {isEditing && currentMember && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-[#1f1f1e] border border-[#2f2f2c] rounded-2xl p-4 space-y-3"
        >
          <div className="text-xs font-medium text-white">Your Closer Card</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-[#8d8c85] block">Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={LIMITS.DISPLAY_NAME_MAX}
                required
                className="w-full bg-[#141413] border border-[#2c2c29] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-[#4d4d48]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-[#8d8c85] block">
                Calls per day
              </label>
              <input
                type="number"
                min={0}
                max={LIMITS.DAILY_CALLS_MAX}
                value={dailyCallsInput}
                onChange={(e) => setDailyCallsInput(e.target.value)}
                className="w-full bg-[#141413] border border-[#2c2c29] rounded-lg px-3 py-1.5 text-xs text-white tabular-nums outline-none focus:border-[#4d4d48]"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] text-[#8d8c85] block">Status</label>
            <input
              type="text"
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              maxLength={LIMITS.STATUS_TEXT_MAX}
              placeholder="Choose or write your current status..."
              className="w-full bg-[#141413] border border-[#2c2c29] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#5e5d58] outline-none focus:border-[#4d4d48]"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_PRESETS.map((preset) => {
                const selected = statusText.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setStatusText(preset)}
                    className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors ${
                      selected
                        ? 'bg-[#2a2a27] border-[#42423e] text-white'
                        : 'bg-[#141413] border-[#262624] text-[#8d8c85] hover:text-white hover:border-[#363632]'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-[#8d8c85] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !displayName.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-[#e0dfd9] disabled:opacity-50 text-black text-xs font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {sortedMembers.map((member) => {
          const isMe = member.uid === currentUserId;
          const callsCount = typeof member.dailyCalls === 'number' ? member.dailyCalls : 0;

          return (
            <div
              key={member.uid}
              className="bg-[#191918] border border-[#262624] rounded-xl p-4 flex flex-col justify-between space-y-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white truncate">
                    {member.displayName}
                  </span>
                  {isMe && (
                    <span className="text-[11px] text-[#9c9a92] shrink-0">
                      You
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#9c9a92] leading-relaxed min-h-[32px]">
                  {member.statusText || 'On the phones'}
                </p>
              </div>

              {/* Daily Calls Counter (direct numeric input, no +/- buttons) */}
              <div className="pt-2.5 border-t border-[#222220] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-[#8d8c85]">
                  <Phone className="w-3 h-3 text-[#71706b]" />
                  <span>Calls / day</span>
                </div>

                {isMe ? (
                  <form
                    onSubmit={handleQuickCallsSubmit}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="number"
                      min={0}
                      max={LIMITS.DAILY_CALLS_MAX}
                      value={quickCallsInput}
                      onChange={(e) => setQuickCallsInput(e.target.value)}
                      aria-label="Your calls per day"
                      className="w-16 bg-[#141413] border border-[#2a2a27] rounded-md px-2 py-0.5 text-right text-xs text-white font-medium tabular-nums outline-none focus:border-[#4d4d48]"
                    />
                    {quickCallsDirty && (
                      <button
                        type="submit"
                        disabled={callsSaving}
                        className="px-2 py-0.5 rounded-md bg-white hover:bg-[#e0dfd9] disabled:opacity-50 text-black text-[11px] font-medium transition-colors"
                      >
                        Save
                      </button>
                    )}
                  </form>
                ) : (
                  <span className="text-sm font-medium text-[#edece8] tabular-nums">
                    {callsCount}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
