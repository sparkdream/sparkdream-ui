// Rep module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface RepMember {
  address: string;
  dream_balance: string;
  staked_dream: string;
  lifetime_earned: string;
  lifetime_burned: string;
  reputation_scores: Record<string, string>;
  lifetime_reputation: Record<string, string>;
  trust_level: string;
  trust_level_updated_at: string;
  joined_season: number;
  joined_at: string;
  invited_by: string;
  invitation_chain: string[];
  invitation_credits: number;
  status: string;
  zeroed_at: string;
  zeroed_count: number;
  last_decay_epoch: string;
  tips_given_this_epoch: number;
  last_tip_epoch: string;
  completed_interims_count: number;
  completed_initiatives_count: number;
  gifts_sent_this_epoch: string;
  last_gift_epoch: string;
  last_credit_reset_season: string;
  reputation_gained_this_epoch: Record<string, string>;
  last_rep_gain_epoch: string;
}

export interface VerificationPolicy {
  default_review: string;
  requires_domain_rep: boolean;
  min_verifier_reputation: string;
  min_verifier_count: number;
  review_period_epochs: string;
  challenge_period_epochs: string;
  requires_creator_approval: boolean;
}

export interface RepProject {
  id: string;
  name: string;
  description: string;
  creator: string;
  tags: string[];
  category: string;
  council: string;
  approved_budget: string;
  allocated_budget: string;
  spent_budget: string;
  approved_spark: string;
  spent_spark: string;
  verification_policy: VerificationPolicy;
  status: string;
  approved_by: string;
  approved_at: string;
  completed_at: string;
}

export interface Initiative {
  id: string;
  project_id: string;
  title: string;
  description: string;
  tags: string[];
  tier: string;
  category: string;
  template_id: string;
  budget: string;
  assignee: string;
  apprentice: string;
  assigned_at: string;
  deliverable_uri: string;
  submitted_at: string;
  required_conviction: string;
  current_conviction: string;
  external_conviction: string;
  conviction_last_updated: string;
  review_period_end: string;
  challenge_period_end: string;
  approvals: string[];
  status: string;
  created_at: string;
  completed_at: string;
  propagated_conviction: string;
}

export interface RepStake {
  id: string;
  staker: string;
  target_type: string;
  target_id: string;
  target_identifier: string;
  amount: string;
  created_at: string;
  last_claimed_at: string;
  reward_debt: string;
}

export interface Invitation {
  id: string;
  inviter: string;
  invitee_address: string;
  staked_dream: string;
  vouched_tags: string[];
  status: string;
  created_at: string;
  accepted_at: string;
}

export interface Challenge {
  id: string;
  initiative_id: string;
  challenger: string;
  reason: string;
  evidence: string[];
  staked_dream: string;
  status: string;
  created_at: string;
  response: string;
  response_evidence: string[];
  responded_at: string;
}

// Enums

export const TrustLevel = {
  NEW: "TRUST_LEVEL_NEW",
  PROVISIONAL: "TRUST_LEVEL_PROVISIONAL",
  ESTABLISHED: "TRUST_LEVEL_ESTABLISHED",
  TRUSTED: "TRUST_LEVEL_TRUSTED",
  CORE: "TRUST_LEVEL_CORE",
} as const;

export const TRUST_LEVEL_LABELS: Record<string, string> = {
  [TrustLevel.NEW]: "New",
  [TrustLevel.PROVISIONAL]: "Provisional",
  [TrustLevel.ESTABLISHED]: "Established",
  [TrustLevel.TRUSTED]: "Trusted",
  [TrustLevel.CORE]: "Core",
};

export const MemberStatus = {
  ACTIVE: "MEMBER_STATUS_ACTIVE",
  INACTIVE: "MEMBER_STATUS_INACTIVE",
  ZEROED: "MEMBER_STATUS_ZEROED",
} as const;

export const MEMBER_STATUS_LABELS: Record<string, string> = {
  [MemberStatus.ACTIVE]: "Active",
  [MemberStatus.INACTIVE]: "Inactive",
  [MemberStatus.ZEROED]: "Zeroed",
};

export const ProjectStatus = {
  PROPOSED: "PROJECT_STATUS_PROPOSED",
  ACTIVE: "PROJECT_STATUS_ACTIVE",
  COMPLETED: "PROJECT_STATUS_COMPLETED",
  CANCELLED: "PROJECT_STATUS_CANCELLED",
} as const;

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  [ProjectStatus.PROPOSED]: "Proposed",
  [ProjectStatus.ACTIVE]: "Active",
  [ProjectStatus.COMPLETED]: "Completed",
  [ProjectStatus.CANCELLED]: "Cancelled",
};

