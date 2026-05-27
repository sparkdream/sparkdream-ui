// Federation module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

// --- Enums ---

export const PeerType = {
  UNSPECIFIED: "PEER_TYPE_UNSPECIFIED",
  SPARK_DREAM: "PEER_TYPE_SPARK_DREAM",
  ACTIVITYPUB: "PEER_TYPE_ACTIVITYPUB",
  ATPROTO: "PEER_TYPE_ATPROTO",
} as const;
export type PeerTypeValue = (typeof PeerType)[keyof typeof PeerType];

export const PeerStatus = {
  PENDING: "PEER_STATUS_PENDING",
  ACTIVE: "PEER_STATUS_ACTIVE",
  SUSPENDED: "PEER_STATUS_SUSPENDED",
  REMOVED: "PEER_STATUS_REMOVED",
} as const;
export type PeerStatusValue = (typeof PeerStatus)[keyof typeof PeerStatus];

export const BridgeStatus = {
  UNSPECIFIED: "BRIDGE_STATUS_UNSPECIFIED",
  ACTIVE: "BRIDGE_STATUS_ACTIVE",
  SUSPENDED: "BRIDGE_STATUS_SUSPENDED",
  UNBONDING: "BRIDGE_STATUS_UNBONDING",
  REVOKED: "BRIDGE_STATUS_REVOKED",
} as const;
export type BridgeStatusValue = (typeof BridgeStatus)[keyof typeof BridgeStatus];

export const FederatedContentStatus = {
  PENDING_VERIFICATION: "FEDERATED_CONTENT_STATUS_PENDING_VERIFICATION",
  VERIFIED: "FEDERATED_CONTENT_STATUS_VERIFIED",
  ACTIVE: "FEDERATED_CONTENT_STATUS_ACTIVE",
  HIDDEN: "FEDERATED_CONTENT_STATUS_HIDDEN",
  DISPUTED: "FEDERATED_CONTENT_STATUS_DISPUTED",
  CHALLENGED: "FEDERATED_CONTENT_STATUS_CHALLENGED",
  REJECTED: "FEDERATED_CONTENT_STATUS_REJECTED",
} as const;
export type FederatedContentStatusValue =
  (typeof FederatedContentStatus)[keyof typeof FederatedContentStatus];

export const IdentityLinkStatus = {
  UNVERIFIED: "IDENTITY_LINK_STATUS_UNVERIFIED",
  VERIFIED: "IDENTITY_LINK_STATUS_VERIFIED",
  REVOKED: "IDENTITY_LINK_STATUS_REVOKED",
} as const;
export type IdentityLinkStatusValue =
  (typeof IdentityLinkStatus)[keyof typeof IdentityLinkStatus];

// --- State objects ---

// Cosmos SDK enums returned by the LCD as numeric strings or PROTO_NAME values
// depending on the runtime. We normalise to the proto-name form via lookup
// helpers below; treat type/status as strings everywhere in UI code.
export interface Peer {
  id: string;
  display_name: string;
  type: string;
  status: string;
  ibc_channel_id: string;
  registered_at: string;
  last_activity: string;
  registered_by: string;
  metadata: string;
  removed_at: string;
}

export interface PeerPolicy {
  peer_id: string;
  outbound_content_types: string[];
  inbound_content_types: string[];
  min_outbound_trust_level: number;
  inbound_rate_limit_per_epoch: string;
  outbound_rate_limit_per_epoch: string;
  allow_reputation_queries: boolean;
  accept_reputation_attestations: boolean;
  max_trust_credit: number;
  require_review: boolean;
  blocked_identities: string[];
}

// BridgeBinding: federation-side record per (operator, peer). Economic state
// (bond, status, slashing history) lives on x/service Operator keyed by
// (address, "federation-bridge-<protocol>"). See commit 0747637.
export interface BridgeBinding {
  address: string;
  peer_id: string;
  protocol: string;
  endpoint: string;
  registered_at: string;
  content_submitted: string;
  content_verified: string;
  content_rejected: string;
  content_unverified: string;
  last_submission_at: string;
  // Toggled by service hooks AfterOperatorUnderfunded / AfterOperatorReFunded.
  suspended: boolean;
}

// Legacy alias: older code refers to `BridgeOperator`, but post-0747637 the
// shape is BridgeBinding and the bond/status moved to x/service.
export type BridgeOperator = BridgeBinding;

export interface FederatedContent {
  id: string;
  peer_id: string;
  remote_content_id: string;
  content_type: string;
  creator_identity: string;
  creator_name: string;
  title: string;
  body: string;
  content_uri: string;
  protocol_metadata: string;
  remote_created_at: string;
  received_at: string;
  submitted_by: string;
  status: string;
  expires_at: string;
  content_hash: string;
}

export interface IdentityLink {
  local_address: string;
  peer_id: string;
  remote_identity: string;
  status: string;
  linked_at: string;
  verified_at: string;
  challenge: string;
}

export interface OutboundAttestation {
  id: string;
  peer_id: string;
  content_type: string;
  local_content_id: string;
  creator: string;
  submitted_by: string;
  published_at: string;
}

// --- Pagination helper ---

interface Pagination {
  next_key: string | null;
  total: string;
}

// --- Query response shapes ---

export interface ListPeersResponse {
  peers: Peer[];
  pagination: Pagination;
}

export interface GetPeerResponse {
  peer: Peer;
}

// Post-0747637 the federation LCD returns `bridge_bindings`; we keep the
// historical name on the alias for the old `list_bridge_operators` callers.
export interface ListBridgeBindingsResponse {
  bridge_bindings: BridgeBinding[];
  pagination: Pagination;
}
export type ListBridgeOperatorsResponse = ListBridgeBindingsResponse;

export interface ListFederatedContentResponse {
  content: FederatedContent[];
  pagination: Pagination;
}

export interface ListIdentityLinksResponse {
  links: IdentityLink[];
  pagination: Pagination;
}

export interface ListOutboundAttestationsResponse {
  attestations: OutboundAttestation[];
  pagination: Pagination;
}

// --- Helpers ---

// Pretty labels for peer status pills
export const PEER_STATUS_LABELS: Record<string, string> = {
  [PeerStatus.PENDING]: "Pending",
  [PeerStatus.ACTIVE]: "Active",
  [PeerStatus.SUSPENDED]: "Suspended",
  [PeerStatus.REMOVED]: "Removed",
};

export const PEER_TYPE_LABELS: Record<string, string> = {
  [PeerType.SPARK_DREAM]: "IBC",
  [PeerType.ACTIVITYPUB]: "ActivityPub",
  [PeerType.ATPROTO]: "AT Protocol",
};
