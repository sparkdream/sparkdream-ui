"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { getRepAliases, getRepCanonical, invalidateRepMigration } from "@/lib/api";

interface AliasState {
  /** The address the aliases were loaded for. */
  address: string;
  /** The member's current address. */
  canonical: string;
  /** Every address the member has held, canonical first. */
  addresses: string[];
  /** Canonical plus predecessors inside the chain's dedup horizon. */
  recent: string[];
  /** The connected address migrated away: the chain lets it sign almost nothing. */
  tombstoned: boolean;
}

/**
 * The connected member's addresses under the x/rep alias contract (member key
 * migration). Content and rights recorded against an earlier address belong
 * to the member, and the chain authorizes the current address for them
 * (CanActAs), so ownership checks must use isMine() instead of comparing a
 * stored address with the wallet's.
 *
 * A tombstoned wallet (one that migrated away) owns nothing it can act on:
 * isMine() is false for it everywhere.
 */
export function useMyAliases() {
  const { address } = useWallet();
  const [state, setState] = useState<AliasState | null>(null);
  // Bumped by refresh() after a migration tx so the lists reload.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!address) return;
    let live = true;
    Promise.all([getRepCanonical(address).catch(() => null), getRepAliases(address).catch(() => null)]).then(
      ([canon, aliases]) => {
        if (!live) return;
        const canonical = canon?.canonical || address;
        setState({
          address,
          canonical,
          addresses: aliases?.addresses?.length ? aliases.addresses : [address],
          recent: aliases?.recent?.length ? aliases.recent : [address],
          tombstoned: !!canon?.tombstoned,
        });
      },
    );
    return () => {
      live = false;
    };
  }, [address, nonce]);

  const refresh = useCallback(() => {
    invalidateRepMigration();
    setNonce((n) => n + 1);
  }, []);

  const current = state && state.address === address ? state : null;

  const isMine = useCallback(
    (stored: string | null | undefined): boolean => {
      if (!stored || !address) return false;
      if (current?.tombstoned) return false;
      // Until the aliases load, the wallet's own address is the safe answer.
      if (!current) return stored === address;
      return current.addresses.includes(stored);
    },
    [address, current],
  );

  return {
    isMine,
    canonical: current?.canonical ?? address ?? null,
    addresses: current?.addresses ?? (address ? [address] : []),
    recent: current?.recent ?? (address ? [address] : []),
    tombstoned: current?.tombstoned ?? false,
    loading: !!address && !current,
    refresh,
  };
}
