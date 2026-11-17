// x/storage (permanent copies) types matching the LCD JSON responses:
// snake_case fields, uint64/int64 as decimal strings, enums as their proto
// names. Proto: proto/sparkdream/storage/v1 in the chain repo.

import type { Pagination } from "@/types/blog";

export const RequestStatus = {
  UNSPECIFIED: "REQUEST_STATUS_UNSPECIFIED",
  PENDING: "REQUEST_STATUS_PENDING",
  CLAIMED: "REQUEST_STATUS_CLAIMED",
  COMPLETED: "REQUEST_STATUS_COMPLETED",
  SETTLED: "REQUEST_STATUS_SETTLED",
  REJECTED: "REQUEST_STATUS_REJECTED",
  EXPIRED: "REQUEST_STATUS_EXPIRED",
  CANCELLED: "REQUEST_STATUS_CANCELLED",
} as const;

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  [RequestStatus.UNSPECIFIED]: "Unknown",
  [RequestStatus.PENDING]: "Waiting for an operator",
  [RequestStatus.CLAIMED]: "Being copied",
  [RequestStatus.COMPLETED]: "Copied, not settled yet",
  [RequestStatus.SETTLED]: "Copied",
  [RequestStatus.REJECTED]: "Refused",
  [RequestStatus.EXPIRED]: "Expired",
  [RequestStatus.CANCELLED]: "Cancelled",
};

export const ClosedReason = {
  FLAGGED: "CLOSED_REASON_FLAGGED",
  DECLINED: "CLOSED_REASON_DECLINED",
  VOIDED: "CLOSED_REASON_VOIDED",
  EXPIRED: "CLOSED_REASON_EXPIRED",
  CANCELLED: "CLOSED_REASON_CANCELLED",
} as const;

export const CLOSED_REASON_LABELS: Record<string, string> = {
  [ClosedReason.FLAGGED]: "A content scanner flagged the file as removed content",
  [ClosedReason.DECLINED]: "Operators could not fetch the file, or it did not match the request",
  [ClosedReason.VOIDED]: "The copy was voided",
  [ClosedReason.EXPIRED]: "No operator copied the file in time",
  [ClosedReason.CANCELLED]: "Cancelled by the requester",
};

export const DECLINE_REASON_LABELS: Record<string, string> = {
  DECLINE_REASON_UNREACHABLE: "could not fetch the file",
  DECLINE_REASON_MISMATCH: "the file did not match the request",
};

export interface BackendType {
  content_type: string;
  scanned?: boolean;
  max_size: string;
}

export interface StorageBackend {
  name: string;
  service_type: string;
  kind: string;
  locator_format: string;
  enabled?: boolean;
  price_per_byte: string;
  min_fee: string;
  declines_to_close?: number;
  types: BackendType[];
}

export interface StorageSource {
  url: string;
  added_by: string;
  added_at?: string;
}

export interface StorageDecline {
  operator: string;
  member: string;
  reason: string;
}

export interface StorageRequest {
  /** Omitted by the gateway when zero. */
  id?: string;
  requester: string;
  backend: string;
  sha256: string;
  size_bytes: string;
  content_type: string;
  scanned?: boolean;
  sources?: StorageSource[];
  copy_fee: string;
  status: string;
  closed_reason?: string;
  created_at?: string;
  opened_at?: string;
  deadline?: string;
  operator?: string;
  controller?: string;
  claimed_at?: string;
  claim_expires_at?: string;
  locator?: string;
  verdicts_locator?: string;
  completed_at?: string;
  settle_at?: string;
  disputed?: boolean;
  paid_to?: string;
  paid_amount?: string;
  closed_at?: string;
  forfeit_at?: string;
  declined_by?: StorageDecline[];
}

export interface StorageParams {
  enabled?: boolean;
  min_requester_trust_level?: number;
  request_fee?: string;
  request_ttl_blocks?: string;
  max_sources_per_request?: number;
  max_url_bytes?: number;
  max_open_requests_per_requester?: number;
  max_operators_per_backend?: number;
  max_approved_scanners?: number;
  max_hashes_per_unflag?: number;
  max_reason_bytes?: number;
}

export interface StorageParamsResponse {
  params: StorageParams;
}

export interface StorageBackendsResponse {
  /** The chain sends each backend with its price bounds. */
  backends: StorageBackendWithBounds[];
  pagination?: Pagination;
}

export interface StorageRequestResponse {
  request: StorageRequest;
  /** The hash is flagged as removed content: sources and locators come back empty. */
  withheld?: boolean;
}

export interface StorageRequestsResponse {
  requests: StorageRequest[];
  pagination?: Pagination;
  withheld_ids?: string[];
}

export interface StorageQuote {
  copy_fee: string;
  request_fee: string;
  total: string;
}

/** The request's id as a string ("0" when the gateway omitted a zero). */
export function requestId(r: StorageRequest): string {
  return r.id ?? "0";
}

export function isOpen(r: StorageRequest): boolean {
  return r.status === RequestStatus.PENDING || r.status === RequestStatus.CLAIMED || r.status === RequestStatus.COMPLETED;
}

// ── Council and governance side (approvals, flags, prices) ──────────────

/** A backend with the governance bounds its two prices must stay inside. */
export interface StorageBackendWithBounds extends StorageBackend {
  min_price_per_byte: string;
  max_price_per_byte: string;
  min_min_fee: string;
  max_min_fee: string;
}

/** A controller's approval of a storage operator for one backend. */
export interface ApprovedOperator {
  backend: string;
  operator: string;
  /** The council recorded when the approval was given. */
  controller: string;
  height?: string;
  /** x/service no longer names the recorded controller: the approval does not count. */
  stale?: boolean;
}

export interface ApprovedOperatorsResponse {
  operators: ApprovedOperator[];
  pagination?: Pagination;
}

export interface ApprovedScanner {
  scanner: string;
  controller: string;
  height?: string;
  stale?: boolean;
}

export interface ApprovedScannersResponse {
  scanners: ApprovedScanner[];
  pagination?: Pagination;
}

export interface StorageCounter {
  window_start?: string;
  count?: string;
}

export interface OperatorStandingResponse {
  approved?: boolean;
  can_claim?: boolean;
  reason?: string;
  open_claims?: number;
  lapses?: StorageCounter;
  mismatch_declines?: StorageCounter;
  unreachable_declines?: StorageCounter;
  completions?: StorageCounter;
}

export interface StorageFlag {
  scanner: string;
  attestation_hash?: string;
  height?: string;
}

export interface RemovedHash {
  sha256: string;
  flags?: StorageFlag[];
  /** Requests whose fee is held because of the flags. */
  held?: string[];
}

export interface RemovedHashResponse {
  removed_hash: RemovedHash;
}

/** The module limits the council forms read (a subset of Params). */
export type StorageCouncilLimits = Pick<
  StorageParams,
  "max_operators_per_backend" | "max_approved_scanners" | "max_hashes_per_unflag" | "max_reason_bytes"
>;
