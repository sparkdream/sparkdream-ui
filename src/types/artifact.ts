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
  RENTED: "TOKEN_LOCK_RENTED",
  NESTED: "TOKEN_LOCK_NESTED",
  AUCTION: "TOKEN_LOCK_AUCTION",
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
  UNIT_TRANSFER: "INBOX_KIND_UNIT_TRANSFER",
  UNIT_MINT: "INBOX_KIND_UNIT_MINT",
} as const;

/** Unit (edition) inbox items carry class_id 0; the token_id is the pending id. */
export function isUnitInboxKind(kind?: string): boolean {
  return kind === InboxKind.UNIT_TRANSFER || kind === InboxKind.UNIT_MINT;
}

export const HideTargetKind = {
  UNSPECIFIED: "HIDE_TARGET_KIND_UNSPECIFIED",
  CLASS: "HIDE_TARGET_KIND_CLASS",
  TOKEN: "HIDE_TARGET_KIND_TOKEN",
  EDITION: "HIDE_TARGET_KIND_EDITION",
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
  NEITHER: "BURN_AUTHORIZATION_NEITHER",
} as const;

// Zero values: NONE / FIXED / NONE / UNIQUE, so a class that never set them
// may omit the field.
export const ExpiryMode = {
  NONE: "EXPIRY_MODE_NONE",
  MARK: "EXPIRY_MODE_MARK",
  BURN: "EXPIRY_MODE_BURN",
} as const;

export const MintPricing = {
  FIXED: "MINT_PRICING_FIXED",
  LINEAR_SUPPLY: "MINT_PRICING_LINEAR_SUPPLY",
  DUTCH: "MINT_PRICING_DUTCH",
} as const;

export const RevealKind = {
  NONE: "REVEAL_KIND_NONE",
  BLIND_METADATA: "REVEAL_KIND_BLIND_METADATA",
  GENERATIVE_SEED: "REVEAL_KIND_GENERATIVE_SEED",
} as const;

export const TokenModel = {
  UNIQUE: "TOKEN_MODEL_UNIQUE",
  EDITIONS: "TOKEN_MODEL_EDITIONS",
} as const;

export const EXPIRY_MODE_LABELS: Record<string, string> = {
  [ExpiryMode.NONE]: "Never expires",
  [ExpiryMode.MARK]: "Marked expired",
  [ExpiryMode.BURN]: "Burned on expiry",
};

export const MINT_PRICING_LABELS: Record<string, string> = {
  [MintPricing.FIXED]: "Fixed price",
  [MintPricing.LINEAR_SUPPLY]: "Rises with supply",
  [MintPricing.DUTCH]: "Falls over time (Dutch)",
};

export const REVEAL_KIND_LABELS: Record<string, string> = {
  [RevealKind.NONE]: "None",
  [RevealKind.BLIND_METADATA]: "Blind mint",
  [RevealKind.GENERATIVE_SEED]: "Generative seed",
};

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
  [BurnAuthorization.NEITHER]: "No one",
};

// ---- State objects --------------------------------------------------------

export interface ClassFlags {
  transferable?: boolean;
  burn_authorization?: string;
  token_metadata_mutable?: boolean;
  /** Mint and transfer need the recipient's acceptance (badges). */
  mutual?: boolean;
  /** Tokens can be redeemed (tickets). */
  redeemable?: boolean;
  /** Redeemed tokens stay transferable. */
  redeemed_transferable?: boolean;
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
  pricing?: string;
  /** math.Int, LINEAR_SUPPLY: added to the price per public mint so far. */
  price_step?: string;
  /** math.Int, DUTCH: the price falls linearly from `price` at start_time to this at end_time. */
  floor_price?: string;
}

export interface ExpiryPolicy {
  mode?: string;
  /** Seconds a token lives (from mint or last renewal). */
  term?: string;
  renewal_price?: Coin;
}

export interface RevealPolicy {
  kind?: string;
  /** Hex Merkle root (blind) or seed commitment (generative). */
  commitment?: string;
  /** Unix seconds by which the reveal must happen. */
  deadline?: string;
  revealed_at?: string;
  /** Hex seed, once revealed. */
  seed?: string;
}

export interface Renderer {
  pkg_path?: string;
  source_hash?: string;
  state_version?: number;
}

