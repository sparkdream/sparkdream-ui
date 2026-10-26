// LCD reads for x/artifact (NFTs). Paths follow the google.api.http rules in
// proto/sparkdream/artifact/v1/query.proto. Every read goes through the shared
// lcdGet (gateway checks, timeouts, chain-status reporting) and a short cache;
// call invalidateArtifacts() right after any artifact tx so the follow-up
// refetch misses the cache.

import { lcdGet, paginationParams } from "./api";
import { cachedFetch, invalidate } from "./queryCache";
import { isMissingEndpoint } from "./errors";
import type { PaginationRequest } from "@/types/blog";
import type {
  ArtifactParamsResponse,
  AuctionResponse,
  AuctionsResponse,
  BalanceView,
  BalancesResponse,
  ChildrenResponse,
  CraftRecipesResponse,
  EditionResponse,
  EditionsResponse,
  HarbergerQuoteResponse,
  MediaProposalsResponse,
  OfferResponse,
  OffersResponse,
  Rental,
  RentalOffer,
  RentalOffersResponse,
  RentalsResponse,
  UnitListing,
  UnitListingsResponse,
  ClassResponse,
  ClassesResponse,
  HideRecord,
  HideRecordsByTargetResponse,
  InboxResponse,
  Listing,
  ListingsResponse,
  OutboxResponse,
  PendingClassOwner,
  PendingClassOwnerResponse,
  PublicMintQuoteResponse,
  ReceivePolicyResponse,
  SupplyResponse,
  TokenResponse,
  TokensResponse,
} from "@/types/artifact";

const PREFIX = "artifact|";
const TTL = { ttl: 15_000, swr: false };

function pageKey(p?: PaginationRequest): string {
  return `${p?.limit ?? ""}|${p?.key ?? ""}|${p?.reverse ? 1 : 0}`;
}

/** Drop every cached artifact read. Call after any x/artifact broadcast. */
export function invalidateArtifacts(): void {
  invalidate(PREFIX);
}

export function getArtifactParams(): Promise<ArtifactParamsResponse> {
  return cachedFetch(
    `${PREFIX}params`,
    () => lcdGet<ArtifactParamsResponse>("/sparkdream/artifact/v1/params"),
    { ttl: 60_000, swr: true }
  );
}

export function getArtifactClass(classId: string): Promise<ClassResponse> {
  return cachedFetch(
    `${PREFIX}class|${classId}`,
    () => lcdGet<ClassResponse>(`/sparkdream/artifact/v1/class/${classId}`),
    TTL
  );
}

export function listArtifactClasses(p?: PaginationRequest): Promise<ClassesResponse> {
  return cachedFetch(
    `${PREFIX}classes|${pageKey(p)}`,
    () => lcdGet<ClassesResponse>("/sparkdream/artifact/v1/classes", paginationParams(p)),
    TTL
  );
}

export function listArtifactClassesByOwner(owner: string, p?: PaginationRequest): Promise<ClassesResponse> {
  return cachedFetch(
    `${PREFIX}classes_by_owner|${owner}|${pageKey(p)}`,
    () =>
      lcdGet<ClassesResponse>(
        `/sparkdream/artifact/v1/classes_by_owner/${owner}`,
        paginationParams(p)
      ),
    TTL
  );
}

export function getArtifactToken(classId: string, tokenId: string): Promise<TokenResponse> {
  return cachedFetch(
    `${PREFIX}token|${classId}|${tokenId}`,
    () => lcdGet<TokenResponse>(`/sparkdream/artifact/v1/token/${classId}/${tokenId}`),
    TTL
  );
}

export function listArtifactTokens(classId: string, p?: PaginationRequest): Promise<TokensResponse> {
  return cachedFetch(
    `${PREFIX}tokens|${classId}|${pageKey(p)}`,
    () =>
      lcdGet<TokensResponse>(`/sparkdream/artifact/v1/tokens/${classId}`, paginationParams(p)),
    TTL
  );
}

export function listArtifactTokensByOwner(
  owner: string,
  p?: PaginationRequest,
  classId?: string
): Promise<TokensResponse> {
  return cachedFetch(
    `${PREFIX}tokens_by_owner|${owner}|${classId ?? ""}|${pageKey(p)}`,
    () => {
      const params = paginationParams(p);
      if (classId && classId !== "0") params.set("class_id", classId);
      return lcdGet<TokensResponse>(`/sparkdream/artifact/v1/tokens_by_owner/${owner}`, params);
    },
    TTL
  );
}

