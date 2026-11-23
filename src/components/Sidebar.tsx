import React from 'react';
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
} from 'lucide-react';
import { SidebarChannel, TeamMember } from '../types/team.ts';
import { Avatar } from './Avatar.tsx';

interface SidebarProps {
  activeChannel: SidebarChannel;
  onSelectChannel: (channel: SidebarChannel) => void;
  onFocusComposer: () => void;
  postCount: number;
  dmCount: number;
  memberCount: number;
  members: TeamMember[];
  selectedDmUserId: string | null;
  onOpenDm: (targetUid: string) => void;
  notificationsEnabled: boolean;
  onOpenNotificationSettings: () => void;
  currentMember: TeamMember | null;
  onSignOut: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
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
  selectedDmUserId,
  onOpenDm,
  notificationsEnabled,
  onOpenNotificationSettings,
  currentMember,
  onSignOut,
  isOpen,
  onToggleOpen,
}) => {
  const sortedPeople = [...members].sort((a, b) => {
    if (a.uid === currentMember?.uid && b.uid !== currentMember?.uid) return 1;
    if (b.uid === currentMember?.uid && a.uid !== currentMember?.uid) return -1;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <aside
      className={`h-screen bg-[#0f0f0e] border-r border-[#222220] transition-all duration-200 flex flex-col justify-between select-none font-['Inter'] shrink-0 ${
        isOpen ? 'w-64' : 'w-0 lg:w-14 overflow-hidden'
      }`}
    >
      {/* Top Section */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="h-14 px-3.5 flex items-center justify-between">
          {isOpen ? (
            <div className="flex items-center gap-2 pl-1">
              <span className="font-['Inter'] font-medium text-base tracking-tight text-[#edece8] lowercase">
                closer
              </span>
              <span className="text-[11px] text-[#71706b] font-normal">
                team ({memberCount})
              </span>
            </div>
          ) : (
            <span className="sr-only">closer</span>
          )}
          <button
            onClick={onToggleOpen}
            className="text-[#71706b] hover:text-white p-1.5 rounded-lg hover:bg-[#1a1a18] transition-colors mx-auto lg:mx-0"
            title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {isOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* "+ New post" Button */}
        <div className="px-3 pb-3">
          <button
            onClick={onFocusComposer}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#1a1a18] hover:bg-[#242422] border border-[#2a2a27] text-[#edece8] text-xs font-medium transition-colors ${
              !isOpen ? 'justify-center px-0' : ''
            }`}
            title="New post"
          >
            <Plus className="w-4 h-4 text-[#a3a29b] shrink-0" />
            {isOpen && <span>New post</span>}
          </button>
        </div>

        {/* Navigation + Direct Messages People List */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-0.5 text-xs">
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
                  : postCount > 0
                    ? String(postCount)
                    : '';

            return (
              <button
                key={item.id}
                onClick={() => onSelectChannel(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-[#1e1e1c] text-white font-medium'
                    : 'text-[#9c9a92] hover:bg-[#181816] hover:text-[#edece8]'
                } ${!isOpen ? 'justify-center px-0' : ''}`}
                title={item.label}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-3.5 h-3.5 shrink-0 text-[#8d8c85]" />
                  {isOpen && <span className="truncate">{item.label}</span>}
                </div>
                {isOpen && countLabel && (
                  <span className="text-[11px] text-[#71706b] font-normal tabular-nums">
                    {countLabel}
                  </span>
                )}
              </button>
            );
          })}

          {isOpen && sortedPeople.length > 0 && (
            <div className="pt-4 pb-2">
              <div className="px-3 pb-1.5 text-[11px] font-medium text-[#71706b]">
                Direct messages
              </div>
              <div className="space-y-0.5">
                {sortedPeople.map((person) => {
                  const isSelected =
                    activeChannel === 'messages' && selectedDmUserId === person.uid;
                  const isMe = person.uid === currentMember?.uid;
                  return (
                    <button
                      key={person.uid}
                      onClick={() => onOpenDm(person.uid)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-colors text-left ${
                        isSelected
                          ? 'bg-[#1e1e1c] text-white font-medium'
                          : 'text-[#9c9a92] hover:bg-[#181816] hover:text-[#edece8]'
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
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </nav>
      </div>

      {/* Bottom Alerts Trigger & Current Closer Profile Strip */}
      <div className="border-t border-[#1e1e1c] p-2.5 space-y-1.5">
        <button
          type="button"
          onClick={onOpenNotificationSettings}
          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors text-[#9c9a92] hover:text-white hover:bg-[#181816] ${
            !isOpen ? 'justify-center px-0' : ''
          }`}
          title="Edit post notifications & sound"
        >
          <span className="flex items-center gap-2 min-w-0">
            {notificationsEnabled ? (
              <Bell className="w-3.5 h-3.5 shrink-0 text-[#edece8]" />
            ) : (
              <BellOff className="w-3.5 h-3.5 shrink-0 text-[#71706b]" />
            )}
            {isOpen && <span className="truncate">Post alerts</span>}
          </span>
          {isOpen && (
            <span className="text-[11px] text-[#71706b]">
              {notificationsEnabled ? 'On' : 'Off'}
            </span>
          )}
        </button>

        {isOpen ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-[#161614] transition-colors">
            <button
              onClick={() => onSelectChannel('roster')}
              className="flex items-center gap-2.5 text-left min-w-0 flex-1"
              title="Edit your closer profile, photo & daily calls"
            >
              <Avatar
                name={currentMember?.displayName || 'Closer'}
                photoUrl={currentMember?.photoUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-[#edece8] truncate">
                  {currentMember?.displayName || 'Closer'}
                </div>
                <div className="text-[11px] text-[#71706b] truncate">
                  {currentMember?.dailyCalls ?? 0} calls/day · {currentMember?.statusText || 'On the phones'}
                </div>
              </div>
            </button>
            <button
              onClick={onSignOut}
              className="p-1.5 text-[#71706b] hover:text-white rounded-lg hover:bg-[#222220] transition-colors shrink-0"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onSignOut}
            className="w-full flex items-center justify-center p-2 text-[#71706b] hover:text-white rounded-lg hover:bg-[#181816] transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
};
