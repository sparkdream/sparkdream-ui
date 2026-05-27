// Forum module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface ForumPost {
  post_id: string;
  category_id: string;
  root_id: string;
  parent_id: string;
  author: string;
  content: string;
  created_at: string;
  expiration_time: string;
  status: string;
  hidden_by: string;
  hidden_at: string;
  pinned: boolean;
  pinned_by: string;
  pinned_at: string;
  pin_priority: string;
  locked: boolean;
  locked_by: string;
  locked_at: string;
  lock_reason: string;
  upvote_count: string;
  downvote_count: string;
  depth: string;
  edited: boolean;
  edited_at: string;
  tags: string[];
  content_type: string;
  initiative_id: string;
  conviction_sustained: boolean;
}

export interface ThreadMetadata {
  thread_id: string;
  accepted_reply_id: string;
  accepted_by: string;
  accepted_at: string;
  proposed_reply_id: string;
  proposed_by: string;
  proposed_at: string;
  pinned_reply_ids: string[];
  pinned_records: PinnedReplyRecord[];
}

export interface PinnedReplyRecord {
  post_id: string;
  pinned_by: string;
  pinned_at: string;
  is_sentinel_pin: boolean;
  disputed: boolean;
  initiative_id: string;
}

export interface ThreadFollow {
  follower: string;
  thread_id: string;
  followed_at: string;
}

export interface ThreadFollowCount {
  thread_id: string;
  follower_count: string;
}

export interface Bounty {
  id: string;
  creator: string;
  thread_id: string;
  amount: string;
  created_at: string;
  expires_at: string;
  status: string;
  moderation_suspended_at: string;
  time_remaining_at_suspension: string;
  awards: BountyAward[];
}

export interface BountyAward {
  post_id: string;
  recipient: string;
  amount: string;
  reason: string;
  awarded_at: string;
  rank: number;
}

export interface PostFlag {
  post_id: string;
  total_weight: string;
  first_flag_at: string;
  last_flag_at: string;
  in_review_queue: boolean;
  flaggers: string[];
  reason_counts: Record<string, string>;
}

export interface HideRecord {
  post_id: string;
  sentinel: string;
  hidden_at: string;
  sentinel_bond_snapshot: string;
  sentinel_backing_snapshot: string;
  committed_amount: string;
  reason_code: string;
  reason_text: string;
}

export interface ListHideRecordsResponse {
  hide_record: HideRecord[];
  pagination?: {
    next_key: string | null;
    total: string;
  };
}

export interface ThreadLockRecord {
  root_id: string;
  sentinel: string;
  locked_at: string;
  sentinel_bond_snapshot: string;
  sentinel_backing_snapshot: string;
  lock_reason: string;
  appeal_pending: boolean;
  initiative_id: string;
}

export interface ThreadMoveRecord {
  root_id: string;
  sentinel: string;
  original_category_id: string;
  new_category_id: string;
  moved_at: string;
  sentinel_bond_snapshot: string;
  sentinel_backing_snapshot: string;
  move_reason: string;
  appeal_pending: boolean;
  initiative_id: string;
}

// Forum-specific sentinel counters. Bond, bond status, registration, and
// reward stamps now live on the generic BondedRole record in x/rep — see
// types/rep.ts.
export interface SentinelActivity {
  address: string;
  total_hides: string;
  upheld_hides: string;
  overturned_hides: string;
  unchallenged_hides: string;
  epoch_hides: string;
  epoch_appeals_resolved: string;
  overturn_cooldown_until: string;
  consecutive_overturns: string;
  pending_hide_count: string;
  consecutive_upheld: string;
  epoch_appeals_filed: string;
  total_locks: string;
  upheld_locks: string;
  overturned_locks: string;
  epoch_locks: string;
  total_moves: string;
  upheld_moves: string;
  overturned_moves: string;
  epoch_moves: string;
  total_pins: string;
  upheld_pins: string;
  overturned_pins: string;
  epoch_pins: string;
  total_proposals: string;
  confirmed_proposals: string;
  rejected_proposals: string;
  epoch_curations: string;
}

export interface MemberReport {
  member: string;
  reason: string;
  recommended_action: string;
  total_bond: string;
  created_at: string;
  status: string;
  defense: string;
  defense_submitted_at: string;
  reporters: string[];
  evidence_post_ids: string[];
  defense_post_ids: string[];
}

export interface MemberWarning {
  id: string;
  member: string;
  reason: string;
  issued_at: string;
  issued_by: string;
  warning_number: string;
  evidence_post_ids: string[];
}

export interface GovActionAppeal {
  id: string;
  appellant: string;
  action_type: string;
  action_target: string;
  original_reason: string;
  appeal_reason: string;
  appeal_bond: string;
  created_at: string;
  deadline: string;
  initiative_id: string;
  status: string;
  original_category_id: string;
}

