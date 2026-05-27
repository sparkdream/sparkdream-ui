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
