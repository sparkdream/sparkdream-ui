// Commons module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface Member {
  address: string;
  weight: string;
  metadata: string;
  added_at: string;
}

export interface Group {
  index: string;
  group_id: string;
  policy_address: string;
  parent_policy_address: string;
  electoral_policy_address: string;
  funding_weight: string;
  max_spend_per_epoch: string;
  update_cooldown: string;
  min_members: string;
  max_members: string;
  term_duration: string;
  current_term_expiration: string;
  activation_time: string;
  last_parent_update: string;
  futarchy_enabled: boolean;
  veto_policy_address: string;
}

export interface Proposal {
  id: string;
  council_name: string;
  policy_address: string;
  proposer: string;
  messages: { type_url: string; value: string }[];
  status: string;
  submit_time: string;
  voting_deadline: string;
  policy_version: string;
  metadata: string;
  execution_time: string;
  failed_reason: string;
}

export interface Vote {
  voter: string;
  option: number;
  metadata: string;
  submit_time: string;
}

export interface TallyResult {
  yes_weight: string;
  no_weight: string;
  abstain_weight: string;
  no_with_veto_weight: string;
}

export const ProposalStatus = {
  UNSPECIFIED: "PROPOSAL_STATUS_UNSPECIFIED",
  SUBMITTED: "PROPOSAL_STATUS_SUBMITTED",
  ACCEPTED: "PROPOSAL_STATUS_ACCEPTED",
  REJECTED: "PROPOSAL_STATUS_REJECTED",
  EXECUTED: "PROPOSAL_STATUS_EXECUTED",
  FAILED: "PROPOSAL_STATUS_FAILED",
  VETOED: "PROPOSAL_STATUS_VETOED",
  EXPIRED: "PROPOSAL_STATUS_EXPIRED",
} as const;

export const VoteOption = {
  UNSPECIFIED: 0,
  YES: 1,
  NO: 2,
  ABSTAIN: 3,
  NO_WITH_VETO: 4,
} as const;

export const VOTE_OPTION_LABELS: Record<number, string> = {
  [VoteOption.YES]: "Yes",
  [VoteOption.NO]: "No",
  [VoteOption.ABSTAIN]: "Abstain",
  [VoteOption.NO_WITH_VETO]: "No with Veto",
};

// API response types

export interface ListGroupsResponse {
  group: Group[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface GetCouncilMembersResponse {
  members: Member[];
}

export interface GetProposalResponse {
  proposal: Proposal;
  votes: Vote[];
  tally: TallyResult;
}

export interface ListProposalsResponse {
  proposals: Proposal[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}