export interface ForumStatus {
  forum_paused: boolean;
  moderation_paused: boolean;
  current_epoch: string;
}

export interface MemberStanding {
  warning_count: string;
  active_report: boolean;
  trust_tier: string;
}

// Enums

export const PostStatus = {
  ACTIVE: "POST_STATUS_ACTIVE",
  HIDDEN: "POST_STATUS_HIDDEN",
  DELETED: "POST_STATUS_DELETED",
  ARCHIVED: "POST_STATUS_ARCHIVED",
} as const;

// Numeric values matching the on-chain PostStatus enum — used in URL path params
// where the backend parses status as uint64.
export const PostStatusValue: Record<string, string> = {
  [PostStatus.ACTIVE]: "1",
  [PostStatus.HIDDEN]: "2",
  [PostStatus.DELETED]: "3",
  [PostStatus.ARCHIVED]: "4",
};

export const POST_STATUS_LABELS: Record<string, string> = {
  [PostStatus.ACTIVE]: "Active",
  [PostStatus.HIDDEN]: "Hidden",
  [PostStatus.DELETED]: "Deleted",
  [PostStatus.ARCHIVED]: "Archived",
};

export const BountyStatus = {
  ACTIVE: "BOUNTY_STATUS_ACTIVE",
  AWARDED: "BOUNTY_STATUS_AWARDED",
  EXPIRED: "BOUNTY_STATUS_EXPIRED",
  CANCELLED: "BOUNTY_STATUS_CANCELLED",
  MODERATION_PENDING: "BOUNTY_STATUS_MODERATION_PENDING",
} as const;

export const BOUNTY_STATUS_LABELS: Record<string, string> = {
  [BountyStatus.ACTIVE]: "Active",
  [BountyStatus.AWARDED]: "Awarded",
  [BountyStatus.EXPIRED]: "Expired",
  [BountyStatus.CANCELLED]: "Cancelled",
  [BountyStatus.MODERATION_PENDING]: "Moderation Pending",
};

export const GovActionType = {
  WARNING: "GOV_ACTION_TYPE_WARNING",
  DEMOTION: "GOV_ACTION_TYPE_DEMOTION",
  ZEROING: "GOV_ACTION_TYPE_ZEROING",
  TAG_REMOVAL: "GOV_ACTION_TYPE_TAG_REMOVAL",
  FORUM_PAUSE: "GOV_ACTION_TYPE_FORUM_PAUSE",
  THREAD_LOCK: "GOV_ACTION_TYPE_THREAD_LOCK",
  THREAD_MOVE: "GOV_ACTION_TYPE_THREAD_MOVE",
} as const;

export const GOV_ACTION_TYPE_LABELS: Record<string, string> = {
  [GovActionType.WARNING]: "Warning",
  [GovActionType.DEMOTION]: "Demotion",
  [GovActionType.ZEROING]: "Zeroing",
  [GovActionType.TAG_REMOVAL]: "Tag Removal",
  [GovActionType.FORUM_PAUSE]: "Swarm Pause",
  [GovActionType.THREAD_LOCK]: "Thread Lock",
  [GovActionType.THREAD_MOVE]: "Thread Move",
};

export const GovAppealStatus = {
  PENDING: "GOV_APPEAL_STATUS_PENDING",
  UPHELD: "GOV_APPEAL_STATUS_UPHELD",
  OVERTURNED: "GOV_APPEAL_STATUS_OVERTURNED",
  TIMEOUT: "GOV_APPEAL_STATUS_TIMEOUT",
} as const;

export const GOV_APPEAL_STATUS_LABELS: Record<string, string> = {
  [GovAppealStatus.PENDING]: "Pending",
  [GovAppealStatus.UPHELD]: "Upheld",
  [GovAppealStatus.OVERTURNED]: "Overturned",
  [GovAppealStatus.TIMEOUT]: "Timeout",
};

export const MemberReportStatus = {
  PENDING: "MEMBER_REPORT_STATUS_PENDING",
  ESCALATED: "MEMBER_REPORT_STATUS_ESCALATED",
  RESOLVED: "MEMBER_REPORT_STATUS_RESOLVED",
  META_APPEALED: "MEMBER_REPORT_STATUS_META_APPEALED",
} as const;

export const MEMBER_REPORT_STATUS_LABELS: Record<string, string> = {
  [MemberReportStatus.PENDING]: "Pending",
  [MemberReportStatus.ESCALATED]: "Escalated",
  [MemberReportStatus.RESOLVED]: "Resolved",
  [MemberReportStatus.META_APPEALED]: "Meta Appeal",
};

export const ContentType = {
  STANDARD: "CONTENT_TYPE_STANDARD",
  EPHEMERAL: "CONTENT_TYPE_EPHEMERAL",
} as const;

