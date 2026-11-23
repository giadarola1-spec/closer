import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, OperationType, handleFirestoreError } from '../firebase.ts';
import { TeamMember, DirectThread, LIMITS, getOtherParticipantId } from '../types/team.ts';
import { compressProfileImage, sanitizePhotoUrl } from '../utils/image.ts';
import { Avatar } from './Avatar.tsx';
import { Check, Edit3, Phone, Camera, Upload, Trash2, Send, Search, X } from 'lucide-react';

interface RosterViewProps {
  members: TeamMember[];
  threads: DirectThread[];
  currentUserId: string;
  googlePhotoUrl?: string | null;
  onOpenDm: (targetUid: string) => void;
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
  threads,
  currentUserId,
  googlePhotoUrl,
  onOpenDm,
  onNotify,
}) => {
  const currentMember = members.find((m) => m.uid === currentUserId) || null;
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(currentMember?.displayName || '');
  const [statusText, setStatusText] = useState(currentMember?.statusText || '');
  const [photoUrlInput, setPhotoUrlInput] = useState(currentMember?.photoUrl || '');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [dailyCallsInput, setDailyCallsInput] = useState(
    String(currentMember?.dailyCalls ?? 0)
  );
  const [quickCallsInput, setQuickCallsInput] = useState(
    String(currentMember?.dailyCalls ?? 0)
  );
  const [saving, setSaving] = useState(false);
  const [callsSaving, setCallsSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const cardFileInputRef = useRef<HTMLInputElement | null>(null);
  const editFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (currentMember) {
      setDisplayName(currentMember.displayName);
      setStatusText(currentMember.statusText);
      setPhotoUrlInput(currentMember.photoUrl || '');
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
    const cleanPhoto = sanitizePhotoUrl(photoUrlInput);

    if (photoUrlInput.trim() && !cleanPhoto) {
      setPhotoError('Photo URL must start with https:// or be an uploaded JPEG/PNG/WebP image.');
      return;
    }

    if (!cleanName || saving) return;

    setPhotoError(null);
    setSaving(true);
    const path = `members/${currentUserId}`;
    try {
      await updateDoc(doc(db, 'members', currentUserId), {
        displayName: cleanName,
        statusText: cleanStatus,
        dailyCalls: cleanCalls,
        photoUrl: cleanPhoto,
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

  const handleEditFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPhotoError(null);
    setPhotoSaving(true);
    try {
      const compressed = await compressProfileImage(file);
      setPhotoUrlInput(compressed);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Failed to process image.');
    } finally {
      setPhotoSaving(false);
    }
  };

  const handleQuickCardPhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || photoSaving) return;

    setPhotoSaving(true);
    const path = `members/${currentUserId}`;
    try {
      const compressed = await compressProfileImage(file);
      await updateDoc(doc(db, 'members', currentUserId), {
        photoUrl: compressed,
        updatedAt: serverTimestamp(),
      });
      setPhotoUrlInput(compressed);
      onNotify('Profile picture updated');
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith('{')) {
        onNotify(error.message);
      } else {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    } finally {
      setPhotoSaving(false);
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

  const handleQuickStatusSelect = async (preset: string) => {
    if (!currentMember || statusSaving) return;
    setStatusText(preset);
    setStatusSaving(true);
    const path = `members/${currentUserId}`;
    try {
      await updateDoc(doc(db, 'members', currentUserId), {
        statusText: preset,
        updatedAt: serverTimestamp(),
      });
      onNotify(`Status: ${preset}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    } finally {
      setStatusSaving(false);
    }
  };

  const sortedMembers = [...members].sort((a, b) => {
    if (a.uid === currentUserId) return -1;
    if (b.uid === currentUserId) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const filteredMembers = sortedMembers.filter((m) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      m.displayName.toLowerCase().includes(q) ||
      (m.statusText || '').toLowerCase().includes(q)
    );
  });

  const totalDailyCalls = sortedMembers.reduce(
    (sum, m) => sum + (typeof m.dailyCalls === 'number' ? m.dailyCalls : 0),
    0
  );

  const savedCalls = currentMember?.dailyCalls ?? 0;
  const quickCallsDirty = sanitizeCalls(quickCallsInput) !== savedCalls;
  const safeGooglePhoto = sanitizePhotoUrl(googlePhotoUrl);
  const previewPhotoUrl = sanitizePhotoUrl(photoUrlInput);

  const threadsByPeerId: Record<string, DirectThread> = {};
  for (const thread of threads) {
    const peerId = getOtherParticipantId(thread.participantIds, currentUserId);
    threadsByPeerId[peerId] = thread;
  }

  return (
    <div className="max-w-4xl mx-auto py-6 sm:py-8 px-4 space-y-5 font-['Inter']">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222220] pb-4">
        <div>
          <h1 className="text-xl font-medium text-[#edece8] tracking-tight">
            Closers Roster
          </h1>
          <p className="text-xs text-[#8d8c85] mt-1">
            <span className="tabular-nums">{sortedMembers.length}</span>{' '}
            {sortedMembers.length === 1 ? 'closer' : 'closers'} active
            {' · '}
            <span className="tabular-nums text-[#c9c8c2]">
              {totalDailyCalls} calls/day total
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-44 sm:w-56">
            <Search className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter closers..."
              className="w-full bg-[#191918] border border-[#262624] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#71706b] outline-none focus:border-[#42423e] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71706b] hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {currentMember && !isEditing && (
            <button
              type="button"
              onClick={() => {
                setPhotoError(null);
                setIsEditing(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#191918] hover:bg-[#242422] border border-[#2a2a27] text-xs text-[#edece8] transition-colors whitespace-nowrap shrink-0"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit profile</span>
            </button>
          )}
        </div>
      </div>

      {/* 1-Click Quick Status Selector */}
      {currentMember && !isEditing && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#191918] border border-[#262624] rounded-2xl px-4 py-3">
          <span className="text-xs text-[#8d8c85]">Your status</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_PRESETS.map((preset) => {
              const active = (currentMember.statusText || '').trim() === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={statusSaving}
                  onClick={() => handleQuickStatusSelect(preset)}
                  className={`px-2.5 py-1 rounded-lg border text-xs transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#2a2a27] border-[#42423e] text-white font-medium'
                      : 'bg-[#141413] border-[#262624] text-[#8d8c85] hover:text-[#edece8] hover:border-[#363632]'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isEditing && currentMember && (
        <form
          onSubmit={handleSaveProfile}
          className="bg-[#1f1f1e] border border-[#2f2f2c] rounded-2xl p-4 space-y-4"
        >
          <div className="text-xs font-medium text-white">Your Closer Card</div>

          {/* Profile Picture Editor */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-3 border-b border-[#292926]">
            <Avatar
              name={displayName || currentMember.displayName}
              photoUrl={previewPhotoUrl}
              size="lg"
            />
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={editFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleEditFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={photoSaving}
                  onClick={() => editFileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141413] hover:bg-[#282826] border border-[#2f2f2c] text-xs text-[#edece8] transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{photoSaving ? 'Processing...' : 'Upload photo'}</span>
                </button>
                {safeGooglePhoto && photoUrlInput !== safeGooglePhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoError(null);
                      setPhotoUrlInput(safeGooglePhoto);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#141413] hover:bg-[#282826] border border-[#2a2a27] text-xs text-[#9c9a92] hover:text-white transition-colors"
                  >
                    Use Google photo
                  </button>
                )}
                {photoUrlInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoError(null);
                      setPhotoUrlInput('');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141413] hover:bg-[#282826] border border-[#2a2a27] text-xs text-[#8d8c85] hover:text-white transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
              <input
                type="url"
                value={photoUrlInput.startsWith('data:') ? '' : photoUrlInput}
                onChange={(e) => {
                  setPhotoError(null);
                  setPhotoUrlInput(e.target.value);
                }}
                placeholder={
                  photoUrlInput.startsWith('data:')
                    ? 'Uploaded custom photo ready to save'
                    : 'Or paste an https:// image URL...'
                }
                className="w-full bg-[#141413] border border-[#2c2c29] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#5e5d58] outline-none focus:border-[#4d4d48]"
              />
              {photoError && (
                <p className="text-[11px] text-[#d1d1cf]">{photoError}</p>
              )}
            </div>
          </div>

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
              onClick={() => {
                setPhotoError(null);
                setPhotoUrlInput(currentMember.photoUrl || '');
                setIsEditing(false);
              }}
              className="px-3 py-1.5 rounded-lg text-xs text-[#8d8c85] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || photoSaving || !displayName.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-[#e0dfd9] disabled:opacity-50 text-black text-xs font-medium transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Hidden quick-upload input for self card avatar */}
      <input
        ref={cardFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleQuickCardPhotoSelect}
        className="hidden"
      />

      {filteredMembers.length === 0 ? (
        <div className="bg-[#191918] border border-[#262624] rounded-2xl p-8 text-center space-y-2">
          <p className="text-sm text-[#edece8] font-medium">No matching closers</p>
          <p className="text-xs text-[#71706b]">Try a different name or status keyword.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredMembers.map((member) => {
            const isMe = member.uid === currentUserId;
            const callsCount = typeof member.dailyCalls === 'number' ? member.dailyCalls : 0;

            return (
              <div
                key={member.uid}
                className={`bg-[#191918] rounded-2xl p-4 flex flex-col justify-between space-y-3 border transition-colors ${
                  isMe ? 'border-[#3a3a36]' : 'border-[#262624] hover:border-[#32322f]'
                }`}
              >
              <div className="flex items-start gap-3">
                {isMe ? (
                  <button
                    type="button"
                    disabled={photoSaving}
                    onClick={() => cardFileInputRef.current?.click()}
                    className="relative group shrink-0 rounded-full focus:outline-none"
                    title="Change profile picture"
                  >
                    <Avatar
                      name={member.displayName}
                      photoUrl={member.photoUrl}
                      size="md"
                    />
                    <span className="absolute inset-0 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Camera className="w-3.5 h-3.5 text-white" />
                    </span>
                  </button>
                ) : (
                  <Avatar
                    name={member.displayName}
                    photoUrl={member.photoUrl}
                    size="md"
                  />
                )}

                <div className="min-w-0 flex-1 space-y-1">
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
              </div>

              {/* Daily Calls Counter (direct numeric input, no +/- buttons) & Private Message */}
              <div className="pt-2.5 border-t border-[#222220] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
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

                {(() => {
                  const thread = threadsByPeerId[member.uid];
                  return (
                    <button
                      type="button"
                      onClick={() => onOpenDm(member.uid)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#141413] hover:bg-[#222220] border border-[#262624] hover:border-[#363632] text-xs text-[#c9c8c2] hover:text-white transition-colors"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Send className="w-3 h-3 text-[#8d8c85] shrink-0" />
                        <span className="truncate">
                          {isMe
                            ? 'Private notes'
                            : thread
                              ? 'Open private chat'
                              : `Message ${member.displayName}`}
                        </span>
                      </span>
                      {thread && (
                        <span className="text-[10px] text-[#71706b] truncate max-w-[90px]">
                          {thread.lastSenderId === currentUserId ? 'You: ' : ''}
                          {thread.lastMessageText}
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
};
