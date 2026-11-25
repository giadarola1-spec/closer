import { NotificationPreferences, NotificationTone } from '../types/team.ts';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  postNotificationsEnabled: true,
  postSoundEnabled: true,
  postSoundTone: 'chime',
  postBrowserAlertsEnabled: true,
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

export function isEmbeddedIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isPageFocusedAndVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible' && document.hasFocus();
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        reg.update().catch(() => {});
        return reg;
      })
      .catch(() => null);
  }
  return swRegistrationPromise;
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

export interface SystemNotificationPayload {
  title: string;
  body: string;
  tag: string;
  data?: {
    channel: 'feed' | 'messages';
    senderUid?: string;
    postId?: string;
  };
  onClick?: () => void;
}

export async function showSystemNotification({
  title,
  body,
  tag,
  data,
  onClick,
}: SystemNotificationPayload): Promise<void> {
  if (!canUseBrowserNotifications() || Notification.permission !== 'granted') {
    return;
  }

  const trimmedBody = body.slice(0, 160);

  try {
    const reg = await registerNotificationServiceWorker();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, {
        body: trimmedBody,
        tag,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: data || { channel: 'feed' },
      });
      return;
    }
  } catch {
    // Fall back to window Notification constructor below
  }

  try {
    const notification = new Notification(title, {
      body: trimmedBody,
      tag,
      icon: '/pwa-192x192.png',
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

export function showBrowserPostNotification(
  title: string,
  body: string,
  onClick?: () => void
): void {
  void showSystemNotification({
    title,
    body,
    tag: 'closer-new-post',
    data: { channel: 'feed' },
    onClick,
  });
}
