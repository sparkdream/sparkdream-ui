"use client";

import { useEffect, useState } from "react";
import { getRepMember } from "@/lib/api";

/**
 * Returns whether `address` has a record in the rep `Member` collection.
 * `null` while the answer is unknown (initial fetch, or no address). Use this
 * to gate UI for actions that the chain restricts to existing members
 * (invite, propose project, create tag, etc.).
 */
export function useIsRepMember(address: string | null | undefined): boolean | null {
  const [isMember, setIsMember] = useState<boolean | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getRepMember(address)
      .then((res) => {
        if (cancelled) return;
        setIsMember(!!res.member?.address);
      })
      .catch(() => {
        if (!cancelled) setIsMember(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return address ? isMember : null;
}
