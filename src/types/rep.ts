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
  /**
   * Advisory endorsements from stakers who signed MsgApproveInitiative with
   * approved=true. Nothing consults this list: conviction gates payout and the
   * bonded reviewers' verdicts gate quality. Disapproval is Operations
   * Committee only and abandons the initiative outright.
   */
  approvals: string[];
  status: string;
  created_at: string;
  completed_at: string;
  propagated_conviction: string;
  /**
   * DREAM locked by a self-assigning project creator (budget-backed projects
   * only). Returned on completion/abandonment, burned on upheld challenge.
   * Optional: nodes older than v1.0.26 don't return it.
   */
  self_assign_bond?: string;
  /**
   * Address that submitted MsgCreateInitiative, recorded on state so authorship
   * is answerable from a node query rather than only from the initiative_created
   * event. Immutable once set. Optional: absent on initiatives created before
   * the field existed, and on nodes that predate it.
   */
  creator?: string;
  /**
   * The definition of done, fixed at creation and immutable afterwards. Gives a
   * challenger a concrete criterion to cite (Challenge.criteria_id) and a
   * reviewer's per-item verdict a real referent. Replaces the removed
   * template_id, which resolved against a registry no message could write to.
   */
  acceptance_criteria?: VerificationCriteria[];
  /**
   * Which review round the work is on. A reviewer rejection returns the
   * initiative to ASSIGNED and increments this, so the assignee can fix and
   * resubmit; each round collects its own verdicts. Bounded by
   * params.max_review_rounds, after which a rejection is terminal.
   */
  review_round?: number;
  /**
   * Height at which the current round's review window closes. Past this with
   * the gate unmet, the round escalates to the Operations Committee.
   */
  review_deadline?: string;
  /** How the committee resolved an escalation for the current round. */
  review_escalation?: string;
  /**
   * Approving verdicts this round needs, snapshotted from the project's
   * verification policy when the review window opened. Read instead of the live
   * policy so a project cannot relax its own standard out from under work
   * already under review. Zero means no per-project gate, though the chain-wide
   * review_required_above_budget threshold still applies on top.
   */
  required_verifiers?: number;
}

// Initiative review (chain commits 70dce72, 32f2cee).
//
// Conviction measures whether people wanted the work done, not whether it was
// done, so completion above params.review_required_above_budget now needs a
// bonded reviewer's verdict as well. Reviewers are paid per verdict filed and
// never per approval, and commit bond scaled to the initiative budget that a
// jury slashes if it overturns them.

export const CriteriaType = {
  BINARY: "CRITERIA_TYPE_BINARY",
  SCALE: "CRITERIA_TYPE_SCALE",
  TEXT: "CRITERIA_TYPE_TEXT",
} as const;

export const CRITERIA_TYPE_LABELS: Record<string, string> = {
  [CriteriaType.BINARY]: "Pass / fail",
  [CriteriaType.SCALE]: "Scored 0-100",
  [CriteriaType.TEXT]: "Written answer",
};

// Numeric values match the on-chain CriteriaType enum. Sent as ints in tx
// messages, read back as the string form from the LCD.
export const CriteriaTypeValue = {
  BINARY: 0,
  SCALE: 1,
  TEXT: 2,
} as const;

/** One item in an initiative's definition of done. */
export interface VerificationCriteria {
  id: string;
  question: string;
  type: string;
  required: boolean;
  how_to_verify: string;
  evidence: string;
}

/** A reviewer's (or juror's) verdict on a single acceptance criterion. */
export interface CriteriaVote {
  criteria_id: string;
  passed: boolean;
  /** 0-100 for SCALE criteria; ignored for BINARY and TEXT. */
  score?: number;
  notes?: string;
}

/** One bonded reviewer's verdict on one round of submitted work. */
export interface InitiativeReview {
  initiative_id: string;
  round: number;
  reviewer: string;
  approved: boolean;
  criteria_votes?: CriteriaVote[];
  comments: string;
  created_at: string;
  /**
   * Bond committed against this verdict, released when the challenge window
   * closes unchallenged and slashed when a jury overturns it.
   */
  bond_reserved: string;
  /** Set once the bond has been released or slashed. */
  settled: boolean;
}

