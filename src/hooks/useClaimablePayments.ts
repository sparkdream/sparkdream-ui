"use client";

import { useEffect, useState } from "react";
import { getGrantsByGrantee } from "@/lib/api";
import { recurringClaimable } from "@/lib/grants";

const POLL_MS = 5 * 60 * 1000;

/**
 * Number of recurring payments `address` can claim right now. Payments are
 * pull-based, so the recipient has to notice them; the header surfaces this.
 */
export function useClaimablePayments(address: string | null): number {
  // Keyed by address so a wallet switch never shows the previous count.
  const [state, setState] = useState<{ address: string; count: number } | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const check = async () => {
      try {
        const { grants } = await getGrantsByGrantee(address, "GRANT_TYPE_RECURRING_PULL");
        if (!cancelled) {
          setState({ address, count: (grants || []).filter((g) => recurringClaimable(g) > 0).length });
        }
      } catch {
        // Leave the last count; the permissions page reports fetch errors.
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [address]);

  return state && state.address === address ? state.count : 0;
}
