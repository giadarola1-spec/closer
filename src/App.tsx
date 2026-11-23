import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
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
} from './types/team.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TeamFeedView } from './components/TeamFeedView.tsx';
import { RosterView } from './components/RosterView.tsx';
import { DirectMessagesView } from './components/DirectMessagesView.tsx';
import { NotificationSettingsModal } from './components/NotificationSettingsModal.tsx';
import { PostNotificationBanner } from './components/PostNotificationBanner.tsx';
import { Toast } from './components/Toast.tsx';
import { sanitizePhotoUrl } from './utils/image.ts';
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
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);

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
        setPostAlerts([]);
        setSelectedDmUserId(null);
        setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
        knownPostIdsRef.current.clear();
        initialPostsLoadedRef.current = false;
        setIsLoadingPosts(false);
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

    const membersQuery = query(
      collection(db, 'members'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsubMembers = onSnapshot(
      membersQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamMember);
        setMembers(list);
      },
      (error) => {
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
                const authorName = authorProfile?.displayName || newPost.authorName;

                const alertSnippet =
                  newPost.body?.trim() ||
                  (newPost.imageUrl ? 'Shared an image' : 'New post');

                pushPostAlert({
                  id: `${newPost.id}_${Date.now()}`,
                  postId: newPost.id,
                  authorName,
                  authorPhotoUrl: authorProfile?.photoUrl,
                  title: newPost.title,
                  body: alertSnippet,
                });

                if (activePrefs.postSoundEnabled) {
                  playNotificationSound(activePrefs.postSoundTone);
                }

                if (activePrefs.postBrowserAlertsEnabled) {
                  const notifTitle = newPost.title
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

    return () => {
      unsubMembers();
      unsubPosts();
      unsubDms();
    };
  }, [authReady, user, profileReady]);

  const currentMember = useMemo(() => {
    if (!user) return null;
    return members.find((m) => m.uid === user.uid) || bootstrapMember;
  }, [members, user, bootstrapMember]);

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
    window.setTimeout(() => {
      composerRef.current?.focus();
    }, 40);
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
        selectedDmUserId={selectedDmUserId}
        onOpenDm={handleOpenDm}
        notificationsEnabled={notificationPrefs.postNotificationsEnabled}
        onOpenNotificationSettings={() => setIsNotificationModalOpen(true)}
        currentMember={currentMember}
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
              onOpenDm={handleOpenDm}
              onNotify={showToast}
            />
          ) : activeChannel === 'messages' ? (
            <DirectMessagesView
              currentMember={currentMember}
              members={members}
              threads={threads}
              selectedUserId={selectedDmUserId}
              onSelectUser={(uid) => setSelectedDmUserId(uid)}
              onNotify={showToast}
            />
          ) : (
            <TeamFeedView
              currentMember={currentMember}
              members={members}
              composerRef={composerRef}
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

      <Toast message={toastMessage} />
    </div>
  );
}