export interface InitiativeReviewRound {
  round: number;
  reviews: InitiativeReview[];
  approvals: number;
}

/**
 * Every round's verdicts plus what the current round adds up to against the
 * gate. `satisfied` is reported rather than recomputed client-side, because
 * approvals >= required is not the whole rule: a committee escalation can
 * satisfy or fail the gate on its own.
 */
export interface InitiativeReviewsResponse {
  rounds?: InitiativeReviewRound[];
  current_round: number;
  approvals: number;
  required: number;
  satisfied: boolean;
}

/** How the Operations Committee resolved an escalated review round. */
export const ReviewEscalation = {
  NONE: "REVIEW_ESCALATION_NONE",
  APPROVED: "REVIEW_ESCALATION_APPROVED",
  REJECTED: "REVIEW_ESCALATION_REJECTED",
  PASSED: "REVIEW_ESCALATION_PASSED",
} as const;

export const REVIEW_ESCALATION_LABELS: Record<string, string> = {
  [ReviewEscalation.NONE]: "Not escalated",
  [ReviewEscalation.APPROVED]: "Committee approved",
  [ReviewEscalation.REJECTED]: "Committee rejected",
  [ReviewEscalation.PASSED]: "Committee passed",
};

// Numeric values for MsgResolveReviewEscalation.resolution. NONE is not a
// resolution: the amino converter omits zero, so sending it would file an empty
// field the chain reads as unset.
export const ReviewEscalationValue = {
  APPROVED: 1,
  REJECTED: 2,
  PASSED: 3,
} as const;

/** One review round sitting with the Operations Committee. */
export interface EscalatedReview {
  initiative_id: string;
  round: number;
  /** Height at which committee silence rejects the round. */
  review_deadline: string;
  title: string;
  assignee: string;
}

export interface EscalatedReviewsResponse {
  escalations?: EscalatedReview[];
}

/**
 * DREAM escrowed against one initiative to bid reviewer attention toward it.
 * Paid out per verdict filed and split across the round's reviewers, exactly
 * like the review fee: a bounty released on completion would be a bribe to
 * approve.
 */
export interface ReviewBounty {
  initiative_id: string;
  amount: string;
  contributions?: ReviewBountyContribution[];
  /**
   * True once any verdict has been filed. Reclaim is barred from that point:
   * reviewers commit bond on the strength of the advertised bounty.
   */
  committed: boolean;
}

export interface ReviewBountyContribution {
  funder: string;
  amount: string;
  /** Block height the contribution was made, for the reclaim delay. */
  funded_at: string;
}

export interface ReviewBountyReclaimStatus {
  funder: string;
  amount: string;
  reclaimable_at_height: string;
  reclaimable: boolean;
}

