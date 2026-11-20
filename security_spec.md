# Security Specification — Closer Team Hub

## 1. Data Invariants
1. **Identity Integrity**: No user may create a `members/{memberId}`, `users/{userId}`, `posts/{postId}`, `comments/{commentId}`, or `likes/{likeUserId}` document with an author/owner UID differing from `request.auth.uid`.
2. **Email Verification Gate**: All authenticated reads and writes require `request.auth.token.email_verified == true`.
3. **PII Isolation**: Email addresses are stored solely in `/users/{userId}` and are strictly readable/writable only by the owner (`request.auth.uid == userId`) or bootstrapped admin. Public closer profiles (`/members/{memberId}`) and shared posts (`/posts/{postId}`) contain zero PII.
4. **Parent & Membership Integrity**: Creating a post or comment requires an existing closer profile at `/members/$(request.auth.uid)`. Creating a comment or like requires the parent `/posts/{postId}` to exist.
5. **Atomicity Guarantee**: Incrementing `replyCount` on `/posts/{postId}` requires `existsAfter(/databases/$(database)/documents/posts/$(postId)/comments/$(incoming().lastCommentId))`. Incrementing/decrementing `likeCount` requires synchronous creation/deletion of `/posts/{postId}/likes/$(request.auth.uid)` via `existsAfter`.
6. **Terminal State Locking**: Once a post's `stageStatus` reaches `'archived'`, non-admin updates to content or status are blocked.
7. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time`, and `createdAt` / `authorId` / `teamId` are immutable after creation.

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Listing `/posts` or creating a post when `request.auth == null`.
2. **Unverified Email Write**: Creating `/posts/{postId}` when `request.auth.token.email_verified == false`.
3. **Author Spoofing**: Creating `/posts/{postId}` with `authorId: "other-closer-uid"` while signed in as `closer-a`.
4. **Ghost / Shadow Field Injection**: Creating `/posts/{postId}` with an extra field `{ isAdmin: true }` or `{ verified: true }`.
5. **Path ID Poisoning**: Creating `/posts/bad$id/comments/c1` or `/posts/` with an ID exceeding 128 chars or containing invalid characters.
6. **Oversized Payload (Denial of Wallet)**: Creating `/posts/{postId}` with `body` > 4000 characters or `title` > 140 characters.
7. **PII Snooping**: User A attempting `get` or `list` on `/users/{userB}` to read User B's email.
8. **Fake Counter Inflation**: Updating `/posts/{postId}` with `{ likeCount: 999, updatedAt: request.time }` without creating `/posts/{postId}/likes/{uid}` in the same atomic batch.
9. **Orphaned Comment**: Creating `/posts/nonexistent_post/comments/c1` when `/posts/nonexistent_post` does not exist.
10. **Non-Author Post Mutation**: User B updating `body` or `stageStatus` on User A's post.
11. **Terminal State Bypass**: Updating `body` or `stageStatus` on a post whose existing `stageStatus == 'archived'` as a non-admin.
12. **Immutable Field Tampering**: Updating a post while modifying `createdAt` or `authorId` or forging `updatedAt` to a past timestamp.
