// Name module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface NameRecord {
  name: string;
  owner: string;
  data: string;
}

export interface OwnerInfo {
  address: string;
  primary_name: string;
  last_active_time: string;
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

export interface NameParams {
  blocked_names: string[];
  min_name_length: string;
  max_name_length: string;
  max_names_per_address: string;
  expiration_duration: string;
  registration_fee: { denom: string; amount: string };
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

export interface GetDisputeResponse {
  dispute: Dispute;
}

export interface ListDisputeResponse {
  dispute: Dispute[];
  pagination: Pagination;
}