// API response types

export interface Pagination {
  next_key: string | null;
  total: string;
}

export interface GetPostResponse {
  post: ForumPost;
}

export interface ListPostResponse {
  post: ForumPost[];
  pagination: Pagination;
}

export interface PostsResponse {
  posts: ForumPost[];
  pagination: Pagination;
}

export interface ThreadResponse {
  posts: ForumPost[];
  pagination: Pagination;
}

export interface UserPostsResponse {
  posts: ForumPost[];
  pagination: Pagination;
}

export interface GetBountyResponse {
  bounty: Bounty;
}

export interface ListBountyResponse {
  bounty: Bounty[];
  pagination: Pagination;
}

export interface ActiveBountiesResponse {
  bounties: Bounty[];
  pagination: Pagination;
}

export interface BountyByThreadResponse {
  bounty: Bounty;
}

export interface UserBountiesResponse {
  bounties: Bounty[];
  pagination: Pagination;
}

export interface GetThreadMetadataResponse {
  thread_metadata: ThreadMetadata;
}

export interface ListThreadMetadataResponse {
  thread_metadata: ThreadMetadata[];
  pagination: Pagination;
}

export interface ThreadFollowersResponse {
  followers: string[];
  pagination: Pagination;
}

export interface UserFollowedThreadsResponse {
  thread_ids: string[];
  pagination: Pagination;
}

export interface IsFollowingThreadResponse {
  is_following: boolean;
}

export interface ThreadFollowCountResponse {
  thread_follow_count: ThreadFollowCount;
}

export interface GetPostFlagResponse {
  post_flag: PostFlag;
}

export interface FlagReviewQueueResponse {
  posts: ForumPost[];
  pagination: Pagination;
}

export interface ForumStatusResponse {
  forum_paused: boolean;
  moderation_paused: boolean;
  current_epoch: string;
}

// Forum module params. As of chain v1.0.11 fee/tax/deposit fields are bare
// math.Int strings in bond-denom micro-units; denom is resolved at runtime
// from x/identity (see commit efcf392).
export interface ForumParams {
  forum_paused: boolean;
  moderation_paused: boolean;
  bounties_enabled: boolean;
  reactions_enabled: boolean;
  appeals_paused: boolean;
  editing_enabled: boolean;
  spam_tax_amount: string;
  reaction_spam_tax_amount: string;
  flag_spam_tax_amount: string;
  downvote_deposit_amount: string;
  appeal_fee_amount: string;
  lock_appeal_fee_amount: string;
  move_appeal_fee_amount: string;
  edit_fee_amount: string;
  bounty_cancellation_fee_percent: string;
  max_content_size: string;
  daily_post_limit: string;
  max_reply_depth: number;
  edit_grace_period: string;
  edit_max_window: string;
  max_follows_per_day: string;
  archive_threshold: string;
  unarchive_cooldown: string;
  archive_cooldown: string;
  hide_appeal_cooldown: string;
  lock_appeal_cooldown: string;
  move_appeal_cooldown: string;
  cost_per_byte_amount: string;
  cost_per_byte_exempt: boolean;
  ephemeral_ttl: string;
  conviction_renewal_threshold: string;
  conviction_renewal_period: string;
  // Sentinel bonded-role config (flattened from forum's source of truth into
  // x/rep BondedRoleConfig for ROLE_TYPE_FORUM_SENTINEL).
  min_sentinel_bond: string;
  min_sentinel_rep_tier: string;
  // Trust-level enum name, e.g. "TRUST_LEVEL_ESTABLISHED". As of commit
  // d01f7b8 the sentinel gate prefers trust level over rep tier.
  min_sentinel_trust_level: string;
  min_sentinel_age_blocks: string;
  sentinel_demotion_cooldown: string;
  sentinel_demotion_threshold: string;
  sentinel_unhide_window: string;
  // Bond stays locked & slashable for this many seconds after MsgUnbondRole;
  // BondedRole status flips to UNBONDING during the cooldown (commit 6d7e7ce).
  sentinel_unbond_cooldown: string;
}

export interface ForumParamsResponse {
  params: ForumParams;
}

export interface PinnedPostsResponse {
  posts: ForumPost[];
}

export interface LockedThreadsResponse {
  posts: ForumPost[];
  pagination: Pagination;
}

export interface TopPostsResponse {
  posts: ForumPost[];
  pagination: Pagination;
}

export interface ThreadLockStatusResponse {
  locked: boolean;
  lock_record: ThreadLockRecord | null;
}

export interface GetSentinelActivityResponse {
  sentinel_activity: SentinelActivity;
}

export interface MemberStandingResponse {
  warning_count: string;
  active_report: boolean;
  trust_tier: string;
}

