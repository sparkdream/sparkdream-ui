// LCD reads for x/storage (permanent copies). Paths follow the
// google.api.http rules in proto/sparkdream/storage/v1/query.proto. Call
// invalidateStorage() right after any storage tx so the follow-up refetch
// misses the cache.

import { lcdGet, paginationParams } from "./api";
import { cachedFetch, invalidate } from "./queryCache";
import { isMissingEndpoint } from "./errors";
import type { PaginationRequest } from "@/types/blog";
import type {
  StorageBackendWithBounds,
  StorageBackendsResponse,
  StorageParams,
  StorageParamsResponse,
  StorageQuote,
  StorageRequestResponse,
  StorageRequestsResponse,
} from "@/types/storage";

const PREFIX = "storage|";
const TTL = { ttl: 15_000, swr: false };

/** Drop every cached storage read. Call after any x/storage broadcast. */
export function invalidateStorage(): void {
  invalidate(PREFIX);
}

export async function getStorageParams(): Promise<StorageParams> {
  const res = await cachedFetch(
    `${PREFIX}params`,
    () => lcdGet<StorageParamsResponse>("/sparkdream/storage/v1/params"),
    { ttl: 60_000, swr: true }
  );
  return res.params ?? {};
}

/** The backends, each with its price bounds. */
export async function listStorageBackends(): Promise<StorageBackendWithBounds[]> {
  const res = await cachedFetch(
    `${PREFIX}backends`,
    () => lcdGet<StorageBackendsResponse>("/sparkdream/storage/v1/backends"),
    { ttl: 60_000, swr: true }
  );
  return res.backends || [];
}

/** The fees a request of this type and size costs right now. */
export function quoteStorageFee(backend: string, contentType: string, sizeBytes: number): Promise<StorageQuote> {
  return cachedFetch(
    `${PREFIX}quote|${backend}|${contentType}|${sizeBytes}`,
    () =>
      lcdGet<StorageQuote>(
        `/sparkdream/storage/v1/quote_fee/${encodeURIComponent(backend)}`,
        new URLSearchParams({ content_type: contentType, size_bytes: String(sizeBytes) })
      ),
    TTL
  );
}

export function getStorageRequest(id: string): Promise<StorageRequestResponse> {
  return cachedFetch(
    `${PREFIX}request|${id}`,
    () => lcdGet<StorageRequestResponse>(`/sparkdream/storage/v1/request/${id}`),
    TTL
  );
}

/** The request for this file on this backend, or null when nobody has asked for it. */
export async function getStorageRequestByHash(backend: string, sha256: string): Promise<StorageRequestResponse | null> {
  try {
    return await cachedFetch(
      `${PREFIX}by_hash|${backend}|${sha256}`,
      () =>
        lcdGet<StorageRequestResponse>(
          `/sparkdream/storage/v1/request_by_hash/${encodeURIComponent(backend)}/${sha256}`
        ),
      TTL
    );
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}

export function listStorageRequestsByRequester(
  requester: string,
  pagination?: PaginationRequest
): Promise<StorageRequestsResponse> {
  return cachedFetch(
    `${PREFIX}by_requester|${requester}|${pagination?.limit ?? ""}|${pagination?.key ?? ""}|${pagination?.reverse ? 1 : 0}`,
    () =>
      lcdGet<StorageRequestsResponse>(
        `/sparkdream/storage/v1/requests_by_requester/${requester}`,
        paginationParams(pagination)
      ),
    TTL
  );
}
