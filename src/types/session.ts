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

export interface SessionParams {
  max_allowed_msg_types: string[];
  allowed_msg_types: string[];
  max_sessions_per_granter: string;
  max_msg_types_per_session: string;
  max_expiration: string;
  max_spend_limit: { denom: string; amount: string };
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