export interface ReviewBountyResponse {
  bounty: ReviewBounty;
  reclaim_status?: ReviewBountyReclaimStatus[];
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
  // Retired by the project creator or Operations Committee while still OPEN
  // and unassigned. Distinct from ABANDONED, which records an assignee walking
  // away from work already taken on.
  CANCELLED: "INITIATIVE_STATUS_CANCELLED",
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
  [InitiativeStatus.CANCELLED]: "Cancelled",
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
  // Blog replies have their own id sequence, so their bonds live in a
  // separate target namespace from blog post bonds.
  BLOG_REPLY_AUTHOR_BOND: "STAKE_TARGET_BLOG_REPLY_AUTHOR_BOND",
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
  [StakeTargetType.BLOG_REPLY_AUTHOR_BOND]: "Dream Reply Author Bond",
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

// Descriptive rather than a restatement of the enum name: the process a project
// declares here only matters alongside min_verifier_count, which is what
// actually gates completion.
export const REVIEW_PROCESS_LABELS: Record<string, string> = {
  [ReviewProcess.CONVICTION_ONLY]: "Conviction only",
  [ReviewProcess.CREATOR_APPROVAL]: "Creator approval",
  [ReviewProcess.PEER_REVIEW]: "Peer review",
  [ReviewProcess.COMMITTEE_REVIEW]: "Committee review",
};

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

// Both endpoints below returned singular scalar fields (initiative_id/title/…)
// before the repeated-response fix; on older nodes `initiatives` is absent.
export interface AvailableInitiativesResponse {
  initiatives?: Initiative[];
  pagination?: Pagination;
}

export interface InitiativesByAssigneeResponse {
  initiatives?: Initiative[];
  pagination?: Pagination;
}

export interface ProjectsByCouncilResponse {
  projects?: RepProject[];
  pagination?: Pagination;
}

// Authorship lookups added in sparkdreamjs 0.0.35. Nodes that predate them 404,
// so both fields are optional and callers fall back to the unfiltered list.
export interface InitiativesByCreatorResponse {
  initiatives?: Initiative[];
  pagination?: Pagination;
}

export interface ProjectsByCreatorResponse {
  projects?: RepProject[];
  pagination?: Pagination;
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

export interface StakesByTargetResponse {
  stakes: RepStake[];
  pagination: Pagination;
}

export interface PendingStakeRewardsResponse {
  pending_rewards: string;
}

// Author bond on a content item (zero bond_amount means no bond exists —
// the chain returns a zero response instead of a 404).
export interface AuthorBondResponse {
  bond_amount: string;
  author: string;
  stake_id: string;
}

export interface AuthorBondsByTypeResponse {
  bonds: RepStake[];
  pagination: Pagination;
}

export const ContentChallengeStatus = {
  ACTIVE: "CONTENT_CHALLENGE_STATUS_ACTIVE",
  IN_JURY_REVIEW: "CONTENT_CHALLENGE_STATUS_IN_JURY_REVIEW",
  UPHELD: "CONTENT_CHALLENGE_STATUS_UPHELD",
  REJECTED: "CONTENT_CHALLENGE_STATUS_REJECTED",
} as const;

export const CONTENT_CHALLENGE_STATUS_LABELS: Record<string, string> = {
  [ContentChallengeStatus.ACTIVE]: "Awaiting author response",
  [ContentChallengeStatus.IN_JURY_REVIEW]: "In jury review",
  [ContentChallengeStatus.UPHELD]: "Upheld",
  [ContentChallengeStatus.REJECTED]: "Rejected",
};

export interface ContentChallenge {
  id: string;
  target_type: string;
  target_id: string;
  challenger: string;
  reason: string;
  evidence: string[];
  staked_dream: string;
  author: string;
  status: string;
  created_at: string; // block height
  resolved_at: string; // block height, "0" if unresolved
  response_deadline: string; // block height
  jury_review_id: string;
  author_response: string;
  author_evidence: string[];
  bond_amount: string;
}

export interface ContentChallengesByTargetResponse {
  content_challenge: ContentChallenge;
}

export interface GetInvitationResponse {
  invitation: Invitation;
}

export interface ListInvitationResponse {
  invitation: Invitation[];
  pagination: Pagination;
}

// Same shape as ListInvitationResponse: the chain query returns a
// `repeated Invitation invitation` field, singular name included.
export interface InvitationsByInviterResponse {
  invitation: Invitation[];
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
  // Renamed from ROLE_TYPE_FORUM_SENTINEL (chain commit 4ad8e38): one
  // moderation corps — one bond, one accountability record — spans forum
  // posts/threads AND collect collections/items. x/forum remains the role's
  // config steward; the shared accountability record (RoleActivity) lives in
  // x/rep. Same enum value, so URLs and stored records are unchanged.
  CONTENT_SENTINEL: 1,
  COLLECT_CURATOR: 2,
  FEDERATION_VERIFIER: 3,
  // Reviews submitted initiative work against its acceptance criteria (chain
  // commit 70dce72). Owned by x/rep rather than folded into CONTENT_SENTINEL
  // because the competence, the liability (a wrong approval mints DREAM), the
  // bond sizing and the accuracy denominators all differ.
  INITIATIVE_REVIEWER: 4,
} as const;

export type RoleTypeValue = typeof RoleType[keyof typeof RoleType];

export const ROLE_TYPE_LABELS: Record<number, string> = {
  [RoleType.CONTENT_SENTINEL]: "Sentinel",
  [RoleType.COLLECT_CURATOR]: "Curator",
  [RoleType.FEDERATION_VERIFIER]: "Verifier",
  [RoleType.INITIATIVE_REVIEWER]: "Reviewer",
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

// RoleActivity is the shared accountability record behind every bonded role,
// keyed by (role_type, address) and owned by x/rep. Sentinels had it projected
// through x/forum; reviewers and curators had no read surface at all, which
// matters because the record gates pay and drives demotion (chain commit
// 32f2cee).

/** One reward-epoch slot in the rolling accuracy ring. */
export interface RoleAccuracyBucket {
  epoch: string;
  upheld: string;
  overturned: string;
}

export interface RoleActivity {
  role_type: string;
  address: string;
  consecutive_upheld: string;
  consecutive_overturns: string;
  /**
   * Unix timestamp until which the holder may not take new moderation actions
   * on any surface, after a lost appeal.
   */
  overturn_cooldown_until: string;
  consecutive_inactive_epochs?: string;
  /** Jury verdicts (either way) resolved this reward epoch. */
  epoch_appeals_resolved: string;
  accuracy_window?: RoleAccuracyBucket[];
  /** Per-action-kind counters, keyed by the rep-owned kind constants. */
  epoch_actions?: Record<string, string>;
  total_actions?: Record<string, string>;
  upheld_actions?: Record<string, string>;
  overturned_actions?: Record<string, string>;
}

export interface RoleActivityResponse {
  role_activity: RoleActivity;
}

/**
 * One bonded-role SPARK reward pool. The pools are derived sub-addresses with
 * no other read surface, so without this query the automatic community-pool
 * funding is invisible.
 */
export interface RoleRewardPoolStatus {
  /** e.g. "content_sentinel", "initiative_reviewer", "collect_curator". */
  role: string;
  address: string;
  balance: string;
  /** Configured ceiling; excess is burned each epoch. */
  cap: string;
  /** max(0, cap - balance): this pool's share of the daily draw. */
  headroom: string;
}

export interface RoleRewardPoolsResponse {
  pools?: RoleRewardPoolStatus[];
  /** SPARK already drawn from the community pool on the current UTC day. */
  funded_today: string;
  /**
   * Today's computed allowance in uspark, from
   * annual_provisions * community_tax * inflation_share / 365. Zero means
   * automatic funding is off or nothing is being minted yet.
   */
  daily_funding_cap: string;
  /** The role_reward_inflation_share param the allowance derives from. */
  inflation_share: string;
}

// Jury summons. Jurors are drawn by lot and must accept to convert the seat
// into a commitment; declining is free and immediate, while ignoring the
// summons costs the seat and counts against the participation rate.

export const Verdict = {
  PENDING: "VERDICT_PENDING",
  UPHOLD_CHALLENGE: "VERDICT_UPHOLD_CHALLENGE",
  REJECT_CHALLENGE: "VERDICT_REJECT_CHALLENGE",
  INCONCLUSIVE: "VERDICT_INCONCLUSIVE",
} as const;

export const VERDICT_LABELS: Record<string, string> = {
  [Verdict.PENDING]: "Pending",
  [Verdict.UPHOLD_CHALLENGE]: "Challenge upheld",
  [Verdict.REJECT_CHALLENGE]: "Challenge rejected",
  [Verdict.INCONCLUSIVE]: "Inconclusive",
};

export interface JurorVote {
  juror: string;
  criteria_votes?: CriteriaVote[];
  verdict: string;
  confidence: string;
  reasoning: string;
  submitted_at: string;
}

export interface JuryReview {
  id: string;
  challenge_id: string;
  initiative_id: string;
  jurors: string[];
  required_votes: number;
  expert_witnesses?: string[];
  review_deliverable: string;
  challenger_claim: string;
  assignee_response: string;
  votes?: JurorVote[];
  deadline: string;
  verdict: string;
  reasoning: string;
  /** Non-zero when this review settles a content challenge, not an initiative. */
  content_challenge_id: string;
  /**
   * Height by which a seated juror must accept, after which unanswered seats
   * are vacated and redrawn. Scaled to the review period via
   * jury_acceptance_window_ratio rather than a fixed two hours.
   */
  acceptance_deadline: string;
  /** Jurors who have accepted the summons. */
  accepted?: string[];
  redraw_count: number;
}

export interface JuryReviewsByJurorResponse {
  jury_review?: JuryReview[];
  pagination?: Pagination;
}
