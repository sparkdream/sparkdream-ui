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
  /** True for self-publish projects that skipped council approval (zero
   * budget, APPRENTICE/STANDARD tiers only, rewards minted on completion). */
  permissionless?: boolean;
  /** Block height after which the EndBlocker auto-expires this project if
   * still PROPOSED. Set to creation_height + params.proposed_project_expiry_blocks
   * for budget-backed projects; "0" for permissionless ones (no expiry) and
   * cleared once the project transitions out of PROPOSED. */
  expiry_block_height?: string;
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

export interface Tag {
  name: string;
  usage_count: string;
  created_at: string;
  last_used_at: string;
  expiration_index: string;
}

export interface TagBudget {
  id: string;
  group_account: string;
  tag: string;
  pool_balance: string;
  members_only: boolean;
  created_at: string;
  active: boolean;
}

export interface TagBudgetAward {
  id: string;
  budget_id: string;
  post_id: string;
  recipient: string;
  amount: string;
  reason: string;
  awarded_at: string;
  awarded_by: string;
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
  // EXPIRED is terminal — the EndBlocker flips PROPOSED projects to this
  // state once they pass their `expiry_block_height` without approval.
  // Kept (not deleted) so the audit trail of stale proposals survives.
  EXPIRED: "PROJECT_STATUS_EXPIRED",
} as const;

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  [ProjectStatus.PROPOSED]: "Proposed",
  [ProjectStatus.ACTIVE]: "Active",
  [ProjectStatus.COMPLETED]: "Completed",
  [ProjectStatus.CANCELLED]: "Cancelled",
  [ProjectStatus.EXPIRED]: "Expired",
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
  [StakeTargetType.BLOG_CONTENT]: "Dream",
  [StakeTargetType.FORUM_CONTENT]: "Spark",
  [StakeTargetType.COLLECTION_CONTENT]: "Collection",
  [StakeTargetType.BLOG_AUTHOR_BOND]: "Dream Author Bond",
  [StakeTargetType.FORUM_AUTHOR_BOND]: "Spark Author Bond",
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

// Effective minimum stake an inviter must lock for their next invitation.
// All "stake" amounts are micro-DREAM strings; cost_multiplier is a LegacyDec
// serialized as a string (e.g. "1.100000000000000000").
export interface RequiredInvitationStakeResponse {
  required_stake: string;
  base_stake: string;
  cost_multiplier: string;
  credits_used: number;
  credits_remaining: number;
  trust_level: string;
}

export interface GetTagResponse {
  tag: Tag;
}

export interface ListTagResponse {
  tag: Tag[];
  pagination: Pagination;
}

export interface TagExistsResponse {
  exists: boolean;
  expiration_time: string;
}

export interface GetTagBudgetResponse {
  tag_budget: TagBudget;
}

export interface ListTagBudgetResponse {
  tag_budget: TagBudget[];
  pagination: Pagination;
}

export interface TagBudgetAwardsResponse {
  post_id: string;
  recipient: string;
  amount: string;
  pagination: Pagination;
}

// Bonded roles — generic accountability primitive in x/rep that the forum
// (sentinel), collect (curator), and federation (verifier) modules build on.

// Numeric values match the on-chain RoleType enum and are accepted by the
// REST URL templates (e.g. /sparkdream/rep/v1/bonded_role/{role_type}/{address}).
export const RoleType = {
  UNSPECIFIED: 0,
  FORUM_SENTINEL: 1,
  COLLECT_CURATOR: 2,
  FEDERATION_VERIFIER: 3,
} as const;

export type RoleTypeValue = typeof RoleType[keyof typeof RoleType];

export const ROLE_TYPE_LABELS: Record<number, string> = {
  [RoleType.FORUM_SENTINEL]: "Sentinel",
  [RoleType.COLLECT_CURATOR]: "Curator",
  [RoleType.FEDERATION_VERIFIER]: "Verifier",
};

export const BondedRoleStatus = {
  NORMAL: "BONDED_ROLE_STATUS_NORMAL",
  RECOVERY: "BONDED_ROLE_STATUS_RECOVERY",
  DEMOTED: "BONDED_ROLE_STATUS_DEMOTED",
  // Added in commit 6d7e7ce: MsgUnbondRole now queues a withdrawal that stays
  // slashable through unbond_cooldown; bond_status flips to UNBONDING and the
  // owning module refuses authority until the EndBlocker matures it.
  UNBONDING: "BONDED_ROLE_STATUS_UNBONDING",
} as const;

export const BONDED_ROLE_STATUS_LABELS: Record<string, string> = {
  [BondedRoleStatus.NORMAL]: "Normal",
  [BondedRoleStatus.RECOVERY]: "Recovery",
  [BondedRoleStatus.DEMOTED]: "Demoted",
  [BondedRoleStatus.UNBONDING]: "Unbonding",
};

export interface BondedRole {
  address: string;
  role_type: string;
  bond_status: string;
  current_bond: string;
  total_committed_bond: string;
  registered_at: string;
  last_active_epoch: string;
  consecutive_inactive_epochs: string;
  demotion_cooldown_until: string;
  cumulative_rewards: string;
  last_reward_epoch: string;
  // DREAM queued for withdrawal via MsgUnbondRole and not yet matured; counts
  // toward current_bond, so slashes consume both (commit 6d7e7ce).
  pending_unbond_amount: string;
  // Unix timestamp at which the in-flight unbond matures and pending DREAM is
  // released; 0 when no unbond is in flight.
  unbond_completion_time: string;
}

export interface BondedRoleConfig {
  role_type: string;
  min_bond: string;
  min_rep_tier: string;
  min_trust_level: string;
  min_age_blocks: string;
  demotion_cooldown: string;
  demotion_threshold: string;
  // Seconds the bond stays locked + slashable after MsgUnbondRole; 0 =
  // immediate (legacy). Sourced from the owning module's operational params.
  unbond_cooldown: string;
}

export interface BondedRoleResponse {
  bonded_role: BondedRole;
}

export interface BondedRolesByTypeResponse {
  bonded_roles: BondedRole[];
  pagination: Pagination;
}

export interface BondedRoleConfigResponse {
  bonded_role_config: BondedRoleConfig;
}
