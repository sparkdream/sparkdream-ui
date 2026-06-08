"use client";

import { useEffect, useState } from "react";
import { getParams } from "@/lib/api";
import { loadRepMember } from "@/lib/repMember";
import { TrustLevel } from "@/types/rep";

const TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

/**
 * Returns whether `address` may promote an ephemeral post/reply to permanent
 * (MsgMakePostPermanent / MsgMakeReplyPermanent): active rep membership AND
 * trust level >= blog params' `make_permanent_min_trust_level` (default
 * PROVISIONAL). This is a distinct, lower gate than pinning (see useCanPin) —
 * the chain separates featuring content (pin) from preserving it (make
 * permanent). `null` while the member or params fetch is in flight.
 */
export function useCanMakePermanent(address: string | null | undefined): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!address) {
      setAllowed(null);
      return;
    }
    let cancelled = false;
    Promise.all([loadRepMember(address), getParams()])
      .then(([member, paramsRes]) => {
        if (cancelled) return;
        if (!member) {
          setAllowed(false);
          return;
        }
        const rank = TRUST_RANK[member.trust_level || ""] ?? -1;
        const required =
          paramsRes.params?.make_permanent_min_trust_level ?? TRUST_RANK[TrustLevel.PROVISIONAL];
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
