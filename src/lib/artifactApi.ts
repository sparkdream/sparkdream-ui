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
