import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Menu,
  MessageSquare,
  Users,
  Send,
  LogOut,
  X,
  Shield,
  ShieldCheck,
  ChevronUp,
  Check,
} from 'lucide-react';
import { PresenceStatus, SidebarChannel, TeamMember } from '../types/team.ts';
import {
  PRESENCE_META,
  PRESENCE_OPTIONS,
  resolveEffectivePresence,
} from '../utils/presence.ts';
import { Avatar } from './Avatar.tsx';
import { SupervisorBadge } from './SupervisorBadge.tsx';

interface SidebarProps {
  activeChannel: SidebarChannel;
  onSelectChannel: (channel: SidebarChannel) => void;
  onFocusComposer: () => void;
  postCount: number;
  dmCount: number;
  memberCount: number;
  members: TeamMember[];
  isLoadingMembers?: boolean;
  selectedDmUserId: string | null;
  onOpenDm: (targetUid: string) => void;
  currentMember: TeamMember | null;
  nowMs: number;
  onChangePresence: (next: PresenceStatus) => void;
  supervisorIds: Set<string>;
  isSupervisor: boolean;
  onOpenSupervisorModal: () => void;
  onSignOut: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: {
  id: SidebarChannel;
  label: string;
  icon: React.FC<{ className?: string }>;
}[] = [
  { id: 'feed', label: 'Feed', icon: MessageSquare },
  { id: 'messages', label: 'Messages', icon: Send },
  { id: 'roster', label: 'Closers', icon: Users },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeChannel,
  onSelectChannel,
  onFocusComposer,
  postCount,
  dmCount,
  memberCount,
  members,
  isLoadingMembers = false,
  selectedDmUserId,
  onOpenDm,
  currentMember,
  nowMs,
  onChangePresence,
  supervisorIds,
  isSupervisor,
  onOpenSupervisorModal,
  onSignOut,
  isOpen,
  onToggleOpen,
  isMobileOpen,
  onCloseMobile,
}) => {
  const [isPresenceMenuOpen, setIsPresenceMenuOpen] = useState(false);
  const presenceMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  useEffect(() => {
    if (!isPresenceMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        presenceMenuRef.current &&
        !presenceMenuRef.current.contains(e.target as Node)
      ) {
        setIsPresenceMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPresenceMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPresenceMenuOpen]);

  const sortedPeople = [...members].sort((a, b) => {
    if (a.uid === currentMember?.uid && b.uid !== currentMember?.uid) return 1;
    if (b.uid === currentMember?.uid && a.uid !== currentMember?.uid) return -1;
    return a.displayName.localeCompare(b.displayName);
  });

  const expanded = isOpen || isMobileOpen;
  const myPresence = resolveEffectivePresence(currentMember, nowMs);
  const myPresenceMeta = PRESENCE_META[myPresence];

  const handleNavClick = (channel: SidebarChannel) => {
    onSelectChannel(channel);
    onCloseMobile();
  };

  const handleComposerClick = () => {
    onFocusComposer();
    onCloseMobile();
  };

  const handleDmClick = (uid: string) => {
    onOpenDm(uid);
    onCloseMobile();
  };

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/65 lg:hidden animate-in fade-in duration-150"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 lg:static h-screen bg-[#0f0f0e] border-r border-[#222220] transition-transform duration-200 flex flex-col justify-between select-none font-['Inter'] shrink-0 ${
          isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'
        } ${isOpen ? 'lg:w-64' : 'lg:w-16'}`}
      >
        {/* Top Sidebar Opener */}
        <div className="flex flex-col flex-1 min-h-0">
          <div
            className={`h-14 px-3.5 flex items-center ${
              expanded ? 'justify-between lg:justify-start' : 'justify-center'
            }`}
          >
            <button
              type="button"
              onClick={onToggleOpen}
              className="hidden lg:inline-flex items-center justify-center p-1.5 bg-transparent hover:bg-transparent border-0 text-[#8d8c85] hover:text-white transition-colors"
              title={isOpen ? 'Collapse sidebar' : 'Open sidebar'}
              aria-label={isOpen ? 'Collapse sidebar' : 'Open sidebar'}
            >
              <Menu className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden ml-auto p-1.5 bg-transparent hover:bg-transparent border-0 text-[#8d8c85] hover:text-white transition-colors"
              title="Close navigation"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Primary Action: New Post */}
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={handleComposerClick}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#191918] hover:bg-[#242422] border border-[#2a2a27] hover:border-[#363632] text-[#edece8] text-xs font-medium transition-colors whitespace-nowrap ${
                !expanded ? 'justify-center px-0' : ''
              }`}
              title="New post"
            >
              <Plus className="w-4 h-4 text-[#edece8] shrink-0" />
              {expanded && <span>New post</span>}
            </button>
          </div>

          {/* Navigation + Direct Messages People List */}
          <nav className="flex-1 overflow-y-auto px-2.5 space-y-1 text-xs">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeChannel === item.id;
              const countLabel =
                item.id === 'roster'
                  ? memberCount > 0
                    ? String(memberCount)
                    : ''
                  : item.id === 'messages'
                    ? dmCount > 0
                      ? String(dmCount)
                      : ''
                    : item.id === 'feed' && postCount > 0
                      ? String(postCount)
                      : '';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#191918] border-[#2c2c29] text-white font-medium'
                      : 'border-transparent text-[#9c9a92] hover:bg-[#171715] hover:text-[#edece8]'
                  } ${!expanded ? 'justify-center px-0' : ''}`}
                  title={item.label}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-[#edece8]' : 'text-[#8d8c85]'
                      }`}
                    />
                    {expanded && <span className="truncate">{item.label}</span>}
                  </div>
                  {expanded && countLabel && (
                    <span className="text-[11px] text-[#71706b] font-normal tabular-nums">
                      {countLabel}
                    </span>
                  )}
                </button>
              );
            })}

            {expanded && (isLoadingMembers || sortedPeople.length > 0) && (
              <div className="pt-4 pb-2">
                <div className="px-3 pb-1.5 text-[11px] font-medium text-[#71706b]">
                  Direct messages
                </div>
                {isLoadingMembers ? (
                  <div
                    className="space-y-0.5"
                    aria-busy="true"
                    aria-label="Loading closers"
                  >
                    {[0, 1, 2, 3].map((idx) => (
                      <div
                        key={idx}
                        aria-hidden="true"
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl"
                      >
                        <div className="w-6 h-6 rounded-full skeleton-shimmer shrink-0" />
                        <div className="w-[100px] h-3 rounded-md skeleton-shimmer" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-0.5 animate-fade-150">
                    {sortedPeople.map((person) => {
                      const isSelected =
                        activeChannel === 'messages' && selectedDmUserId === person.uid;
                      const isMe = person.uid === currentMember?.uid;
                      const presence = resolveEffectivePresence(person, nowMs);
                      const presenceMeta = PRESENCE_META[presence];

                      return (
                        <button
                          key={person.uid}
                          type="button"
                          onClick={() => handleDmClick(person.uid)}
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition-colors text-left ${
                            isSelected
                              ? 'bg-[#191918] border-[#2c2c29] text-white font-medium'
                              : 'border-transparent text-[#9c9a92] hover:bg-[#171715] hover:text-[#edece8]'
                          }`}
                          title={`Message ${person.displayName} · ${presenceMeta.label}`}
                        >
                          <Avatar
                            name={person.displayName}
                            photoUrl={person.photoUrl}
                            size="xs"
                            presenceStatus={presence}
                            presenceRingClass="ring-[#0f0f0e]"
                          />
                          <span className="truncate flex-1">
                            {person.displayName}
                            {isMe ? ' (You)' : ''}
                          </span>
                          {supervisorIds.has(person.uid) && (
                            <SupervisorBadge compact />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>

        {/* Bottom Supervisor & Current Closer Profile Strip */}
        <div className="border-t border-[#1e1e1c] p-2.5 space-y-1.5">
          <button
            type="button"
            onClick={() => {
              onOpenSupervisorModal();
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors whitespace-nowrap ${
              isSupervisor
                ? 'text-[#f2c46d] hover:bg-[#231b10]/60'
                : 'text-[#8d8c85] hover:text-white hover:bg-[#171715]'
            } ${!expanded ? 'justify-center px-0' : ''}`}
            title={isSupervisor ? 'Supervisor profile active' : 'Supervisor login'}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isSupervisor ? (
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#eab308]" />
              ) : (
                <Shield className="w-3.5 h-3.5 shrink-0 text-[#71706b]" />
              )}
              {expanded && <span className="truncate">Supervisor</span>}
            </span>
            {expanded && (
              <span
                className={`text-[11px] ${
                  isSupervisor ? 'text-[#f2c46d]' : 'text-[#71706b]'
                }`}
              >
                {isSupervisor ? 'Active' : 'Login'}
              </span>
            )}
          </button>

          {expanded ? (
            <div ref={presenceMenuRef} className="relative">
              {isPresenceMenuOpen && (
                <div
                  role="menu"
                  aria-label="Set availability status"
                  className="absolute bottom-full left-0 right-0 mb-1.5 z-50 rounded-xl border border-[#2c2c29] bg-[#191918] p-1 shadow-xl space-y-0.5"
                >
                  {PRESENCE_OPTIONS.map((option) => {
                    const meta = PRESENCE_META[option];
                    const selected = myPresence === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onChangePresence(option);
                          setIsPresenceMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                          selected
                            ? 'bg-[#262624] text-white font-medium'
                            : 'text-[#b5b4ad] hover:bg-[#222220] hover:text-white'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`}
                          />
                          <span>{meta.label}</span>
                        </span>
                        {selected && <Check className="w-3 h-3 text-[#edece8]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl hover:bg-[#171715] transition-colors">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => handleNavClick('roster')}
                    className="shrink-0 rounded-full focus:outline-none"
                    title="Edit your closer profile, photo & daily calls"
                  >
                    <Avatar
                      name={currentMember?.displayName || 'Closer'}
                      photoUrl={currentMember?.photoUrl}
                      size="sm"
                      presenceStatus={myPresence}
                      presenceRingClass="ring-[#0f0f0e]"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleNavClick('roster')}
                      className="flex items-center gap-1.5 min-w-0 w-full text-left"
                      title="Open closer roster"
                    >
                      <span className="text-xs font-medium text-[#edece8] truncate">
                        {currentMember?.displayName || 'Closer'}
                      </span>
                      {isSupervisor && <SupervisorBadge compact />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPresenceMenuOpen((prev) => !prev)}
                      className="flex items-center gap-1 text-[11px] text-[#71706b] hover:text-[#c9c8c2] transition-colors max-w-full"
                      title="Change availability status"
                    >
                      <span className={myPresenceMeta.textClass}>
                        {myPresenceMeta.label}
                      </span>
                      <span>·</span>
                      <span className="truncate tabular-nums">
                        {currentMember?.dailyCalls ?? 0} calls
                      </span>
                      <ChevronUp className="w-3 h-3 shrink-0 opacity-70" />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="p-1.5 text-[#71706b] hover:text-white rounded-lg hover:bg-[#222220] transition-colors shrink-0"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => handleNavClick('roster')}
                className="p-1 rounded-full hover:bg-[#171715] transition-colors"
                title={`${currentMember?.displayName || 'Closers'} · ${myPresenceMeta.label}`}
              >
                <Avatar
                  name={currentMember?.displayName || 'Closer'}
                  photoUrl={currentMember?.photoUrl}
                  size="sm"
                  presenceStatus={myPresence}
                  presenceRingClass="ring-[#0f0f0e]"
                />
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="w-full flex items-center justify-center p-2 text-[#71706b] hover:text-white rounded-xl hover:bg-[#171715] transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