export const ProjectCategory = {
  INFRASTRUCTURE: "PROJECT_CATEGORY_INFRASTRUCTURE",
  ECOSYSTEM: "PROJECT_CATEGORY_ECOSYSTEM",
  CREATIVE: "PROJECT_CATEGORY_CREATIVE",
  RESEARCH: "PROJECT_CATEGORY_RESEARCH",
  OPERATIONS: "PROJECT_CATEGORY_OPERATIONS",
} as const;

export const PROJECT_CATEGORY_LABELS: Record<string, string> = {
  [ProjectCategory.INFRASTRUCTURE]: "Infrastructure",
  [ProjectCategory.ECOSYSTEM]: "Ecosystem",
  [ProjectCategory.CREATIVE]: "Creative",
  [ProjectCategory.RESEARCH]: "Research",
  [ProjectCategory.OPERATIONS]: "Operations",
};

export const InitiativeStatus = {
  OPEN: "INITIATIVE_STATUS_OPEN",
  ASSIGNED: "INITIATIVE_STATUS_ASSIGNED",
  SUBMITTED: "INITIATIVE_STATUS_SUBMITTED",
  IN_REVIEW: "INITIATIVE_STATUS_IN_REVIEW",
  CHALLENGED: "INITIATIVE_STATUS_CHALLENGED",
  COMPLETED: "INITIATIVE_STATUS_COMPLETED",
  REJECTED: "INITIATIVE_STATUS_REJECTED",
  ABANDONED: "INITIATIVE_STATUS_ABANDONED",
} as const;

export const INITIATIVE_STATUS_LABELS: Record<string, string> = {
  [InitiativeStatus.OPEN]: "Open",
  [InitiativeStatus.ASSIGNED]: "Assigned",
  [InitiativeStatus.SUBMITTED]: "Submitted",
  [InitiativeStatus.IN_REVIEW]: "In Review",
  [InitiativeStatus.CHALLENGED]: "Challenged",
  [InitiativeStatus.COMPLETED]: "Completed",
  [InitiativeStatus.REJECTED]: "Rejected",
  [InitiativeStatus.ABANDONED]: "Abandoned",
};

export const InitiativeTier = {
  APPRENTICE: "INITIATIVE_TIER_APPRENTICE",
  STANDARD: "INITIATIVE_TIER_STANDARD",
  EXPERT: "INITIATIVE_TIER_EXPERT",
  EPIC: "INITIATIVE_TIER_EPIC",
} as const;

export const INITIATIVE_TIER_LABELS: Record<string, string> = {
  [InitiativeTier.APPRENTICE]: "Apprentice",
  [InitiativeTier.STANDARD]: "Standard",
  [InitiativeTier.EXPERT]: "Expert",
  [InitiativeTier.EPIC]: "Epic",
};

export const InitiativeCategory = {
  FEATURE: "INITIATIVE_CATEGORY_FEATURE",
  BUGFIX: "INITIATIVE_CATEGORY_BUGFIX",
  REFACTOR: "INITIATIVE_CATEGORY_REFACTOR",
  TESTING: "INITIATIVE_CATEGORY_TESTING",
  SECURITY: "INITIATIVE_CATEGORY_SECURITY",
  DOCUMENTATION: "INITIATIVE_CATEGORY_DOCUMENTATION",
  DESIGN: "INITIATIVE_CATEGORY_DESIGN",
  RESEARCH: "INITIATIVE_CATEGORY_RESEARCH",
  REVIEW: "INITIATIVE_CATEGORY_REVIEW",
  OTHER: "INITIATIVE_CATEGORY_OTHER",
} as const;

export const INITIATIVE_CATEGORY_LABELS: Record<string, string> = {
  [InitiativeCategory.FEATURE]: "Feature",
  [InitiativeCategory.BUGFIX]: "Bugfix",
  [InitiativeCategory.REFACTOR]: "Refactor",
  [InitiativeCategory.TESTING]: "Testing",
  [InitiativeCategory.SECURITY]: "Security",
  [InitiativeCategory.DOCUMENTATION]: "Documentation",
  [InitiativeCategory.DESIGN]: "Design",
  [InitiativeCategory.RESEARCH]: "Research",
  [InitiativeCategory.REVIEW]: "Review",
  [InitiativeCategory.OTHER]: "Other",
};

