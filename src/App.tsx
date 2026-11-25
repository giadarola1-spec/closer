import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { Bell, BellOff } from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  OperationType,
  handleFirestoreError,
} from './firebase.ts';
import {
  TEAM_ID,
  ACCEPTED_TEAM_IDS,
  LIMITS,
  PresenceStatus,
  SidebarChannel,
  TeamMember,
  TeamPost,
  DirectThread,
  NotificationPreferences,
  PostAlert,
  SupervisorRecord,
} from './types/team.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TeamFeedView } from './components/TeamFeedView.tsx';
import { RosterView } from './components/RosterView.tsx';
import { DirectMessagesView } from './components/DirectMessagesView.tsx';
import { NotificationSettingsModal } from './components/NotificationSettingsModal.tsx';
import { SupervisorModal } from './components/SupervisorModal.tsx';
import { PostNotificationBanner } from './components/PostNotificationBanner.tsx';
import { Toast } from './components/Toast.tsx';
import { LaunchSplash } from './components/LaunchSplash.tsx';
import { PadlockMark } from './components/PadlockMark.tsx';
import { sanitizePhotoUrl } from './utils/image.ts';
import { textMentionsMember } from './utils/mentions.ts';
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_IDLE_AFK_MS,
  PRESENCE_META,
} from './utils/presence.ts';
import {
  isValidSyncKey,
  deriveSupervisorSyncKey,
  constantTimeHexEquals,
} from './utils/supervisor.ts';
import {
  DEFAULT_NOTIFICATION_PREFS,
  isValidTone,
  loadCachedNotificationPrefs,
  saveCachedNotificationPrefs,
  installAudioUnlockListeners,
  playNotificationSound,
  canUseBrowserNotifications,
  isEmbeddedIframe,
  isPageFocusedAndVisible,
  registerNotificationServiceWorker,
  requestBrowserNotificationPermission,
  showSystemNotification,
} from './utils/notifications.ts';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [bootstrapMember, setBootstrapMember] = useState<TeamMember | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [threads, setThreads] = useState<DirectThread[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorRecord[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);

  const [supervisorToken, setSupervisorToken] = useState<string | null>(null);
  const [supervisorStatusMode, setSupervisorStatusMode] = useState<
    'env' | 'claimed' | 'unconfigured' | 'loading'
  >('loading');
  const [isSupervisorModalOpen, setIsSupervisorModalOpen] = useState(false);
  const [supervisorBusy, setSupervisorBusy] = useState(false);
  const [supervisorError, setSupervisorError] = useState<string | null>(null);

  const [activeChannel, setActiveChannel] = useState<SidebarChannel>('feed');
  const [selectedDmUserId, setSelectedDmUserId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [savingNotificationPrefs, setSavingNotificationPrefs] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [postAlerts, setPostAlerts] = useState<PostAlert[]>([]);
  const [composerOpenNonce, setComposerOpenNonce] = useState(0);
  const [showLaunchSplash, setShowLaunchSplash] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [unreadAwayCount, setUnreadAwayCount] = useState(0);
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => (canUseBrowserNotifications() ? Notification.permission : 'unsupported'));
  const [browserPromptDismissed, setBrowserPromptDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('closer_notif_prompt_dismissed') === '1';
    } catch {
      return false;
    }
  });

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const alertTimersRef = useRef<Record<string, number>>({});
  const knownPostIdsRef = useRef<Set<string>>(new Set());
  const initialPostsLoadedRef = useRef(false);
  const knownDmKeysRef = useRef<Map<string, string>>(new Map());
  const initialDmsLoadedRef = useRef(false);
  const prefsRef = useRef<NotificationPreferences>(notificationPrefs);
  const membersRef = useRef<TeamMember[]>(members);
  const activeChannelRef = useRef<SidebarChannel>(activeChannel);
  const selectedDmUserIdRef = useRef<string | null>(selectedDmUserId);
  const manualPresenceRef = useRef<PresenceStatus>('online');
  const autoAfkRef = useRef<boolean>(false);
  const lastInteractionAtRef = useRef<number>(Date.now());
  const lastHeartbeatSentAtRef = useRef<number>(0);

  useEffect(() => {
    prefsRef.current = notificationPrefs;
  }, [notificationPrefs]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  useEffect(() => {
    selectedDmUserIdRef.current = selectedDmUserId;
  }, [selectedDmUserId]);

  useEffect(() => {
    return installAudioUnlockListeners();
  }, []);

  useEffect(() => {
    void registerNotificationServiceWorker();

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const channelParam = params.get('channel');
      const dmParam = params.get('dm');
      if (channelParam === 'messages') {
        setActiveChannel('messages');
        if (dmParam) {
          setSelectedDmUserId(dmParam);
        }
      } else if (channelParam === 'feed') {
        setActiveChannel('feed');
      }
      if (channelParam || dmParam) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    if (!('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'NOTIFICATION_CLICK') return;
      const payload = event.data.payload || {};
      if (payload.channel === 'messages') {
        if (typeof payload.senderUid === 'string' && payload.senderUid) {
          setSelectedDmUserId(payload.senderUid);
        }
        setActiveChannel('messages');
      } else {
        setActiveChannel('feed');
      }
      setUnreadAwayCount(0);
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, []);

  useEffect(() => {
    const syncPermissionAndClearUnread = () => {
      if (canUseBrowserNotifications()) {
        setBrowserPermission(Notification.permission);
      }
      if (isPageFocusedAndVisible()) {
        setUnreadAwayCount(0);
      }
    };
    window.addEventListener('focus', syncPermissionAndClearUnread);
    document.addEventListener('visibilitychange', syncPermissionAndClearUnread);
    return () => {
      window.removeEventListener('focus', syncPermissionAndClearUnread);
      document.removeEventListener('visibilitychange', syncPermissionAndClearUnread);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title =
      unreadAwayCount > 0
        ? `(${unreadAwayCount}) Closer - Go To Truckers`
        : 'Closer - Go To Truckers';
  }, [unreadAwayCount]);

  const dismissPostAlert = (alertId: string) => {
    if (alertTimersRef.current[alertId]) {
      window.clearTimeout(alertTimersRef.current[alertId]);
      delete alertTimersRef.current[alertId];
    }
    setPostAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  const pushPostAlert = (alert: PostAlert) => {
    setPostAlerts((prev) => [alert, ...prev].slice(0, 3));
    alertTimersRef.current[alert.id] = window.setTimeout(() => {
      dismissPostAlert(alert.id);
    }, 6000);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 2200);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      Object.values(alertTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setBootstrapMember(null);
        setProfileReady(false);
        setMembers([]);
        setPosts([]);
        setThreads([]);
        setSupervisors([]);
        setSupervisorToken(null);
        setIsSupervisorModalOpen(false);
        setSupervisorError(null);
        setPostAlerts([]);
        setSelectedDmUserId(null);
        setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
        knownPostIdsRef.current.clear();
        initialPostsLoadedRef.current = false;
        knownDmKeysRef.current.clear();
        initialDmsLoadedRef.current = false;
        setUnreadAwayCount(0);
        setIsLoadingPosts(false);
        setIsLoadingMembers(false);
      } else {
        setNotificationPrefs(loadCachedNotificationPrefs(nextUser.uid));
      }
    });
    return () => unsub();
  }, []);

  // Bootstrap private user record and public closer member profile on sign-in
  useEffect(() => {
    if (!authReady || !user) return;
    if (!user.emailVerified) {
      setAuthError('A verified Google email address is required to access the closer hub.');
      setProfileReady(false);
      return;
    }

    let cancelled = false;
    setAuthError(null);
    setProfileReady(false);

    const bootstrap = async () => {
      const userRef = doc(db, 'users', user.uid);
      const cachedPrefs = loadCachedNotificationPrefs(user.uid);
      try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: (user.email || '').slice(0, 200),
            postNotificationsEnabled: cachedPrefs.postNotificationsEnabled,
            postSoundEnabled: cachedPrefs.postSoundEnabled,
            postSoundTone: cachedPrefs.postSoundTone,
            postBrowserAlertsEnabled: cachedPrefs.postBrowserAlertsEnabled,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          const userData = userSnap.data();
          const syncedPrefs: NotificationPreferences = {
            postNotificationsEnabled:
              typeof userData.postNotificationsEnabled === 'boolean'
                ? userData.postNotificationsEnabled
                : cachedPrefs.postNotificationsEnabled,
            postSoundEnabled:
              typeof userData.postSoundEnabled === 'boolean'
                ? userData.postSoundEnabled
                : cachedPrefs.postSoundEnabled,
            postSoundTone: isValidTone(userData.postSoundTone)
              ? userData.postSoundTone
              : cachedPrefs.postSoundTone,
            postBrowserAlertsEnabled:
              typeof userData.postBrowserAlertsEnabled === 'boolean'
                ? userData.postBrowserAlertsEnabled
                : cachedPrefs.postBrowserAlertsEnabled,
          };
          if (!cancelled) {
            setNotificationPrefs(syncedPrefs);
            saveCachedNotificationPrefs(user.uid, syncedPrefs);
          }
        }
      } catch (error) {
        if (!cancelled) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
        return;
      }

      const memberRef = doc(db, 'members', user.uid);
      const initialGooglePhoto = sanitizePhotoUrl(user.photoURL);
      try {
        const memberSnap = await getDoc(memberRef);
        if (memberSnap.exists()) {
          const existingData = memberSnap.data();
          const resolvedDailyCalls =
            typeof existingData.dailyCalls === 'number' ? existingData.dailyCalls : 0;
          const resolvedPhotoUrl =
            typeof existingData.photoUrl === 'string'
              ? existingData.photoUrl
              : initialGooglePhoto;
          const initialPresence: PresenceStatus =
            existingData.presenceState === 'busy' ? 'busy' : 'online';
          manualPresenceRef.current = initialPresence;
          autoAfkRef.current = false;
          lastInteractionAtRef.current = Date.now();
          lastHeartbeatSentAtRef.current = Date.now();

          await updateDoc(memberRef, {
            teamId: TEAM_ID,
            dailyCalls: resolvedDailyCalls,
            photoUrl: resolvedPhotoUrl,
            presenceState: initialPresence,
            lastActiveAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (!cancelled) {
            setBootstrapMember({
              id: memberSnap.id,
              ...existingData,
              teamId: TEAM_ID,
              dailyCalls: resolvedDailyCalls,
              photoUrl: resolvedPhotoUrl,
              presenceState: initialPresence,
              lastActiveAt: Date.now(),
            } as TeamMember);
            setProfileReady(true);
          }
        } else {
          const fallbackName = (
            user.displayName ||
            user.email?.split('@')[0] ||
            'Closer'
          )
            .trim()
            .slice(0, LIMITS.DISPLAY_NAME_MAX);

          manualPresenceRef.current = 'online';
          autoAfkRef.current = false;
          lastInteractionAtRef.current = Date.now();
          lastHeartbeatSentAtRef.current = Date.now();

          await setDoc(memberRef, {
            uid: user.uid,
            teamId: TEAM_ID,
            displayName: fallbackName || 'Closer',
            focus: '',
            statusText: 'On the phones',
            dailyCalls: 0,
            photoUrl: initialGooglePhoto,
            presenceState: 'online',
            lastActiveAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (!cancelled) {
            setBootstrapMember({
              id: user.uid,
              uid: user.uid,
              teamId: TEAM_ID,
              displayName: fallbackName || 'Closer',
              focus: '',
              statusText: 'On the phones',
              dailyCalls: 0,
              photoUrl: initialGooglePhoto,
              presenceState: 'online',
              lastActiveAt: Date.now(),
              createdAt: null,
              updatedAt: null,
            });
            setProfileReady(true);
          }
        }
      } catch (error) {
        if (!cancelled) {
          handleFirestoreError(error, OperationType.WRITE, `members/${user.uid}`);
        }
      }
    };

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  // Real-time listeners for team members & shared feed posts (only after profileReady)
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified || !profileReady) return;

    setIsLoadingPosts(true);
    setIsLoadingMembers(true);

    const membersQuery = query(
      collection(db, 'members'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsubMembers = onSnapshot(
      membersQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamMember);
        setMembers(list);
        setIsLoadingMembers(false);
      },
      (error) => {
        setIsLoadingMembers(false);
        handleFirestoreError(error, OperationType.LIST, 'members');
      }
    );

    initialPostsLoadedRef.current = false;
    knownPostIdsRef.current.clear();

    const postsQuery = query(
      collection(db, 'posts'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsubPosts = onSnapshot(
      postsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamPost);

        if (!initialPostsLoadedRef.current) {
          for (const d of snap.docs) {
            knownPostIdsRef.current.add(d.id);
          }
          initialPostsLoadedRef.current = true;
        } else {
          for (const change of snap.docChanges()) {
            if (change.type === 'added' && !knownPostIdsRef.current.has(change.doc.id)) {
              knownPostIdsRef.current.add(change.doc.id);
              const newPost = { id: change.doc.id, ...change.doc.data() } as TeamPost;
              const activePrefs = prefsRef.current;

              if (newPost.authorId !== user.uid && activePrefs.postNotificationsEnabled) {
                const authorProfile = membersRef.current.find(
                  (m) => m.uid === newPost.authorId
                );
                const myProfile =
                  membersRef.current.find((m) => m.uid === user.uid) || null;
                const authorName = authorProfile?.displayName || newPost.authorName;
                const mentionedMe = textMentionsMember(
                  `${newPost.title || ''} ${newPost.body || ''}`,
                  myProfile
                );

                const alertSnippet =
                  newPost.body?.trim() ||
                  (newPost.imageUrl ? 'Shared an image' : 'New post');

                pushPostAlert({
                  id: `${newPost.id}_${Date.now()}`,
                  kind: 'post',
                  postId: newPost.id,
                  authorName: mentionedMe ? `${authorName} mentioned you` : authorName,
                  authorPhotoUrl: authorProfile?.photoUrl,
                  title: newPost.title,
                  body: alertSnippet,
                });

                if (!isPageFocusedAndVisible()) {
                  setUnreadAwayCount((prev) => prev + 1);
                }

                if (activePrefs.postSoundEnabled) {
                  playNotificationSound(activePrefs.postSoundTone);
                }

                if (activePrefs.postBrowserAlertsEnabled) {
                  const notifTitle = mentionedMe
                    ? `${authorName} mentioned you`
                    : newPost.title
                      ? `${authorName}: ${newPost.title}`
                      : `${authorName} posted in closer`;
                  void showSystemNotification({
                    title: notifTitle,
                    body: alertSnippet,
                    tag: `closer-post-${newPost.id}`,
                    data: { channel: 'feed', postId: newPost.id },
                    onClick: () => setActiveChannel('feed'),
                  });
                }
              }
            }
          }
        }

        setPosts(list);
        setIsLoadingPosts(false);
      },
      (error) => {
        setIsLoadingPosts(false);
        handleFirestoreError(error, OperationType.LIST, 'posts');
      }
    );

    initialDmsLoadedRef.current = false;
    knownDmKeysRef.current.clear();

    const dmsQuery = query(
      collection(db, 'dms'),
      where('participantIds', 'array-contains', user.uid)
    );
    const unsubDms = onSnapshot(
      dmsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DirectThread);

        if (!initialDmsLoadedRef.current) {
          for (const thread of list) {
            const msgKey =
              thread.lastMessageId ||
              String(thread.lastMessageAt?.toMillis?.() || '') ||
              thread.lastMessageText ||
              '';
            knownDmKeysRef.current.set(thread.id, msgKey);
          }
          initialDmsLoadedRef.current = true;
        } else {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added' && change.type !== 'modified') continue;
            const thread = { id: change.doc.id, ...change.doc.data() } as DirectThread;
            const msgKey =
              thread.lastMessageId ||
              String(thread.lastMessageAt?.toMillis?.() || '') ||
              thread.lastMessageText ||
              '';
            const prevKey = knownDmKeysRef.current.get(thread.id);
            if (!msgKey || msgKey === prevKey) continue;

            knownDmKeysRef.current.set(thread.id, msgKey);

            if (!thread.lastSenderId || thread.lastSenderId === user.uid) continue;

            const activePrefs = prefsRef.current;
            if (!activePrefs.postNotificationsEnabled) continue;

            const viewingSameChatHere =
              isPageFocusedAndVisible() &&
              activeChannelRef.current === 'messages' &&
              selectedDmUserIdRef.current === thread.lastSenderId;
            if (viewingSameChatHere) continue;

            const senderProfile = membersRef.current.find(
              (m) => m.uid === thread.lastSenderId
            );
            const senderName = senderProfile?.displayName || 'Teammate';
            const dmSnippet = thread.lastMessageText?.trim() || 'Sent you a direct message';

            pushPostAlert({
              id: `dm_${thread.id}_${Date.now()}`,
              kind: 'dm',
              postId: thread.id,
              senderUid: thread.lastSenderId,
              authorName: senderName,
              authorPhotoUrl: senderProfile?.photoUrl,
              title: '',
              body: dmSnippet,
            });

            if (!isPageFocusedAndVisible()) {
              setUnreadAwayCount((prev) => prev + 1);
            }

            if (activePrefs.postSoundEnabled) {
              playNotificationSound(activePrefs.postSoundTone);
            }

            if (activePrefs.postBrowserAlertsEnabled) {
              void showSystemNotification({
                title: `Message from ${senderName}`,
                body: dmSnippet,
                tag: `closer-dm-${thread.id}`,
                data: { channel: 'messages', senderUid: thread.lastSenderId },
                onClick: () => {
                  setSelectedDmUserId(thread.lastSenderId);
                  setActiveChannel('messages');
                },
              });
            }
          }
        }

        setThreads(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'dms');
      }
    );

    const supervisorsQuery = query(
      collection(db, 'supervisors'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsubSupervisors = onSnapshot(
      supervisorsQuery,
      (snap) => {
        const list = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as SupervisorRecord
        );
        setSupervisors(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'supervisors');
      }
    );

    return () => {
      unsubMembers();
      unsubPosts();
      unsubDms();
      unsubSupervisors();
    };
  }, [authReady, user, profileReady]);

  // Automatic presence heartbeat, idle AFK detection, and freshness ticker
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified || !profileReady) return;

    const uid = user.uid;
    const writePresence = (nextState: PresenceStatus) => {
      lastHeartbeatSentAtRef.current = Date.now();
      void updateDoc(doc(db, 'members', uid), {
        presenceState: nextState,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {
        // Ignore transient offline/disconnect write failures on presence ping
      });
    };

    const handleUserActivity = () => {
      const now = Date.now();
      lastInteractionAtRef.current = now;
      if (autoAfkRef.current && manualPresenceRef.current === 'online') {
        autoAfkRef.current = false;
        writePresence('online');
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      lastInteractionAtRef.current = now;
      if (manualPresenceRef.current === 'offline') return;
      if (autoAfkRef.current && manualPresenceRef.current === 'online') {
        autoAfkRef.current = false;
        writePresence('online');
      } else if (now - lastHeartbeatSentAtRef.current >= 60_000) {
        writePresence(manualPresenceRef.current);
      }
    };

    const handlePageHide = () => {
      void updateDoc(doc(db, 'members', uid), {
        presenceState: 'offline',
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    };

    window.addEventListener('pointerdown', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });
    window.addEventListener('mousemove', handleUserActivity, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);

      const desired = manualPresenceRef.current;
      if (desired === 'offline') return;

      if (desired === 'online' && !autoAfkRef.current) {
        if (now - lastInteractionAtRef.current >= PRESENCE_IDLE_AFK_MS) {
          autoAfkRef.current = true;
          writePresence('afk');
          return;
        }
      }

      if (now - lastHeartbeatSentAtRef.current >= PRESENCE_HEARTBEAT_MS) {
        const effectiveWriteState: PresenceStatus = autoAfkRef.current ? 'afk' : desired;
        writePresence(effectiveWriteState);
      }
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      window.removeEventListener('mousemove', handleUserActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [authReady, user, profileReady]);

  const currentMember = useMemo(() => {
    if (!user) return null;
    return members.find((m) => m.uid === user.uid) || bootstrapMember;
  }, [members, user, bootstrapMember]);

  const supervisorIds = useMemo(() => {
    return new Set(supervisors.filter((s) => s.active).map((s) => s.uid));
  }, [supervisors]);

  const isSupervisor = Boolean(user && supervisorIds.has(user.uid));

  const refreshSupervisorStatus = async () => {
    try {
      const res = await fetch('/api/supervisor/status');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (
          data.mode === 'env' ||
          data.mode === 'claimed' ||
          data.mode === 'unconfigured'
        ) {
          setSupervisorStatusMode(data.mode);
          return;
        }
      }
    } catch {
      // Backend API unavailable (e.g., static shared hosting); fall through to Firestore check
    }

    if (user?.email === 'giadarola1@gmail.com') {
      try {
        const configSnap = await getDoc(doc(db, 'app_config', 'supervisor'));
        setSupervisorStatusMode(
          configSnap.exists() && isValidSyncKey(configSnap.data()?.syncKey)
            ? 'claimed'
            : 'unconfigured'
        );
        return;
      } catch {
        // Fall through cleanly
      }
    }

    setSupervisorStatusMode('claimed');
  };

  useEffect(() => {
    if (authReady && user && profileReady) {
      refreshSupervisorStatus();
    }
  }, [authReady, user, profileReady]);

  const handleOpenSupervisorModal = () => {
    setSupervisorError(null);
    setIsSupervisorModalOpen(true);
    refreshSupervisorStatus();
  };

  const activateSupervisorInFirestore = async (syncKey: string) => {
    if (!user || !currentMember) return;
    if (!isValidSyncKey(syncKey)) {
      throw new Error('Supervisor verification key is missing or invalid.');
    }

    const isAdminEmail = user.email === 'giadarola1@gmail.com';
    const supRef = doc(db, 'supervisors', user.uid);
    const supSnap = await getDoc(supRef);
    const batch = writeBatch(db);
    const cleanName =
      currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX) || 'Closer';

    if (isAdminEmail) {
      batch.set(doc(db, 'app_config', 'supervisor'), {
        syncKey,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(doc(db, 'supervisor_claims', user.uid), {
        uid: user.uid,
        syncKey,
        updatedAt: serverTimestamp(),
      });
    }

    if (supSnap.exists()) {
      batch.update(supRef, {
        displayName: cleanName,
        active: true,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(supRef, {
        uid: user.uid,
        teamId: TEAM_ID,
        displayName: cleanName,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  };

  const handleSupervisorClaim = async (passcode: string) => {
    if (!user || supervisorBusy) return;
    setSupervisorBusy(true);
    setSupervisorError(null);
    try {
      let resolvedSyncKey: string | null = null;
      let apiHandled = false;

      try {
        const res = await fetch('/api/supervisor/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: user.uid, passcode }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          apiHandled = true;
          const data = await res.json();
          if (!res.ok) {
            if (res.status === 409) {
              await refreshSupervisorStatus();
            }
            setSupervisorError(data.error || 'Could not configure supervisor passcode.');
            return;
          }
          if (!isValidSyncKey(data.syncKey)) {
            setSupervisorError('Server returned an incomplete verification key.');
            return;
          }
          setSupervisorToken(typeof data.token === 'string' ? data.token : null);
          resolvedSyncKey = data.syncKey;
        }
      } catch {
        // Static deployment without Express API; verify via Firestore fallback
      }

      if (!apiHandled) {
        if (user.email !== 'giadarola1@gmail.com') {
          setSupervisorError('An admin must configure Supervisor first.');
          return;
        }
        const existingConfig = await getDoc(doc(db, 'app_config', 'supervisor'));
        if (existingConfig.exists() && isValidSyncKey(existingConfig.data()?.syncKey)) {
          setSupervisorStatusMode('claimed');
          setSupervisorError('Supervisor passcode is already configured. Please sign in.');
          return;
        }
        resolvedSyncKey = await deriveSupervisorSyncKey(passcode);
      }

      if (!isValidSyncKey(resolvedSyncKey)) {
        setSupervisorError('Could not derive a valid verification key.');
        return;
      }

      setSupervisorStatusMode('claimed');
      await activateSupervisorInFirestore(resolvedSyncKey);
      setIsSupervisorModalOpen(false);
      showToast('Supervisor mode activated');
    } catch (error) {
      const msg =
        error instanceof Error && error.message.toLowerCase().includes('permission')
          ? 'An admin must activate Supervisor once before other teammates can claim it.'
          : error instanceof Error
            ? error.message
            : 'Unable to activate Supervisor mode.';
      setSupervisorError(msg);
    } finally {
      setSupervisorBusy(false);
    }
  };

  const handleSupervisorLogin = async (passcode: string) => {
    if (!user || supervisorBusy) return;
    setSupervisorBusy(true);
    setSupervisorError(null);
    try {
      let resolvedSyncKey: string | null = null;
      let apiHandled = false;

      try {
        const res = await fetch('/api/supervisor/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: user.uid, passcode }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          apiHandled = true;
          const data = await res.json();
          if (!res.ok) {
            setSupervisorError(data.error || 'Incorrect supervisor password.');
            return;
          }
          if (!isValidSyncKey(data.syncKey)) {
            setSupervisorError('Server returned an incomplete verification key.');
            return;
          }
          setSupervisorToken(typeof data.token === 'string' ? data.token : null);
          resolvedSyncKey = data.syncKey;
        }
      } catch {
        // Static deployment without Express API; verify via Firestore fallback
      }

      if (!apiHandled) {
        const candidateSyncKey = await deriveSupervisorSyncKey(passcode);
        if (user.email === 'giadarola1@gmail.com') {
          const configSnap = await getDoc(doc(db, 'app_config', 'supervisor'));
          const storedKey = configSnap.data()?.syncKey;
          if (!configSnap.exists() || !isValidSyncKey(storedKey)) {
            setSupervisorStatusMode('unconfigured');
            setSupervisorError('Please set the supervisor passcode first.');
            return;
          }
          if (!constantTimeHexEquals(candidateSyncKey, storedKey)) {
            setSupervisorError('Incorrect supervisor password.');
            return;
          }
        }
        resolvedSyncKey = candidateSyncKey;
      }

      if (!isValidSyncKey(resolvedSyncKey)) {
        setSupervisorError('Could not derive a valid verification key.');
        return;
      }

      await activateSupervisorInFirestore(resolvedSyncKey);
      setIsSupervisorModalOpen(false);
      showToast('Supervisor mode activated');
    } catch (error) {
      const msg =
        error instanceof Error && error.message.toLowerCase().includes('permission')
          ? 'Incorrect supervisor password or admin has not activated Supervisor yet.'
          : error instanceof Error
            ? error.message
            : 'Unable to verify supervisor password.';
      setSupervisorError(msg);
    } finally {
      setSupervisorBusy(false);
    }
  };

  const handleSupervisorLogout = async () => {
    if (!user || supervisorBusy) return;
    setSupervisorBusy(true);
    setSupervisorError(null);
    try {
      await fetch('/api/supervisor/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(supervisorToken ? { Authorization: `Bearer ${supervisorToken}` } : {}),
        },
        body: JSON.stringify({ uid: user.uid }),
      }).catch(() => {});

      await deleteDoc(doc(db, 'supervisors', user.uid));
      await deleteDoc(doc(db, 'supervisor_claims', user.uid)).catch(() => {});
      setSupervisorToken(null);
      setIsSupervisorModalOpen(false);
      showToast('Signed out of Supervisor');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `supervisors/${user.uid}`);
    } finally {
      setSupervisorBusy(false);
    }
  };

  const handleUnpinAllPosts = async () => {
    if (!isSupervisor || supervisorBusy) return;
    const pinnedPosts = posts.filter((p) => p.pinned);
    if (pinnedPosts.length === 0) return;

    setSupervisorBusy(true);
    try {
      const batch = writeBatch(db);
      for (const p of pinnedPosts) {
        batch.update(doc(db, 'posts', p.id), {
          pinned: false,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      showToast(
        `Unpinned ${pinnedPosts.length} ${pinnedPosts.length === 1 ? 'post' : 'posts'}`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'posts');
    } finally {
      setSupervisorBusy(false);
    }
  };

  const handleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to sign in with Google.';
      setAuthError(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleChangePresence = async (next: PresenceStatus) => {
    if (!user) return;
    manualPresenceRef.current = next;
    autoAfkRef.current = false;
    lastInteractionAtRef.current = Date.now();
    lastHeartbeatSentAtRef.current = Date.now();
    try {
      await updateDoc(doc(db, 'members', user.uid), {
        presenceState: next,
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(`Availability: ${PRESENCE_META[next].label}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `members/${user.uid}`);
    }
  };

  const handleSignOut = async () => {
    try {
      if (user) {
        await updateDoc(doc(db, 'members', user.uid), {
          presenceState: 'offline',
          lastActiveAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      await signOut(auth);
      setActiveChannel('feed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign out.';
      showToast(message);
    }
  };

  const handleOpenDm = (targetUid: string) => {
    setSelectedDmUserId(targetUid);
    setActiveChannel('messages');
  };

  const handleUpdateNotificationPrefs = async (
    patch: Partial<NotificationPreferences>
  ) => {
    if (!user) return;
    const nextPrefs: NotificationPreferences = {
      ...notificationPrefs,
      ...patch,
    };
    setNotificationPrefs(nextPrefs);
    saveCachedNotificationPrefs(user.uid, nextPrefs);
    setSavingNotificationPrefs(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setSavingNotificationPrefs(false);
    }
  };

  const handleEnableOutsideNotifications = async () => {
    const permission = await requestBrowserNotificationPermission();
    setBrowserPermission(permission);
    if (permission === 'granted') {
      await handleUpdateNotificationPrefs({
        postNotificationsEnabled: true,
        postBrowserAlertsEnabled: true,
      });
      showToast('Outside-page notifications enabled');
    } else if (isEmbeddedIframe()) {
      setIsNotificationModalOpen(true);
    } else {
      showToast('Allow notifications in your browser settings');
    }
  };

  const handleDismissBrowserPrompt = () => {
    setBrowserPromptDismissed(true);
    try {
      window.localStorage.setItem('closer_notif_prompt_dismissed', '1');
    } catch {
      // Ignore storage errors
    }
  };

  const handleTestAlert = async () => {
    if (!currentMember) return;
    pushPostAlert({
      id: `test_${Date.now()}`,
      kind: 'post',
      postId: 'test',
      authorName: currentMember.displayName,
      authorPhotoUrl: currentMember.photoUrl,
      title: 'Test notification',
      body: notificationPrefs.postNotificationsEnabled
        ? notificationPrefs.postSoundEnabled
          ? `Alerts on · Sound tone: ${notificationPrefs.postSoundTone}`
          : 'Alerts on · Sound muted'
        : 'Alerts are currently off (this is a manual preview)',
    });
    if (notificationPrefs.postSoundEnabled) {
      playNotificationSound(notificationPrefs.postSoundTone);
    }

    let perm: NotificationPermission | 'unsupported' = canUseBrowserNotifications()
      ? Notification.permission
      : 'unsupported';
    if (perm === 'default' && notificationPrefs.postBrowserAlertsEnabled) {
      perm = await requestBrowserNotificationPermission();
      setBrowserPermission(perm);
    }

    if (notificationPrefs.postBrowserAlertsEnabled && perm === 'granted') {
      void showSystemNotification({
        title: `${currentMember.displayName} — closer`,
        body: 'Notifications for new posts & direct messages are active.',
        tag: 'closer-test-notification',
        data: { channel: 'feed' },
        onClick: () => setActiveChannel('feed'),
      });
    }
  };

  const handleFocusComposer = () => {
    if (activeChannel !== 'feed') {
      setActiveChannel('feed');
    }
    setComposerOpenNonce((n) => n + 1);
    window.setTimeout(() => {
      composerRef.current?.focus();
    }, 60);
  };

  const handleCopyText = (text: string, label: string) => {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    showToast(label);
  };

  const renderContent = () => {
    // Loading auth state
    if (!authReady) {
      return (
        <div className="min-h-screen bg-[#141413] text-[#8d8c85] flex items-center justify-center font-['Inter'] text-xs">
          Loading workspace...
        </div>
      );
    }

    // Unauthenticated or unverified sign-in view
    if (!user || !user.emailVerified) {
      return (
        <div className="min-h-screen bg-[#141413] text-[#edece8] flex items-center justify-center p-6 font-['Inter'] selection:bg-[#2b2b28] selection:text-white">
          <div className="max-w-sm w-full bg-[#191918] border border-[#262624] rounded-2xl p-7 space-y-6">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#141413] border border-[#2a2a27] flex items-center justify-center text-[#edece8]">
                  <PadlockMark isOpen={false} animateOnChange={false} size="sm" />
                </div>
                <h1 className="font-['Inter'] text-3xl font-medium tracking-tight text-white">
                  Closer
                </h1>
              </div>
              <p className="text-xs text-[#8d8c85] leading-relaxed">
                Go To Truckers — Closers Team Hub. Share posts, updates, private messages, and daily call volume in real time.
              </p>
            </div>

            {authError && (
              <div className="bg-[#141413] border border-[#32322f] rounded-xl px-3 py-2 text-xs text-[#d1d1cf] leading-relaxed">
                {authError}
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={handleSignIn}
                disabled={authBusy}
                className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-[#e0dfd9] disabled:opacity-60 text-black text-xs font-medium transition-colors"
              >
                {authBusy ? 'Signing in...' : 'Sign in with Google'}
              </button>

              {user && !user.emailVerified && (
                <button
                  onClick={handleSignOut}
                  className="w-full py-2 px-4 rounded-xl bg-[#141413] border border-[#2a2a27] text-[#9c9a92] hover:text-white text-xs transition-colors"
                >
                  Use another account
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Bootstrapping team member profile
    if (!profileReady || !currentMember) {
      return (
        <div className="min-h-screen bg-[#141413] text-[#8d8c85] flex items-center justify-center font-['Inter'] text-xs">
          Joining closer floor...
        </div>
      );
    }

    return (
      <div className="h-screen w-screen bg-[#141413] text-[#d1d1cf] flex font-['Inter'] selection:bg-[#2b2b28] selection:text-white overflow-hidden">
      <Sidebar
        activeChannel={activeChannel}
        onSelectChannel={(channel) => setActiveChannel(channel)}
        onFocusComposer={handleFocusComposer}
        postCount={posts.length}
        dmCount={threads.length}
        memberCount={members.length || 1}
        members={members}
        isLoadingMembers={isLoadingMembers}
        selectedDmUserId={selectedDmUserId}
        onOpenDm={handleOpenDm}
        currentMember={currentMember}
        nowMs={nowMs}
        onChangePresence={handleChangePresence}
        supervisorIds={supervisorIds}
        isSupervisor={isSupervisor}
        onOpenSupervisorModal={handleOpenSupervisorModal}
        onSignOut={handleSignOut}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen(!isSidebarOpen)}
        isMobileOpen={isMobileNavOpen}
        onCloseMobile={() => setIsMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto bg-[#141413]">
        <div className="lg:hidden h-12 border-b border-[#222220] bg-[#0f0f0e] flex items-center px-4 justify-between shrink-0 font-['Inter']">
          <button
            type="button"
            onClick={() => setIsMobileNavOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 p-1 bg-transparent hover:bg-transparent border-0 text-[#edece8] hover:text-white transition-colors"
            title="Open navigation"
            aria-label="Open navigation"
          >
            <PadlockMark isOpen={isMobileNavOpen} size="sm" />
            <span className="font-['Inter'] text-sm font-medium text-white">
              Closer
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsNotificationModalOpen(true)}
            className="p-1.5 text-[#8d8c85] hover:text-white rounded-lg bg-[#191918] border border-[#262624]"
            title="Post notifications"
          >
            {notificationPrefs.postNotificationsEnabled ? (
              <Bell className="w-4 h-4" />
            ) : (
              <BellOff className="w-4 h-4" />
            )}
          </button>
        </div>

        <main className="flex-1 h-full overflow-y-auto">
          {activeChannel === 'roster' ? (
            <RosterView
              members={members}
              threads={threads}
              currentUserId={currentMember.uid}
              googlePhotoUrl={user.photoURL}
              nowMs={nowMs}
              onChangePresence={handleChangePresence}
              supervisorIds={supervisorIds}
              isSupervisor={isSupervisor}
              onOpenSupervisorModal={handleOpenSupervisorModal}
              onOpenDm={handleOpenDm}
              onNotify={showToast}
            />
          ) : activeChannel === 'messages' ? (
            <DirectMessagesView
              currentMember={currentMember}
              members={members}
              isLoadingMembers={isLoadingMembers}
              threads={threads}
              supervisorIds={supervisorIds}
              selectedUserId={selectedDmUserId}
              nowMs={nowMs}
              onSelectUser={(uid) => setSelectedDmUserId(uid)}
              onNotify={showToast}
            />
          ) : (
            <TeamFeedView
              currentMember={currentMember}
              members={members}
              supervisorIds={supervisorIds}
              isSupervisor={isSupervisor}
              composerRef={composerRef}
              composerOpenNonce={composerOpenNonce}
              onCopyText={handleCopyText}
              onOpenDm={handleOpenDm}
              onNotify={showToast}
              notificationsEnabled={notificationPrefs.postNotificationsEnabled}
              onOpenNotificationSettings={() => setIsNotificationModalOpen(true)}
              posts={posts}
              isLoadingPosts={isLoadingPosts}
            />
          )}
        </main>
      </div>

      <PostNotificationBanner
        alerts={postAlerts}
        onOpenFeed={() => setActiveChannel('feed')}
        onOpenDm={handleOpenDm}
        onDismiss={dismissPostAlert}
      />

      {notificationPrefs.postNotificationsEnabled &&
        canUseBrowserNotifications() &&
        browserPermission !== 'unsupported' &&
        !browserPromptDismissed &&
        (browserPermission !== 'granted' || !notificationPrefs.postBrowserAlertsEnabled) && (
          <div className="fixed bottom-4 right-4 z-40 max-w-xs bg-[#191918] border border-[#2a2a27] rounded-2xl p-3.5 shadow-xl font-['Inter'] space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white">
                  Outside-page alerts
                </div>
                <p className="text-[11px] text-[#8d8c85] leading-snug">
                  Allow desktop notifications to see new posts and DMs while working in other tabs or apps.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismissBrowserPrompt}
                className="text-[#71706b] hover:text-white text-xs px-1"
                title="Dismiss"
              >
                ×
              </button>
            </div>
            <div className="flex items-center gap-2">
              {browserPermission === 'denied' && isEmbeddedIframe() ? (
                <a
                  href={typeof window !== 'undefined' ? window.location.href : '/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#e0dfd9] text-black text-[11px] font-medium transition-colors"
                >
                  Open standalone tab
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleEnableOutsideNotifications}
                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-[#e0dfd9] text-black text-[11px] font-medium transition-colors"
                >
                  Enable alerts
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsNotificationModalOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-[#2c2c29] text-[#9c9a92] hover:text-white text-[11px] transition-colors"
              >
                Settings
              </button>
            </div>
          </div>
        )}

      <NotificationSettingsModal
        isOpen={isNotificationModalOpen}
        prefs={notificationPrefs}
        saving={savingNotificationPrefs}
        onUpdatePrefs={handleUpdateNotificationPrefs}
        onTestAlert={handleTestAlert}
        onClose={() => setIsNotificationModalOpen(false)}
      />

      <SupervisorModal
        isOpen={isSupervisorModalOpen}
        onClose={() => setIsSupervisorModalOpen(false)}
        currentMember={currentMember}
        isSupervisor={isSupervisor}
        supervisors={supervisors}
        posts={posts}
        statusMode={supervisorStatusMode}
        busy={supervisorBusy}
        error={supervisorError}
        onClearError={() => setSupervisorError(null)}
        onLogin={handleSupervisorLogin}
        onClaim={handleSupervisorClaim}
        onLogout={handleSupervisorLogout}
        onUnpinAllPosts={handleUnpinAllPosts}
      />

      <Toast message={toastMessage} />
    </div>
    );
  };

  return (
    <>
      {renderContent()}
      {showLaunchSplash && (
        <LaunchSplash onComplete={() => setShowLaunchSplash(false)} />
      )}
    </>
  );
}
