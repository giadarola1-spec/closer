import React from 'react';
import { Bell, X } from 'lucide-react';
import { PostAlert } from '../types/team.ts';
import { Avatar } from './Avatar.tsx';

interface PostNotificationBannerProps {
  alerts: PostAlert[];
  onOpenFeed: () => void;
  onDismiss: (id: string) => void;
}

export const PostNotificationBanner: React.FC<PostNotificationBannerProps> = ({
  alerts,
  onOpenFeed,
  onDismiss,
}) => {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm font-['Inter']">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="bg-[#1f1f1e] border border-[#3a3a36] rounded-2xl p-3.5 shadow-2xl flex items-start gap-3"
        >
          <button
            type="button"
            onClick={() => {
              onOpenFeed();
              onDismiss(alert.id);
            }}
            className="flex items-start gap-3 flex-1 min-w-0 text-left group"
          >
            <Avatar
              name={alert.authorName}
              photoUrl={alert.authorPhotoUrl}
              size="sm"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[#9c9a92]">
                <Bell className="w-3 h-3 text-[#edece8] shrink-0" />
                <span className="truncate font-medium text-white group-hover:underline">
                  {alert.authorName}
                </span>
                <span className="shrink-0">posted</span>
              </div>
              {alert.title && (
                <div className="text-xs font-medium text-[#edece8] truncate">
                  {alert.title}
                </div>
              )}
              <p className="text-xs text-[#c9c8c2] line-clamp-2 leading-snug">
                {alert.body}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onDismiss(alert.id)}
            className="p-1 rounded-lg text-[#71706b] hover:text-white hover:bg-[#2a2a27] transition-colors shrink-0"
            title="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
