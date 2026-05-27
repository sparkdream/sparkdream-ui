"use client";

import { useEffect, useState } from "react";
import { getRepMember } from "@/lib/api";
import { TrustLevel } from "@/types/rep";

// Numeric ranks match the on-chain TrustLevel enum:
//   NEW=0, PROVISIONAL=1, ESTABLISHED=2, TRUSTED=3, CORE=4
const TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

/**
 * Returns the numeric trust rank of `address` (0..4), or -1 if not a member.
 * `null` while in flight or no address.
 */
export function useTrustRank(address: string | null | undefined): number | null {
  const [rank, setRank] = useState<number | null>(null);
  // Reset to null synchronously at the moment `address` changes so callers
  // don't observe the prior address's rank for one render. Doing this in an
  // effect would trip react-hooks/set-state-in-effect.
  const [trackedAddress, setTrackedAddress] = useState(address);
  if (address !== trackedAddress) {
    setTrackedAddress(address);
    setRank(null);
  }
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getRepMember(address)
      .then((res) => {
        if (cancelled) return;
        if (!res.member?.address) {
          setRank(-1);
          return;
        }
        setRank(TRUST_RANK[res.member.trust_level || ""] ?? 0);
      })
      .catch(() => {
        if (!cancelled) setRank(-1);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return address ? rank : null;
}
