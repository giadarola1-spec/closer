import React, { useEffect } from 'react';
import {
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Users,
  Send,
  LogOut,
  Bell,
  BellOff,
  Truck,
  X,
  Shield,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import { SidebarChannel, TeamMember } from '../types/team.ts';
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
  notificationsEnabled: boolean;
  onOpenNotificationSettings: () => void;
  currentMember: TeamMember | null;
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
  { id: 'statistics', label: 'Statistics', icon: BarChart3 },
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
  notificationsEnabled,
  onOpenNotificationSettings,
  currentMember,
  supervisorIds,
  isSupervisor,
  onOpenSupervisorModal,
  onSignOut,
  isOpen,
  onToggleOpen,
  isMobileOpen,
  onCloseMobile,
}) => {
  useEffect(() => {
    if (!isMobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobile();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  const sortedPeople = [...members].sort((a, b) => {
    if (a.uid === currentMember?.uid && b.uid !== currentMember?.uid) return 1;
    if (b.uid === currentMember?.uid && a.uid !== currentMember?.uid) return -1;
    return a.displayName.localeCompare(b.displayName);
  });

  const expanded = isOpen || isMobileOpen;

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
        {/* Top Brand & Toggle */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="h-14 px-3.5 flex items-center justify-between">
            {expanded ? (
              <div className="flex items-center gap-2 pl-1 min-w-0">
                <Truck className="w-4 h-4 text-[#edece8] shrink-0" />
                <span className="font-['Inter'] font-medium text-base tracking-tight text-[#edece8] lowercase whitespace-nowrap">
                  closer
                </span>
                <span className="text-[11px] text-[#71706b] font-normal tabular-nums whitespace-nowrap">
                  · {memberCount}
                </span>
              </div>
            ) : (
              <span className="sr-only">closer</span>
            )}

            <button
              type="button"
              onClick={onToggleOpen}
              className="hidden lg:inline-flex text-[#71706b] hover:text-white p-1.5 rounded-lg hover:bg-[#1a1a18] transition-colors mx-auto lg:mx-0"
              title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {isOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden text-[#71706b] hover:text-white p-1.5 rounded-lg hover:bg-[#1a1a18] transition-colors"
              title="Close navigation"
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
                          title={`Message ${person.displayName}`}
                        >
                          <Avatar
                            name={person.displayName}
                            photoUrl={person.photoUrl}
                            size="xs"
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

        {/* Bottom Alerts Trigger & Current Closer Profile Strip */}
        <div className="border-t border-[#1e1e1c] p-2.5 space-y-1.5">
          <button
            type="button"
            onClick={() => {
              onOpenNotificationSettings();
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-colors text-[#9c9a92] hover:text-white hover:bg-[#171715] whitespace-nowrap ${
              !expanded ? 'justify-center px-0' : ''
            }`}
            title="Edit post notifications & sound"
          >
            <span className="flex items-center gap-2 min-w-0">
              {notificationsEnabled ? (
                <Bell className="w-3.5 h-3.5 shrink-0 text-[#edece8]" />
              ) : (
                <BellOff className="w-3.5 h-3.5 shrink-0 text-[#71706b]" />
              )}
              {expanded && <span className="truncate">Post alerts</span>}
            </span>
            {expanded && (
              <span className="text-[11px] text-[#71706b]">
                {notificationsEnabled ? 'On' : 'Off'}
              </span>
            )}
          </button>

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
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl hover:bg-[#171715] transition-colors">
              <button
                type="button"
                onClick={() => handleNavClick('roster')}
                className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                title="Edit your closer profile, photo & daily calls"
              >
                <Avatar
                  name={currentMember?.displayName || 'Closer'}
                  photoUrl={currentMember?.photoUrl}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-[#edece8] truncate">
                      {currentMember?.displayName || 'Closer'}
                    </span>
                    {isSupervisor && <SupervisorBadge compact />}
                  </div>
                  <div className="text-[11px] text-[#71706b] truncate tabular-nums">
                    {currentMember?.dailyCalls ?? 0} calls/day · {currentMember?.statusText || 'On the phones'}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="p-1.5 text-[#71706b] hover:text-white rounded-lg hover:bg-[#222220] transition-colors shrink-0"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => handleNavClick('roster')}
                className="p-1 rounded-full hover:bg-[#171715] transition-colors"
                title={currentMember?.displayName || 'Closers'}
              >
                <Avatar
                  name={currentMember?.displayName || 'Closer'}
                  photoUrl={currentMember?.photoUrl}
                  size="sm"
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
