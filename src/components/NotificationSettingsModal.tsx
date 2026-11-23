import React, { useState } from 'react';
import { Bell, BellOff, Volume2, VolumeX, X, Play } from 'lucide-react';
import { NotificationPreferences, NotificationTone } from '../types/team.ts';
import {
  canUseBrowserNotifications,
  playNotificationSound,
  requestBrowserNotificationPermission,
} from '../utils/notifications.ts';

interface NotificationSettingsModalProps {
  isOpen: boolean;
  prefs: NotificationPreferences;
  saving: boolean;
  onUpdatePrefs: (patch: Partial<NotificationPreferences>) => Promise<void>;
  onTestAlert: () => void;
  onClose: () => void;
}

const TONES: { id: NotificationTone; label: string }[] = [
  { id: 'chime', label: 'Chime' },
  { id: 'ping', label: 'Ping' },
  { id: 'soft', label: 'Soft' },
];

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  prefs,
  saving,
  onUpdatePrefs,
  onTestAlert,
  onClose,
}) => {
  const [browserNote, setBrowserNote] = useState<string | null>(null);

  if (!isOpen) return null;

  const browserSupported = canUseBrowserNotifications();
  const browserPermission =
    browserSupported ? Notification.permission : 'unsupported';

  const handleToggleBrowserAlerts = async () => {
    setBrowserNote(null);
    if (prefs.postBrowserAlertsEnabled) {
      await onUpdatePrefs({ postBrowserAlertsEnabled: false });
      return;
    }

    const permission = await requestBrowserNotificationPermission();
    if (permission === 'granted') {
      await onUpdatePrefs({ postBrowserAlertsEnabled: true });
    } else if (permission === 'unsupported') {
      setBrowserNote('Desktop notifications are not supported in this browser.');
    } else {
      setBrowserNote('Browser notification permission was blocked in site settings.');
    }
  };

  const handleSelectTone = async (tone: NotificationTone) => {
    playNotificationSound(tone);
    await onUpdatePrefs({ postSoundTone: tone });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 font-['Inter']"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#191918] border border-[#2a2a27] rounded-2xl p-5 space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#222220] pb-3.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              {prefs.postNotificationsEnabled ? (
                <Bell className="w-4 h-4 text-[#edece8]" />
              ) : (
                <BellOff className="w-4 h-4 text-[#8d8c85]" />
              )}
              <span>Post Notifications</span>
            </div>
            <p className="text-xs text-[#8d8c85]">
              Choose whether to get alerted and play a sound when a teammate publishes a new post.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#8d8c85] hover:text-white hover:bg-[#222220] transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Toggle: New Post Alerts */}
          <div className="flex items-center justify-between gap-3 bg-[#141413] border border-[#262624] rounded-xl p-3.5">
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-[#edece8]">
                New post alerts
              </div>
              <div className="text-[11px] text-[#8d8c85]">
                Notify me every time there is a new post
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.postNotificationsEnabled}
              disabled={saving}
              onClick={() =>
                onUpdatePrefs({
                  postNotificationsEnabled: !prefs.postNotificationsEnabled,
                })
              }
              className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                prefs.postNotificationsEnabled ? 'bg-white' : 'bg-[#2a2a27]'
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full transition-transform ${
                  prefs.postNotificationsEnabled
                    ? 'translate-x-5 bg-black'
                    : 'translate-x-0.5 bg-[#8d8c85]'
                }`}
              />
            </button>
          </div>

          {/* Toggle: Sound */}
          <div
            className={`bg-[#141413] border border-[#262624] rounded-xl p-3.5 space-y-3 transition-opacity ${
              prefs.postNotificationsEnabled ? 'opacity-100' : 'opacity-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {prefs.postSoundEnabled ? (
                  <Volume2 className="w-4 h-4 text-[#edece8] shrink-0" />
                ) : (
                  <VolumeX className="w-4 h-4 text-[#8d8c85] shrink-0" />
                )}
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-[#edece8]">
                    Sound alert
                  </div>
                  <div className="text-[11px] text-[#8d8c85]">
                    Play a sound when a new post arrives
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.postSoundEnabled}
                disabled={saving || !prefs.postNotificationsEnabled}
                onClick={() => {
                  const nextSound = !prefs.postSoundEnabled;
                  if (nextSound) {
                    playNotificationSound(prefs.postSoundTone);
                  }
                  onUpdatePrefs({ postSoundEnabled: nextSound });
                }}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  prefs.postSoundEnabled && prefs.postNotificationsEnabled
                    ? 'bg-white'
                    : 'bg-[#2a2a27]'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full transition-transform ${
                    prefs.postSoundEnabled && prefs.postNotificationsEnabled
                      ? 'translate-x-5 bg-black'
                      : 'translate-x-0.5 bg-[#8d8c85]'
                  }`}
                />
              </button>
            </div>

            {prefs.postNotificationsEnabled && prefs.postSoundEnabled && (
              <div className="pt-2 border-t border-[#222220] flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#8d8c85]">Sound tone</span>
                <div className="flex items-center gap-1.5">
                  {TONES.map((tone) => {
                    const selected = prefs.postSoundTone === tone.id;
                    return (
                      <button
                        key={tone.id}
                        type="button"
                        onClick={() => handleSelectTone(tone.id)}
                        className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors ${
                          selected
                            ? 'bg-white border-white text-black font-medium'
                            : 'bg-[#191918] border-[#2c2c29] text-[#9c9a92] hover:text-white'
                        }`}
                      >
                        {tone.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Toggle: Browser Desktop Notifications */}
          <div
            className={`bg-[#141413] border border-[#262624] rounded-xl p-3.5 space-y-2 transition-opacity ${
              prefs.postNotificationsEnabled ? 'opacity-100' : 'opacity-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-[#edece8]">
                  Desktop browser alerts
                </div>
                <div className="text-[11px] text-[#8d8c85]">
                  Show system alerts even while working in another tab
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.postBrowserAlertsEnabled}
                disabled={saving || !prefs.postNotificationsEnabled}
                onClick={handleToggleBrowserAlerts}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  prefs.postBrowserAlertsEnabled &&
                  prefs.postNotificationsEnabled &&
                  browserPermission === 'granted'
                    ? 'bg-white'
                    : 'bg-[#2a2a27]'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full transition-transform ${
                    prefs.postBrowserAlertsEnabled &&
                    prefs.postNotificationsEnabled &&
                    browserPermission === 'granted'
                      ? 'translate-x-5 bg-black'
                      : 'translate-x-0.5 bg-[#8d8c85]'
                  }`}
                />
              </button>
            </div>
            {browserNote && (
              <p className="text-[11px] text-[#c9c8c2]">{browserNote}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onTestAlert}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141413] hover:bg-[#222220] border border-[#2c2c29] text-xs text-[#edece8] transition-colors"
          >
            <Play className="w-3 h-3" />
            <span>Test notification</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white hover:bg-[#e0dfd9] text-black text-xs font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
