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
  /** Unix seconds of the parent's last MsgUpdateGroupConfig (0 = never). */
  last_config_update?: string;
  /** Enum name; absent or UNSPECIFIED reads as OPEN. */
  ballot_mode?: string;
}

export const BallotMode = {
  UNSPECIFIED: "BALLOT_MODE_UNSPECIFIED",
  OPEN: "BALLOT_MODE_OPEN",
  SECRET: "BALLOT_MODE_SECRET",
  PROPOSER_CHOICE: "BALLOT_MODE_PROPOSER_CHOICE",
} as const;

/** Proto numbers, for MsgRegisterGroup / MsgUpdateGroupConfig. */
export const BallotModeNumber: Record<string, number> = {
  [BallotMode.UNSPECIFIED]: 0,
  [BallotMode.OPEN]: 1,
  [BallotMode.SECRET]: 2,
  [BallotMode.PROPOSER_CHOICE]: 3,
};

/** A group's effective ballot mode (UNSPECIFIED and absent read as OPEN). */
export function groupBallotMode(group: Pick<Group, "ballot_mode">): string {
  const m = group.ballot_mode;
  return !m || m === BallotMode.UNSPECIFIED ? BallotMode.OPEN : m;
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
  /** Voted only with MsgAnonymousVoteProposal against the voter snapshot. */
  secret_ballot?: boolean;
  /** base64 root of the voter snapshot (secret ballots). */
  voter_root?: string;
  ballot_member_count?: string;
  ballot_member_weight?: string;
}

export interface Vote {
  voter: string;
  // Enum name as the LCD serializes it ("VOTE_OPTION_YES"), not the proto
  // number. Run it through `parseVoteOption` before comparing or labelling.
  option: string;
  metadata: string;
  submit_time: string;
}

export interface TallyResult {
  yes_weight: string;
  no_weight: string;
  abstain_weight: string;
  no_with_veto_weight: string;
}

// Category defines a governance-curated content category. Created by the
// Commons Council (or Operations Committee). Consumed by x/forum, x/blog,
// x/collect, and other content modules.
export interface Category {
  category_id: string;
  title: string;
  description: string;
  members_only_write: boolean;
  admin_only_write: boolean;
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

const VOTE_OPTION_BY_NAME: Record<string, number> = {
  VOTE_OPTION_UNSPECIFIED: VoteOption.UNSPECIFIED,
  VOTE_OPTION_YES: VoteOption.YES,
  VOTE_OPTION_NO: VoteOption.NO,
  VOTE_OPTION_ABSTAIN: VoteOption.ABSTAIN,
  VOTE_OPTION_NO_WITH_VETO: VoteOption.NO_WITH_VETO,
};

/**
 * Map a vote option as returned by the LCD to its proto number. The REST API
 * serializes the enum as its string name (`VOTE_OPTION_YES`) while the rest of
 * the UI keys off the numbers, so `Vote.option` has to come through here before
 * it can pick a label or a color. Unknown names fall back to UNSPECIFIED,
 * which renders as "?" rather than mislabelling the vote.
 */
export function parseVoteOption(option: string): number {
  return VOTE_OPTION_BY_NAME[option] ?? VoteOption.UNSPECIFIED;
}

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

export interface PolicyPermissions {
  policy_address: string;
  allowed_messages: string[];
}

export interface GetPolicyPermissionsResponse {
  policy_permissions: PolicyPermissions;
}

/** Secret-ballot votes cast through x/shield, one per member of the voter snapshot. */
export interface AnonVoteTally {
  yes_count?: string;
  no_count?: string;
  abstain_count?: string;
  no_with_veto_count?: string;
}

export interface GetProposalResponse {
  proposal: Proposal;
  votes: Vote[];
  tally: TallyResult;
  /** Absent on nodes older than the anonymous-tally query field. */
  anon_tally?: AnonVoteTally;
}

export interface ListProposalsResponse {
  proposals: Proposal[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface GetCategoryResponse {
  category: Category;
}

export interface ListCategoryResponse {
  category: Category[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

/** x/commons module parameters (LCD shape). */
export interface CommonsParams {
  /**
   * Minimum tx fee required to submit a MsgSubmitProposal containing a
   * non-exempt inner message. Encoded as a `sdk.Coins`-formatted string
   * (e.g. `"5000000uspark"`). Empty string disables the fee.
   */
  proposal_fee: string;
}

export interface CommonsParamsResponse {
  params: CommonsParams;
}

// ── Polls ───────────────────────────────────────────────────────────

export const PollStatus = {
  UNSPECIFIED: "POLL_STATUS_UNSPECIFIED",
  OPEN: "POLL_STATUS_OPEN",
  CLOSED: "POLL_STATUS_CLOSED",
  CANCELLED: "POLL_STATUS_CANCELLED",
} as const;

/** Proto numbers, for the ListPolls status filter. */
export const PollStatusNumber: Record<string, number> = {
  [PollStatus.UNSPECIFIED]: 0,
  [PollStatus.OPEN]: 1,
  [PollStatus.CLOSED]: 2,
  [PollStatus.CANCELLED]: 3,
};

/** A non-binding, single-choice question put to a group's members. */
export interface Poll {
  id: string;
  council_name: string;
  creator: string;
  question: string;
  options: string[];
  secret_ballot?: boolean;
  /** Unix seconds. */
  opened_at: string;
  /** Unix seconds voting closes. */
  deadline: string;
  status: string;
  /** tallies[i] counts the votes for options[i]; may be omitted while empty. */
  tallies?: string[];
  voter_root?: string;
  /** Group size (open poll) or snapshot leaf count (secret poll). */
  eligible_voters?: string;
  closed_at?: string;
}

export interface PollVote {
  poll_id: string;
  voter: string;
  option: string;
  voted_at: string;
}

export interface GetPollResponse {
  poll: Poll;
}

export interface ListPollsResponse {
  polls: Poll[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface GetPollVotesResponse {
  votes: PollVote[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

/** A secret ballot's voter snapshot; the shape of x/rep's trust_tree query. */
export interface VoterTree {
  /** base64 */
  root: string;
  depth: number;
  leaves: { index: string; hash: string }[];
  member_count?: string;
  member_weight?: string;
}

export interface VoterTreeResponse {
  tree: VoterTree;
}