export function getArtifactSupply(classId: string): Promise<SupplyResponse> {
  return cachedFetch(
    `${PREFIX}supply|${classId}`,
    () => lcdGet<SupplyResponse>(`/sparkdream/artifact/v1/supply/${classId}`),
    TTL
  );
}

export function listArtifactListings(p?: PaginationRequest, classId?: string): Promise<ListingsResponse> {
  return cachedFetch(
    `${PREFIX}listings|${classId ?? ""}|${pageKey(p)}`,
    () => {
      const params = paginationParams(p);
      if (classId && classId !== "0") params.set("class_id", classId);
      return lcdGet<ListingsResponse>("/sparkdream/artifact/v1/listings", params);
    },
    TTL
  );
}

export function listArtifactListingsBySeller(seller: string, p?: PaginationRequest): Promise<ListingsResponse> {
  return cachedFetch(
    `${PREFIX}listings_by_seller|${seller}|${pageKey(p)}`,
    () =>
      lcdGet<ListingsResponse>(
        `/sparkdream/artifact/v1/listings_by_seller/${seller}`,
        paginationParams(p)
      ),
    TTL
  );
}

/** A token's active listing, or null when it has none. */
export async function getArtifactListing(classId: string, tokenId: string): Promise<Listing | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}listing|${classId}|${tokenId}`,
      () =>
        lcdGet<{ listing: Listing }>(`/sparkdream/artifact/v1/listing/${classId}/${tokenId}`),
      TTL
    );
    return res.listing ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

export function getArtifactInbox(address: string, p?: PaginationRequest): Promise<InboxResponse> {
  return cachedFetch(
    `${PREFIX}inbox|${address}|${pageKey(p)}`,
    () => lcdGet<InboxResponse>(`/sparkdream/artifact/v1/inbox/${address}`, paginationParams(p)),
    TTL
  );
}

export function getArtifactOutbox(address: string, p?: PaginationRequest): Promise<OutboxResponse> {
  return cachedFetch(
    `${PREFIX}outbox|${address}|${pageKey(p)}`,
    () => lcdGet<OutboxResponse>(`/sparkdream/artifact/v1/outbox/${address}`, paginationParams(p)),
    TTL
  );
}

export function getArtifactReceivePolicy(address: string): Promise<ReceivePolicyResponse> {
  return cachedFetch(
    `${PREFIX}receive_policy|${address}`,
    () => lcdGet<ReceivePolicyResponse>(`/sparkdream/artifact/v1/receive_policy/${address}`),
    TTL
  );
}

/** A class's open ownership proposal, or null when there is none (or it expired). */
export async function getArtifactPendingClassOwner(classId: string): Promise<PendingClassOwner | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}pending_class_owner|${classId}`,
      () =>
        lcdGet<PendingClassOwnerResponse>(
          `/sparkdream/artifact/v1/pending_class_owner/${classId}`
        ),
      TTL
    );
    return res.pending?.proposed_owner ? res.pending : null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

/** Every hide record on a class (tokenId "0") or a token, oldest first. */
export async function getArtifactHideRecords(classId: string, tokenId = "0"): Promise<HideRecord[]> {
  try {
    const res = await cachedFetch(
      `${PREFIX}hide_records|${classId}|${tokenId}`,
      () =>
        lcdGet<HideRecordsByTargetResponse>(
          `/sparkdream/artifact/v1/hide_records_by_target/${classId}/${tokenId}`
        ),
      TTL
    );
    return res.records || [];
  } catch (err) {
    if (isMissingEndpoint(err)) return [];
    throw err;
  }
}

export function getArtifactPublicMintQuote(
  classId: string,
  buyer: string,
  quantity: number
): Promise<PublicMintQuoteResponse> {
  // Not cached: the answer depends on block time and the buyer's count.
  return lcdGet<PublicMintQuoteResponse>(
    `/sparkdream/artifact/v1/public_mint_quote/${classId}/${buyer}/${quantity}`
  );
}

// ---- Media versions --------------------------------------------------------

