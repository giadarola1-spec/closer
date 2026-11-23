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
  PenTool,
  ImagePlus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../firebase.ts';
import {
  TEAM_ID,
  ACCEPTED_TEAM_IDS,
  LIMITS,
  TeamMember,
  TeamPost,
  PostComment,
} from '../types/team.ts';
import { Avatar } from './Avatar.tsx';
import { TeamScratchpad } from './TeamScratchpad.tsx';
import { TweetCard, TweetSkeleton } from '@/components/ui/tweet-card';
import {
  MAX_POST_IMAGE_BYTES,
  sanitizePostImageUrl,
  uploadPostImageToCloudinary,
} from '../utils/image.ts';

interface TeamFeedViewProps {
  currentMember: TeamMember;
  members: TeamMember[];
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
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

  const tokenRegex = /(https?:\/\/[^\s<>"']+)|(^|\s)(#[a-zA-Z0-9_]{1,50})|(^|\s)(@[a-zA-Z0-9_]{1,30})/g;
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

  const screenName =
    authorName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20) || 'closer';

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

interface PostCardProps {
  post: TeamPost;
  currentMember: TeamMember;
  membersById: Record<string, TeamMember>;
  onCopyText: (text: string, label: string) => void;
  onOpenDm: (targetUid: string) => void;
  onNotify: (msg: string) => void;
}

const PostCard: React.FC<PostCardProps> = ({
  post,
  currentMember,
  membersById,
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
  const [confirmDeletePost, setConfirmDeletePost] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const isAuthor = post.authorId === currentMember.uid;
  const isArchived = post.stageStatus === 'archived';
  const authorMember = membersById[post.authorId];
  const displayAuthorName = authorMember?.displayName || post.authorName;

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

  useEffect(() => {
    if (!isThreadOpen) return;
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
  }, [isThreadOpen, post.id]);

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
    if (!isAuthor || isArchived) return;
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
    if (!isAuthor || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteDoc(doc(db, 'posts', post.id));
      onNotify('Post removed');
    } catch (error) {
      setDeleteBusy(false);
      handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}`);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteDoc(doc(db, 'posts', post.id, 'comments', commentId));
      onNotify('Reply deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}/comments/${commentId}`);
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

  const headerActions = isAuthor ? (
    <div className="flex items-center gap-0.5 shrink-0">
      {!isArchived && (
        <button
          type="button"
          onClick={handleTogglePin}
          className={`p-1.5 rounded-lg transition-colors ${
            post.pinned
              ? 'text-[#edece8] bg-[#242422]'
              : 'text-[#71706b] hover:text-white hover:bg-[#222220]'
          }`}
          title={post.pinned ? 'Unpin post' : 'Pin post'}
        >
          <Pin className="w-3.5 h-3.5" />
        </button>
      )}

      {!confirmDeletePost ? (
        <button
          type="button"
          onClick={() => setConfirmDeletePost(true)}
          className="p-1.5 rounded-lg text-[#71706b] hover:text-white hover:bg-[#222220] transition-colors"
          title="Delete post"
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
            onClick={() => setIsThreadOpen(!isThreadOpen)}
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

      {isThreadOpen && (
        <div className="pt-2.5 space-y-3 border-t border-[#222220]">
          {!commentsLoaded ? (
            <div className="text-[11px] text-[#71706b] px-1">Loading replies...</div>
          ) : comments.length === 0 ? (
            <div className="text-[11px] text-[#71706b] px-1">
              No replies yet. Add the first reply below.
            </div>
          ) : (
            <div className="space-y-2.5 pl-3 border-l border-[#2a2a27]">
              {comments.map((comment) => {
                const commentMember = membersById[comment.authorId];
                const commentName = commentMember?.displayName || comment.authorName;
                const isOwnComment = comment.authorId === currentMember.uid;
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
                        <span className="text-[#5c5b56] shrink-0 tabular-nums">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                      </div>
                      {isOwnComment && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(comment.id)}
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded text-[#71706b] hover:text-white hover:bg-[#222220] transition-opacity shrink-0"
                          title="Delete reply"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-[#c9c8c2] leading-relaxed whitespace-pre-wrap pl-7">
                      {comment.body}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <form onSubmit={handleAddReply} className="flex items-center gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              maxLength={LIMITS.COMMENT_MAX}
              placeholder="Write a reply..."
              className="flex-1 bg-[#141413] border border-[#2a2a27] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#686761] outline-none focus:border-[#4d4d48] transition-colors"
            />
            <button
              type="submit"
              disabled={replyBusy || !replyText.trim()}
              className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] disabled:bg-[#262624] disabled:text-[#5e5d58] text-black text-xs font-medium transition-colors shrink-0"
            >
              {replyBusy ? '...' : 'Reply'}
            </button>
          </form>
        </div>
      )}
    </>
  );

  return (
    <TweetCard
      tweet={tweetPayload}
      logo="closer"
      title={post.title || undefined}
      imageUrl={safeImageUrl || null}
      timestamp={formatRelativeTime(post.createdAt)}
      pinned={post.pinned}
      headerActions={headerActions}
      footer={footerContent}
      onAuthorClick={authorMember ? () => onOpenDm(post.authorId) : undefined}
    />
  );
};

export const TeamFeedView: React.FC<TeamFeedViewProps> = ({
  currentMember,
  members,
  composerRef,
  onCopyText,
  onOpenDm,
  onNotify,
  notificationsEnabled,
  onOpenNotificationSettings,
  posts,
  isLoadingPosts,
}) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedFilter, setFeedFilter] = useState<'all' | 'pinned'>('all');
  const [isBoardOpen, setIsBoardOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

    const postRef = doc(collection(db, 'posts'));

    try {
      await setDoc(postRef, {
        teamId: TEAM_ID,
        authorId: currentMember.uid,
        authorName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        category: 'post',
        title: title.trim().slice(0, LIMITS.TITLE_MAX),
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
      onNotify('Post shared');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `posts/${postRef.id}`);
    } finally {
      setSubmitting(false);
      setIsUploadingImage(false);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handlePublish();
    }
  };

  const pinnedCount = useMemo(() => posts.filter((p) => p.pinned).length, [posts]);

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts
      .filter((p) => {
        if (feedFilter === 'pinned' && !p.pinned) return false;
        if (!q) return true;
        const liveAuthor = membersById[p.authorId]?.displayName || p.authorName;
        return (
          p.title.toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q) ||
          liveAuthor.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const ta = a.createdAt?.toMillis?.() || Date.now();
        const tb = b.createdAt?.toMillis?.() || Date.now();
        return tb - ta;
      });
  }, [posts, searchQuery, feedFilter, membersById]);

  return (
    <div className="max-w-[1040px] mx-auto py-6 sm:py-8 px-4 space-y-6 font-['Inter']">
      {/* Header + Search + Board Toggle (mobile/tablet) + Notification Settings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-['Inter'] text-2xl sm:text-3xl font-medium tracking-tight text-[#edece8] lowercase">
            closer
          </h1>
          <span className="text-xs text-[#71706b]">Team feed</span>
        </div>

        <div className="flex items-center gap-2 flex-1 sm:max-w-md justify-end">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search posts..."
              className="w-full bg-[#191918] border border-[#262624] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#71706b] outline-none focus:border-[#42423e] transition-colors"
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
            onClick={() => setIsBoardOpen(!isBoardOpen)}
            aria-expanded={isBoardOpen}
            className={`xl:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-colors shrink-0 whitespace-nowrap ${
              isBoardOpen
                ? 'bg-[#262626] border-[#3d3d39] text-white'
                : 'bg-[#191918] border-[#262624] text-[#edece8] hover:border-[#3d3d39]'
            }`}
            title="Toggle Team Scratchpad"
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Board</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotificationSettings}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-colors shrink-0 whitespace-nowrap ${
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
        </div>
      </div>

      {/* 2-Column Workspace Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,640px)_340px] gap-6 items-start justify-center">
        {/* Left Column: Composer + Filter Bar + Feed */}
        <div className="min-w-0 w-full space-y-5">
          {/* Social Post Composer (Optional Title + Post Body) */}
          <form
            onSubmit={handlePublish}
            className="bg-[#191918] border border-[#2a2a27] rounded-2xl p-4 focus-within:border-[#42423e] transition-colors space-y-2.5"
          >
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIMITS.TITLE_MAX}
              placeholder="Title (optional)"
              className="w-full bg-transparent border-b border-[#242422] pb-2 px-1 text-sm font-medium text-white placeholder-[#686761] outline-none focus:border-[#3d3d39] font-['Inter'] transition-colors"
            />

            <textarea
              ref={composerRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              maxLength={LIMITS.BODY_MAX}
              placeholder="Share an update, win, or note with the team..."
              rows={3}
              disabled={submitting || isUploadingImage}
              className="w-full bg-transparent text-sm text-white placeholder-[#71706b] outline-none resize-none px-1 pt-0.5 leading-relaxed font-['Inter'] disabled:opacity-60"
            />

            {imagePreviewUrl && (
              <div className="relative rounded-xl border border-[#2a2a27] bg-[#141413] p-2">
                <div className="flex items-center justify-between gap-2 pb-1.5 px-1">
                  <span className="text-[11px] text-[#8d8c85] truncate">
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
                <div className="overflow-hidden rounded-lg bg-[#0f0f0e] border border-[#222220] flex items-center justify-center">
                  <img
                    src={imagePreviewUrl}
                    alt="Selected post attachment preview"
                    className="max-h-60 w-auto max-w-full object-contain"
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

          {/* Feed Filter Bar */}
          {!isLoadingPosts && posts.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center p-0.5 bg-[#191918] border border-[#262624] rounded-xl">
                <button
                  type="button"
                  onClick={() => setFeedFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs transition-colors whitespace-nowrap ${
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
                  className={`px-3 py-1 rounded-lg text-xs transition-colors whitespace-nowrap tabular-nums ${
                    feedFilter === 'pinned'
                      ? 'bg-[#262624] text-white font-medium'
                      : 'text-[#8d8c85] hover:text-[#edece8]'
                  }`}
                >
                  Pinned{pinnedCount > 0 ? ` (${pinnedCount})` : ''}
                </button>
              </div>

              <span className="text-[11px] text-[#71706b] tabular-nums">
                {filteredPosts.length} {filteredPosts.length === 1 ? 'post' : 'posts'}
              </span>
            </div>
          )}

          {/* Feed Stream */}
          {isLoadingPosts ? (
            <div className="space-y-3 pb-10">
              <TweetSkeleton />
              <TweetSkeleton />
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="bg-[#191918] border border-[#262624] rounded-2xl p-8 text-center space-y-2.5">
              <p className="text-sm text-[#edece8] font-medium">
                {feedFilter === 'pinned' && !searchQuery
                  ? 'No pinned posts'
                  : 'No posts found'}
              </p>
              <p className="text-xs text-[#71706b]">
                {searchQuery
                  ? 'Try clearing your search query.'
                  : feedFilter === 'pinned'
                    ? 'Pin important team updates to keep them at the top.'
                    : 'Share the first post above with the team.'}
              </p>
              {(searchQuery || feedFilter === 'pinned') && (
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
              )}
            </div>
          ) : (
            <div className="space-y-3 pb-10">
              {filteredPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentMember={currentMember}
                  membersById={membersById}
                  onCopyText={onCopyText}
                  onOpenDm={onOpenDm}
                  onNotify={onNotify}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Sticky Team Scratchpad Drawboard */}
        <aside
          className={`order-first xl:order-last w-full xl:w-[340px] xl:sticky xl:top-8 ${
            isBoardOpen ? 'block' : 'hidden xl:block'
          }`}
        >
          <TeamScratchpad
            currentMember={currentMember}
            membersById={membersById}
            onNotify={onNotify}
          />
        </aside>
      </div>
    </div>
  );
};
