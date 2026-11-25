export const TEAM_ID = 'gtt-closers' as const;
export const ACCEPTED_TEAM_IDS = ['gtt-closers', 'gtt-closers-9'] as const;

// Exact volumetric bounds synchronized with firebase-blueprint.json & firestore.rules
export const LIMITS = {
  DISPLAY_NAME_MAX: 60,
  FOCUS_MAX: 80,
  STATUS_TEXT_MAX: 140,
  DAILY_CALLS_MAX: 10000,
  PHOTO_URL_MAX: 32000,
  IMAGE_URL_MAX: 1000,
  TITLE_MAX: 140,
  BODY_MAX: 4000,
  COMMENT_MAX: 2000,
  DM_PREVIEW_MAX: 500,
  DM_BODY_MAX: 4000,
  DRAWBOARD_POINTS_MAX: 500,
  MARGIN_NOTE_POINTS_MAX: 3,
  MARGIN_NOTE_POINT_MAX: 280,
} as const;

export type PostCategory = 'post' | 'message' | 'idea' | 'mql' | 'sql' | 'opening';
export type EquipmentType = '' | 'Dry Van' | 'Reefer' | 'Both';
export type StageStatus = 'open' | 'in_progress' | 'won' | 'archived';

export type SidebarChannel = 'feed' | 'messages' | 'roster';

export interface PostMarginNote {
  points: string[];
}

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
  imageUrl?: string | null;
  lane: string;
  equipment: EquipmentType;
  loadsPerWeek: string;
  stageStatus: StageStatus;
  pinned: boolean;
  replyCount: number;
  likeCount: number;
  lastCommentId: string;
  marginNote?: PostMarginNote | null;
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

export type NotificationTone = 'chime' | 'ping' | 'soft';

export interface NotificationPreferences {
  postNotificationsEnabled: boolean;
  postSoundEnabled: boolean;
  postSoundTone: NotificationTone;
  postBrowserAlertsEnabled: boolean;
}

export interface PostAlert {
  id: string;
  kind?: 'post' | 'dm';
  postId: string;
  senderUid?: string;
  authorName: string;
  authorPhotoUrl?: string;
  title: string;
  body: string;
}

export interface DrawboardPoint {
  x: number;
  y: number;
}

export const DRAWBOARD_BG = '#191919' as const;

export const DRAWBOARD_SWATCHES = [
  { hex: '#e5e5e5', label: 'Off-white' },
  { hex: '#9ca3af', label: 'Cool Gray' },
  { hex: '#d97706', label: 'Soft Amber' },
  { hex: '#eab308', label: 'Warm Gold' },
  { hex: '#10b981', label: 'Muted Emerald' },
  { hex: '#06b6d4', label: 'Muted Cyan' },
  { hex: '#3b82f6', label: 'Soft Blue' },
  { hex: '#f43f5e', label: 'Soft Coral' },
] as const;

export const DRAWBOARD_SIZES = [1, 2, 4, 8] as const;
export type DrawboardSize = (typeof DRAWBOARD_SIZES)[number];

export type DrawboardColor = (typeof DRAWBOARD_SWATCHES)[number]['hex'] | typeof DRAWBOARD_BG;

export interface DrawboardStroke {
  id: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  points: DrawboardPoint[];
  color: DrawboardColor;
  width: number;
  userId: string;
  userName: string;
  createdAt: any;
}

export interface SupervisorRecord {
  id: string;
  uid: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  displayName: string;
  active: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface SupervisorStatusResponse {
  configured: boolean;
  mode: 'env' | 'claimed' | 'unconfigured';
}
