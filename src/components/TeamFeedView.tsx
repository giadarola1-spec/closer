import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  writeBatch,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import type { Tweet } from 'react-tweet/api';
import {
  ArrowUp,
  Search,
  Copy,
  MessageSquare,
  Heart,
  Pin,
  Trash2,
  X,
  Send,
  Bell,
  BellOff,
  ImagePlus,
  Loader2,
  AlertCircle,
  ArrowUpDown,
  ChevronDown,
  Check,
  Plus,
  AtSign,
  StickyNote,
} from 'lucide-react';
import { auth, db, OperationType, handleFirestoreError } from '../firebase.ts';
import {
  TEAM_ID,
  ACCEPTED_TEAM_IDS,
  LIMITS,
  TeamMember,
  TeamPost,
  PostComment,
} from '../types/team.ts';
import { Avatar } from './Avatar.tsx';
import { SupervisorBadge } from './SupervisorBadge.tsx';
import { MentionSuggestions } from './MentionSuggestions.tsx';
import {
  DesktopMarginNote,
  MobileMarginNote,
  DesktopMarginNoteStatus,
  MobileMarginNoteStatus,
  MarginNoteRequestStatus,
} from './MarginNote.tsx';
import { TweetCard, TweetSkeleton } from '@/components/ui/tweet-card';
import {
  MAX_POST_IMAGE_BYTES,
  sanitizePostImageUrl,
  uploadPostImageToCloudinary,
} from '../utils/image.ts';
import { extractYouTubeLinks } from '../utils/youtube.ts';
import { YouTubeThumbnailCard } from './YouTubeThumbnailCard.tsx';
import {
  ActiveMentionQuery,
  buildMembersByMentionHandle,
  filterMentionCandidates,
  findActiveMentionQuery,
  getMentionHandle,
  insertMentionAtCursor,
  resolveMentionedMember,
} from '../utils/mentions.ts';

interface TeamFeedViewProps {
  currentMember: TeamMember;
  members: TeamMember[];
  supervisorIds: Set<string>;
  isSupervisor: boolean;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  composerOpenNonce?: number;
  onCopyText: (text: string, label: string) => void;
  onOpenDm: (targetUid: string) => void;
  onNotify: (msg: string) => void;
  notificationsEnabled: boolean;
  onOpenNotificationSettings: () => void;
  posts: TeamPost[];
  isLoadingPosts: boolean;
}

function formatRelativeTime(ts: any): string {
  if (!ts) return 'just now';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type FeedFilterMode = 'all' | 'pinned' | 'images';
type FeedSortMode = 'recent' | 'relevant' | 'interactions' | 'likes' | 'replies';

const SORT_OPTIONS: { id: FeedSortMode; label: string; title: string }[] = [
  { id: 'recent', label: 'Recent', title: 'Newest posts first (pinned on top)' },
  {
    id: 'relevant',
    label: 'Relevant',
    title: 'Balances engagement, recency, pinned updates, and search matches',
  },
  {
    id: 'interactions',
    label: 'Most interactions',
    title: 'Highest combined likes and replies',
  },
  { id: 'likes', label: 'Most liked', title: 'Most likes first' },
  { id: 'replies', label: 'Most replies', title: 'Most replies first' },
];

function getPostMillis(post: TeamPost, fallbackMs: number): number {
  if (!post.createdAt) return fallbackMs;
  if (typeof post.createdAt.toMillis === 'function') {
    return post.createdAt.toMillis();
  }
  const parsed = new Date(post.createdAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function scorePostRelevance(
  post: TeamPost,
  nowMs: number,
  searchQueryLower: string,
  authorDisplayName: string
): number {
  const likes = post.likeCount || 0;
  const replies = post.replyCount || 0;
  const engagement = likes * 2 + replies * 3;
  const pinnedBoost = post.pinned ? 6 : 0;
  const mediaBoost = sanitizePostImageUrl(post.imageUrl) ? 1.5 : 0;
  const titleBoost = post.title?.trim() ? 0.5 : 0;

  let searchBoost = 0;
  if (searchQueryLower) {
    if (post.title.toLowerCase().includes(searchQueryLower)) searchBoost += 12;
    if (authorDisplayName.toLowerCase().includes(searchQueryLower)) searchBoost += 8;
    if (post.body.toLowerCase().includes(searchQueryLower)) searchBoost += 4;
  }

  const ageHours = Math.max(0, (nowMs - getPostMillis(post, nowMs)) / 3_600_000);
  const baseScore = 2 + engagement + pinnedBoost + mediaBoost + titleBoost + searchBoost;
  return baseScore / Math.pow(ageHours + 2, 1.25);
}

type MarginNoteGenResult =
  | { ok: true; saved: boolean }
  | { ok: false; error: string; retryable: boolean };

async function generateAndSaveMarginNote(
  postId: string,
  title: string,
  body: string,
  force: boolean = false
): Promise<MarginNoteGenResult> {
  if (!title.trim() && !body.trim()) {
    if (force) {
      return {
        ok: false,
        error: 'Add post text or a link first.',
        retryable: false,
      };
    }
    return { ok: true, saved: false };
  }

  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      return {
        ok: false,
        error: 'Sign in again to generate a margin note.',
        retryable: false,
      };
    }

    const response = await fetch('/api/posts/margin-note', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ title, body, force }),
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const trimmed = rawText.trim();
    const looksLikeHtml =
      trimmed.startsWith('<') ||
      (!contentType.includes('application/json') && /<!doctype|<html/i.test(trimmed));

    let parsedBody: {
      shouldGenerate?: boolean;
      points?: unknown;
      error?: string;
      retryable?: boolean;
    } | null = null;

    if (!looksLikeHtml && trimmed) {
      try {
        parsedBody = JSON.parse(trimmed);
      } catch {
        parsedBody = null;
      }
    }

    if (!response.ok || looksLikeHtml || !parsedBody) {
      if (
        response.status === 503 ||
        /503|UNAVAILABLE|high demand|overloaded|capacity/i.test(trimmed)
      ) {
        return {
          ok: false,
          error:
            parsedBody?.error ||
            'The AI is currently being overused (high demand). Please try again in a moment.',
          retryable: true,
        };
      }

      if (response.status === 429) {
        return {
          ok: false,
          error:
            parsedBody?.error ||
            'The AI rate limit was reached right now. Please try again shortly.',
          retryable: true,
        };
      }

      if (looksLikeHtml) {
        return {
          ok: false,
          error: `Backend returned HTML instead of JSON (HTTP ${response.status}) — the API server may be restarting or unavailable on this URL.`,
          retryable: true,
        };
      }

      return {
        ok: false,
        error:
          parsedBody?.error ||
          `The AI service returned an unexpected response (HTTP ${response.status}).`,
        retryable:
          typeof parsedBody?.retryable === 'boolean'
            ? parsedBody.retryable
            : response.status >= 500,
      };
    }

    const data = parsedBody;

    if (!data?.shouldGenerate || !Array.isArray(data.points)) {
      return { ok: true, saved: false };
    }

    const cleanPoints = data.points
      .filter((item): item is string => typeof item === 'string')
      .map((line) => line.trim().slice(0, LIMITS.MARGIN_NOTE_POINT_MAX))
      .filter(Boolean)
      .slice(0, LIMITS.MARGIN_NOTE_POINTS_MAX);

    if (cleanPoints.length === 0) {
      return { ok: true, saved: false };
    }

    await updateDoc(doc(db, 'posts', postId), {
      marginNote: { points: cleanPoints },
      updatedAt: serverTimestamp(),
    });
    return { ok: true, saved: true };
  } catch (err) {
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Margin note request failed unexpectedly.';
    console.warn('Margin note evaluation error:', message);
    return {
      ok: false,
      error: message,
      retryable: true,
    };
  }
}

