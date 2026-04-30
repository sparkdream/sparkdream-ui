"use client";

import { useEffect, useState } from "react";
import { listGroups, getCouncilMembers } from "@/lib/api";

interface CommonsCouncilState {
  loading: boolean;
  /** Bech32 group-policy address of the "Commons Council" group (executes reveal council msgs). */
  councilPolicyAddress: string | null;
  /** True if `address` is a member of the "Commons Operations Committee" — required to propose council actions. */
  isOpsCommitteeMember: boolean;
}

const COUNCIL_NAME = "Commons Council";
const OPS_COMMITTEE_NAME = "Commons Operations Committee";

/**
 * Resolves the Commons Council policy address and whether the connected wallet
 * is a member of the Commons Operations Committee. Used to gate reveal council
 * proposal actions (Approve / Reject / ResolveDispute) which must be wrapped
 * in a Commons Council proposal initiated by an Ops Committee member.
 */
export function useCommonsCouncil(address: string | null): CommonsCouncilState {
  const [state, setState] = useState<CommonsCouncilState>({
    loading: true,
    councilPolicyAddress: null,
    isOpsCommitteeMember: false,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([listGroups(), address ? getCouncilMembers(OPS_COMMITTEE_NAME) : Promise.resolve(null)])
      .then(([groupsRes, opsMembersRes]) => {
        if (cancelled) return;
        const council = (groupsRes.group || []).find((g) => g.index === COUNCIL_NAME);
        const isMember = !!(
          address &&
          opsMembersRes &&
          (opsMembersRes.members || []).some((m) => m.address === address)
        );
        setState({
          loading: false,
          councilPolicyAddress: council?.policy_address || null,
          isOpsCommitteeMember: isMember,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          loading: false,
          councilPolicyAddress: null,
          isOpsCommitteeMember: false,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return state;
}
