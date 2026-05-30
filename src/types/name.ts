// Name module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface NameRecord {
  name: string;
  owner: string;
  data: string;
  // target, when non-empty, overrides forward resolution: resolve(name) returns
  // this address instead of owner. Set/cleared via MsgSetTarget; the target
  // must call MsgAcceptTarget before it can set the name as its primary.
  target?: string;
  target_accepted?: boolean;
}

export interface OwnerInfo {
  address: string;
  primary_name: string;
  last_active_time: string;
  display_name: string;
}

export interface Dispute {
  name: string;
  claimant: string;
  filed_at: string;
  stake_amount: string;
  active: boolean;
  contest_challenge_id: string;
  contested_at: string;
  contest_succeeded: boolean;
}

// As of chain v1.0.11 fee fields are bare math.Int strings in bond-denom
// micro-units; the denom is resolved at runtime from x/identity.
export interface NameParams {
  blocked_names: string[];
  min_name_length: string;
  max_name_length: string;
  max_names_per_address: string;
  expiration_duration: string;
  registration_fee_amount: string;
  dispute_stake_dream: string;
  dispute_timeout_blocks: string;
  contest_stake_dream: string;
}

// API response types

export interface Pagination {
  next_key: string | null;
  total: string;
}

export interface NameParamsResponse {
  params: NameParams;
}

export interface ResolveResponse {
  name_record: NameRecord;
}

export interface ReverseResolveResponse {
  name: string;
}

export interface ListNamesResponse {
  names: NameRecord[];
  pagination: Pagination;
}

// Targets returns names where the address is the accepted resolver target.
// Pending (set-but-not-yet-accepted) targets cannot be enumerated; the target
// address must accept by name.
export interface ListTargetsResponse {
  names: NameRecord[];
  pagination: Pagination;
}

export interface GetOwnerInfoResponse {
  owner_info: OwnerInfo;
}

export interface GetDisputeResponse {
  dispute: Dispute;
}

export interface ListDisputeResponse {
  dispute: Dispute[];
  pagination: Pagination;
}
