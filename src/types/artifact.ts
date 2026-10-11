// x/artifact (NFT) module types matching the LCD JSON responses.
// Field names are snake_case, as the LCD returns them. uint64/int64 and
// math.Int arrive as decimal strings, uint32 as numbers, enums as their
// proto names ("RECEIVE_POLICY_MEMBERS"). Missing fields are tolerated
// everywhere: the gateway may omit zero values.

import type { Pagination } from "@/types/blog";

export interface Coin {
  denom: string;
  amount: string;
}

// ---- Enums (string names as served by the LCD) ----------------------------

export const ContentStatus = {
  UNSPECIFIED: "CONTENT_STATUS_UNSPECIFIED",
  ACTIVE: "CONTENT_STATUS_ACTIVE",
  HIDDEN: "CONTENT_STATUS_HIDDEN",
} as const;

export const TokenLock = {
  NONE: "TOKEN_LOCK_NONE",
  LISTED: "TOKEN_LOCK_LISTED",
  PENDING_TRANSFER: "TOKEN_LOCK_PENDING_TRANSFER",
} as const;

export const ReceivePolicy = {
  UNSPECIFIED: "RECEIVE_POLICY_UNSPECIFIED",
  OPEN: "RECEIVE_POLICY_OPEN",
  MEMBERS: "RECEIVE_POLICY_MEMBERS",
  INBOX: "RECEIVE_POLICY_INBOX",
} as const;

export const InboxKind = {
  UNSPECIFIED: "INBOX_KIND_UNSPECIFIED",
  TRANSFER: "INBOX_KIND_TRANSFER",
  MINT: "INBOX_KIND_MINT",
} as const;

export const HideTargetKind = {
  UNSPECIFIED: "HIDE_TARGET_KIND_UNSPECIFIED",
  CLASS: "HIDE_TARGET_KIND_CLASS",
  TOKEN: "HIDE_TARGET_KIND_TOKEN",
} as const;

export const HideOutcome = {
  UNSPECIFIED: "HIDE_OUTCOME_UNSPECIFIED",
  PENDING: "HIDE_OUTCOME_PENDING",
  UNHIDDEN: "HIDE_OUTCOME_UNHIDDEN",
  OVERTURNED: "HIDE_OUTCOME_OVERTURNED",
  UPHELD: "HIDE_OUTCOME_UPHELD",
  EXPIRED: "HIDE_OUTCOME_EXPIRED",
  APPEAL_TIMEOUT: "HIDE_OUTCOME_APPEAL_TIMEOUT",
  TARGET_BURNED: "HIDE_OUTCOME_TARGET_BURNED",
} as const;

// The zero value is HOLDER, so a class that never set it may omit the field.
export const BurnAuthorization = {
  HOLDER: "BURN_AUTHORIZATION_HOLDER",
  ISSUER: "BURN_AUTHORIZATION_ISSUER",
  HOLDER_OR_ISSUER: "BURN_AUTHORIZATION_HOLDER_OR_ISSUER",
} as const;

export const RECEIVE_POLICY_LABELS: Record<string, string> = {
  [ReceivePolicy.UNSPECIFIED]: "Network default",
  [ReceivePolicy.OPEN]: "Open",
  [ReceivePolicy.MEMBERS]: "Members",
  [ReceivePolicy.INBOX]: "Inbox",
};

export const HIDE_OUTCOME_LABELS: Record<string, string> = {
  [HideOutcome.UNSPECIFIED]: "Unknown",
  [HideOutcome.PENDING]: "Hidden",
  [HideOutcome.UNHIDDEN]: "Unhidden",
  [HideOutcome.OVERTURNED]: "Overturned on appeal",
  [HideOutcome.UPHELD]: "Upheld on appeal",
  [HideOutcome.EXPIRED]: "Expired, content removed",
  [HideOutcome.APPEAL_TIMEOUT]: "Appeal timed out, restored",
  [HideOutcome.TARGET_BURNED]: "Token burned",
};

export const BURN_AUTHORIZATION_LABELS: Record<string, string> = {
  [BurnAuthorization.HOLDER]: "Holder",
  [BurnAuthorization.ISSUER]: "Issuer only",
  [BurnAuthorization.HOLDER_OR_ISSUER]: "Holder or issuer",
};

// ---- State objects --------------------------------------------------------

export interface ClassFlags {
  transferable?: boolean;
  burn_authorization?: string;
  token_metadata_mutable?: boolean;
}

export interface MintPolicy {
  public_mint_enabled?: boolean;
  price?: Coin;
  /** Unix seconds; "0" = immediately. */
  start_time?: string;
  /** Unix seconds; "0" = no end. */
  end_time?: string;
  /** 0 = unlimited. */
  per_address_limit?: number;
}

export interface RoyaltyShare {
  address: string;
  weight_bps?: number;
}