function buildTweetFromPost(
  post: TeamPost,
  authorName: string,
  authorPhotoUrl?: string
): Tweet {
  const text = post.body || '';
  const totalCodePoints = Array.from(text).length;

  const urls: NonNullable<Tweet['entities']>['urls'] = [];
  const hashtags: NonNullable<Tweet['entities']>['hashtags'] = [];
  const userMentions: NonNullable<Tweet['entities']>['user_mentions'] = [];

  const tokenRegex = /(https?:\/\/[^\s<>"']+)|(^|\s)(#[a-zA-Z0-9_]{1,50})|(^|[\s(<"'])(@[a-zA-Z0-9_]{1,30})/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match[1]) {
      const rawUrl = match[1];
      const start = Array.from(text.slice(0, match.index)).length;
      const end = start + Array.from(rawUrl).length;
      let displayUrl = rawUrl.replace(/^https?:\/\//i, '');
      if (displayUrl.length > 36) {
        displayUrl = `${displayUrl.slice(0, 33)}...`;
      }
      urls.push({
        indices: [start, end],
        url: rawUrl,
        expanded_url: rawUrl,
        display_url: displayUrl,
      });
    } else if (match[3]) {
      const prefixLen = match[2] ? match[2].length : 0;
      const tagToken = match[3];
      const start = Array.from(text.slice(0, match.index + prefixLen)).length;
      const end = start + Array.from(tagToken).length;
      hashtags.push({
        indices: [start, end],
        text: tagToken.slice(1),
      });
    } else if (match[5]) {
      const prefixLen = match[4] ? match[4].length : 0;
      const mentionToken = match[5];
      const start = Array.from(text.slice(0, match.index + prefixLen)).length;
      const end = start + Array.from(mentionToken).length;
      const handle = mentionToken.slice(1);
      userMentions.push({
        indices: [start, end],
        id_str: handle,
        name: handle,
        screen_name: handle,
      });
    }
  }

  const createdDate =
    typeof post.createdAt?.toDate === 'function'
      ? post.createdAt.toDate()
      : post.createdAt
        ? new Date(post.createdAt)
        : new Date();

  const screenName = getMentionHandle(authorName);

  return {
    __typename: 'Tweet',
    lang: 'en',
    created_at: createdDate.toISOString(),
    display_text_range: [0, totalCodePoints],
    id_str: post.id,
    text,
    favorite_count: post.likeCount || 0,
    conversation_count: post.replyCount || 0,
    news_action_type: 'conversation',
    isEdited: false,
    isStaleEdit: false,
    edit_control: {
      edit_tweet_ids: [post.id],
      editable_until_msecs: '0',
      is_edit_eligible: false,
      edits_remaining: '0',
    },
    entities: {
      hashtags,
      urls,
      user_mentions: userMentions,
      symbols: [],
    },
    user: {
      id_str: post.authorId,
      name: authorName,
      screen_name: screenName,
      profile_image_url_https: authorPhotoUrl || '',
      profile_image_shape: 'Circle',
      verified: true,
      is_blue_verified: false,
    },
  };
}

function renderCommentRichText(
  text: string,
  membersByHandle: Record<string, TeamMember>,
  onOpenDm: (targetUid: string) => void
): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const regex = /(https?:\/\/[^\s<>"']+)|(^|[\s(<"'])(@[a-zA-Z0-9_]{1,30})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      if (match.index > lastIndex) {
        nodes.push(text.slice(lastIndex, match.index));
      }
      const rawUrl = match[1];
      const cleanedHref = rawUrl.replace(/[.,!?;:)\]]+$/g, '');
      const trailing = rawUrl.slice(cleanedHref.length);
      nodes.push(
        <React.Fragment key={`url-${keyIdx++}`}>
          <a
            href={cleanedHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#b5b4ad] hover:text-white underline underline-offset-2 transition-colors"
          >
            {cleanedHref}
          </a>
          {trailing}
        </React.Fragment>
      );
      lastIndex = match.index + rawUrl.length;
    } else if (match[3]) {
      const prefix = match[2] || '';
      const mentionToken = match[3];
      const mentionStart = match.index + prefix.length;
      if (mentionStart > lastIndex) {
        nodes.push(text.slice(lastIndex, mentionStart));
      }
      const targetMember = resolveMentionedMember(mentionToken, membersByHandle);
      if (targetMember) {
        nodes.push(
          <button
            key={`mention-${keyIdx++}`}
            type="button"
            onClick={() => onOpenDm(targetMember.uid)}
            title={`Message ${targetMember.displayName}`}
            className="inline text-[#f2c46d] hover:text-[#fbd88c] hover:underline underline-offset-2 font-medium transition-colors cursor-pointer"
          >
            {mentionToken}
          </button>
        );
      } else {
        nodes.push(
          <span key={`mention-${keyIdx++}`} className="text-[#f2c46d] font-medium">
            {mentionToken}
          </span>
        );
      }
      lastIndex = mentionStart + mentionToken.length;
    }
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

interface PostCardProps {
  post: TeamPost;
  currentMember: TeamMember;
  members: TeamMember[];
  membersById: Record<string, TeamMember>;
  membersByHandle: Record<string, TeamMember>;
  supervisorIds: Set<string>;
  isSupervisor: boolean;
  marginNoteStatus?: MarginNoteRequestStatus;
  onRequestMarginNote: (force: boolean) => void;
  onDismissMarginNoteStatus: () => void;
  onCopyText: (text: string, label: string) => void;
  onOpenDm: (targetUid: string) => void;
  onNotify: (msg: string) => void;
}

