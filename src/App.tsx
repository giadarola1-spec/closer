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
import { Menu, Bell, BellOff, Truck } from 'lucide-react';
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
import { sanitizePhotoUrl } from './utils/image.ts';
import { textMentionsMember } from './utils/mentions.ts';
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
  showBrowserPostNotification,
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

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const alertTimersRef = useRef<Record<string, number>>({});
  const knownPostIdsRef = useRef<Set<string>>(new Set());
  const initialPostsLoadedRef = useRef(false);
  const prefsRef = useRef<NotificationPreferences>(notificationPrefs);
  const membersRef = useRef<TeamMember[]>(members);

  useEffect(() => {
    prefsRef.current = notificationPrefs;
  }, [notificationPrefs]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    return installAudioUnlockListeners();
  }, []);

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
          const needsMigration =
            typeof existingData.dailyCalls !== 'number' ||
            typeof existingData.photoUrl !== 'string' ||
            existingData.teamId !== TEAM_ID;

          if (needsMigration) {
            await updateDoc(memberRef, {
              teamId: TEAM_ID,
              dailyCalls: resolvedDailyCalls,
              photoUrl: resolvedPhotoUrl,
              updatedAt: serverTimestamp(),
            });
          }

          if (!cancelled) {
            setBootstrapMember({
              id: memberSnap.id,
              ...existingData,
              teamId: TEAM_ID,
              dailyCalls: resolvedDailyCalls,
              photoUrl: resolvedPhotoUrl,
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

          await setDoc(memberRef, {
            uid: user.uid,
            teamId: TEAM_ID,
            displayName: fallbackName || 'Closer',
            focus: '',
            statusText: 'On the phones',
            dailyCalls: 0,
            photoUrl: initialGooglePhoto,
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
                  postId: newPost.id,
                  authorName: mentionedMe ? `${authorName} mentioned you` : authorName,
                  authorPhotoUrl: authorProfile?.photoUrl,
                  title: newPost.title,
                  body: alertSnippet,
                });

                if (activePrefs.postSoundEnabled) {
                  playNotificationSound(activePrefs.postSoundTone);
                }

                if (activePrefs.postBrowserAlertsEnabled) {
                  const notifTitle = mentionedMe
                    ? `${authorName} mentioned you`
                    : newPost.title
                      ? `${authorName}: ${newPost.title}`
                      : `${authorName} posted in closer`;
                  showBrowserPostNotification(notifTitle, alertSnippet, () => {
                    setActiveChannel('feed');
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

    const dmsQuery = query(
      collection(db, 'dms'),
      where('participantIds', 'array-contains', user.uid)
    );
    const unsubDms = onSnapshot(
      dmsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DirectThread);
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

  const handleSignOut = async () => {
    try {
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

  const handleTestAlert = () => {
    if (!currentMember) return;
    pushPostAlert({
      id: `test_${Date.now()}`,
      postId: 'test',
      authorName: currentMember.displayName,
      authorPhotoUrl: currentMember.photoUrl,
      title: 'Test post notification',
      body: notificationPrefs.postNotificationsEnabled
        ? notificationPrefs.postSoundEnabled
          ? `Alerts on · Sound tone: ${notificationPrefs.postSoundTone}`
          : 'Alerts on · Sound muted'
        : 'Post alerts are currently off (this is a manual preview)',
    });
    if (notificationPrefs.postSoundEnabled) {
      playNotificationSound(notificationPrefs.postSoundTone);
    }
    if (notificationPrefs.postBrowserAlertsEnabled) {
      showBrowserPostNotification(
        `${currentMember.displayName}: Test post notification`,
        'New post notifications are active.',
        () => setActiveChannel('feed')
      );
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
                <Truck className="w-4 h-4" />
              </div>
              <h1 className="font-['Inter'] text-3xl font-medium tracking-tight text-white lowercase">
                closer
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
        notificationsEnabled={notificationPrefs.postNotificationsEnabled}
        onOpenNotificationSettings={() => setIsNotificationModalOpen(true)}
        currentMember={currentMember}
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
            onClick={() => setIsMobileNavOpen(true)}
            className="p-1.5 text-[#8d8c85] hover:text-white rounded-lg bg-[#191918] border border-[#262624]"
            title="Open navigation"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5">
            <Truck className="w-3.5 h-3.5 text-[#edece8]" />
            <span className="font-['Inter'] text-sm font-medium text-white lowercase">closer</span>
          </div>
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
        onDismiss={dismissPostAlert}
      />

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
}
