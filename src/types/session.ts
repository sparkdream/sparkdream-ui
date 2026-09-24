// Session module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface Session {
  granter: string;
  grantee: string;
  allowed_msg_types: string[];
  spend_limit: { denom: string; amount: string };
  spent: { denom: string; amount: string };
  expiration: string;
  created_at: string;
  last_used_at: string;
  exec_count: string;
  max_exec_count: string;
}

// As of chain v1.0.11 `max_spend_limit` was renamed to `max_spend_limit_amount`
// (bare math.Int in bond-denom micro-units; denom resolved from x/identity).
// The chain also added P3 (RecurringPull), P4 (SpendingAllowance), and P5
// (ScheduledOneshot) grant-type params under the unified grant registry.
export interface SessionParams {
  max_allowed_msg_types: string[];
  allowed_msg_types: string[];
  max_sessions_per_granter: string;
  max_msg_types_per_session: string;
  max_expiration: string;
  max_spend_limit_amount: string;
  max_exec_count: string;
  // RecurringPull (P3)
  min_recurring_period_seconds?: string;
  max_recurring_duration_seconds?: string;
  max_recurring_pulls_per_granter?: number;
  // SpendingAllowance (P4)
  min_allowance_period_seconds?: string;
  max_allowances_per_granter?: number;
  max_allowance_recipient_list?: number;
  min_pull_amount?: string;
  // ScheduledOneshot (P5)
  min_schedule_delay_seconds?: string;
  max_schedule_horizon_seconds?: string;
  fire_to_expiry_buffer_seconds?: string;
  max_pending_oneshots_per_granter?: number;
  max_paused_oneshots_per_granter?: number;
  paused_oneshot_ttl_seconds?: string;
  min_oneshot_exec_gas?: string;
  max_oneshot_exec_gas?: string;
  oneshot_gas_price?: string;
  oneshot_creation_fee?: string;
  min_oneshot_deposit?: string;
  max_endblocker_dispatches_per_pass?: number;
  // Cross-type
  allowed_denoms?: string[];
  max_grant_lifetime_seconds?: string;
  authorized_grant_creators?: string[];
}

// API response types

export interface GetSessionResponse {
  session: Session;
}

export interface SessionsByGranterResponse {
  sessions: Session[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface SessionsByGranteeResponse {
  sessions: Session[];
  pagination: {
    next_key: string | null;
    total: string;
  };
}

export interface AllowedMsgTypesResponse {
  max_allowed_msg_types: string[];
  allowed_msg_types: string[];
}

export interface SessionParamsResponse {
  params: SessionParams;
}

// ── Unified grant registry ──────────────────────────────────────────
// LCD renders enums as their proto names, int64/uint64 as strings,
// Timestamps as RFC 3339, and the payload oneof as its member field.

export type GrantType =
  | "GRANT_TYPE_UNSPECIFIED"
  | "GRANT_TYPE_SESSION_KEY"
  | "GRANT_TYPE_RECURRING_PULL"
  | "GRANT_TYPE_SPENDING_ALLOWANCE"
  | "GRANT_TYPE_SCHEDULED_ONESHOT";

export type GrantStatus =
  | "GRANT_STATUS_UNSPECIFIED"
  | "GRANT_STATUS_ACTIVE"
  | "GRANT_STATUS_PAUSED_INSUFFICIENT_FUNDS"
  | "GRANT_STATUS_DECLINED"
  | "GRANT_STATUS_REVOKED"
  | "GRANT_STATUS_COMPLETED"
  | "GRANT_STATUS_FIRED";

export interface Coin {
  denom: string;
  amount: string;
}

export interface SessionKeyPayload {
  allowed_msg_types?: string[];
  spend_limit?: Coin;
  spent?: Coin;
  max_exec_count?: string;
  exec_count?: string;
  last_used_at?: string;
  allow_self_revoke?: boolean;
}

// start_time / last_claim_advance are unix seconds. The next claim opens at
// last_claim_advance + period_seconds; each claim advances it by one period.
export interface RecurringPullPayload {
  amount_per_period?: Coin;
  period_seconds?: string;
  start_time?: string;
  last_claim_advance?: string;
  claims_made?: string;
  max_per_epoch?: string;
}

// current_period_start is unix seconds; the window resets lazily on the
// first pull after current_period_start + period_seconds.
export interface SpendingAllowancePayload {
  max_per_period?: Coin;
  period_seconds?: string;
  current_period_start?: string;
  spent_in_current_period?: Coin;
  allowed_recipients?: string[];
  denom?: string;
}

export interface OneshotTransfer {
  recipient?: string;
  amount?: Coin;
}

export interface OneshotExec {
  msg?: { "@type": string; [key: string]: unknown };
  gas_limit?: string;
}

// fire_at is unix seconds.
export interface ScheduledOneshotPayload {
  transfer?: OneshotTransfer;
  exec?: OneshotExec;
  fire_at?: string;
  fire_error?: string;
}

export interface Grant {
  id: string;
  granter: string;
  grantee: string;
  type: GrantType;
  status: GrantStatus;
  created_at: string;
  expires_at: string;
  note?: string;
  session_key?: SessionKeyPayload;
  recurring_pull?: RecurringPullPayload;
  spending_allowance?: SpendingAllowancePayload;
  scheduled_oneshot?: ScheduledOneshotPayload;
}

export interface GetGrantResponse {
  grant: Grant;
}

export interface GrantsResponse {
  grants: Grant[];
}