const PostCard: React.FC<PostCardProps> = ({
  post,
  currentMember,
  members,
  membersById,
  membersByHandle,
  supervisorIds,
  isSupervisor,
  marginNoteStatus,
  onRequestMarginNote,
  onDismissMarginNoteStatus,
  onCopyText,
  onOpenDm,
  onNotify,
}) => {
  const [hasLiked, setHasLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [isThreadOpen, setIsThreadOpen] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [replyMentionQuery, setReplyMentionQuery] = useState<ActiveMentionQuery | null>(
    null
  );
  const [replyMentionIndex, setReplyMentionIndex] = useState(0);
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [removingMarginNote, setRemovingMarginNote] = useState(false);

  const replyInputRef = useRef<HTMLInputElement | null>(null);

  const isAuthor = post.authorId === currentMember.uid;
  const canModeratePost = isAuthor || isSupervisor;
  const isArchived = post.stageStatus === 'archived';
  const canRemoveMarginNote = isSupervisor || (isAuthor && !isArchived);
  const authorMember = membersById[post.authorId];
  const displayAuthorName = authorMember?.displayName || post.authorName;
  const authorIsSupervisor = supervisorIds.has(post.authorId);

  const replyMentionCandidates = useMemo(() => {
    if (!replyMentionQuery) return [];
    return filterMentionCandidates(members, replyMentionQuery.query, 6);
  }, [members, replyMentionQuery]);

  useEffect(() => {
    setReplyMentionIndex(0);
  }, [replyMentionQuery?.query]);

  useEffect(() => {
    const likePath = `posts/${post.id}/likes/${currentMember.uid}`;
    const unsub = onSnapshot(
      doc(db, 'posts', post.id, 'likes', currentMember.uid),
      (snap) => {
        setHasLiked(snap.exists());
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, likePath);
      }
    );
    return () => unsub();
  }, [post.id, currentMember.uid]);

  // Always load replies so they are visible inline without clicking the Reply button
  useEffect(() => {
    setCommentsLoaded(false);
    const commentsPath = `posts/${post.id}/comments`;
    const q = query(
      collection(db, 'posts', post.id, 'comments'),
      where('teamId', 'in', [...ACCEPTED_TEAM_IDS])
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as PostComment)
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() || 0;
            const tb = b.createdAt?.toMillis?.() || 0;
            return ta - tb;
          });
        setComments(list);
        setCommentsLoaded(true);
      },
      (error) => {
        setCommentsLoaded(true);
        handleFirestoreError(error, OperationType.LIST, commentsPath);
      }
    );
    return () => unsub();
  }, [post.id]);

  const handleToggleLike = async () => {
    if (likeBusy) return;
    setLikeBusy(true);
    const batch = writeBatch(db);
    const postRef = doc(db, 'posts', post.id);
    const likeRef = doc(db, 'posts', post.id, 'likes', currentMember.uid);

    try {
      if (hasLiked) {
        batch.delete(likeRef);
        batch.update(postRef, {
          likeCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(likeRef, {
          teamId: post.teamId,
          postId: post.id,
          userId: currentMember.uid,
          createdAt: serverTimestamp(),
        });
        batch.update(postRef, {
          likeCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.WRITE,
        `posts/${post.id}/likes/${currentMember.uid}`
      );
    } finally {
      setLikeBusy(false);
    }
  };

  const handleAddReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanReply = replyText.trim().slice(0, LIMITS.COMMENT_MAX);
    if (!cleanReply || replyBusy) return;

    setReplyBusy(true);
    const batch = writeBatch(db);
    const commentRef = doc(collection(db, 'posts', post.id, 'comments'));
    const postRef = doc(db, 'posts', post.id);

    try {
      batch.set(commentRef, {
        teamId: post.teamId,
        postId: post.id,
        authorId: currentMember.uid,
        authorName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        body: cleanReply,
        createdAt: serverTimestamp(),
      });
      batch.update(postRef, {
        replyCount: increment(1),
        lastCommentId: commentRef.id,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setReplyText('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `posts/${post.id}/comments`);
    } finally {
      setReplyBusy(false);
    }
  };

  const handleTogglePin = async () => {
    if (!canModeratePost || (isArchived && !isSupervisor)) return;
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        pinned: !post.pinned,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${post.id}`);
    }
  };

  const handleDelete = async () => {
    if (!canModeratePost || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteDoc(doc(db, 'posts', post.id));
      onNotify('Post removed');
    } catch (error) {
      setDeleteBusy(false);
      handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}`);
    }
  };

  const handleRemoveMarginNote = async () => {
    if (!canRemoveMarginNote || removingMarginNote) return;
    setRemovingMarginNote(true);
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        marginNote: deleteField(),
        updatedAt: serverTimestamp(),
      });
      onNotify('Margin note removed');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${post.id}`);
    } finally {
      setRemovingMarginNote(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (deletingCommentId) return;
    setDeletingCommentId(commentId);
    const commentRef = doc(db, 'posts', post.id, 'comments', commentId);
    const postRef = doc(db, 'posts', post.id);
    try {
      if ((post.replyCount || 0) > 0) {
        const batch = writeBatch(db);
        batch.delete(commentRef);
        batch.update(postRef, {
          replyCount: increment(-1),
          lastCommentId: commentId,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } else {
        await deleteDoc(commentRef);
      }
      onNotify('Reply deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}/comments/${commentId}`);
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleSelectReplyMention = (member: TeamMember) => {
    if (!replyMentionQuery) return;
    const { nextValue, nextCursorPos } = insertMentionAtCursor(
      replyText,
      replyMentionQuery.startIndex,
      replyMentionQuery.endIndex,
      member
    );
    setReplyText(nextValue.slice(0, LIMITS.COMMENT_MAX));
    setReplyMentionQuery(null);
    window.requestAnimationFrame(() => {
      if (replyInputRef.current) {
        replyInputRef.current.focus();
        const pos = Math.min(nextCursorPos, LIMITS.COMMENT_MAX);
        replyInputRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  const handleReplyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setReplyText(val);
    setReplyMentionQuery(findActiveMentionQuery(val, cursor));
  };

  const handleReplyInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!replyMentionQuery || replyMentionCandidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setReplyMentionIndex((prev) => (prev + 1) % replyMentionCandidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setReplyMentionIndex(
        (prev) => (prev - 1 + replyMentionCandidates.length) % replyMentionCandidates.length
      );
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const target = replyMentionCandidates[replyMentionIndex] || replyMentionCandidates[0];
      if (target) handleSelectReplyMention(target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setReplyMentionQuery(null);
    }
  };

  const safeImageUrl = sanitizePostImageUrl(post.imageUrl);
  const copyPayload = post.title
    ? post.body
      ? `${post.title}\n\n${post.body}`
      : post.title
    : post.body || safeImageUrl;
  const tweetPayload = useMemo(
    () => buildTweetFromPost(post, displayAuthorName, authorMember?.photoUrl),
    [post, displayAuthorName, authorMember?.photoUrl]
  );

  const headerActions = canModeratePost ? (
    <div className="flex items-center gap-0.5 shrink-0">
      {(!isArchived || isSupervisor) && (
        <button
          type="button"
          onClick={handleTogglePin}
          className={`p-1.5 rounded-lg transition-colors ${
            post.pinned
              ? 'text-[#edece8] bg-[#242422]'
              : 'text-[#71706b] hover:text-white hover:bg-[#222220]'
          }`}
          title={
            post.pinned
              ? !isAuthor && isSupervisor
                ? 'Unpin post (Supervisor)'
                : 'Unpin post'
              : !isAuthor && isSupervisor
                ? 'Pin post (Supervisor)'
                : 'Pin post'
          }
        >
          <Pin className="w-3.5 h-3.5" />
        </button>
      )}

      {!confirmDeletePost ? (
        <button
          type="button"
          onClick={() => setConfirmDeletePost(true)}
          className="p-1.5 rounded-lg text-[#71706b] hover:text-white hover:bg-[#222220] transition-colors"
          title={!isAuthor && isSupervisor ? 'Delete post (Supervisor)' : 'Delete post'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ) : (
        <div className="flex items-center gap-1 bg-[#141413] border border-[#363632] rounded-lg px-1.5 py-0.5 text-[11px]">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteBusy}
            className="text-[#edece8] hover:text-white font-medium px-1 disabled:opacity-50"
          >
            {deleteBusy ? '...' : 'Delete'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeletePost(false)}
            className="text-[#71706b] hover:text-[#edece8] px-1"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  ) : null;

  const footerContent = (
    <>
      <div className="pt-2.5 border-t border-[#222220] flex flex-wrap items-center justify-between gap-2 text-xs text-[#8d8c85]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleLike}
            disabled={likeBusy}
            aria-pressed={hasLiked}
            title={hasLiked ? 'Remove like' : 'Like post'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
              hasLiked
                ? 'bg-[#262624] border-[#3d3d39] text-[#edece8]'
                : 'bg-[#141413] border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632]'
            }`}
          >
            <Heart
              className={`w-3.5 h-3.5 transition-colors ${
                hasLiked ? 'fill-[#edece8] text-[#edece8]' : ''
              }`}
            />
            <span className="tabular-nums">
              {post.likeCount > 0
                ? `${post.likeCount} ${post.likeCount === 1 ? 'like' : 'likes'}`
                : 'Like'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              const nextOpen = !isThreadOpen;
              setIsThreadOpen(nextOpen);
              if (nextOpen) {
                window.setTimeout(() => replyInputRef.current?.focus(), 40);
              }
            }}
            aria-expanded={isThreadOpen}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
              isThreadOpen
                ? 'bg-[#262624] border-[#3d3d39] text-white'
                : 'bg-[#141413] border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632]'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              {post.replyCount > 0
                ? `${post.replyCount} ${post.replyCount === 1 ? 'reply' : 'replies'}`
                : 'Reply'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onCopyText(copyPayload, 'Post copied')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141413] border border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632] transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy</span>
          </button>

          {!(post.marginNote && Array.isArray(post.marginNote.points) && post.marginNote.points.length > 0) &&
            Boolean(post.title?.trim() || post.body?.trim()) &&
            (!isArchived || isSupervisor) && (
              <button
                type="button"
                onClick={() => onRequestMarginNote(true)}
                disabled={marginNoteStatus?.status === 'generating'}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141413] border border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632] disabled:opacity-50 transition-colors"
                title="Add a margin note to this post"
              >
                {marginNoteStatus?.status === 'generating' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <StickyNote className="w-3.5 h-3.5" />
                )}
                <span>
                  {marginNoteStatus?.status === 'generating'
                    ? 'Adding...'
                    : 'Margin note'}
                </span>
              </button>
            )}
        </div>

        {authorMember && (
          <button
            type="button"
            onClick={() => onOpenDm(post.authorId)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141413] border border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632] transition-colors"
            title={isAuthor ? 'Open private notes' : `Send private message to ${displayAuthorName}`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isAuthor ? 'Notes' : 'Message'}</span>
          </button>
        )}
      </div>

      {((!commentsLoaded && (post.replyCount || 0) > 0) || comments.length > 0 || isThreadOpen) && (
        <div className="pt-2.5 space-y-3 border-t border-[#222220]">
          {!commentsLoaded && (post.replyCount || 0) > 0 ? (
            <div className="text-[11px] text-[#71706b] px-1">Loading replies...</div>
          ) : comments.length === 0 ? (
            isThreadOpen && (
              <div className="text-[11px] text-[#71706b] px-1">
                No replies yet. Add the first reply below.
              </div>
            )
          ) : (
            <div className="space-y-2.5 pl-3 border-l border-[#2a2a27]">
              {comments.map((comment) => {
                const commentMember = membersById[comment.authorId];
                const commentName = commentMember?.displayName || comment.authorName;
                const isOwnComment = comment.authorId === currentMember.uid;
                const canDeleteComment = isOwnComment || isAuthor || isSupervisor;
                const commentIsSupervisor = supervisorIds.has(comment.authorId);
                const isDeletingThis = deletingCommentId === comment.id;
                return (
                  <div key={comment.id} className="group space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Avatar
                          name={commentName}
                          photoUrl={commentMember?.photoUrl}
                          size="xs"
                        />
                        <span className="font-medium text-[#edece8] truncate">
                          {commentName}
                        </span>
                        {commentIsSupervisor && <SupervisorBadge compact />}
                        <span className="text-[#5c5b56] shrink-0 tabular-nums">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                      </div>
                      {canDeleteComment && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(comment.id)}
                          disabled={isDeletingThis}
                          className="p-1 rounded text-[#71706b] hover:text-white hover:bg-[#222220] disabled:opacity-40 transition-colors shrink-0"
                          title={
                            !isOwnComment && isSupervisor
                              ? 'Delete reply (Supervisor)'
                              : 'Delete reply'
                          }
                          aria-label="Delete reply"
                        >
                          {isDeletingThis ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </button>
                      )}
                    </div>
                    <p className="text-[#c9c8c2] leading-relaxed whitespace-pre-wrap pl-7">
                      {renderCommentRichText(comment.body, membersByHandle, onOpenDm)}
                    </p>
                    {(() => {
                      const commentYt = extractYouTubeLinks(comment.body, 2);
                      if (commentYt.length === 0) return null;
                      return (
                        <div className="pl-7 pt-1 flex flex-wrap gap-2">
                          {commentYt.map((preview) => (
                            <YouTubeThumbnailCard
                              key={preview.videoId}
                              preview={preview}
                              compact
                            />
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}

          {isThreadOpen && (
            <form onSubmit={handleAddReply} className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  ref={replyInputRef}
                  type="text"
                  value={replyText}
                  onChange={handleReplyInputChange}
                  onKeyDown={handleReplyInputKeyDown}
                  onClick={(e) => {
                    const cursor = e.currentTarget.selectionStart ?? replyText.length;
                    setReplyMentionQuery(findActiveMentionQuery(replyText, cursor));
                  }}
                  maxLength={LIMITS.COMMENT_MAX}
                  placeholder="Write a reply... (use @ to mention)"
                  className="w-full bg-[#141413] border border-[#2a2a27] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#686761] outline-none focus:border-[#4d4d48] transition-colors"
                />
                {replyMentionQuery && replyMentionCandidates.length > 0 && (
                  <MentionSuggestions
                    candidates={replyMentionCandidates}
                    highlightedIndex={replyMentionIndex}
                    supervisorIds={supervisorIds}
                    placement="above"
                    onHoverIndex={setReplyMentionIndex}
                    onSelect={handleSelectReplyMention}
                  />
                )}
              </div>
              <button
                type="submit"
                disabled={replyBusy || !replyText.trim()}
                className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] disabled:bg-[#262624] disabled:text-[#5e5d58] text-black text-xs font-medium transition-colors shrink-0"
              >
                {replyBusy ? '...' : 'Reply'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );

  const activeMarginNote =
    post.marginNote && Array.isArray(post.marginNote.points) && post.marginNote.points.length > 0
      ? post.marginNote
      : null;

  return (
    <div className="min-[1120px]:grid min-[1120px]:grid-cols-[minmax(0,640px)_minmax(288px,368px)] min-[1120px]:items-start">
      <div className="min-w-0">
        <TweetCard
          tweet={tweetPayload}
          logo="closer"
          title={post.title || undefined}
          imageUrl={safeImageUrl || null}
          timestamp={formatRelativeTime(post.createdAt)}
          pinned={post.pinned}
          authorBadge={authorIsSupervisor ? <SupervisorBadge compact /> : undefined}
          headerActions={headerActions}
          footer={footerContent}
          onAuthorClick={authorMember ? () => onOpenDm(post.authorId) : undefined}
          onMentionClick={(handle) => {
            const target = resolveMentionedMember(handle, membersByHandle);
            if (target) {
              onOpenDm(target.uid);
            }
          }}
        />
        {activeMarginNote ? (
          <MobileMarginNote
            marginNote={activeMarginNote}
            canRemove={canRemoveMarginNote}
            removing={removingMarginNote}
            onCopyText={onCopyText}
            onRemove={handleRemoveMarginNote}
          />
        ) : (
          marginNoteStatus && (
            <MobileMarginNoteStatus
              requestState={marginNoteStatus}
              onRetry={() => onRequestMarginNote(Boolean(marginNoteStatus.force))}
              onDismiss={onDismissMarginNoteStatus}
            />
          )
        )}
      </div>

      {activeMarginNote ? (
        <DesktopMarginNote
          marginNote={activeMarginNote}
          canRemove={canRemoveMarginNote}
          removing={removingMarginNote}
          onCopyText={onCopyText}
          onRemove={handleRemoveMarginNote}
        />
      ) : (
        marginNoteStatus && (
          <DesktopMarginNoteStatus
            requestState={marginNoteStatus}
            onRetry={() => onRequestMarginNote(Boolean(marginNoteStatus.force))}
            onDismiss={onDismissMarginNoteStatus}
          />
        )
      )}
    </div>
  );
};

export const TeamFeedView: React.FC<TeamFeedViewProps> = ({
  currentMember,
  members,
  supervisorIds,
  isSupervisor,
  composerRef,
  composerOpenNonce = 0,
  onCopyText,
  onOpenDm,
  onNotify,
  notificationsEnabled,
  onOpenNotificationSettings,
  posts,
  isLoadingPosts,
}) => {
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedFilter, setFeedFilter] = useState<FeedFilterMode>('all');
  const [sortBy, setSortBy] = useState<FeedSortMode>('recent');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [composerMentionQuery, setComposerMentionQuery] =
    useState<ActiveMentionQuery | null>(null);
  const [composerMentionIndex, setComposerMentionIndex] = useState(0);
  const [marginNoteStateByPostId, setMarginNoteStateByPostId] = useState<
    Record<string, MarginNoteRequestStatus>
  >({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  const handleRequestMarginNote = async (
    postId: string,
    postTitle: string,
    postBody: string,
    force: boolean
  ) => {
    if (force) {
      setMarginNoteStateByPostId((prev) => ({
        ...prev,
        [postId]: { status: 'generating', force: true },
      }));
    } else {
      setMarginNoteStateByPostId((prev) => {
        if (!prev[postId]) return prev;
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }

    const result = await generateAndSaveMarginNote(postId, postTitle, postBody, force);

    if (result.ok) {
      if (!result.saved && force) {
        setMarginNoteStateByPostId((prev) => ({
          ...prev,
          [postId]: {
            status: 'error',
            message: 'Could not extract a margin note from this post.',
            retryable: true,
            force: true,
          },
        }));
        return;
      }

      setMarginNoteStateByPostId((prev) => {
        if (!prev[postId]) return prev;
        const next = { ...prev };
        delete next[postId];
        return next;
      });

      if (result.saved && force) {
        onNotify('Margin note added');
      }
      return;
    }

    setMarginNoteStateByPostId((prev) => ({
      ...prev,
      [postId]: {
        status: 'error',
        message: result.error,
        retryable: result.retryable,
        force,
      },
    }));
  };

  const handleDismissMarginNoteStatus = (postId: string) => {
    setMarginNoteStateByPostId((prev) => {
      if (!prev[postId]) return prev;
      const next = { ...prev };
      delete next[postId];
      return next;
    });
  };

  useEffect(() => {
    if (composerOpenNonce > 0) {
      setIsComposerOpen(true);
      window.setTimeout(() => {
        composerRef.current?.focus();
      }, 40);
    }
  }, [composerOpenNonce, composerRef]);

  useEffect(() => {
    if (!isSortMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(event.target as Node)
      ) {
        setIsSortMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSortMenuOpen]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const membersById = useMemo(() => {
    const map: Record<string, TeamMember> = {};
    for (const m of members) {
      map[m.uid] = m;
    }
    return map;
  }, [members]);

  const membersByHandle = useMemo(() => buildMembersByMentionHandle(members), [members]);

  const composerMentionCandidates = useMemo(() => {
    if (!composerMentionQuery) return [];
    return filterMentionCandidates(members, composerMentionQuery.query, 6);
  }, [members, composerMentionQuery]);

  useEffect(() => {
    setComposerMentionIndex(0);
  }, [composerMentionQuery?.query]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadError(null);

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (PNG, JPG, WebP, or GIF).');
      return;
    }
    if (file.size > MAX_POST_IMAGE_BYTES) {
      setUploadError('Image is too large (max 15 MB).');
      return;
    }

    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }

    setSelectedImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
  };

  const handleClearSelectedImage = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePublish = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanBody = body.trim().slice(0, LIMITS.BODY_MAX);
    if ((!cleanBody && !selectedImageFile) || submitting || isUploadingImage) return;

    setUploadError(null);
    setSubmitting(true);

    let uploadedImageUrl: string | null = null;

    if (selectedImageFile) {
      setIsUploadingImage(true);
      try {
        uploadedImageUrl = await uploadPostImageToCloudinary(selectedImageFile);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to upload image. Please try again.';
        setUploadError(message);
        setIsUploadingImage(false);
        setSubmitting(false);
        return;
      }
      setIsUploadingImage(false);
    }

    const cleanTitle = title.trim().slice(0, LIMITS.TITLE_MAX);
    const postRef = doc(collection(db, 'posts'));

    try {
      await setDoc(postRef, {
        teamId: TEAM_ID,
        authorId: currentMember.uid,
        authorName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        category: 'post',
        title: cleanTitle,
        body: cleanBody,
        imageUrl: uploadedImageUrl,
        lane: '',
        equipment: '',
        loadsPerWeek: '',
        stageStatus: 'open',
        pinned: false,
        replyCount: 0,
        likeCount: 0,
        lastCommentId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setTitle('');
      setBody('');
      handleClearSelectedImage();
      setIsComposerOpen(false);
      onNotify('Post shared');

      void handleRequestMarginNote(postRef.id, cleanTitle, cleanBody, false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `posts/${postRef.id}`);
    } finally {
      setSubmitting(false);
      setIsUploadingImage(false);
    }
  };

  const handleSelectComposerMention = (member: TeamMember) => {
    if (!composerMentionQuery) return;
    const { nextValue, nextCursorPos } = insertMentionAtCursor(
      body,
      composerMentionQuery.startIndex,
      composerMentionQuery.endIndex,
      member
    );
    setBody(nextValue.slice(0, LIMITS.BODY_MAX));
    setComposerMentionQuery(null);
    window.requestAnimationFrame(() => {
      if (composerRef.current) {
        composerRef.current.focus();
        const pos = Math.min(nextCursorPos, LIMITS.BODY_MAX);
        composerRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  const handleInsertAtTrigger = () => {
    const el = composerRef.current;
    const cursor = el?.selectionStart ?? body.length;
    const before = body.slice(0, cursor);
    const after = body.slice(cursor);
    const needsLeadingSpace = before.length > 0 && !/[\s(["']$/.test(before);
    const inserted = `${needsLeadingSpace ? ' ' : ''}@`;
    const nextValue = `${before}${inserted}${after}`.slice(0, LIMITS.BODY_MAX);
    const nextCursor = Math.min(before.length + inserted.length, nextValue.length);
    setBody(nextValue);
    setComposerMentionQuery(findActiveMentionQuery(nextValue, nextCursor));
    window.requestAnimationFrame(() => {
      if (composerRef.current) {
        composerRef.current.focus();
        composerRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart ?? val.length;
    setBody(val);
    setComposerMentionQuery(findActiveMentionQuery(val, cursor));
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composerMentionQuery && composerMentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setComposerMentionIndex((prev) => (prev + 1) % composerMentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setComposerMentionIndex(
          (prev) =>
            (prev - 1 + composerMentionCandidates.length) %
            composerMentionCandidates.length
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const target =
          composerMentionCandidates[composerMentionIndex] || composerMentionCandidates[0];
        if (target) handleSelectComposerMention(target);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setComposerMentionQuery(null);
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handlePublish();
    }
  };

  const pinnedCount = useMemo(() => posts.filter((p) => p.pinned).length, [posts]);
  const imagePostCount = useMemo(
    () => posts.filter((p) => Boolean(sanitizePostImageUrl(p.imageUrl))).length,
    [posts]
  );

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const nowMs = Date.now();

    return posts
      .filter((p) => {
        if (feedFilter === 'pinned' && !p.pinned) return false;
        if (feedFilter === 'images' && !sanitizePostImageUrl(p.imageUrl)) return false;
        if (!q) return true;
        const liveAuthor = membersById[p.authorId]?.displayName || p.authorName;
        return (
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          liveAuthor.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ta = getPostMillis(a, nowMs);
        const tb = getPostMillis(b, nowMs);

        if (sortBy === 'relevant') {
          const authorA = membersById[a.authorId]?.displayName || a.authorName;
          const authorB = membersById[b.authorId]?.displayName || b.authorName;
          const scoreDiff =
            scorePostRelevance(b, nowMs, q, authorB) -
            scorePostRelevance(a, nowMs, q, authorA);
          if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
          return tb - ta;
        }

        if (sortBy === 'interactions') {
          const totalA = (a.likeCount || 0) + (a.replyCount || 0);
          const totalB = (b.likeCount || 0) + (b.replyCount || 0);
          if (totalB !== totalA) return totalB - totalA;
          if ((b.replyCount || 0) !== (a.replyCount || 0)) {
            return (b.replyCount || 0) - (a.replyCount || 0);
          }
          return tb - ta;
        }

        if (sortBy === 'likes') {
          const likesDiff = (b.likeCount || 0) - (a.likeCount || 0);
          if (likesDiff !== 0) return likesDiff;
          return tb - ta;
        }

        if (sortBy === 'replies') {
          const repliesDiff = (b.replyCount || 0) - (a.replyCount || 0);
          if (repliesDiff !== 0) return repliesDiff;
          return tb - ta;
        }

        // 'recent': keep pinned posts anchored at top, then newest first
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return tb - ta;
      });
  }, [posts, searchQuery, feedFilter, sortBy, membersById]);

  const activeSortOption =
    SORT_OPTIONS.find((option) => option.id === sortBy) || SORT_OPTIONS[0];

  const handleOpenComposer = () => {
    setIsComposerOpen(true);
    window.setTimeout(() => {
      composerRef.current?.focus();
    }, 40);
  };

  const hasDraft = Boolean(title.trim() || body.trim() || selectedImageFile);
  const composerYoutubePreviews = useMemo(
    () => extractYouTubeLinks([title, body].filter(Boolean).join(' '), 2),
    [title, body]
  );

  return (
    <div className="w-full max-w-[1060px] py-6 sm:py-8 px-4 sm:px-6 space-y-5 font-['Inter']">
      {/* Search + Alerts + New Post (aligned to left post column width) */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full max-w-[640px]">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search posts..."
            className="w-full bg-[#191918] border border-[#262624] rounded-xl pl-8 pr-7 py-2 text-xs text-white placeholder-[#71706b] outline-none focus:border-[#42423e] transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71706b] hover:text-white"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenNotificationSettings}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs transition-colors shrink-0 whitespace-nowrap ${
            notificationsEnabled
              ? 'bg-[#191918] border-[#262624] text-[#edece8] hover:border-[#3d3d39]'
              : 'bg-[#141413] border-[#262624] text-[#71706b] hover:text-white hover:border-[#363632]'
          }`}
          title="Edit post notification & sound settings"
        >
          {notificationsEnabled ? (
            <Bell className="w-3.5 h-3.5" />
          ) : (
            <BellOff className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">
            {notificationsEnabled ? 'Alerts' : 'Muted'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (isComposerOpen) {
              setIsComposerOpen(false);
            } else {
              handleOpenComposer();
            }
          }}
          aria-expanded={isComposerOpen}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors shrink-0 whitespace-nowrap ${
            isComposerOpen
              ? 'bg-[#262624] border border-[#3d3d39] text-white hover:bg-[#2f2f2c]'
              : 'bg-white hover:bg-[#e0dfd9] text-black border border-transparent'
          }`}
          title={isComposerOpen ? 'Close post composer' : 'Write a new post'}
        >
          {isComposerOpen ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          <span>{isComposerOpen ? 'Close' : hasDraft ? 'Resume draft' : 'New post'}</span>
        </button>
      </div>

      {/* Main Feed Workspace */}
      <div className="min-w-0 w-full space-y-4">
        {isComposerOpen && (
          <form
            onSubmit={handlePublish}
            className="w-full max-w-[640px] bg-[#191918] border border-[#2a2a27] rounded-2xl p-4 focus-within:border-[#42423e] transition-colors space-y-2.5"
          >
              <div className="flex items-center justify-between gap-2 pb-1">
                <span className="text-xs font-medium text-[#edece8]">New post</span>
                <button
                  type="button"
                  onClick={() => setIsComposerOpen(false)}
                  disabled={submitting || isUploadingImage}
                  className="p-1 rounded-lg text-[#71706b] hover:text-white hover:bg-[#242422] disabled:opacity-50 transition-colors"
                  title="Close composer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={LIMITS.TITLE_MAX}
                placeholder="Title (optional)"
                className="w-full bg-transparent border-b border-[#242422] pb-2 px-1 text-sm font-medium text-white placeholder-[#686761] outline-none focus:border-[#3d3d39] font-['Inter'] transition-colors"
              />

              <div className="relative">
                <textarea
                  ref={composerRef}
                  value={body}
                  onChange={handleComposerChange}
                  onKeyDown={handleComposerKeyDown}
                  onClick={(e) => {
                    const cursor = e.currentTarget.selectionStart ?? body.length;
                    setComposerMentionQuery(findActiveMentionQuery(body, cursor));
                  }}
                  maxLength={LIMITS.BODY_MAX}
                  placeholder="Share an update, win, or note with the team... (use @ to mention)"
                  rows={3}
                  disabled={submitting || isUploadingImage}
                  className="w-full bg-transparent text-sm text-white placeholder-[#71706b] outline-none resize-none px-1 pt-0.5 leading-relaxed font-['Inter'] disabled:opacity-60"
                />
                {composerMentionQuery && composerMentionCandidates.length > 0 && (
                  <MentionSuggestions
                    candidates={composerMentionCandidates}
                    highlightedIndex={composerMentionIndex}
                    supervisorIds={supervisorIds}
                    placement="below"
                    onHoverIndex={setComposerMentionIndex}
                    onSelect={handleSelectComposerMention}
                  />
                )}
              </div>

              {composerYoutubePreviews.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {composerYoutubePreviews.map((preview) => (
                    <YouTubeThumbnailCard
                      key={preview.videoId}
                      preview={preview}
                      compact
                    />
                  ))}
                </div>
              )}

              {imagePreviewUrl && (
                <div className="relative w-fit max-w-full rounded-xl border border-[#2a2a27] bg-[#141413] p-2">
                  <div className="flex items-center justify-between gap-3 pb-1.5 px-1">
                    <span className="text-[11px] text-[#8d8c85] truncate max-w-[200px]">
                      {selectedImageFile?.name || 'Attached image'}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearSelectedImage}
                      disabled={submitting || isUploadingImage}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#191918] border border-[#2a2a27] text-[11px] text-[#b5b4ad] hover:text-white hover:border-[#3d3d39] disabled:opacity-50 transition-colors shrink-0"
                      title="Remove attached image"
                    >
                      <X className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-lg bg-[#0f0f0e] border border-[#222220] inline-flex items-center justify-center">
                    <img
                      src={imagePreviewUrl}
                      alt="Selected post attachment preview"
                      className="max-h-36 w-auto max-w-[280px] object-contain"
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#4a2c2c] bg-[#1e1515] px-3 py-2 text-xs text-[#e5a4a4]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{uploadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadError(null)}
                    className="p-0.5 rounded text-[#c98b8b] hover:text-white shrink-0"
                    title="Dismiss error"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#222220] px-1">
                <div className="flex items-center gap-2 text-[11px] text-[#71706b] min-w-0">
                  <Avatar
                    name={currentMember.displayName}
                    photoUrl={currentMember.photoUrl}
                    size="xs"
                  />
                  <span className="truncate hidden sm:inline">
                    {currentMember.displayName} · Ctrl/Cmd+Enter
                  </span>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    disabled={submitting || isUploadingImage}
                    aria-label="Attach image to post"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={submitting || isUploadingImage}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors shrink-0 disabled:opacity-50 ${
                      selectedImageFile
                        ? 'bg-[#242422] border-[#3d3d39] text-[#edece8]'
                        : 'bg-[#141413] border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632]'
                    }`}
                    title="Attach an image"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>{selectedImageFile ? 'Change image' : 'Image'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleInsertAtTrigger}
                    disabled={submitting || isUploadingImage}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border bg-[#141413] border-[#262624] text-[#9c9a92] hover:text-white hover:border-[#363632] text-xs transition-colors shrink-0 disabled:opacity-50"
                    title="Mention a closer (@)"
                  >
                    <AtSign className="w-3.5 h-3.5" />
                    <span>Mention</span>
                  </button>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {body.length > 0 && (
                    <span className="text-[11px] text-[#71706b] tabular-nums">
                      {body.length}/{LIMITS.BODY_MAX}
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      isUploadingImage ||
                      (!body.trim() && !selectedImageFile)
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] active:scale-[0.98] disabled:bg-[#262624] disabled:text-[#5e5d58] text-black text-xs font-medium transition-all shrink-0"
                    title="Share post"
                  >
                    {submitting || isUploadingImage ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowUp className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isUploadingImage
                        ? 'Uploading...'
                        : submitting
                          ? 'Posting...'
                          : 'Post'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Feed Filter Tabs + Side Sort Selector */}
          {!isLoadingPosts && posts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 w-full max-w-[640px]">
              <div className="inline-flex items-center p-0.5 bg-[#191918] border border-[#262624] rounded-xl">
                <button
                  type="button"
                  onClick={() => setFeedFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 ${
                    feedFilter === 'all'
                      ? 'bg-[#262624] text-white font-medium'
                      : 'text-[#8d8c85] hover:text-[#edece8]'
                  }`}
                >
                  All posts
                </button>
                <button
                  type="button"
                  onClick={() => setFeedFilter('pinned')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    feedFilter === 'pinned'
                      ? 'bg-[#262624] text-white font-medium'
                      : 'text-[#8d8c85] hover:text-[#edece8]'
                  }`}
                >
                  Pinned{pinnedCount > 0 ? ` (${pinnedCount})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setFeedFilter('images')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    feedFilter === 'images'
                      ? 'bg-[#262624] text-white font-medium'
                      : 'text-[#8d8c85] hover:text-[#edece8]'
                  }`}
                >
                  Images{imagePostCount > 0 ? ` (${imagePostCount})` : ''}
                </button>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="relative" ref={sortMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsSortMenuOpen((prev) => !prev)}
                    aria-expanded={isSortMenuOpen}
                    aria-haspopup="listbox"
                    title={activeSortOption.title}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#191918] border border-[#262624] hover:border-[#3d3d39] text-xs text-[#edece8] transition-colors whitespace-nowrap shrink-0"
                  >
                    <ArrowUpDown className="w-3 h-3 text-[#8d8c85]" />
                    <span className="text-[#8d8c85]">Sort:</span>
                    <span className="font-medium text-white">{activeSortOption.label}</span>
                    <ChevronDown
                      className={`w-3 h-3 text-[#71706b] transition-transform ${
                        isSortMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {isSortMenuOpen && (
                    <div
                      role="listbox"
                      aria-label="Sort posts by"
                      className="absolute right-0 mt-1.5 w-48 z-30 rounded-xl border border-[#2c2c29] bg-[#191918] p-1 shadow-xl"
                    >
                      {SORT_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          role="option"
                          aria-selected={sortBy === option.id}
                          onClick={() => {
                            setSortBy(option.id);
                            setIsSortMenuOpen(false);
                          }}
                          title={option.title}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors whitespace-nowrap ${
                            sortBy === option.id
                              ? 'bg-[#262624] text-white font-medium'
                              : 'text-[#b5b4ad] hover:bg-[#222220] hover:text-white'
                          }`}
                        >
                          <span>{option.label}</span>
                          {sortBy === option.id && (
                            <Check className="w-3 h-3 text-[#edece8] shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <span className="text-[11px] text-[#71706b] tabular-nums whitespace-nowrap shrink-0">
                  {filteredPosts.length} {filteredPosts.length === 1 ? 'post' : 'posts'}
                </span>
              </div>
            </div>
          )}

          {/* Feed Stream (Left post column + selective tethered margin notes on right) */}
          {isLoadingPosts ? (
            <div className="space-y-3 pb-10 max-w-[640px]" aria-busy="true" aria-label="Loading posts">
              <TweetSkeleton />
              <TweetSkeleton />
              <TweetSkeleton />
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="max-w-[640px] bg-[#191918] border border-[#262624] rounded-2xl p-8 text-center space-y-2.5 animate-fade-150">
              <p className="text-sm text-[#edece8] font-medium">
                {feedFilter === 'pinned' && !searchQuery
                  ? 'No pinned posts'
                  : feedFilter === 'images' && !searchQuery
                    ? 'No image posts yet'
                    : 'No posts found'}
              </p>
              <p className="text-xs text-[#71706b]">
                {searchQuery
                  ? 'Try clearing your search query.'
                  : feedFilter === 'pinned'
                    ? 'Pin important team updates to keep them at the top.'
                    : feedFilter === 'images'
                      ? 'Posts with attached images will appear here.'
                      : 'Share the first post with the team.'}
              </p>
              {searchQuery || feedFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFeedFilter('all');
                  }}
                  className="mt-1 px-3 py-1.5 rounded-xl bg-[#141413] border border-[#2a2a27] text-xs text-[#edece8] hover:border-[#3d3d39] transition-colors"
                >
                  Show all posts
                </button>
              ) : (
                !isComposerOpen && (
                  <button
                    type="button"
                    onClick={handleOpenComposer}
                    className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] text-black text-xs font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New post</span>
                  </button>
                )
              )}
            </div>
          ) : (
            <div className="space-y-3 pb-10 animate-fade-150">
              {filteredPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentMember={currentMember}
                  members={members}
                  membersById={membersById}
                  membersByHandle={membersByHandle}
                  supervisorIds={supervisorIds}
                  isSupervisor={isSupervisor}
                  marginNoteStatus={marginNoteStateByPostId[post.id]}
                  onRequestMarginNote={(force) =>
                    void handleRequestMarginNote(
                      post.id,
                      post.title || '',
                      post.body || '',
                      force
                    )
                  }
                  onDismissMarginNoteStatus={() =>
                    handleDismissMarginNoteStatus(post.id)
                  }
                  onCopyText={onCopyText}
                  onOpenDm={onOpenDm}
                  onNotify={onNotify}
                />
              ))}
            </div>
          )}
      </div>
    </div>
  );
};
