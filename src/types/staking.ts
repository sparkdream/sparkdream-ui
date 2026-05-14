// Cosmos SDK x/staking and x/distribution LCD response shapes.
// Field names are snake_case to match the chain's REST output verbatim.

export type ValidatorStatus =
  | "BOND_STATUS_BONDED"
  | "BOND_STATUS_UNBONDED"
  | "BOND_STATUS_UNBONDING"
  | "BOND_STATUS_UNSPECIFIED";

export interface ValidatorDescription {
  moniker: string;
  identity: string;
  website: string;
  security_contact: string;
  details: string;
}

export interface CommissionRates {
  rate: string;            // legacy Dec (e.g. "0.100000000000000000")
  max_rate: string;
  max_change_rate: string;
}

export interface Validator {
  operator_address: string;
  // consensus_pubkey/jailed/unbonding_height etc. are omitted — the UI
  // doesn't display them and the JSON shape varies per chain crypto.
  jailed: boolean;
  status: ValidatorStatus;
  tokens: string;          // integer, native denom
  delegator_shares: string; // legacy Dec
  description: ValidatorDescription;
  commission: {
    commission_rates: CommissionRates;
    update_time: string;
  };
  min_self_delegation: string;
  unbonding_height?: string;
  unbonding_time?: string;
}

export interface ListValidatorsResponse {
  validators: Validator[];
  pagination?: { next_key: string | null; total: string };
}

export interface DelegationResponse {
  delegation: {
    delegator_address: string;
    validator_address: string;
    shares: string;        // legacy Dec
  };
  balance: { denom: string; amount: string };
}

export interface ListDelegationsResponse {
  delegation_responses: DelegationResponse[];
  pagination?: { next_key: string | null; total: string };
}

export interface UnbondingEntry {
  creation_height: string;
  completion_time: string;  // RFC3339
  initial_balance: string;
  balance: string;
  unbonding_id?: string;
  unbonding_on_hold_ref_count?: string;
}

export interface UnbondingDelegation {
  delegator_address: string;
  validator_address: string;
  entries: UnbondingEntry[];
}

export interface ListUnbondingsResponse {
  unbonding_responses: UnbondingDelegation[];
  pagination?: { next_key: string | null; total: string };
}

// `reward[].amount` is a legacy DecCoin string (e.g. "1.234567890000000000"),
// not an integer — withdrawing floors to integer base-denom. Display has to
// account for the decimal point or BigInt() will throw.
export interface DelegatorReward {
  validator_address: string;
  reward: { denom: string; amount: string }[];
}

export interface DelegatorRewardsResponse {
  rewards: DelegatorReward[];
  total: { denom: string; amount: string }[];
}

export interface StakingPool {
  not_bonded_tokens: string;
  bonded_tokens: string;
}

export interface StakingPoolResponse {
  pool: StakingPool;
}

export interface StakingParams {
  unbonding_time: string;   // duration string, e.g. "1814400s"
  max_validators: number;
  max_entries: number;
  historical_entries: number;
  bond_denom: string;
  min_commission_rate?: string;
}

export interface StakingParamsResponse {
  params: StakingParams;
}

export interface BankBalanceResponse {
  balance: { denom: string; amount: string };
}
