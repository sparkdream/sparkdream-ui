"use client";

import { useEffect, useState } from "react";
import { reverseResolveName, getSessionsByGrantee, listTargetsForAddress } from "@/lib/api";

// Simple in-memory cache shared across all hook instances.
// Key: address, Value: { name, timestamp }
const nameCache = new Map<string, { name: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Pending fetches to avoid duplicate requests for the same address
const pendingFetches = new Map<string, Promise<string>>();

async function resolveDirect(address: string): Promise<string> {
  try {
    const res = await reverseResolveName(address);
    return res.name || "";
  } catch {
    return "";
  }
}

async function resolveWithCache(address: string): Promise<string> {
  const cached = nameCache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.name;
  }

  const pending = pendingFetches.get(address);
  if (pending) return pending;

  const promise = (async () => {
    let name = await resolveDirect(address);
    if (!name) {
      // Fallback: if the address is a session grantee, resolve the granter's name.
      try {
        const res = await getSessionsByGrantee(address);
        const granter = res.sessions?.[0]?.granter;
        if (granter && granter !== address) {
          name = await resolveDirect(granter);
        }
      } catch {
        // ignore
      }
    }
    if (!name) {
      // Fallback: names where this address is the accepted resolver target but
      // hasn't been set as primary yet. Alphabetical tiebreaker since an
      // address can be the accepted target of multiple names — stable across
      // reloads avoids flicker.
      try {
        const res = await listTargetsForAddress(address);
        const candidates = (res.names || []).map((n) => n.name).sort();
        if (candidates.length > 0) name = candidates[0];
      } catch {
        // ignore
      }
    }
    nameCache.set(address, { name, ts: Date.now() });
    return name;
  })().finally(() => {
    pendingFetches.delete(address);
  });

  pendingFetches.set(address, promise);
  return promise;
}

/**
 * Resolves an address to its primary name via reverse resolution.
 * Results are cached in memory for 5 minutes.
 *
 * @returns { name, loading } — name is "" if not found or not yet loaded.
 */
export function useResolveName(address: string | undefined | null): {
  name: string;
  loading: boolean;
} {
  const [name, setName] = useState<string>(() => {
    if (!address) return "";
    const cached = nameCache.get(address);
    return cached && Date.now() - cached.ts < CACHE_TTL ? cached.name : "";
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!address) return false;
    const cached = nameCache.get(address);
    return !(cached && Date.now() - cached.ts < CACHE_TTL);
  });

  // Sync `name`/`loading` to the new address synchronously during render
  // (React-supported "adjust state while rendering" pattern). Doing this in
  // a useEffect would flash the previous address's name on mount and trip
  // `react-hooks/set-state-in-effect`. The TTL check + async resolve stay
  // in the effect — calling `Date.now()` during render is impure.
  const [trackedAddress, setTrackedAddress] = useState(address);
  if (address !== trackedAddress) {
    setTrackedAddress(address);
    if (!address) {
      setName("");
      setLoading(false);
    } else {
      // Show any cached value immediately (SWR-style); the effect below
      // revalidates against the TTL and refetches if stale.
      const cached = nameCache.get(address);
      if (cached) {
        setName(cached.name);
        setLoading(false);
      } else {
        setName("");
        setLoading(true);
      }
    }
  }

  useEffect(() => {
    if (!address) return;
    const cached = nameCache.get(address);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return;

    let cancelled = false;
    resolveWithCache(address).then((resolved) => {
      if (!cancelled) {
        setName(resolved);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { name, loading };
}
