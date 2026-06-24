"use client";

import { useEffect, useMemo, useState } from "react";
import { getBondedRole, getForumParams } from "@/lib/api";
import { RoleType, BondedRoleStatus } from "@/types/rep";
import type { BondedRole } from "@/types/rep";

/**
 * Returns whether `address` is a forum sentinel currently eligible to moderate.
 *
 * Mirrors x/forum's eligibleSentinel helper (chain commit d4507ca): a bonded
 * sentinel in NORMAL or RECOVERY is eligible outright; an UNBONDING sentinel
 * stays eligible while its staying bond (current_bond - pending_unbond_amount)
 * remains at or above min_sentinel_bond — the withdrawing portion is treated as
 * already gone. DEMOTED and unbonded accounts are never eligible.
 *
 * This is UI gating only. Epoch limits, cooldowns, the per-action bond/rep
 * floors, and the session-key permit are still enforced elsewhere (chain-side
 * and via useSessionPermits) and surface as broadcast errors.
 */
export function useIsEligibleSentinel(address: string | null | undefined): boolean {
  const [sentinelBond, setSentinelBond] = useState<BondedRole | null>(null);
  const [minSentinelBond, setMinSentinelBond] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setSentinelBond(null);
      return;
    }
    let cancelled = false;
    getBondedRole(RoleType.FORUM_SENTINEL, address)
      .then((res) => {
        if (!cancelled) setSentinelBond(res?.bonded_role ?? null);
      })
      .catch(() => {
        if (!cancelled) setSentinelBond(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // min_sentinel_bond is a chain param needed to evaluate an UNBONDING
  // sentinel's staying bond; fetch it once.
  useEffect(() => {
    let cancelled = false;
    getForumParams()
      .then((res) => {
        if (!cancelled) setMinSentinelBond(res?.params?.min_sentinel_bond ?? null);
      })
      .catch(() => {
        if (!cancelled) setMinSentinelBond(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const status = sentinelBond?.bond_status;
    if (status === BondedRoleStatus.NORMAL || status === BondedRoleStatus.RECOVERY) {
      return true;
    }
    if (status === BondedRoleStatus.UNBONDING && minSentinelBond) {
      try {
        const staying = BigInt(sentinelBond?.current_bond || "0") - BigInt(sentinelBond?.pending_unbond_amount || "0");
        return staying >= BigInt(minSentinelBond);
      } catch {
        return false;
      }
    }
    return false;
  }, [sentinelBond, minSentinelBond]);
}
