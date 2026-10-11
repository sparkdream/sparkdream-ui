"use client";

import { useEffect, useState } from "react";
import { getForumParams, getParams } from "@/lib/api";
import { loadRepMember } from "@/lib/repMember";
import {
  checkMediaPermitted,
  mediaRulesFromParams,
  NO_MEDIA_RULES,
  type MediaGateResult,
  type MediaRules,
} from "@/lib/mediaLabels";
import { formatSpark } from "@/lib/utils";
import { MemberStatus, TrustLevel } from "@/types/rep";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import { useChainConfig } from "@/contexts/ChainConfigContext";

export type MediaModule = "blog" | "forum";

// Params change only by governance; one read per module per page load is plenty.
const rulesCache = new Map<MediaModule, Promise<MediaRules>>();

function loadMediaRules(module: MediaModule): Promise<MediaRules> {
  let p = rulesCache.get(module);
  if (!p) {
    p = (module === "blog" ? getParams() : getForumParams())
      .then((res) => mediaRulesFromParams(res.params))
      .catch(() => {
        rulesCache.delete(module);
        return NO_MEDIA_RULES;
      });
    rulesCache.set(module, p);
  }
  return p;
}

const TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

interface AuthorStanding {
  address: string;
  /** Active x/rep member (MEMBER_STATUS_ACTIVE is the proto zero, so absent counts). */
  member: boolean;
  trustLevel: number;
}

export interface MediaGateOptions {
  module: MediaModule;
  /** media_flags the chain will compute for this write (labelBody). */
  flags: number;
  address: string | null | undefined;
  anonymous: boolean;
  /** Author bond being attached, micro-DREAM. Ignored unless bondAllowed. */
  authorBond?: string | null;
  /** Creates can carry a bond; edits have no bond path. */
  bondAllowed: boolean;
}

export interface MediaGateState extends MediaGateResult {
  rules: MediaRules;
  /** media_scan_fee formatted with the bond (SPARK) ticker, or null when 0. */
  scanFeeLabel: string | null;
  /** media_author_bond_min formatted with the DREAM ticker, or null when 0. */
  bondMinLabel: string | null;
}

/**
 * Mirrors the chain's media posting rules (CheckMediaPermitted) for a blog or
 * forum write about to be signed: whether it will be labelled as media, and if
 * so whether the author's standing (or an attached bond) lets it through.
 */
export function useMediaGate(opts: MediaGateOptions): MediaGateState {
  const dream = useDreamDenom();
  const spark = useChainConfig().config.displayDenom;
  const [rules, setRules] = useState<MediaRules>(NO_MEDIA_RULES);
  const [standing, setStanding] = useState<AuthorStanding | null>(null);

  useEffect(() => {
    let live = true;
    loadMediaRules(opts.module).then((r) => live && setRules(r));
    return () => {
      live = false;
    };
  }, [opts.module]);

  // Only look the author up once the write is actually media, so plain-text
  // composers cost nothing extra. loadRepMember is cached and deduped.
  const needStanding = opts.flags !== 0 && rules.enabled && !!opts.address;
  useEffect(() => {
    if (!needStanding || !opts.address) return;
    let live = true;
    const addr = opts.address;
    loadRepMember(addr).then((m) => {
      if (!live) return;
      setStanding({
        address: addr,
        member: !!m && (!m.status || m.status === MemberStatus.ACTIVE),
        trustLevel: m ? TRUST_RANK[m.trust_level || ""] ?? 0 : 0,
      });
    });
    return () => {
      live = false;
    };
  }, [needStanding, opts.address]);

  const current = standing && standing.address === opts.address ? standing : null;
  const bondMinLabel =
    rules.bondMin && rules.bondMin !== "0" ? `${formatSpark(rules.bondMin)} ${dream}` : null;
  const scanFeeLabel =
    rules.scanFee && rules.scanFee !== "0" ? `${formatSpark(rules.scanFee)} ${spark}` : null;

  const result = checkMediaPermitted({
    flags: opts.flags,
    rules,
    anonymous: opts.anonymous,
    member: current ? current.member : null,
    trustLevel: current ? current.trustLevel : null,
    authorBond: opts.bondAllowed ? opts.authorBond : null,
    bondAllowed: opts.bondAllowed,
    bondLabel: bondMinLabel ?? undefined,
  });

  return { ...result, rules, scanFeeLabel, bondMinLabel };
}
