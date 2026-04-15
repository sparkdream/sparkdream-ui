// Cosmos SDK x/gov v1 types matching the LCD REST API responses.
// Field names use snake_case to match the API response format.

export interface GovProposal {
  id: string;
  messages: { "@type": string; [key: string]: unknown }[];
  status: string;
  final_tally_result: GovTallyResult;
  submit_time: string;
  deposit_end_time: string;
  total_deposit: Coin[];
  voting_start_time: string;
  voting_end_time: string;
  metadata: string;
  title: string;
  summary: string;
  proposer: string;
  expedited: boolean;
}

export interface GovTallyResult {
  yes_count: string;
  abstain_count: string;
  no_count: string;
  no_with_veto_count: string;
}

export interface GovVote {
  proposal_id: string;
  voter: string;
  options: { option: string; weight: string }[];
  metadata: string;
}

export interface GovDeposit {
  proposal_id: string;
  depositor: string;
  amount: Coin[];
}

export interface Coin {
  denom: string;
  amount: string;
}

export interface GovParams {
  min_deposit: Coin[];
  max_deposit_period: string;
  voting_period: string;
  quorum: string;
  threshold: string;
  veto_threshold: string;
  min_initial_deposit_ratio: string;
  expedited_voting_period: string;
  expedited_threshold: string;
  expedited_min_deposit: Coin[];
  burn_vote_quorum: boolean;
  burn_proposal_deposit_prevote: boolean;
  burn_vote_veto: boolean;
  min_deposit_ratio: string;
}

export const GovProposalStatus = {
  UNSPECIFIED: "PROPOSAL_STATUS_UNSPECIFIED",
  DEPOSIT_PERIOD: "PROPOSAL_STATUS_DEPOSIT_PERIOD",
  VOTING_PERIOD: "PROPOSAL_STATUS_VOTING_PERIOD",
  PASSED: "PROPOSAL_STATUS_PASSED",
  REJECTED: "PROPOSAL_STATUS_REJECTED",
  FAILED: "PROPOSAL_STATUS_FAILED",
} as const;

export const GovVoteOption = {
  YES: "VOTE_OPTION_YES",
  ABSTAIN: "VOTE_OPTION_ABSTAIN",
  NO: "VOTE_OPTION_NO",
  NO_WITH_VETO: "VOTE_OPTION_NO_WITH_VETO",
} as const;

// Numeric values used for v1beta1 tx messages
export const GovVoteOptionNum = {
  YES: 1,
  ABSTAIN: 2,
  NO: 3,
  NO_WITH_VETO: 4,
} as const;

export const GOV_VOTE_OPTION_LABELS: Record<string, string> = {
  [GovVoteOption.YES]: "Yes",
  [GovVoteOption.ABSTAIN]: "Abstain",
  [GovVoteOption.NO]: "No",
  [GovVoteOption.NO_WITH_VETO]: "No with Veto",
};

// API response types

export interface ListGovProposalsResponse {
  proposals: GovProposal[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface GetGovProposalResponse {
  proposal: GovProposal;
}

export interface ListGovVotesResponse {
  votes: GovVote[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface ListGovDepositsResponse {
  deposits: GovDeposit[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface GetGovTallyResponse {
  tally: GovTallyResult;
}

export interface GetGovParamsResponse {
  params: GovParams;
}
