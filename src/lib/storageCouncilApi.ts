// LCD reads for the council side of x/storage: approvals and flags. The
// backends (with their price bounds) and the params the council forms check
// against are the same reads members use: listStorageBackends and
// getStorageParams in storageApi.ts. Paths follow the google.api.http rules in
// proto/sparkdream/storage/v1/query.proto. The member-facing reads are in
// storageApi.ts; invalidateStorage() there drops these too (same prefix).

import { lcdGet } from "./api";
import { cachedFetch } from "./queryCache";
import { isMissingEndpoint } from "./errors";
import type {
  ApprovedOperator,
  ApprovedOperatorsResponse,
  ApprovedScanner,
  ApprovedScannersResponse,
  OperatorStandingResponse,
  RemovedHash,
  RemovedHashResponse,
} from "@/types/storage";

const PREFIX = "storage|council|";
const TTL = { ttl: 15_000, swr: false };
// Both lists are capped by params well below this (max_operators_per_backend,
// max_approved_scanners), so one page holds them.
const PAGE = new URLSearchParams({ "pagination.limit": "200" });

export async function listApprovedOperators(backend: string): Promise<ApprovedOperator[]> {
  const res = await cachedFetch(
    `${PREFIX}approved_operators|${backend}`,
    () =>
      lcdGet<ApprovedOperatorsResponse>(
        `/sparkdream/storage/v1/approved_operators/${encodeURIComponent(backend)}`,
        PAGE
      ),
    TTL
  );
  return res.operators || [];
}

export async function listApprovedScanners(): Promise<ApprovedScanner[]> {
  const res = await cachedFetch(
    `${PREFIX}approved_scanners`,
    () => lcdGet<ApprovedScannersResponse>("/sparkdream/storage/v1/approved_scanners", PAGE),
    TTL
  );
  return res.scanners || [];
}

/** Whether an operator could claim now, and what it holds in this window. */
export function getOperatorStanding(backend: string, operator: string): Promise<OperatorStandingResponse> {
  return cachedFetch(
    `${PREFIX}standing|${backend}|${operator}`,
    () =>
      lcdGet<OperatorStandingResponse>(
        `/sparkdream/storage/v1/operator_standing/${encodeURIComponent(backend)}/${encodeURIComponent(operator)}`
      ),
    TTL
  );
}

/** The flags on a file, or null when it is not flagged. */
export async function getRemovedHash(sha256: string): Promise<RemovedHash | null> {
  try {
    const res = await cachedFetch(
      `${PREFIX}removed_hash|${sha256}`,
      () => lcdGet<RemovedHashResponse>(`/sparkdream/storage/v1/removed_hash/${sha256}`),
      TTL
    );
    return res.removed_hash ?? null;
  } catch (err) {
    if (isMissingEndpoint(err)) return null;
    throw err;
  }
}
