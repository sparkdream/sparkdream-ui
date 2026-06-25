"use client";

import { useEffect, useMemo, useState } from "react";
import { getBondedRole } from "@/lib/api";
import { RoleType, BondedRoleStatus } from "@/types/rep";
import type { BondedRole } from "@/types/rep";

/**
 * Returns whether `address` holds a x/collect curator role currently eligible
 * to rate collections.
 *
 * Mirrors x/collect's MsgRateCollection gate (msg_server_rate_collection.go):
 * the curator's bonded ROLE_TYPE_COLLECT_CURATOR must be in NORMAL or RECOVERY.
 * An UNBONDING curator is refused authority (unlike forum sentinels), so it is
 * treated as ineligible here. DEMOTED and unbonded accounts are never eligible.
 *
 * This is UI gating only. min trust level, min bonded age, the per-day review
 * cap, and the collection's community-feedback flag are still enforced
 * chain-side and surface as broadcast errors.
 */
export function useIsEligibleCurator(address: string | null | undefined): boolean {
  const [bond, setBond] = useState<BondedRole | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getBondedRole(RoleType.COLLECT_CURATOR, address)
      .then((res) => {
        if (!cancelled) setBond(res?.bonded_role ?? null);
      })
      .catch(() => {
        if (!cancelled) setBond(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return useMemo(() => {
    if (!address) return false;
    const status = bond?.bond_status;
    return (
      status === BondedRoleStatus.NORMAL || status === BondedRoleStatus.RECOVERY
    );
  }, [address, bond]);
}
