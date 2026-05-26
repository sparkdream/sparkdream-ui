"use client";

import { useEffect, useState } from "react";
import { getRepMember, getParams } from "@/lib/api";
import { TrustLevel } from "@/types/rep";

const TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

/**
 * Returns whether `address` may pin a post or reply: active rep membership
 * AND trust level >= blog params' `pin_min_trust_level` (default ESTABLISHED).
 * `null` while either the member or params fetch is in flight, so callers
 * can leave the affordance enabled-but-not-yet-clickable during the load
 * rather than flashing disabled→enabled.
 */
export function useCanPin(address: string | null | undefined): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!address) {
      setAllowed(null);
      return;
    }
    let cancelled = false;
    Promise.all([getRepMember(address), getParams()])
      .then(([memberRes, paramsRes]) => {
        if (cancelled) return;
        if (!memberRes.member?.address) {
          setAllowed(false);
          return;
        }
        const rank = TRUST_RANK[memberRes.member.trust_level || ""] ?? -1;
        const required = paramsRes.params?.pin_min_trust_level ?? TRUST_RANK[TrustLevel.ESTABLISHED];
        setAllowed(rank >= required);
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return address ? allowed : null;
}
