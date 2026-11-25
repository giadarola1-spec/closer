import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Volume2, VolumeX, X, Play, ExternalLink } from 'lucide-react';
import { NotificationPreferences, NotificationTone } from '../types/team.ts';
import {
  canUseBrowserNotifications,
  isEmbeddedIframe,
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
  const [permissionState, setPermissionState] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    canUseBrowserNotifications() ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    if (!isOpen) return;
    setPermissionState(
      canUseBrowserNotifications() ? Notification.permission : 'unsupported'
    );
    setBrowserNote(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const browserSupported = canUseBrowserNotifications();
  const inIframe = isEmbeddedIframe();

  const handleToggleBrowserAlerts = async () => {
    setBrowserNote(null);
    if (prefs.postBrowserAlertsEnabled && permissionState === 'granted') {
      await onUpdatePrefs({ postBrowserAlertsEnabled: false });
      return;
    }

    const permission = await requestBrowserNotificationPermission();
    setPermissionState(permission);
    if (permission === 'granted') {
      await onUpdatePrefs({ postBrowserAlertsEnabled: true });
    } else if (permission === 'unsupported') {
      setBrowserNote('System notifications are not supported in this browser.');
    } else if (inIframe) {
      setBrowserNote(
        'Browser blocked notifications inside the embedded preview. Open the app in its own tab to allow desktop/background notifications.'
      );
    } else {
      setBrowserNote(
        'Notification permission is blocked in your browser site settings. Click the lock/tune icon in the address bar to allow Notifications.'
      );
    }
  };

  const handleSelectTone = async (tone: NotificationTone) => {
    playNotificationSound(tone);
    await onUpdatePrefs({ postSoundTone: tone });
  };

  const browserAlertsActive =
    prefs.postBrowserAlertsEnabled &&
    prefs.postNotificationsEnabled &&
    permissionState === 'granted';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Notification settings"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 font-['Inter'] animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#191918] border border-[#2a2a27] rounded-2xl p-5 space-y-5 shadow-2xl animate-in zoom-in-95 duration-150"
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
              <span>Posts & Messages Notifications</span>
            </div>
            <p className="text-xs text-[#8d8c85]">
              Get notified for new team posts and direct messages, including when you are in another tab or outside the page.
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
          {/* Toggle: Posts & Direct Message Alerts */}
          <div className="flex items-center justify-between gap-3 bg-[#141413] border border-[#262624] rounded-xl p-3.5">
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-[#edece8]">
                New post & DM alerts
              </div>
              <div className="text-[11px] text-[#8d8c85]">
                Notify me whenever a teammate posts or sends a direct message
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
                    Play a tone when a new post or message arrives
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

          {/* Toggle: Outside-Page System Notifications */}
          <div
            className={`bg-[#141413] border border-[#262624] rounded-xl p-3.5 space-y-2 transition-opacity ${
              prefs.postNotificationsEnabled ? 'opacity-100' : 'opacity-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-[#edece8]">
                  Outside-page & desktop alerts
                </div>
                <div className="text-[11px] text-[#8d8c85]">
                  Show OS notifications when you are in another tab or another app (keep this tab open in the background)
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={browserAlertsActive}
                disabled={saving || !prefs.postNotificationsEnabled || !browserSupported}
                onClick={handleToggleBrowserAlerts}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  browserAlertsActive ? 'bg-white' : 'bg-[#2a2a27]'
                }`}
              >
                <span
                  className={`block w-4 h-4 rounded-full transition-transform ${
                    browserAlertsActive
                      ? 'translate-x-5 bg-black'
                      : 'translate-x-0.5 bg-[#8d8c85]'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px] text-[#8d8c85] pt-0.5">
              <span>
                Browser status:{' '}
                <span className="text-[#d1d1cf]">
                  {permissionState === 'granted'
                    ? 'Allowed'
                    : permissionState === 'denied'
                      ? 'Blocked'
                      : permissionState === 'unsupported'
                        ? 'Unsupported'
                        : 'Not allowed yet'}
                </span>
              </span>
              {inIframe && permissionState !== 'granted' && (
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#edece8] hover:underline"
                >
                  <span>Open standalone tab</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {browserNote && (
              <p className="text-[11px] text-[#c9c8c2] leading-snug">{browserNote}</p>
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
