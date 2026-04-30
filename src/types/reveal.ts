// Reveal module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface RevealTranche {
  id: number;
  name: string;
  description: string;
  components: string[];
  stake_threshold: string;
  dream_staked: string;
  preview_uri: string;
  code_uri: string;
  docs_uri: string;
  commit_hash: string;
  stake_deadline: string;
  reveal_deadline: string;
  verification_deadline: string;
  status: string;
  backed_at: string;
  revealed_at: string;
  verified_at: string;
}

export interface Contribution {
  id: string;
  contributor: string;
  project_name: string;
  description: string;
  tranches: RevealTranche[];
  current_tranche: number;
  total_valuation: string;
  bond_amount: string;
  bond_remaining: string;
  initial_license: string;
  final_license: string;
  transitioned_to_project: boolean;
  project_id: string;
  status: string;
  council_id: string;
  approved_by: string;
  approved_at: string;
  created_at: string;
  holdback_amount: string;
  proposal_eligible_at: string;
}

export interface RevealStake {
  id: string;
  staker: string;
  contribution_id: string;
  tranche_id: number;
  amount: string;
  staked_at: string;
}

export interface VerificationVote {
  voter: string;
  contribution_id: string;
  tranche_id: number;
  value_confirmed: boolean;
  quality_rating: number;
  comments: string;
  stake_weight: string;
  voted_at: string;
}

export interface RevealParams {
  stake_deadline_epochs: string;
  reveal_deadline_epochs: string;
  verification_period_epochs: string;
  dispute_resolution_epochs: string;
  verification_threshold: string;
  min_verification_votes: number;
  max_tranches: number;
  max_tranche_valuation: string;
  bond_rate: string;
  min_proposer_trust_level: number;
  max_total_valuation: string;
  min_stake_amount: string;
  payout_holdback_rate: string;
  proposal_cooldown_epochs: string;
}

// Enums

export const ContributionStatus = {
  PROPOSED: "CONTRIBUTION_STATUS_PROPOSED",
  IN_PROGRESS: "CONTRIBUTION_STATUS_IN_PROGRESS",
  COMPLETED: "CONTRIBUTION_STATUS_COMPLETED",
  CANCELLED: "CONTRIBUTION_STATUS_CANCELLED",
} as const;

export const CONTRIBUTION_STATUS_LABELS: Record<string, string> = {
  [ContributionStatus.PROPOSED]: "Proposed",
  [ContributionStatus.IN_PROGRESS]: "In Progress",
  [ContributionStatus.COMPLETED]: "Completed",
  [ContributionStatus.CANCELLED]: "Cancelled",
};

// Numeric values for status (used in URL path params where backend parses as int).
export const ContributionStatusValue: Record<string, string> = {
  [ContributionStatus.PROPOSED]: "0",
  [ContributionStatus.IN_PROGRESS]: "1",
  [ContributionStatus.COMPLETED]: "2",
  [ContributionStatus.CANCELLED]: "3",
};

export const TrancheStatus = {
  LOCKED: "TRANCHE_STATUS_LOCKED",
  STAKING: "TRANCHE_STATUS_STAKING",
  BACKED: "TRANCHE_STATUS_BACKED",
  REVEALED: "TRANCHE_STATUS_REVEALED",
  VERIFIED: "TRANCHE_STATUS_VERIFIED",
  DISPUTED: "TRANCHE_STATUS_DISPUTED",
  CANCELLED: "TRANCHE_STATUS_CANCELLED",
  FAILED: "TRANCHE_STATUS_FAILED",
} as const;

export const TRANCHE_STATUS_LABELS: Record<string, string> = {
  [TrancheStatus.LOCKED]: "Locked",
  [TrancheStatus.STAKING]: "Staking",
  [TrancheStatus.BACKED]: "Backed",
  [TrancheStatus.REVEALED]: "Revealed",
  [TrancheStatus.VERIFIED]: "Verified",
  [TrancheStatus.DISPUTED]: "Disputed",
  [TrancheStatus.CANCELLED]: "Cancelled",
  [TrancheStatus.FAILED]: "Failed",
};

export const DisputeVerdict = {
  UNSPECIFIED: "DISPUTE_VERDICT_UNSPECIFIED",
  ACCEPT: "DISPUTE_VERDICT_ACCEPT",
  IMPROVE: "DISPUTE_VERDICT_IMPROVE",
  REJECT: "DISPUTE_VERDICT_REJECT",
} as const;

// Numeric verdict values used when building MsgResolveDispute.
export const DisputeVerdictValue = {
  UNSPECIFIED: 0,
  ACCEPT: 1,
  IMPROVE: 2,
  REJECT: 3,
} as const;

// API response types

interface Pagination {
  next_key: string | null;
  total: string;
}

export interface GetContributionResponse {
  contribution: Contribution;
}

export interface ListContributionsResponse {
  contributions: Contribution[];
  pagination: Pagination;
}

export interface GetTrancheResponse {
  tranche: RevealTranche;
}

export interface GetTrancheTallyResponse {
  yes_weight: string;
  no_weight: string;
  vote_count: number;
}

export interface ListTrancheStakesResponse {
  stakes: RevealStake[];
  pagination: Pagination;
}

export interface GetStakeDetailResponse {
  stake: RevealStake;
}

export interface ListStakesByStakerResponse {
  stakes: RevealStake[];
  pagination: Pagination;
}

export interface ListVotesByVoterResponse {
  votes: VerificationVote[];
  pagination: Pagination;
}

export interface RevealParamsResponse {
  params: RevealParams;
}