export interface HarbergerPolicy {
  tax_bps_per_year?: number;
  /** Seconds between tax pulls. */
  tax_period?: string;
  /** Seconds a delinquent token waits before foreclosure. */
  foreclosure_duration?: string;
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
  expiry?: ExpiryPolicy;
  reveal?: RevealPolicy;
  renderer?: Renderer;
  royalty_locked?: boolean;
  public_minted?: string;
  token_model?: string;
  harberger?: HarbergerPolicy;
  crafting_locked?: boolean;
  next_recipe_id?: string;
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
  /** Set when a session key paid the deposit: the granter that paid it gets
   *  the refund instead of the holder or burner (chain v1.0.57). */
  deposit_payer?: string;
  status?: string;
  media_flags?: number;
  media_rules_version?: number;
  /** Unix seconds. */
  minted_at?: string;
  /** Unix seconds; "0" = never. */
  expires_at?: string;
  /** Unix seconds; "0" = not redeemed. */
  redeemed_at?: string;
  schedule?: MetadataStage[];
  media_versions?: TokenMetadata[];
  /** 0 = the stored metadata; n = media_versions[n-1]. */
  displayed_version?: number;
  unrevealed?: boolean;
  /** uspark held in escrow until reveal. */
  paid?: string;
  next_media_proposal_id?: string;
  harberger?: HarbergerState;
  parent?: TokenRef;
  descendants?: number;
}

export interface TokenRef {
  class_id: string;
  token_id: string;
}

export interface MetadataStage {
  /** Unix seconds from which this stage displays. */
  from_time?: string;
  metadata?: TokenMetadata;
}

export interface MediaProposal {
  class_id: string;
  token_id: string;
  id: string;
  proposer: string;
  metadata?: TokenMetadata;
  created_at?: string;
}

export interface HarbergerState {
  /** math.Int self-assessed price, uspark. */
  price?: string;
  grant_id?: string;
  next_due?: string;
  grace_until?: string;
  foreclosed_at?: string;
  tax_paid?: string;
  /** math.Int price the paid-through window (now to next_due) was assessed
   *  at (chain v1.0.57). Raising the price above it within the window
   *  charges the extra tax for that time up front. */
  paid_price?: string;
}

export interface Rental {
  class_id: string;
  token_id: string;
  owner: string;
  user: string;
  started_at?: string;
  expires_at?: string;
  owner_may_end?: boolean;
  price?: Coin;
}

export interface RentalOffer {
  class_id: string;
  token_id: string;
  owner: string;
  /** "" = anyone may accept. */
  user?: string;
  price?: Coin;
  /** Seconds the rental lasts once accepted. */
  duration?: string;
  owner_may_end?: boolean;
  created_at?: string;
  expires_at?: string;
  nonce?: string;
}

export interface ImpactClaim {
  scope?: string;
  contributors?: string[];
  work_start?: string;
  work_end?: string;
  initiative_id?: string;
}

export interface Edition {
  class_id: string;
  id: string;
  creator: string;
  metadata?: TokenMetadata;
  metadata_frozen?: boolean;
  /** "0" = unlimited. */
  max_supply?: string;
  supply?: string;
  burned?: string;
  reserved?: string;
  status?: string;
  media_flags?: number;
  media_rules_version?: number;
  created_at?: string;
  claim?: ImpactClaim;
  reward_per_unit?: string;
  rewards_funded?: string;
  holders?: string;
}

export interface Balance {
  class_id: string;
  edition_id: string;
  owner: string;
  amount?: string;
  locked?: string;
  deposit?: string;
  /** Set when a session key paid the deposit: the granter that paid it gets
   *  the refund instead of the holder or burner (chain v1.0.57). */
  deposit_payer?: string;
  reward_debt?: string;
  unclaimed?: string;
}

export interface UnitListing {
  id: string;
  class_id: string;
  edition_id: string;
  seller: string;
  quantity?: string;
  unit_price?: Coin;
  created_at?: string;
  expires_at?: string;
}

export interface CraftInput {
  class_id: string;
  edition_id: string;
  quantity?: string;
}

export interface CraftRecipe {
  class_id: string;
  id: string;
  inputs?: CraftInput[];
  output_metadata?: TokenMetadata;
  /** "0" = the output is a unique token. */
  output_edition_id?: string;
  output_quantity?: string;
  crafts?: string;
}

