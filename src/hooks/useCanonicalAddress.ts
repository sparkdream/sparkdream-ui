"use client";

import { useEffect, useState } from "react";
import { getRepCanonical } from "@/lib/api";
import { isMissingEndpoint } from "@/lib/errors";

// Display-side alias resolution: an address that migrated away (a tombstone)
// shows as the member's current address. Most addresses never migrate, so
// this sits behind its own long-lived cache instead of the 60s query cache:
// a tombstone's canonical only changes on a further migration (and the chain
// path-compresses those), and a live address turning into a tombstone while
// it is on screen is rare enough to wait out the TTL.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { canonical: string; ts: number }>();
const pending = new Map<string, Promise<string>>();
// A node without the canonical query (pre-migration build) answers 404/501
// for every address; stop asking after the first.
let unsupported = false;

/** The canonical address for `address` (itself when it never migrated). Never throws. */
export function resolveCanonical(address: string): Promise<string> {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.ts < TTL_MS) return Promise.resolve(hit.canonical);
  if (unsupported) return Promise.resolve(address);
  const inflight = pending.get(address);
  if (inflight) return inflight;
  const p = getRepCanonical(address)
    .then((res) => res.canonical || address)
    .catch((err) => {
      if (isMissingEndpoint(err)) unsupported = true;
      return address;
    })
    .then((canonical) => {
      cache.set(address, { canonical, ts: Date.now() });
      return canonical;
    })
    .finally(() => pending.delete(address));
  pending.set(address, p);
  return p;
}

function cached(address: string | null | undefined): string | null {
  if (!address) return null;
  return cache.get(address)?.canonical ?? null;
}

/**
 * The member's current address for a possibly migrated-away `address`, or
 * null while unknown (and for a null input). Pass null to skip the lookup,
 * e.g. while a name is still resolving.
 */
export function useCanonicalAddress(address: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ address: string; canonical: string } | null>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    resolveCanonical(address).then((canonical) => {
      if (live) setResolved({ address, canonical });
    });
    return () => {
      live = false;
    };
  }, [address]);

  if (!address) return null;
  return resolved?.address === address ? resolved.canonical : cached(address);
}
