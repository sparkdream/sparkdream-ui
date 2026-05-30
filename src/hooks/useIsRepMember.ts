"use client";

import { useEffect, useState } from "react";
import { freshRepMember, loadRepMember } from "@/lib/repMember";

/**
 * Returns whether `address` has a record in the rep `Member` collection.
 * `null` while the answer is unknown (initial fetch, or no address). Use this
 * to gate UI for actions that the chain restricts to existing members
 * (invite, propose project, create tag, etc.).
 */
export function useIsRepMember(address: string | null | undefined): boolean | null {
  const [isMember, setIsMember] = useState<boolean | null>(() => {
    if (!address) return null;
    const cached = freshRepMember(address);
    return cached === undefined ? null : cached !== null;
  });
  useEffect(() => {
    if (!address) {
      setIsMember(null);
      return;
    }
    let cancelled = false;
    loadRepMember(address).then((m) => {
      if (!cancelled) setIsMember(m !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return address ? isMember : null;
}
