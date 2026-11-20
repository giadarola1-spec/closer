# Security Specification — Closer Team Hub

## 1. Data Invariants
1. **Identity Integrity**: No user may create a `members/{memberId}`, `users/{userId}`, `posts/{postId}`, `comments/{commentId}`, `likes/{likeUserId}`, or `dms/{dmId}/messages/{messageId}` document with an author/owner/sender UID differing from `request.auth.uid`.
2. **Email Verification Gate**: All authenticated reads and writes require `request.auth.token.email_verified == true`.
3. **PII Isolation**: Email addresses are stored solely in `/users/{userId}` and are strictly readable/writable only by the owner (`request.auth.uid == userId`) or bootstrapped admin. Public closer profiles (`/members/{memberId}`) and shared posts (`/posts/{postId}`) contain zero PII.
4. **Parent & Membership Integrity**: Creating a post, comment, or DM requires an existing closer profile at `/members/$(request.auth.uid)`, and DM recipients must also exist in `/members`. Creating a comment or like requires the parent `/posts/{postId}` to exist.
5. **Atomicity Guarantee**: Incrementing `replyCount` on `/posts/{postId}` requires `existsAfter(.../comments/$(incoming().lastCommentId))`. Incrementing/decrementing `likeCount` requires synchronous creation/deletion of `/posts/{postId}/likes/$(request.auth.uid)` via `existsAfter`. Sending a DM requires atomic batch synchronization between `/dms/{dmId}` and `/dms/{dmId}/messages/{messageId}` via `existsAfter`/`getAfter`.
6. **Terminal State Locking**: Once a post's `stageStatus` reaches `'archived'`, non-admin updates to content or status are blocked.
7. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time`, and `createdAt` / `authorId` / `teamId` / `participantIds` are immutable after creation.
8. **Private DM Isolation**: `/dms/{dmId}` and `/dms/{dmId}/messages/{messageId}` are strictly readable and listable only by users present in the bounded 2-element `participantIds` array, and `dmId` must match `participantIds[0] + '__' + participantIds[1]`.

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Listing `/posts` or `/dms` or creating a post/DM when `request.auth == null`.
2. **Unverified Email Write**: Creating `/posts/{postId}` or `/dms/{dmId}/messages/{messageId}` when `request.auth.token.email_verified == false`.
3. **Author / Sender Spoofing**: Creating `/posts/{postId}` with `authorId: "other-closer-uid"` or `/dms/{dmId}/messages/{m1}` with `senderId: "other-closer-uid"`.
4. **Ghost / Shadow Field Injection**: Creating `/posts/{postId}` or `/dms/{dmId}` with an extra field `{ isAdmin: true }` or `{ verified: true }`.
5. **Path ID Poisoning**: Creating `/posts/bad$id/comments/c1` or `/dms/bad$id` with an ID exceeding 128 chars or containing invalid characters.
6. **Oversized Payload (Denial of Wallet)**: Creating `/posts/{postId}` or `/dms/{dmId}/messages/{m1}` with `body` > 4000 characters.
7. **PII & Private DM Snooping**: User C attempting `get` or `list` on `/users/{userB}`, `/dms/{userA__userB}`, or `/dms/{userA__userB}/messages`.
8. **Fake Counter / Thread Desync**: Updating `/dms/{dmId}` with `lastMessageId: "fake"` without creating `/dms/{dmId}/messages/fake` in the same atomic batch.
9. **Orphaned / Non-Team DM Write**: Sending a DM to a `recipientId` that has no `/members/{recipientId}` closer document.
10. **Non-Author Post / DM Mutation**: User B updating `body` on User A's post or updating immutable `participantIds` on `/dms/{dmId}`.
11. **Terminal State Bypass**: Updating `body` or `stageStatus` on a post whose existing `stageStatus == 'archived'` as a non-admin.
12. **Immutable Field Tampering**: Updating a post or DM thread while modifying `createdAt`, `participantIds`, or forging `updatedAt` to a past timestamp.

