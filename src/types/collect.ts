// Collect module types matching Cosmos SDK proto JSON responses.
// Field names use snake_case to match the LCD REST API response format.

export interface Collection {
  id: string;
  owner: string;
  name: string;
  description: string;
  cover_uri: string;
  tags: string[];
  encrypted_data: string;
  type: string;
  visibility: string;
  encrypted: boolean;
  item_count: number;
  collaborator_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  deposit_amount: string;
  item_deposit_total: string;
  deposit_burned: boolean;
  sponsored_by: string;
  community_feedback_enabled: boolean;
  status: string;
  upvote_count: number;
  downvote_count: number;
  endorsed_by: string;
  seeking_endorsement: boolean;
  immutable: boolean;
  conviction_sustained: boolean;
  initiative_id: string;
}

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface NftReference {
  chain_id: string;
  contract_address: string;
  token_id: string;
  token_standard: string;
  token_uri: string;
}

export interface LinkReference {
  uri: string;
  content_hash: string;
  content_type: string;
}

export interface OnChainReference {
  module: string;
  entity_type: string;
  entity_id: string;
}

export interface CustomReference {
  type_label: string;
  value: string;
  extra: KeyValuePair[];
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  added_by: string;
  title: string;
  description: string;
  image_uri: string;
  reference_type: string;
  nft: NftReference | null;
  link: LinkReference | null;
  on_chain: OnChainReference | null;
  custom: CustomReference | null;
  attributes: KeyValuePair[];
  encrypted_data: string;
  position: number;
  added_at: string;
  status: string;
  upvote_count: number;
  downvote_count: number;
}

export interface Collaborator {
  collection_id: string;
  address: string;
  role: string;
  added_at: string;
}

// Collect-specific per-curator counters. The bond/status/registration record
// for a curator now lives in x/rep as BondedRole (ROLE_TYPE_COLLECT_CURATOR);
// see types/rep.ts.
export interface CuratorActivity {
  address: string;
  total_reviews: string;
  challenged_reviews: string;
  upheld_reviews: string;
  overturned_reviews: string;
  consecutive_overturns: string;
  consecutive_upheld: string;
  epoch_reviews: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface CurationReview {
  id: string;
  collection_id: string;
  curator: string;
  verdict: string;
  tags: string[];
  comment: string;
  created_at: string;
  challenged: boolean;
  overturned: boolean;
  challenger: string;
}

export interface CurationSummary {
  collection_id: string;
  up_count: number;
  down_count: number;
  top_tags: TagCount[];
  last_reviewed_at: string;
}

export interface SponsorshipRequest {
  collection_id: string;
  requester: string;
  collection_deposit: string;
  item_deposit_total: string;
  requested_at: string;
  expires_at: string;
}

export interface Endorsement {
  collection_id: string;
  endorser: string;
  dream_stake: string;
  endorsed_at: string;
  stake_release_at: string;
  stake_released: boolean;
}

// Enums

export const CollectionType = {
  NFT: "COLLECTION_TYPE_NFT",
  LINK: "COLLECTION_TYPE_LINK",
  ONCHAIN: "COLLECTION_TYPE_ONCHAIN",
  MIXED: "COLLECTION_TYPE_MIXED",
} as const;

export const COLLECTION_TYPE_LABELS: Record<string, string> = {
  [CollectionType.NFT]: "NFT",
  [CollectionType.LINK]: "Link",
  [CollectionType.ONCHAIN]: "Onchain",
  [CollectionType.MIXED]: "Mixed",
};

export const CollectionVisibility = {
  PUBLIC: "VISIBILITY_PUBLIC",
  PRIVATE: "VISIBILITY_PRIVATE",
} as const;

export const VISIBILITY_LABELS: Record<string, string> = {
  [CollectionVisibility.PUBLIC]: "Public",
  [CollectionVisibility.PRIVATE]: "Private",
};

export const CollectionStatus = {
  ACTIVE: "COLLECTION_STATUS_ACTIVE",
  PENDING: "COLLECTION_STATUS_PENDING",
  HIDDEN: "COLLECTION_STATUS_HIDDEN",
} as const;

export const COLLECTION_STATUS_LABELS: Record<string, string> = {
  [CollectionStatus.ACTIVE]: "Active",
  [CollectionStatus.PENDING]: "Pending",
  [CollectionStatus.HIDDEN]: "Hidden",
};

export const ItemStatus = {
  ACTIVE: "ITEM_STATUS_ACTIVE",
  HIDDEN: "ITEM_STATUS_HIDDEN",
} as const;

export const ReferenceType = {
  NFT: "REFERENCE_TYPE_NFT",
  LINK: "REFERENCE_TYPE_LINK",
  ON_CHAIN: "REFERENCE_TYPE_ON_CHAIN",
  CUSTOM: "REFERENCE_TYPE_CUSTOM",
} as const;

export const REFERENCE_TYPE_LABELS: Record<string, string> = {
  [ReferenceType.NFT]: "NFT",
  [ReferenceType.LINK]: "Link",
  [ReferenceType.ON_CHAIN]: "Onchain",
  [ReferenceType.CUSTOM]: "Custom",
};

export const CollaboratorRole = {
  EDITOR: "COLLABORATOR_ROLE_EDITOR",
  ADMIN: "COLLABORATOR_ROLE_ADMIN",
} as const;

export const COLLABORATOR_ROLE_LABELS: Record<string, string> = {
  [CollaboratorRole.EDITOR]: "Editor",
  [CollaboratorRole.ADMIN]: "Admin",
};

export const CurationVerdict = {
  UP: "CURATION_VERDICT_UP",
  DOWN: "CURATION_VERDICT_DOWN",
} as const;

export const CURATION_VERDICT_LABELS: Record<string, string> = {
  [CurationVerdict.UP]: "Up",
  [CurationVerdict.DOWN]: "Down",
};

// API response types

export interface Pagination {
  next_key: string | null;
  total: string;
}

export interface GetCollectionResponse {
  collection: Collection;
}

export interface ListCollectionsResponse {
  collections: Collection[];
  pagination: Pagination;
}

export interface GetItemResponse {
  item: CollectionItem;
}

export interface ListItemsResponse {
  items: CollectionItem[];
  pagination: Pagination;
}

export interface ListCollaboratorsResponse {
  collaborators: Collaborator[];
}

export interface GetCuratorActivityResponse {
  curator_activity: CuratorActivity;
}

export interface GetCurationSummaryResponse {
  summary: CurationSummary;
}

export interface ListCurationReviewsResponse {
  reviews: CurationReview[];
  pagination: Pagination;
}

export interface GetSponsorshipRequestResponse {
  sponsorship_request: SponsorshipRequest;
}

export interface ListSponsorshipRequestsResponse {
  sponsorship_requests: SponsorshipRequest[];
  pagination: Pagination;
}

export interface GetEndorsementResponse {
  endorsement: Endorsement;
}

export interface CollectionConvictionResponse {
  conviction_score: string;
  stake_count: string;
  total_staked: string;
  author_bond: string;
}

export interface CollectParamsResponse {
  params: Record<string, unknown>;
}
