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
import { Menu } from 'lucide-react';
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
} from './types/team.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TeamFeedView } from './components/TeamFeedView.tsx';
import { RosterView } from './components/RosterView.tsx';
import { Toast } from './components/Toast.tsx';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [bootstrapMember, setBootstrapMember] = useState<TeamMember | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [posts, setPosts] = useState<TeamPost[]>([]);
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);

  const [activeChannel, setActiveChannel] = useState<SidebarChannel>('feed');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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
        setIsLoadingPosts(false);
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
      try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: (user.email || '').slice(0, 200),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        if (!cancelled) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
        return;
      }

      const memberRef = doc(db, 'members', user.uid);
      try {
        const memberSnap = await getDoc(memberRef);
        if (memberSnap.exists()) {
          const existingData = memberSnap.data();
          const needsMigration =
            typeof existingData.dailyCalls !== 'number' || existingData.teamId !== TEAM_ID;
          const resolvedDailyCalls =
            typeof existingData.dailyCalls === 'number' ? existingData.dailyCalls : 0;

          if (needsMigration) {
            await updateDoc(memberRef, {
              teamId: TEAM_ID,
              dailyCalls: resolvedDailyCalls,
              updatedAt: serverTimestamp(),
            });
          }

          if (!cancelled) {
            setBootstrapMember({
              id: memberSnap.id,
              ...existingData,
              teamId: TEAM_ID,
              dailyCalls: resolvedDailyCalls,
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

    const postsQuery = query(
      collection(db, 'posts'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsubPosts = onSnapshot(
      postsQuery,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeamPost);
        setPosts(list);
        setIsLoadingPosts(false);
      },
      (error) => {
        setIsLoadingPosts(false);
        handleFirestoreError(error, OperationType.LIST, 'posts');
      }
    );

    return () => {
      unsubMembers();
      unsubPosts();
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

  const handleFocusComposer = () => {
    if (activeChannel === 'roster') {
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
          <div className="space-y-2">
            <h1 className="font-['Inter'] text-3xl font-medium tracking-tight text-white lowercase">
              closer
            </h1>
            <p className="text-xs text-[#8d8c85] leading-relaxed">
              Go To Truckers — Closers Team Hub. Share posts, updates, and daily call volume in real time.
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
        memberCount={members.length || 1}
        currentMember={currentMember}
        onSignOut={handleSignOut}
        isOpen={isSidebarOpen}
        onToggleOpen={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto bg-[#141413]">
        <div className="lg:hidden h-12 border-b border-[#222220] bg-[#0f0f0e] flex items-center px-4 justify-between shrink-0 font-['Inter']">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 text-[#8d8c85] hover:text-white rounded bg-[#1e1e1c]"
            title="Toggle navigation"
          >
            <Menu className="w-4 h-4" />
          </button>
          <span className="font-['Inter'] text-sm font-medium text-white lowercase">closer</span>
          <div className="w-6" />
        </div>

        <main className="flex-1 h-full overflow-y-auto">
          {activeChannel === 'roster' ? (
            <RosterView
              members={members}
              currentUserId={currentMember.uid}
              onNotify={showToast}
            />
          ) : (
            <TeamFeedView
              currentMember={currentMember}
              composerRef={composerRef}
              onCopyText={handleCopyText}
              onNotify={showToast}
              posts={posts}
              isLoadingPosts={isLoadingPosts}
            />
          )}
        </main>
      </div>

      <Toast message={toastMessage} />
    </div>
  );
}