export interface ArtifactClass {
  id: string;
  owner: string;
  creator: string;
  name?: string;
  symbol?: string;
  description?: string;
  uri?: string;
  uri_hash?: string;
  token_uri_base?: string;
  flags?: ClassFlags;
  metadata_frozen?: boolean;
  /** "0" = unlimited. Counts tokens ever issued. */
  max_supply?: string;
  minting_closed?: boolean;
  next_token_id?: string;
  supply?: string;
  reserved_supply?: string;
  burned?: string;
  minters?: string[];
  mint_policy?: MintPolicy;
  payout_address?: string;
  royalty_bps?: number;
  royalty_recipients?: RoyaltyShare[];
  status?: string;
  media_flags?: number;
  media_rules_version?: number;
  /** Unix seconds. */
  created_at?: string;
  updated_at?: string;
}

export interface Attribute {
  key: string;
  value: string;
}

export interface TokenMetadata {
  name?: string;
  description?: string;
  uri?: string;
  uri_hash?: string;
  attributes?: Attribute[];
}

export interface Token {
  class_id: string;
  id: string;
  owner: string;
  minter?: string;
  metadata?: TokenMetadata;
  metadata_frozen?: boolean;
  lock?: string;
  listing_seq?: string;
  /** uspark. */
  deposit?: string;
  status?: string;
  media_flags?: number;
  media_rules_version?: number;
  /** Unix seconds. */
  minted_at?: string;
}

export interface Listing {
  class_id: string;
  token_id: string;
  seller: string;
  price: Coin;
  /** Unix seconds. */
  created_at?: string;
  expires_at?: string;
  nonce?: string;
}

export interface PendingClassOwner {
  class_id: string;
  proposed_owner: string;
  /** Unix seconds. */
  expires_at?: string;
}

export interface HideRecord {
  id: string;
  target_kind?: string;
  class_id: string;
  token_id?: string;
  /** "" for a council hide. */
  sentinel?: string;
  committed_amount?: string;
  reason?: string;
  reason_text?: string;
  /** Block height. */
  hidden_at?: string;
  /** Block height. */
  appeal_deadline?: string;
  appellant?: string;
  appealed?: boolean;
  appeal_id?: string;
  outcome?: string;
}

// ---- Query views ----------------------------------------------------------

export interface ClassView {
  class: ArtifactClass;
  /** True when the class is hidden and its content fields were blanked. */
  withheld?: boolean;
}

export interface TokenView {
  token: Token;
  withheld?: boolean;
  metadata_hash?: string;
  class_status?: string;
}

export interface InboxItem {
  kind?: string;
  class_id: string;
  token_id: string;
  /** Transfer sender, or minter. */
  from?: string;
  to?: string;
  /** Unix seconds. */
  created_at?: string;
  expires_at?: string;
  metadata?: TokenMetadata;
  metadata_hash?: string;
  withheld?: boolean;
}

export interface ArtifactParams {
  min_trust_level_create_class?: number;
  max_classes_per_creator?: number;
  default_receive_policy?: string;
  max_name_length?: number;
  max_symbol_length?: number;
  max_description_length?: number;
  max_uri_length?: number;
  max_attributes?: number;
  max_attribute_key_length?: number;
  max_attribute_value_length?: number;
  max_minters_per_class?: number;
  max_batch_size?: number;
  allowed_uri_schemes?: string[];
  max_royalty_bps?: number;
  sale_fee_bps?: number;
  class_creation_fee?: string;
  token_deposit?: string;
  inbox_fee?: string;
  /** Seconds. */
  pending_ttl?: string;
  /** Seconds. */
  max_listing_duration?: string;
  max_pending_per_pair?: number;
  max_inbox_per_recipient?: number;
  max_expirations_per_block?: number;
  market_enabled?: boolean;
  public_mint_enabled?: boolean;
  max_hides_per_sentinel_per_day?: number;
  sentinel_unhide_window_blocks?: string;
  hide_expiry_blocks?: string;
  sentinel_hide_commit_dream?: string;
}

// ---- Responses ------------------------------------------------------------

export interface ArtifactParamsResponse {
  params: ArtifactParams;
}

export interface ClassResponse {
  class: ClassView;
}

export interface ClassesResponse {
  classes: ClassView[];
  pagination?: Pagination;
}

export interface TokenResponse {
  token: TokenView;
  /** Set when the token is listed. */
  listing?: Listing | null;
}

export interface TokensResponse {
  tokens: TokenView[];
  pagination?: Pagination;
}

export interface SupplyResponse {
  supply?: string;
  burned?: string;
  reserved_supply?: string;
  max_supply?: string;
  minting_closed?: boolean;
}

export interface ListingResponse {
  listing: Listing;
}

export interface ListingsResponse {
  listings: Listing[];
  pagination?: Pagination;
}

export interface InboxResponse {
  items: InboxItem[];
  inbox_count?: number;
  pagination?: Pagination;
}

export interface OutboxResponse {
  items: InboxItem[];
  pagination?: Pagination;
}

export interface ReceivePolicyResponse {
  policy?: string;
  is_default?: boolean;
}

export interface PendingClassOwnerResponse {
  pending: PendingClassOwner;
}

export interface HideRecordResponse {
  record: HideRecord;
}

export interface HideRecordsByTargetResponse {
  records: HideRecord[];
}

export interface PublicMintQuoteResponse {
  total_price?: Coin;
  fee?: Coin;
  deposit?: Coin;
  /** "-1" = unlimited. */
  remaining_allowance?: string;
  available?: boolean;
  reason?: string;
}
