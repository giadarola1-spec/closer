export const TEAM_ID = 'gtt-closers' as const;
export const ACCEPTED_TEAM_IDS = ['gtt-closers', 'gtt-closers-9'] as const;

// Exact volumetric bounds synchronized with firebase-blueprint.json & firestore.rules
export const LIMITS = {
  DISPLAY_NAME_MAX: 60,
  FOCUS_MAX: 80,
  STATUS_TEXT_MAX: 140,
  DAILY_CALLS_MAX: 10000,
  TITLE_MAX: 140,
  BODY_MAX: 4000,
  COMMENT_MAX: 2000,
} as const;

export type PostCategory = 'post' | 'message' | 'idea' | 'mql' | 'sql' | 'opening';
export type EquipmentType = '' | 'Dry Van' | 'Reefer' | 'Both';
export type StageStatus = 'open' | 'in_progress' | 'won' | 'archived';

export type SidebarChannel = 'feed' | 'roster';

export interface TeamMember {
  id: string;
  uid: string;
  teamId: (typeof ACCEPTED_TEAM_IDS)[number];
  displayName: string;
  focus: string;
  statusText: string;
  dailyCalls?: number;
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