export async function getArtifactMediaProposals(classId: string, tokenId: string): Promise<MediaProposalsResponse> {
  return cachedFetch(
    `${PREFIX}media_proposals|${classId}|${tokenId}`,
    () => lcdGet<MediaProposalsResponse>(`/sparkdream/artifact/v1/media_proposals/${classId}/${tokenId}`),
    TTL
  );
}

// ---- Editions (semi-fungible units) ------------------------------------------

export function getArtifactEdition(classId: string, editionId: string): Promise<EditionResponse> {
  return cachedFetch(
    `${PREFIX}edition|${classId}|${editionId}`,
    () => lcdGet<EditionResponse>(`/sparkdream/artifact/v1/edition/${classId}/${editionId}`),
    TTL
  );
}

export function listArtifactEditions(classId: string, p?: PaginationRequest): Promise<EditionsResponse> {
  return cachedFetch(
    `${PREFIX}editions|${classId}|${pageKey(p)}`,
    () => lcdGet<EditionsResponse>(`/sparkdream/artifact/v1/editions/${classId}`, paginationParams(p)),
    TTL
  );
}

/** The holder's balance of an edition, or null when they hold none. */
export async function getArtifactBalance(classId: string, editionId: string, owner: string): Promise<BalanceView | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}balance|${classId}|${editionId}|${owner}`,
      () => lcdGet<{ balance: BalanceView }>(`/sparkdream/artifact/v1/balance/${classId}/${editionId}/${owner}`),
      TTL
    );
    return res.balance ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

export function listArtifactBalancesByOwner(owner: string, p?: PaginationRequest): Promise<BalancesResponse> {
  return cachedFetch(
    `${PREFIX}balances_by_owner|${owner}|${pageKey(p)}`,
    () => lcdGet<BalancesResponse>(`/sparkdream/artifact/v1/balances_by_owner/${owner}`, paginationParams(p)),
    TTL
  );
}

export function listArtifactEditionHolders(classId: string, editionId: string, p?: PaginationRequest): Promise<BalancesResponse> {
  return cachedFetch(
    `${PREFIX}edition_holders|${classId}|${editionId}|${pageKey(p)}`,
    () => lcdGet<BalancesResponse>(`/sparkdream/artifact/v1/edition_holders/${classId}/${editionId}`, paginationParams(p)),
    TTL
  );
}

/** A unit listing, or null when it is gone or expired. */
export async function getArtifactUnitListing(listingId: string): Promise<UnitListing | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}unit_listing|${listingId}`,
      () => lcdGet<{ listing: UnitListing }>(`/sparkdream/artifact/v1/unit_listing/${listingId}`),
      TTL
    );
    return res.listing ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

export function listArtifactUnitListings(classId: string, editionId: string, p?: PaginationRequest): Promise<UnitListingsResponse> {
  return cachedFetch(
    `${PREFIX}unit_listings|${classId}|${editionId}|${pageKey(p)}`,
    () => lcdGet<UnitListingsResponse>(`/sparkdream/artifact/v1/unit_listings/${classId}/${editionId}`, paginationParams(p)),
    TTL
  );
}

// ---- Crafting ---------------------------------------------------------------

export function getArtifactCraftRecipes(classId: string): Promise<CraftRecipesResponse> {
  return cachedFetch(
    `${PREFIX}craft_recipes|${classId}`,
    () => lcdGet<CraftRecipesResponse>(`/sparkdream/artifact/v1/craft_recipes/${classId}`),
    TTL
  );
}

// ---- Rentals and nesting -----------------------------------------------------

/** A token's active rental, or null. */
export async function getArtifactRental(classId: string, tokenId: string): Promise<Rental | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}rental|${classId}|${tokenId}`,
      () => lcdGet<{ rental: Rental }>(`/sparkdream/artifact/v1/rental/${classId}/${tokenId}`),
      TTL
    );
    return res.rental ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

/** A token's open rental offer, or null (none, or expired). */
export async function getArtifactRentalOffer(classId: string, tokenId: string): Promise<RentalOffer | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}rental_offer|${classId}|${tokenId}`,
      () => lcdGet<{ offer: RentalOffer }>(`/sparkdream/artifact/v1/rental_offer/${classId}/${tokenId}`),
      TTL
    );
    return res.offer ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

