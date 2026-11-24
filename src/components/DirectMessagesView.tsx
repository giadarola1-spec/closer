import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { ArrowUp, Lock, Search, Trash2, ChevronLeft, X, Copy } from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../firebase.ts';
import {
  TEAM_ID,
  LIMITS,
  TeamMember,
  DirectThread,
  DirectMessage,
  getParticipantPair,
  getDmId,
  getOtherParticipantId,
} from '../types/team.ts';
import { Avatar } from './Avatar.tsx';
import { SupervisorBadge } from './SupervisorBadge.tsx';

interface DirectMessagesViewProps {
  currentMember: TeamMember;
  members: TeamMember[];
  isLoadingMembers?: boolean;
  threads: DirectThread[];
  supervisorIds?: Set<string>;
  selectedUserId: string | null;
  onSelectUser: (uid: string) => void;
  onNotify: (msg: string) => void;
}

function formatMessageTime(ts: any): string {
  if (!ts) return 'sending';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatShortTime(ts: any): string {
  if (!ts) return '';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDayKey(ts: any): string {
  const date = ts && typeof ts.toDate === 'function' ? ts.toDate() : ts ? new Date(ts) : new Date();
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDayDivider(ts: any): string {
  const date = ts && typeof ts.toDate === 'function' ? ts.toDate() : ts ? new Date(ts) : new Date();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((today - target) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const DirectMessagesView: React.FC<DirectMessagesViewProps> = ({
  currentMember,
  members,
  isLoadingMembers = false,
  threads,
  supervisorIds,
  selectedUserId,
  onSelectUser,
  onNotify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(Boolean(selectedUserId));

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const threadsByPeerId = useMemo(() => {
    const map: Record<string, DirectThread> = {};
    for (const thread of threads) {
      const peerId = getOtherParticipantId(thread.participantIds, currentMember.uid);
      map[peerId] = thread;
    }
    return map;
  }, [threads, currentMember.uid]);

  const sortedPeople = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members
      .filter((m) => {
        if (!q) return true;
        return (
          m.displayName.toLowerCase().includes(q) ||
          (m.statusText || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ta = threadsByPeerId[a.uid]?.lastMessageAt?.toMillis?.() || 0;
        const tb = threadsByPeerId[b.uid]?.lastMessageAt?.toMillis?.() || 0;
        if (ta !== tb) return tb - ta;
        if (a.uid === currentMember.uid && b.uid !== currentMember.uid) return 1;
        if (b.uid === currentMember.uid && a.uid !== currentMember.uid) return -1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [members, searchQuery, threadsByPeerId, currentMember.uid]);

  const activeRecipient = useMemo(() => {
    if (selectedUserId) {
      const found = members.find((m) => m.uid === selectedUserId);
      if (found) return found;
    }
    const firstTeammate = sortedPeople.find((m) => m.uid !== currentMember.uid);
    return firstTeammate || sortedPeople[0] || currentMember;
  }, [selectedUserId, members, sortedPeople, currentMember]);

  const dmId = activeRecipient ? getDmId(currentMember.uid, activeRecipient.uid) : null;

  useEffect(() => {
    if (selectedUserId) {
      setMobileShowChat(true);
    }
  }, [selectedUserId]);

  useEffect(() => {
    if (!dmId) {
      setMessages([]);
      return;
    }

    setIsLoadingMessages(true);
    const messagesPath = `dms/${dmId}/messages`;
    const q = query(
      collection(db, 'dms', dmId, 'messages'),
      where('participantIds', 'array-contains', currentMember.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as DirectMessage)
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
            const tb = b.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
            return ta - tb;
          });
        setMessages(list);
        setIsLoadingMessages(false);
      },
      (error) => {
        setIsLoadingMessages(false);
        handleFirestoreError(error, OperationType.LIST, messagesPath);
      }
    );

    return () => unsub();
  }, [dmId, currentMember.uid]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, dmId]);

  useEffect(() => {
    if (!mobileShowChat) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileShowChat(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileShowChat]);

  const handleCopyMessage = (text: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
    onNotify('Message copied');
  };

  const handleSelectPerson = (uid: string) => {
    onSelectUser(uid);
    setMobileShowChat(true);
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 40);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeRecipient || !dmId || sending) return;

    const cleanBody = draft.trim().slice(0, LIMITS.DM_BODY_MAX);
    if (!cleanBody) return;

    setSending(true);
    const dmRef = doc(db, 'dms', dmId);
    const messageRef = doc(collection(db, 'dms', dmId, 'messages'));
    const participantIds = getParticipantPair(currentMember.uid, activeRecipient.uid);
    const preview = cleanBody.slice(0, LIMITS.DM_PREVIEW_MAX);

    try {
      const dmSnap = await getDoc(dmRef);
      const batch = writeBatch(db);

      batch.set(messageRef, {
        dmId,
        teamId: TEAM_ID,
        participantIds,
        senderId: currentMember.uid,
        senderName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        recipientId: activeRecipient.uid,
        body: cleanBody,
        createdAt: serverTimestamp(),
      });

      if (!dmSnap.exists()) {
        batch.set(dmRef, {
          teamId: TEAM_ID,
          participantIds,
          lastMessageText: preview,
          lastSenderId: currentMember.uid,
          lastMessageId: messageRef.id,
          lastMessageAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(dmRef, {
          lastMessageText: preview,
          lastSenderId: currentMember.uid,
          lastMessageId: messageRef.id,
          lastMessageAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setDraft('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `dms/${dmId}/messages/${messageRef.id}`);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!dmId) return;
    try {
      await deleteDoc(doc(db, 'dms', dmId, 'messages', messageId));
      onNotify('Message deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `dms/${dmId}/messages/${messageId}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isSelfThread = activeRecipient.uid === currentMember.uid;

  return (
    <div className="h-full flex bg-[#141413] font-['Inter'] overflow-hidden">
      {/* Left Conversation / People List */}
      <div
        className={`w-full md:w-72 lg:w-80 border-r border-[#222220] bg-[#141413] flex flex-col shrink-0 ${
          mobileShowChat ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-[#222220] space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-medium text-[#edece8] tracking-tight">
              Private Messages
            </h1>
            <span className="text-[11px] text-[#71706b] tabular-nums">
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find a closer..."
              className="w-full bg-[#191918] border border-[#2a2a27] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#71706b] outline-none focus:border-[#4d4d48]"
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
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingMembers ? (
            <div className="space-y-1" aria-busy="true" aria-label="Loading closers">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  aria-hidden="true"
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl"
                >
                  <div className="w-6 h-6 rounded-full skeleton-shimmer shrink-0" />
                  <div className="w-[100px] h-3 rounded-md skeleton-shimmer" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1 animate-fade-150">
              {sortedPeople.map((person) => {
                const isSelected = activeRecipient.uid === person.uid;
                const thread = threadsByPeerId[person.uid];
                const isMe = person.uid === currentMember.uid;
                const previewPrefix =
                  thread && thread.lastSenderId === currentMember.uid ? 'You: ' : '';

                return (
                  <button
                    key={person.uid}
                    type="button"
                    onClick={() => handleSelectPerson(person.uid)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      isSelected
                        ? 'bg-[#1f1f1e] border border-[#2f2f2c]'
                        : 'border border-transparent hover:bg-[#191918]'
                    }`}
                  >
                    <Avatar
                      name={person.displayName}
                      photoUrl={person.photoUrl}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium text-[#edece8] truncate">
                            {person.displayName}
                            {isMe ? ' (You)' : ''}
                          </span>
                          {supervisorIds?.has(person.uid) && (
                            <SupervisorBadge compact />
                          )}
                        </div>
                        {thread?.lastMessageAt && (
                          <span className="text-[10px] text-[#71706b] shrink-0 tabular-nums">
                            {formatShortTime(thread.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#8d8c85] truncate mt-0.5">
                        {thread
                          ? `${previewPrefix}${thread.lastMessageText}`
                          : person.statusText || 'On the phones'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Active Thread Pane */}
      <div
        className={`flex-1 flex flex-col min-w-0 bg-[#141413] ${
          mobileShowChat ? 'flex' : 'hidden md:flex'
        }`}
      >
        {/* Thread Header */}
        <div className="px-4 py-3 border-b border-[#222220] bg-[#141413] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileShowChat(false)}
              className="md:hidden p-1.5 rounded-lg bg-[#1e1e1c] text-[#9c9a92] hover:text-white"
              title="Back to people"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <Avatar
              name={activeRecipient.displayName}
              photoUrl={activeRecipient.photoUrl}
              size="sm"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-white truncate">
                  {activeRecipient.displayName}
                  {isSelfThread ? ' (Notes to self)' : ''}
                </h2>
                {supervisorIds?.has(activeRecipient.uid) && (
                  <SupervisorBadge compact />
                )}
              </div>
              <p className="text-[11px] text-[#8d8c85] truncate">
                {activeRecipient.statusText || 'On the phones'}
                {' · '}
                <span className="tabular-nums">
                  {activeRecipient.dailyCalls ?? 0} calls/day
                </span>
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[#71706b] shrink-0">
            <Lock className="w-3 h-3" />
            <span>
              {isSelfThread
                ? 'Private to you'
                : `Private · Only you and ${activeRecipient.displayName}`}
            </span>
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
          {isLoadingMessages ? (
            <div className="py-12 text-center text-xs text-[#71706b]">
              Loading messages...
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-12 space-y-2">
              <Avatar
                name={activeRecipient.displayName}
                photoUrl={activeRecipient.photoUrl}
                size="lg"
              />
              <p className="text-sm font-medium text-[#edece8] pt-1">
                {activeRecipient.displayName}
              </p>
              <p className="text-xs text-[#71706b] max-w-xs leading-relaxed">
                {isSelfThread
                  ? 'Keep private notes, call reminders, or scripts here. Only you can see this.'
                  : `Start a private conversation with ${activeRecipient.displayName}. Only the two of you can read these messages.`}
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isMine = msg.senderId === currentMember.uid;
              const prevMsg = idx > 0 ? messages[idx - 1] : null;
              const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null;
              const dayKey = getDayKey(msg.createdAt);
              const showDayDivider = !prevMsg || getDayKey(prevMsg.createdAt) !== dayKey;
              const sameSenderAsPrev =
                !showDayDivider && prevMsg && prevMsg.senderId === msg.senderId;
              const sameSenderAsNext =
                nextMsg &&
                getDayKey(nextMsg.createdAt) === dayKey &&
                nextMsg.senderId === msg.senderId;

              return (
                <React.Fragment key={msg.id}>
                  {showDayDivider && (
                    <div className="flex items-center justify-center py-2">
                      <span className="text-[11px] text-[#71706b] px-2">
                        {formatDayDivider(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <div
                    className={`group flex flex-col ${
                      isMine ? 'items-end' : 'items-start'
                    } ${sameSenderAsPrev ? '!mt-1' : 'mt-2'}`}
                  >
                    <div
                      className={`flex items-end gap-1.5 max-w-[85%] sm:max-w-[70%] ${
                        isMine ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isMine
                            ? 'bg-[#edece8] text-black'
                            : 'bg-[#191918] border border-[#262624] text-[#e0dfd9]'
                        }`}
                      >
                        {msg.body}
                      </div>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.body)}
                          className="p-1 rounded-md text-[#71706b] hover:text-white hover:bg-[#1e1e1c]"
                          title="Copy message"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        {isMine && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="p-1 rounded-md text-[#71706b] hover:text-white hover:bg-[#1e1e1c]"
                            title="Delete message"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    {!sameSenderAsNext && (
                      <span className="text-[10px] text-[#686761] mt-1 px-1 tabular-nums">
                        {formatMessageTime(msg.createdAt)}
                      </span>
                    )}
                  </div>
                </React.Fragment>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        <form
          onSubmit={handleSendMessage}
          className="p-3 sm:p-4 border-t border-[#222220] bg-[#141413] shrink-0"
        >
          <div className="bg-[#1f1f1e] border border-[#2f2f2c] focus-within:border-[#4d4d48] rounded-2xl p-2.5 flex items-end gap-2 transition-colors">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={LIMITS.DM_BODY_MAX}
              rows={1}
              placeholder={
                isSelfThread
                  ? 'Write a private note...'
                  : `Message ${activeRecipient.displayName}...`
              }
              className="flex-1 bg-transparent text-sm text-white placeholder-[#71706b] outline-none resize-none px-1.5 py-1 max-h-36 leading-relaxed"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="w-8 h-8 rounded-full bg-white hover:bg-[#e0dfd9] disabled:bg-[#292926] disabled:text-[#555550] text-black flex items-center justify-center transition-colors shrink-0"
              title="Send message"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-[#686761] mt-1.5 px-1">
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
};
