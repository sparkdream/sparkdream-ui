"use client";

import { useEffect, useState } from "react";
import { invalidateTags, listTags } from "@/lib/api";
import { loadRepMember } from "@/lib/repMember";
import { RepMsgTypeUrls } from "@/lib/tx";
import { TrustLevel } from "@/types/rep";

const TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

/** Fetches the rep tag registry, ranked by usage_count descending. */
export function useTagRegistry(): {
  tags: string[];
  loading: boolean;
  refresh: () => void;
} {
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listTags({ limit: "200" })
      .then((res) => {
        if (cancelled) return;
        const ranked = [...(res.tag || [])].sort((a, b) => {
          const ua = parseInt(a.usage_count || "0", 10);
          const ub = parseInt(b.usage_count || "0", 10);
          return ub - ua;
        });
        setTags(ranked.map((t) => t.name));
      })
      .catch(() => {
        if (!cancelled) setTags([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // refresh() is called after tag-creating txs, so it must bypass the cache.
  return {
    tags,
    loading,
    refresh: () => {
      invalidateTags();
      setVersion((v) => v + 1);
    },
  };
}

/**
 * True when the connected wallet meets MsgCreateTag's trust-level gate
 * (>= ESTABLISHED). Returns false until the member record loads, so the
 * "create tag" affordance stays hidden for unknown / provisional users.
 */
export function useCanCreateTags(address: string | null | undefined): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    loadRepMember(address).then((m) => {
      if (cancelled) return;
      const rank = TRUST_RANK[m?.trust_level || ""] ?? -1;
      setAllowed(rank >= TRUST_RANK[TrustLevel.ESTABLISHED]);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return address ? allowed : false;
}

/**
 * Returns MsgCreateTag entries for every selected tag that isn't already in
 * the registry. The chain processes messages in order, so prepending these
 * to the parent tx makes the tags exist before the parent message validates.
 */
export function buildCreateTagMsgs(
  creator: string,
  selected: string[],
  registry: string[]
): { typeUrl: string; value: Record<string, unknown> }[] {
  const known = new Set(registry);
  return selected
    .filter((t) => !known.has(t))
    .map((name) => ({
      typeUrl: RepMsgTypeUrls.CreateTag,
      value: { creator, name },
    }));
}