export interface Offer {
  id: string;
  bidder: string;
  class_id: string;
  /** "0" = a collection offer on any token of the class. */
  token_id: string;
  price?: Coin;
  created_at?: string;
  expires_at?: string;
  expected_metadata_hash?: string;
  expected_contents_hash?: string;
}

export interface Auction {
  id: string;
  class_id: string;
  token_id: string;
  seller: string;
  reserve_price?: Coin;
  min_increment_bps?: number;
  created_at?: string;
  ends_at?: string;
  high_bidder?: string;
  /** math.Int, in the reserve price's denom. */
  high_bid?: string;
  bids?: number;
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
  /** What to show: schedule stage, accepted media version, renderer output, or the stored metadata. */
  displayed_metadata?: TokenMetadata;
  /** "stored" | "schedule" | "media_version" | "renderer" | "unrevealed". */
  display_source?: string;
  /** Set when a renderer failed and the view fell back. */
  render_error?: string;
  expired?: boolean;
  /** Hex seed of a revealed generative class. */
  seed?: string;
  /** Single-token query only: hash over nested contents. */
  contents_hash?: string;
  /** Single-token query only: the renter while rented. */
  user?: string;
  /** Single-token query only: Harberger self-assessed price. */
  harberger_price?: string;
}

export interface EditionView {
  edition: Edition;
  withheld?: boolean;
  metadata_hash?: string;
  class_status?: string;
}

export interface BalanceView {
  balance: Balance;
  /** uspark of retro funding claimable now. */
  claimable?: string;
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
  /** Unit items: the edition's class (class_id is 0). */
  unit_class_id?: string;
  edition_id?: string;
  amount?: string;
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
  max_issue_batch_size?: number;
  max_schedule_stages?: number;
  max_media_proposals_per_token?: number;
  max_media_versions_per_token?: number;
  renderers_enabled?: boolean;
  max_nest_depth?: number;
  max_nested_tokens?: number;
  /** Seconds. */
  max_rental_duration?: string;
  max_craft_recipes_per_class?: number;
  max_offers_per_bidder?: number;
  /** Seconds a late bid extends an auction by. */
  auction_extension?: string;
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
  /** Set while the token is auctioned. */
  auction?: Auction | null;
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
  /** Price of the next unit under the class's pricing curve. */
  unit_price?: Coin;
  /** The highest unit price in the requested quantity: pass as MsgPublicMint's max_price. */
  max_unit_price?: Coin;
}

export interface MediaProposalsResponse {
  proposals: MediaProposal[];
}

export interface EditionResponse {
  edition: EditionView;
}

export interface EditionsResponse {
  editions: EditionView[];
  pagination?: Pagination;
}

export interface BalanceResponse {
  balance: BalanceView;
}

export interface BalancesResponse {
  balances: BalanceView[];
  pagination?: Pagination;
}

export interface UnitListingResponse {
  listing: UnitListing;
}

export interface UnitListingsResponse {
  listings: UnitListing[];
  pagination?: Pagination;
}

export interface CraftRecipesResponse {
  recipes: CraftRecipe[];
  locked?: boolean;
}

export interface RentalResponse {
  rental: Rental;
}

export interface RentalOfferResponse {
  offer: RentalOffer;
}

export interface RentalsResponse {
  rentals: Rental[];
  pagination?: Pagination;
}

export interface RentalOffersResponse {
  offers: RentalOffer[];
  pagination?: Pagination;
}

export interface ChildrenResponse {
  children: TokenRef[];
  contents_hash?: string;
  descendants?: number;
}

export interface HarbergerQuoteResponse {
  state?: HarbergerState;
  current_price?: string;
  tax_per_period?: string;
  foreclosed?: boolean;
  for_sale?: boolean;
}

export interface OfferResponse {
  offer: Offer;
}

export interface OffersResponse {
  offers: Offer[];
  pagination?: Pagination;
}

export interface AuctionResponse {
  auction: Auction;
  /** math.Int: the lowest bid the chain accepts now. */
  min_next_bid?: string;
}

export interface AuctionsResponse {
  auctions: Auction[];
  pagination?: Pagination;
}