export const StakeTargetType = {
  INITIATIVE: "STAKE_TARGET_INITIATIVE",
  PROJECT: "STAKE_TARGET_PROJECT",
  MEMBER: "STAKE_TARGET_MEMBER",
  TAG: "STAKE_TARGET_TAG",
  BLOG_CONTENT: "STAKE_TARGET_BLOG_CONTENT",
  FORUM_CONTENT: "STAKE_TARGET_FORUM_CONTENT",
  COLLECTION_CONTENT: "STAKE_TARGET_COLLECTION_CONTENT",
  BLOG_AUTHOR_BOND: "STAKE_TARGET_BLOG_AUTHOR_BOND",
  FORUM_AUTHOR_BOND: "STAKE_TARGET_FORUM_AUTHOR_BOND",
  COLLECTION_AUTHOR_BOND: "STAKE_TARGET_COLLECTION_AUTHOR_BOND",
} as const;

export const STAKE_TARGET_LABELS: Record<string, string> = {
  [StakeTargetType.INITIATIVE]: "Initiative",
  [StakeTargetType.PROJECT]: "Project",
  [StakeTargetType.MEMBER]: "Member",
  [StakeTargetType.TAG]: "Tag",
  [StakeTargetType.BLOG_CONTENT]: "Blog Content",
  [StakeTargetType.FORUM_CONTENT]: "Forum Content",
  [StakeTargetType.COLLECTION_CONTENT]: "Collection Content",
  [StakeTargetType.BLOG_AUTHOR_BOND]: "Blog Author Bond",
  [StakeTargetType.FORUM_AUTHOR_BOND]: "Forum Author Bond",
  [StakeTargetType.COLLECTION_AUTHOR_BOND]: "Collection Author Bond",
};

export const TransferPurpose = {
  TIP: "TRANSFER_PURPOSE_TIP",
  GIFT: "TRANSFER_PURPOSE_GIFT",
  BOUNTY: "TRANSFER_PURPOSE_BOUNTY",
} as const;

export const InvitationStatus = {
  PENDING: "INVITATION_STATUS_PENDING",
  ACCEPTED: "INVITATION_STATUS_ACCEPTED",
  EXPIRED: "INVITATION_STATUS_EXPIRED",
} as const;

export const INVITATION_STATUS_LABELS: Record<string, string> = {
  [InvitationStatus.PENDING]: "Pending",
  [InvitationStatus.ACCEPTED]: "Accepted",
  [InvitationStatus.EXPIRED]: "Expired",
};

export const ReviewProcess = {
  CONVICTION_ONLY: "REVIEW_PROCESS_CONVICTION_ONLY",
  CREATOR_APPROVAL: "REVIEW_PROCESS_CREATOR_APPROVAL",
  PEER_REVIEW: "REVIEW_PROCESS_PEER_REVIEW",
  COMMITTEE_REVIEW: "REVIEW_PROCESS_COMMITTEE_REVIEW",
} as const;

export const ChallengeStatus = {
  ACTIVE: "CHALLENGE_STATUS_ACTIVE",
  IN_JURY_REVIEW: "CHALLENGE_STATUS_IN_JURY_REVIEW",
  UPHELD: "CHALLENGE_STATUS_UPHELD",
  REJECTED: "CHALLENGE_STATUS_REJECTED",
} as const;

// API response types

export interface Pagination {
  next_key: string | null;
  total: string;
}

export interface GetMemberResponse {
  member: RepMember;
}

export interface ListMemberResponse {
  member: RepMember[];
  pagination: Pagination;
}

export interface MembersByTrustLevelResponse {
  members: RepMember[];
  pagination: Pagination;
}

export interface GetProjectResponse {
  project: RepProject;
}

export interface ListProjectResponse {
  project: RepProject[];
  pagination: Pagination;
}

export interface GetInitiativeResponse {
  initiative: Initiative;
}

export interface ListInitiativeResponse {
  initiative: Initiative[];
  pagination: Pagination;
}

export interface InitiativesByProjectResponse {
  initiatives: Initiative[];
  pagination: Pagination;
}

export interface InitiativesByAssigneeResponse {
  initiatives: Initiative[];
  pagination: Pagination;
}

export interface AvailableInitiativesResponse {
  initiatives: Initiative[];
  pagination: Pagination;
}

export interface GetStakeResponse {
  stake: RepStake;
}

export interface ListStakeResponse {
  stake: RepStake[];
  pagination: Pagination;
}

export interface StakesByStakerResponse {
  stakes: RepStake[];
  pagination: Pagination;
}

export interface PendingStakeRewardsResponse {
  pending_rewards: string;
}

export interface GetInvitationResponse {
  invitation: Invitation;
}

export interface ListInvitationResponse {
  invitation: Invitation[];
  pagination: Pagination;
}

export interface InvitationsByInviterResponse {
  invitations: Invitation[];
  pagination: Pagination;
}

export interface RepParamsResponse {
  params: Record<string, unknown>;
}
