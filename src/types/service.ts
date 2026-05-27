// x/service module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.
//
// Added in chain commit 95a0e38 (v1.0.4ish era). x/service is the SPARK-
// bonded accountability primitive for off-chain operators (Akash funders,
// pinning agents, federation bridges, external RPC, etc.). See
// docs/x-service-spec.md for the full design.

// --- Enums ---

export const OperatorStatus = {
  UNSPECIFIED: "OPERATOR_STATUS_UNSPECIFIED",
  ACTIVE: "OPERATOR_STATUS_ACTIVE",
  UNDERFUNDED: "OPERATOR_STATUS_UNDERFUNDED",
  UNBONDING: "OPERATOR_STATUS_UNBONDING",
  SLASHED: "OPERATOR_STATUS_SLASHED",
  RETIRED: "OPERATOR_STATUS_RETIRED",
} as const;
export type OperatorStatusValue = (typeof OperatorStatus)[keyof typeof OperatorStatus];

export const OPERATOR_STATUS_LABELS: Record<string, string> = {
  [OperatorStatus.UNSPECIFIED]: "Unknown",
  [OperatorStatus.ACTIVE]: "Active",
  [OperatorStatus.UNDERFUNDED]: "Underfunded",
  [OperatorStatus.UNBONDING]: "Unbonding",
  [OperatorStatus.SLASHED]: "Slashed",
  [OperatorStatus.RETIRED]: "Retired",
};

export const ReportStatus = {
  UNSPECIFIED: "REPORT_STATUS_UNSPECIFIED",
  PENDING: "REPORT_STATUS_PENDING",
  RESOLVED_T1: "REPORT_STATUS_RESOLVED_T1",
  ESCALATED: "REPORT_STATUS_ESCALATED",
  RESOLVED_T2: "REPORT_STATUS_RESOLVED_T2",
  AUTO_DISMISSED: "REPORT_STATUS_AUTO_DISMISSED",
  AUTO_TIMEOUT: "REPORT_STATUS_AUTO_TIMEOUT",
  CLOSED_OPERATOR_DISSOLVED: "REPORT_STATUS_CLOSED_OPERATOR_DISSOLVED",
} as const;
export type ReportStatusValue = (typeof ReportStatus)[keyof typeof ReportStatus];

export const REPORT_STATUS_LABELS: Record<string, string> = {
  [ReportStatus.UNSPECIFIED]: "Unknown",
  [ReportStatus.PENDING]: "Pending",
  [ReportStatus.RESOLVED_T1]: "Resolved (T1)",
  [ReportStatus.ESCALATED]: "Escalated",
  [ReportStatus.RESOLVED_T2]: "Resolved (Jury)",
  [ReportStatus.AUTO_DISMISSED]: "Auto-Dismissed",
  [ReportStatus.AUTO_TIMEOUT]: "Auto-Timeout",
  [ReportStatus.CLOSED_OPERATOR_DISSOLVED]: "Closed (Operator Dissolved)",
};

export const ReportTimeoutAction = {
  DISMISS: "REPORT_TIMEOUT_ACTION_DISMISS",
  ESCALATE: "REPORT_TIMEOUT_ACTION_ESCALATE",
} as const;

// --- State objects ---

export interface Operator {
  address: string;
  service_type: string;
  controller: string;
  // Bare math.Int string in bond-denom micro-units; the chain wraps it into
  // Coin via x/identity at the point of use.
  bond_amount: string;
  metadata: string;
  status: string;
  underfunded_since: string;
  unbond_complete_at: string;
  tier1_slashed_in_window: string;
  tier1_window_start: string;
  tier1_window_start_bond: string;
  registered_at: string;
  retired_at: string;
  total_lifetime_bond_blocks: string;
  last_bond_block_update_at: string;
}

export interface ServiceTypeConfig {
  service_type: string;
  description: string;
  min_bond_amount: string;
  unbonding_period_blocks: string;
  unilateral_slash_cap_bps: number;
  tier1_window_blocks: string;
  tier1_aggregate_cap_bps: number;
  tier1_cooldown_blocks: string;
  underfunded_grace_blocks: string;
  enabled: boolean;
  report_timeout_action: string;
  challenge_default_slash_bps: number;
}

export interface Report {
  report_id: string;
  operator_address: string;
  service_type: string;
  reporter: string;
  reason: string;
  filed_at: string;
  escalated_at: string;
  status: string;
  proposed_slash_bps: number;
  slash_amount: string;
  deposit: string;
  jury_case_id: string;
}

// --- Pagination ---

interface Pagination {
  next_key: string | null;
  total: string;
}

// --- Query responses ---

export interface QueryOperatorResponse {
  operator: Operator;
}

export interface QueryOperatorsResponse {
  operators: Operator[];
  pagination: Pagination;
}

export interface QueryServiceTypeResponse {
  config: ServiceTypeConfig;
}

export interface QueryServiceTypesResponse {
  configs: ServiceTypeConfig[];
  pagination: Pagination;
}

export interface QueryReportResponse {
  report: Report;
}

export interface QueryReportsByOperatorResponse {
  reports: Report[];
  pagination: Pagination;
}
