"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { resolveWithCache } from "@/hooks/useResolveName";
import { resolveCanonical } from "@/hooks/useCanonicalAddress";
import { ANONYMOUS_LABEL, isAnonymousAddress } from "@/lib/shield";

// The name an address is shown under, following useDisplayName: the onchain
// name, else the name of the address it migrated to. "" when it has neither.
async function lookup(address: string): Promise<string> {
  const name = await resolveWithCache(address);
  if (name) return name;
  const canonical = await resolveCanonical(address);
  return canonical !== address ? resolveWithCache(canonical) : "";
}

/**
 * Display names for a list of authors, for matching a search query against
 * the name a post is shown under. Returns address → lowercased name; an
 * address with no name is absent. Lookups share the useResolveName cache, so
 * authors already on screen cost nothing. Pass `enabled: false` to skip the
 * lookups (e.g. while the search box is empty).
 */
export function useAuthorNames(addresses: string[], enabled = true): Map<string, string> {
  const { address: currentAddress, name: keplrName } = useWallet();
  const [resolved, setResolved] = useState<Map<string, string>>(new Map());

  // Stable across renders that pass a new array with the same authors.
  const key = useMemo(() => [...new Set(addresses.filter(Boolean))].sort().join(","), [addresses]);

  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    for (const addr of key.split(",")) {
      if (isAnonymousAddress(addr)) continue;
      lookup(addr).then((name) => {
        if (!live || !name) return;
        const lower = name.toLowerCase();
        setResolved((prev) => (prev.get(addr) === lower ? prev : new Map(prev).set(addr, lower)));
      });
    }
    return () => {
      live = false;
    };
  }, [key, enabled]);

  return useMemo(() => {
    const names = new Map(resolved);
    for (const addr of key ? key.split(",") : []) {
      if (isAnonymousAddress(addr)) names.set(addr, ANONYMOUS_LABEL.toLowerCase());
    }
    // Your own posts show under your wallet name when you have no onchain one.
    if (currentAddress && keplrName && !names.has(currentAddress)) {
      names.set(currentAddress, keplrName.toLowerCase());
    }
    return names;
  }, [resolved, key, currentAddress, keplrName]);
}

/**
 * Whether `query` (already trimmed and lowercased) matches an author by
 * address or by display name. A leading "@" is ignored for the name.
 */
export function matchesAuthor(query: string, address: string | undefined, names: Map<string, string>): boolean {
  if (!address) return false;
  if (address.toLowerCase().includes(query)) return true;
  const nameQuery = query.replace(/^@/, "");
  return !!nameQuery && !!names.get(address)?.includes(nameQuery);
}
