import { NotificationPreferences, NotificationTone } from '../types/team.ts';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  postNotificationsEnabled: true,
  postSoundEnabled: true,
  postSoundTone: 'chime',
  postBrowserAlertsEnabled: false,
};

const STORAGE_PREFIX = 'closer_notification_prefs_';

export function isValidTone(value: unknown): value is NotificationTone {
  return value === 'chime' || value === 'ping' || value === 'soft';
}

export function loadCachedNotificationPrefs(uid: string): NotificationPreferences {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${uid}`);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw);
    return {
      postNotificationsEnabled:
        typeof parsed.postNotificationsEnabled === 'boolean'
          ? parsed.postNotificationsEnabled
          : DEFAULT_NOTIFICATION_PREFS.postNotificationsEnabled,
      postSoundEnabled:
        typeof parsed.postSoundEnabled === 'boolean'
          ? parsed.postSoundEnabled
          : DEFAULT_NOTIFICATION_PREFS.postSoundEnabled,
      postSoundTone: isValidTone(parsed.postSoundTone)
        ? parsed.postSoundTone
        : DEFAULT_NOTIFICATION_PREFS.postSoundTone,
      postBrowserAlertsEnabled:
        typeof parsed.postBrowserAlertsEnabled === 'boolean'
          ? parsed.postBrowserAlertsEnabled
          : DEFAULT_NOTIFICATION_PREFS.postBrowserAlertsEnabled,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveCachedNotificationPrefs(
  uid: string,
  prefs: NotificationPreferences
): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${uid}`, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

export function installAudioUnlockListeners(): () => void {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  peakGain: number,
  type: OscillatorType
): void {
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export async function playNotificationSound(tone: NotificationTone): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (tone === 'chime') {
      scheduleTone(ctx, 587.33, 0, 0.22, 0.12, 'sine');
      scheduleTone(ctx, 880, 0.09, 0.28, 0.1, 'sine');
    } else if (tone === 'ping') {
      scheduleTone(ctx, 987.77, 0, 0.26, 0.13, 'sine');
    } else {
      scheduleTone(ctx, 440, 0, 0.18, 0.1, 'triangle');
      scheduleTone(ctx, 523.25, 0.08, 0.22, 0.08, 'sine');
    }
  } catch {
    // Browser autoplay policies may block sound before first interaction
  }
}

export function canUseBrowserNotifications(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!canUseBrowserNotifications()) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showBrowserPostNotification(
  title: string,
  body: string,
  onClick?: () => void
): void {
  if (!canUseBrowserNotifications() || Notification.permission !== 'granted') {
    return;
  }
  try {
    const notification = new Notification(title, {
      body: body.slice(0, 140),
      tag: 'closer-new-post',
    });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  } catch {
    // Ignore restricted Notification constructor errors in embedded frames
  }
}