export function listArtifactRentalsByUser(user: string, p?: PaginationRequest): Promise<RentalsResponse> {
  return cachedFetch(
    `${PREFIX}rentals_by_user|${user}|${pageKey(p)}`,
    () => lcdGet<RentalsResponse>(`/sparkdream/artifact/v1/rentals_by_user/${user}`, paginationParams(p)),
    TTL
  );
}

/** Unexpired rental offers; with user, only those addressed to that user. */
export function listArtifactRentalOffers(user?: string, p?: PaginationRequest): Promise<RentalOffersResponse> {
  return cachedFetch(
    `${PREFIX}rental_offers|${user ?? ""}|${pageKey(p)}`,
    () => {
      const params = paginationParams(p);
      if (user) params.set("user", user);
      return lcdGet<RentalOffersResponse>("/sparkdream/artifact/v1/rental_offers", params);
    },
    TTL
  );
}

export function getArtifactChildren(classId: string, tokenId: string): Promise<ChildrenResponse> {
  return cachedFetch(
    `${PREFIX}children|${classId}|${tokenId}`,
    () => lcdGet<ChildrenResponse>(`/sparkdream/artifact/v1/children/${classId}/${tokenId}`),
    TTL
  );
}

// ---- Harberger ----------------------------------------------------------------

export function getArtifactHarbergerQuote(classId: string, tokenId: string): Promise<HarbergerQuoteResponse> {
  // Not cached: the price and tax depend on block time.
  return lcdGet<HarbergerQuoteResponse>(`/sparkdream/artifact/v1/harberger_quote/${classId}/${tokenId}`);
}

// ---- Offers ---------------------------------------------------------------------

export function getArtifactOffer(offerId: string): Promise<OfferResponse> {
  return cachedFetch(
    `${PREFIX}offer|${offerId}`,
    () => lcdGet<OfferResponse>(`/sparkdream/artifact/v1/offer/${offerId}`),
    TTL
  );
}

/** Unexpired offers on a token, or collection offers on a class (tokenId "0"). */
export function listArtifactOffers(classId: string, tokenId: string, p?: PaginationRequest): Promise<OffersResponse> {
  return cachedFetch(
    `${PREFIX}offers|${classId}|${tokenId}|${pageKey(p)}`,
    () => lcdGet<OffersResponse>(`/sparkdream/artifact/v1/offers/${classId}/${tokenId}`, paginationParams(p)),
    TTL
  );
}

export function listArtifactOffersByBidder(bidder: string, p?: PaginationRequest): Promise<OffersResponse> {
  return cachedFetch(
    `${PREFIX}offers_by_bidder|${bidder}|${pageKey(p)}`,
    () => lcdGet<OffersResponse>(`/sparkdream/artifact/v1/offers_by_bidder/${bidder}`, paginationParams(p)),
    TTL
  );
}

// ---- Auctions ---------------------------------------------------------------------

/** An open auction and the lowest bid accepted now, or null when it settled or was cancelled. */
export async function getArtifactAuction(auctionId: string): Promise<AuctionResponse | null> {
  try {
    // Not cached: min_next_bid moves with every bid.
    return await lcdGet<AuctionResponse>(`/sparkdream/artifact/v1/auction/${auctionId}`);
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

/** Open auctions, optionally of one class. */
export function listArtifactAuctions(classId?: string, p?: PaginationRequest): Promise<AuctionsResponse> {
  return cachedFetch(
    `${PREFIX}auctions|${classId ?? "0"}|${pageKey(p)}`,
    () => lcdGet<AuctionsResponse>(`/sparkdream/artifact/v1/auctions/${classId || "0"}`, paginationParams(p)),
    TTL
  );
}

export function listArtifactAuctionsBySeller(seller: string, p?: PaginationRequest): Promise<AuctionsResponse> {
  return cachedFetch(
    `${PREFIX}auctions_by_seller|${seller}|${pageKey(p)}`,
    () => lcdGet<AuctionsResponse>(`/sparkdream/artifact/v1/auctions_by_seller/${seller}`, paginationParams(p)),
    TTL
  );
}


/**
 * The id the next created class will get. Pass it as MsgCreateClass's
 * expected_class_id when it is bound into data first (a blind-mint
 * commitment). Not cached: it moves with every class created.
 */
export async function getArtifactNextClassId(): Promise<string> {
  const res = await lcdGet<{ next_class_id?: string }>("/sparkdream/artifact/v1/next_class_id");
  return res.next_class_id || "1";
}
