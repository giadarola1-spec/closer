import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
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
import { PadlockMark } from './PadlockMark.tsx';

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

  useEffect(() => {
    if (!expanded && isPresenceMenuOpen) {
      setIsPresenceMenuOpen(false);
    }
  }, [expanded, isPresenceMenuOpen]);

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
      <div
        className={`fixed inset-0 z-30 bg-black/65 lg:hidden transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isMobileOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 lg:static h-screen bg-[#0f0f0e] border-r border-[#222220] transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[transform,width] overflow-hidden flex flex-col justify-between select-none font-['Inter'] shrink-0 ${
          isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full lg:translate-x-0'
        } ${isOpen ? 'lg:w-64' : 'lg:w-16'}`}
      >
        {/* Top Padlock Opener & Closer Lockup */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="h-14 px-[18px] flex items-center justify-between overflow-hidden shrink-0">
            <button
              type="button"
              onClick={onToggleOpen}
              className="hidden lg:inline-flex items-center gap-2.5 p-1 bg-transparent hover:bg-transparent border-0 text-[#edece8] hover:text-white transition-colors min-w-0"
              title={isOpen ? 'Collapse sidebar' : 'Open sidebar'}
              aria-label={isOpen ? 'Collapse sidebar' : 'Open sidebar'}
            >
              <PadlockMark isOpen={isOpen} size="md" />
              <span
                aria-hidden={!isOpen}
                className={`font-['Inter'] font-medium text-base tracking-tight text-[#edece8] whitespace-nowrap transition-[opacity,transform] duration-200 ${
                  isOpen
                    ? 'opacity-100 translate-x-0 delay-75'
                    : 'opacity-0 -translate-x-1 pointer-events-none'
                }`}
              >
                Closer
              </span>
            </button>

            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden inline-flex items-center gap-2.5 p-1 bg-transparent hover:bg-transparent border-0 text-[#edece8] hover:text-white transition-colors"
              title="Close navigation"
              aria-label="Close navigation"
            >
              <PadlockMark isOpen={isMobileOpen} size="md" />
              <span className="font-['Inter'] font-medium text-base tracking-tight text-[#edece8] whitespace-nowrap">
                Closer
              </span>
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
          <div className="px-3 pb-3 shrink-0">
            <button
              type="button"
              onClick={handleComposerClick}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#191918] hover:bg-[#242422] border border-[#2a2a27] hover:border-[#363632] text-[#edece8] text-xs font-medium transition-colors whitespace-nowrap overflow-hidden"
              title="New post"
            >
              <Plus className="w-4 h-4 text-[#edece8] shrink-0" />
              <span
                aria-hidden={!expanded}
                className={`transition-opacity duration-200 ${
                  expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'
                }`}
              >
                New post
              </span>
            </button>
          </div>

          {/* Navigation + Direct Messages People List */}
          <nav
            className={`flex-1 px-2.5 space-y-1 text-xs ${
              expanded ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
            }`}
          >
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
                  className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl border transition-colors whitespace-nowrap overflow-hidden ${
                    isActive
                      ? 'bg-[#191918] border-[#2c2c29] text-white font-medium'
                      : 'border-transparent text-[#9c9a92] hover:bg-[#171715] hover:text-[#edece8]'
                  }`}
                  title={item.label}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-[#edece8]' : 'text-[#8d8c85]'
                      }`}
                    />
                    <span
                      aria-hidden={!expanded}
                      className={`truncate transition-opacity duration-200 ${
                        expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                  {countLabel && (
                    <span
                      aria-hidden={!expanded}
                      className={`text-[11px] text-[#71706b] font-normal tabular-nums transition-opacity duration-200 ${
                        expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      {countLabel}
                    </span>
                  )}
                </button>
              );
            })}

            {(isLoadingMembers || sortedPeople.length > 0) && (
              <div
                aria-hidden={!expanded}
                className={`pt-4 pb-2 min-w-[235px] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  expanded
                    ? 'opacity-100 translate-x-0 delay-75'
                    : 'opacity-0 -translate-x-2 pointer-events-none'
                }`}
              >
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
                          tabIndex={expanded ? 0 : -1}
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
        <div className="border-t border-[#1e1e1c] p-2.5 space-y-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              onOpenSupervisorModal();
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl border border-transparent text-xs transition-colors whitespace-nowrap overflow-hidden ${
              isSupervisor
                ? 'text-[#f2c46d] hover:bg-[#231b10]/60'
                : 'text-[#8d8c85] hover:text-white hover:bg-[#171715]'
            }`}
            title={isSupervisor ? 'Supervisor profile active' : 'Supervisor login'}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isSupervisor ? (
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#eab308]" />
              ) : (
                <Shield className="w-3.5 h-3.5 shrink-0 text-[#71706b]" />
              )}
              <span
                aria-hidden={!expanded}
                className={`truncate transition-opacity duration-200 ${
                  expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'
                }`}
              >
                Supervisor
              </span>
            </span>
            <span
              aria-hidden={!expanded}
              className={`text-[11px] transition-opacity duration-200 ${
                isSupervisor ? 'text-[#f2c46d]' : 'text-[#71706b]'
              } ${expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'}`}
            >
              {isSupervisor ? 'Active' : 'Login'}
            </span>
          </button>

          <div ref={presenceMenuRef} className="relative">
            {expanded && isPresenceMenuOpen && (
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

            <div className="flex items-center justify-between gap-2 px-1.5 py-1.5 rounded-xl hover:bg-[#171715] transition-colors overflow-hidden">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => handleNavClick('roster')}
                  className="shrink-0 rounded-full focus:outline-none"
                  title={
                    expanded
                      ? 'Edit your closer profile, photo & daily calls'
                      : `${currentMember?.displayName || 'Closers'} · ${myPresenceMeta.label}`
                  }
                >
                  <Avatar
                    name={currentMember?.displayName || 'Closer'}
                    photoUrl={currentMember?.photoUrl}
                    size="sm"
                    presenceStatus={myPresence}
                    presenceRingClass="ring-[#0f0f0e]"
                  />
                </button>
                <div
                  aria-hidden={!expanded}
                  className={`min-w-0 flex-1 transition-opacity duration-200 ${
                    expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'
                  }`}
                >
                  <button
                    type="button"
                    tabIndex={expanded ? 0 : -1}
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
                    tabIndex={expanded ? 0 : -1}
                    onClick={() => setIsPresenceMenuOpen((prev) => !prev)}
                    className="flex items-center gap-1 text-[11px] text-[#71706b] hover:text-[#c9c8c2] transition-colors max-w-full whitespace-nowrap"
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
                tabIndex={expanded ? 0 : -1}
                aria-hidden={!expanded}
                onClick={onSignOut}
                className={`p-1.5 text-[#71706b] hover:text-white rounded-lg hover:bg-[#222220] transition-[color,background-color,opacity] duration-200 shrink-0 ${
                  expanded ? 'opacity-100 delay-75' : 'opacity-0 pointer-events-none'
                }`}
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                expanded
                  ? 'grid-rows-[0fr] opacity-0 pointer-events-none'
                  : 'grid-rows-[1fr] opacity-100 pt-1'
              }`}
            >
              <div className="overflow-hidden">
                <button
                  type="button"
                  tabIndex={expanded ? -1 : 0}
                  onClick={onSignOut}
                  className="w-full flex items-center justify-center p-2 text-[#71706b] hover:text-white rounded-xl hover:bg-[#171715] transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
