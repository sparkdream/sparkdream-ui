// x/vault (shared accounts) types matching the LCD JSON responses: snake_case
// fields, uint64/int64 as decimal strings, enums as their proto names.

import type { Pagination } from "@/types/blog";

export const VaultProposalStatus = {
  UNSPECIFIED: "PROPOSAL_STATUS_UNSPECIFIED",
  PENDING: "PROPOSAL_STATUS_PENDING",
  EXECUTED: "PROPOSAL_STATUS_EXECUTED",
  CANCELLED: "PROPOSAL_STATUS_CANCELLED",
  EXPIRED: "PROPOSAL_STATUS_EXPIRED",
  /** A vault update (or another executed proposal) changed the config it was made against. */
  INVALIDATED: "PROPOSAL_STATUS_INVALIDATED",
} as const;

/** Enum numbers, for query parameters: the REST gateway only takes an enum by number. */
export const VAULT_PROPOSAL_STATUS_NUMBER: Record<string, number> = {
  [VaultProposalStatus.UNSPECIFIED]: 0,
  [VaultProposalStatus.PENDING]: 1,
  [VaultProposalStatus.EXECUTED]: 2,
  [VaultProposalStatus.CANCELLED]: 3,
  [VaultProposalStatus.EXPIRED]: 4,
  [VaultProposalStatus.INVALIDATED]: 5,
};

export const VAULT_PROPOSAL_STATUS_LABELS: Record<string, string> = {
  [VaultProposalStatus.UNSPECIFIED]: "Unknown",
  [VaultProposalStatus.PENDING]: "Collecting approvals",
  [VaultProposalStatus.EXECUTED]: "Executed",
  [VaultProposalStatus.CANCELLED]: "Cancelled",
  [VaultProposalStatus.EXPIRED]: "Expired",
  [VaultProposalStatus.INVALIDATED]: "Invalidated by a vault change",
};

// Fixed limits (x/vault/types/types.go), not params.
export const VAULT_LIMITS = {
  maxSigners: 10,
  maxSignerWeight: 1000,
  maxMessagesPerProposal: 16,
  /** Pending proposals one signer may have open per vault, plus update-only slots. */
  maxPendingPerProposer: 8,
  maxPendingUpdatesPerProposer: 2,
  maxLabelLength: 64,
  maxMemoLength: 256,
  /** Seconds; network builds. Test builds allow 10 s. */
  minProposalTtl: 3600,
  maxProposalTtl: 30 * 24 * 3600,
} as const;

export interface VaultSigner {
  address: string;
  /** uint64 as a string. */
  weight: string;
  /** Chain-set; omitted when false. An entry listed by someone else stays
   *  unaccepted (no weight, can't act) until its address accepts it. */
  accepted?: boolean;
  /** Chain-set unix seconds after which an unaccepted entry is removed
   *  (chain v1.0.57). "0" or omitted on accepted entries and on a vault's
   *  only entry, which never expires. */
  invite_expires_at?: string;
}

/** Unix seconds an unaccepted listing lapses, or null when it doesn't. */
export function inviteExpiry(s: VaultSigner): number | null {
  if (s.accepted) return null;
  const t = parseInt(s.invite_expires_at || "0", 10);
  return Number.isFinite(t) && t > 0 ? t : null;
}

export function formatInviteExpiry(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export interface Vault {
  vault_id: string;
  /** The keyless module-derived account that holds the funds. */
  address: string;
  signers: VaultSigner[];
  threshold: string;
  /** Bumped by every MsgUpdateVault; proposals made against an older one are invalid. */
  config_version: string;
  /** Seconds a proposal stays open. */
  proposal_ttl: string;
  label?: string;
  /** Unix seconds. */
  created_at?: string;
}

/** An inner message as the LCD renders an Any: "@type" plus its JSON fields. */
export interface VaultInnerMessage {
  "@type": string;
  [field: string]: unknown;
}

export interface VaultProposal {
  proposal_id: string;
  vault_id: string;
  proposer: string;
  messages?: VaultInnerMessage[];
  /** base64 sha256 over the messages; MsgApprove must echo it. */
  messages_hash: string;
  config_version: string;
  /** Canonical addresses of the signers who approved. */
  approvals?: string[];
  status: string;
  /** Unix seconds. */
  expires_at?: string;
  memo?: string;
  resolved_at?: string;
}

export interface VaultParams {
  creation_enabled?: boolean;
  /** Bond-denom micro amount, burned on creation. */
  creation_fee_amount?: string;
}

export interface VaultParamsResponse {
  params: VaultParams;
}

export interface VaultResponse {
  vault: Vault;
}

export interface VaultsResponse {
  vaults: Vault[];
  pagination?: Pagination;
}

export interface VaultProposalResponse {
  vault_proposal: VaultProposal;
}

export interface VaultProposalsResponse {
  proposals: VaultProposal[];
  pagination?: Pagination;
}

export interface VaultTallyResponse {
  approved_weight?: string;
  threshold?: string;
  met?: boolean;
}
