"use client";

import { useEffect, useState } from "react";
import { reverseResolveName } from "@/lib/api";

// Simple in-memory cache shared across all hook instances.
// Key: address, Value: { name, timestamp }
const nameCache = new Map<string, { name: string; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Pending fetches to avoid duplicate requests for the same address
const pendingFetches = new Map<string, Promise<string>>();

async function resolveWithCache(address: string): Promise<string> {
  const cached = nameCache.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.name;
  }

  const pending = pendingFetches.get(address);
  if (pending) return pending;

  const promise = reverseResolveName(address)
    .then((res) => {
      const name = res.name || "";
      nameCache.set(address, { name, ts: Date.now() });
      return name;
    })
    .catch(() => {
      nameCache.set(address, { name: "", ts: Date.now() });
      return "";
    })
    .finally(() => {
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

  useEffect(() => {
    if (!address) {
      setName("");
      setLoading(false);
      return;
    }

    const cached = nameCache.get(address);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setName(cached.name);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

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
