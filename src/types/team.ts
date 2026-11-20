export const TEAM_ID = 'gtt-closers' as const;
export const ACCEPTED_TEAM_IDS = ['gtt-closers', 'gtt-closers-9'] as const;

// Exact volumetric bounds synchronized with firebase-blueprint.json & firestore.rules
export const LIMITS = {
  DISPLAY_NAME_MAX: 60,
  FOCUS_MAX: 80,
  STATUS_TEXT_MAX: 140,
  DAILY_CALLS_MAX: 10000,
  PHOTO_URL_MAX: 32000,
  TITLE_MAX: 140,
  BODY_MAX: 4000,
  COMMENT_MAX: 2000,
  DM_PREVIEW_MAX: 500,
  DM_BODY_MAX: 4000,
} as const;

export type PostCategory = 'post' | 'message' | 'idea' | 'mql' | 'sql' | 'opening';
export type EquipmentType = '' | 'Dry Van' | 'Reefer' | 'Both';
export type StageStatus = 'open' | 'in_progress' | 'won' | 'archived';

export type SidebarChannel = 'feed' | 'messages' | 'roster';

export interface TeamMember {
  id: string;
  uid: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  displayName: string;
  focus: string;
  statusText: string;
  dailyCalls?: number;
  photoUrl?: string;
  createdAt: any;
  updatedAt: any;
}

export interface TeamPost {
  id: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  authorId: string;
  authorName: string;
  category: PostCategory;
  title: string;
  body: string;
  lane: string;
  equipment: EquipmentType;
  loadsPerWeek: string;
  stageStatus: StageStatus;
  pinned: boolean;
  replyCount: number;
  likeCount: number;
  lastCommentId: string;
  createdAt: any;
  updatedAt: any;
}

export interface PostComment {
  id: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: any;
}

export interface DirectThread {
  id: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  participantIds: [string, string];
  lastMessageText: string;
  lastSenderId: string;
  lastMessageId: string;
  lastMessageAt: any;
  createdAt: any;
  updatedAt: any;
}

export interface DirectMessage {
  id: string;
  dmId: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  participantIds: [string, string];
  senderId: string;
  senderName: string;
  recipientId: string;
  body: string;
  createdAt: any;
}

export function getParticipantPair(uidA: string, uidB: string): [string, string] {
  return uidA <= uidB ? [uidA, uidB] : [uidB, uidA];
}

export function getDmId(uidA: string, uidB: string): string {
  const [first, second] = getParticipantPair(uidA, uidB);
  return `${first}__${second}`;
}

export function getOtherParticipantId(
  participantIds: string[],
  currentUserId: string
): string {
  const other = participantIds.find((id) => id !== currentUserId);
  return other || currentUserId;
}

