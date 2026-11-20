import React, { useState, useEffect, useMemo } from 'react';
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

interface TeamFeedViewProps {
  currentMember: TeamMember;
  members: TeamMember[];
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  onCopyText: (text: string, label: string) => void;
  onOpenDm: (targetUid: string) => void;
  onNotify: (msg: string) => void;
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
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

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
      },
      (error) => {
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
    if (!isAuthor) return;
    try {
      await deleteDoc(doc(db, 'posts', post.id));
      onNotify('Post removed');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}`);
    }
  };

  const copyPayload = post.title ? `${post.title}\n\n${post.body}` : post.body;

  return (
    <article className="bg-[#191918] border border-[#262624] rounded-2xl p-4 sm:p-5 space-y-3">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            name={displayAuthorName}
            photoUrl={authorMember?.photoUrl}
            size="sm"
          />
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-white truncate">
              {displayAuthorName}
            </span>
            <span className="text-[#5c5b56]">·</span>
            <span className="text-[#71706b] shrink-0">
              {formatRelativeTime(post.createdAt)}
            </span>
            {post.pinned && (
              <>
                <span className="text-[#5c5b56]">·</span>
                <span className="text-[#edece8] flex items-center gap-1 shrink-0">
                  <Pin className="w-3 h-3" />
                  Pinned
                </span>
              </>
            )}
          </div>
        </div>

        {isAuthor && (
          <div className="flex items-center gap-1 shrink-0">
            {!isArchived && (
              <button
                onClick={handleTogglePin}
                className="p-1.5 rounded-lg text-[#71706b] hover:text-white hover:bg-[#222220] transition-colors"
                title={post.pinned ? 'Unpin post' : 'Pin post'}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-[#71706b] hover:text-white hover:bg-[#222220] transition-colors"
              title="Delete post"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Optional Title */}
      {post.title && (
        <h3 className="text-[15px] font-medium text-white leading-snug">
          {post.title}
        </h3>
      )}

      {/* Body */}
      <div className="text-sm text-[#e0dfd9] leading-relaxed whitespace-pre-wrap">
        {post.body}
      </div>

      {/* Action Footer */}
      <div className="pt-2 border-t border-[#222220] flex flex-wrap items-center gap-1.5 text-xs text-[#8d8c85]">
        <button
          type="button"
          onClick={handleToggleLike}
          disabled={likeBusy}
          aria-pressed={hasLiked}
          title={hasLiked ? 'Remove like' : 'Like post'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
            hasLiked
              ? 'bg-[#282826] border-[#3d3d39] text-[#edece8]'
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
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors ${
            isThreadOpen
              ? 'bg-[#282826] border-[#3d3d39] text-white'
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

      {/* Expandable Comments Thread */}
      {isThreadOpen && (
        <div className="pt-2 space-y-3 border-t border-[#222220]">
          {comments.length > 0 && (
            <div className="space-y-2.5 pl-3 border-l border-[#2a2a27]">
              {comments.map((comment) => {
                const commentMember = membersById[comment.authorId];
                const commentName = commentMember?.displayName || comment.authorName;
                return (
                  <div key={comment.id} className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <Avatar
                        name={commentName}
                        photoUrl={commentMember?.photoUrl}
                        size="xs"
                      />
                      <span className="font-medium text-[#edece8]">
                        {commentName}
                      </span>
                      <span className="text-[#5c5b56]">
                        {formatRelativeTime(comment.createdAt)}
                      </span>
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
              className="flex-1 bg-[#141413] border border-[#2a2a27] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#686761] outline-none focus:border-[#4d4d48]"
            />
            <button
              type="submit"
              disabled={replyBusy || !replyText.trim()}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#e0dfd9] disabled:bg-[#262624] disabled:text-[#5e5d58] text-black text-xs font-medium transition-colors shrink-0"
            >
              {replyBusy ? '...' : 'Reply'}
            </button>
          </form>
        </div>
      )}
    </article>
  );
};

export const TeamFeedView: React.FC<TeamFeedViewProps> = ({
  currentMember,
  members,
  composerRef,
  onCopyText,
  onOpenDm,
  onNotify,
  posts,
  isLoadingPosts,
}) => {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const membersById = useMemo(() => {
    const map: Record<string, TeamMember> = {};
    for (const m of members) {
      map[m.uid] = m;
    }
    return map;
  }, [members]);

  const handlePublish = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanBody = body.trim().slice(0, LIMITS.BODY_MAX);
    if (!cleanBody || submitting) return;

    setSubmitting(true);
    const postRef = doc(collection(db, 'posts'));

    try {
      await setDoc(postRef, {
        teamId: TEAM_ID,
        authorId: currentMember.uid,
        authorName: currentMember.displayName.slice(0, LIMITS.DISPLAY_NAME_MAX),
        category: 'post',
        title: title.trim().slice(0, LIMITS.TITLE_MAX),
        body: cleanBody,
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
      onNotify('Post shared');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `posts/${postRef.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handlePublish();
    }
  };

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return posts
      .filter((p) => {
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
  }, [posts, searchQuery, membersById]);

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6 font-['Inter']">
      {/* Header + Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="font-['Inter'] text-2xl sm:text-3xl font-medium tracking-tight text-[#edece8] lowercase">
          closer
        </h1>

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#71706b] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search posts..."
            className="w-full bg-[#191918] border border-[#2a2a27] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#71706b] outline-none focus:border-[#4d4d48]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#71706b] hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Social Post Composer (Optional Title + Post Body) */}
      <form
        onSubmit={handlePublish}
        className="bg-[#1f1f1e] border border-[#2f2f2c] rounded-3xl p-4 shadow-lg focus-within:border-[#4d4d48] transition-colors space-y-2.5"
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={LIMITS.TITLE_MAX}
          placeholder="Title (optional)"
          className="w-full bg-transparent border-b border-[#2a2a27] pb-2 px-1 text-sm font-medium text-white placeholder-[#686761] outline-none focus:border-[#3d3d39] font-['Inter']"
        />

        <textarea
          ref={composerRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          maxLength={LIMITS.BODY_MAX}
          placeholder="What's happening?"
          rows={3}
          className="w-full bg-transparent text-sm text-white placeholder-[#71706b] outline-none resize-none px-1 pt-0.5 leading-relaxed font-['Inter']"
        />

        <div className="flex items-center justify-between pt-2 border-t border-[#262624] px-1">
          <div className="flex items-center gap-2 text-[11px] text-[#71706b]">
            <Avatar
              name={currentMember.displayName}
              photoUrl={currentMember.photoUrl}
              size="xs"
            />
            <span>Posting as {currentMember.displayName} · Ctrl/Cmd+Enter</span>
          </div>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="w-8 h-8 rounded-full bg-white hover:bg-[#e0dfd9] disabled:bg-[#292926] disabled:text-[#555550] text-black flex items-center justify-center transition-colors shrink-0 shadow"
            title="Post"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </form>

      {/* Feed Stream */}
      {isLoadingPosts ? (
        <div className="py-12 text-center text-xs text-[#71706b]">
          Loading feed...
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="bg-[#191918] border border-[#262624] rounded-2xl p-8 text-center space-y-2">
          <p className="text-sm text-[#edece8] font-medium">No posts yet</p>
          <p className="text-xs text-[#71706b]">
            {searchQuery
              ? 'Try clearing your search filter.'
              : 'Share the first post above with the team.'}
          </p>
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
  );
};
