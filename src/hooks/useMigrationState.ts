"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getRepAliases,
  getRepCanonical,
  getRepMember,
  getRepParams,
  getRepPendingMigration,
  getRepPendingMigrationByTarget,
  getRepRecoveryCommitments,
  invalidateRepMigration,
  listRepMemberMigrations,
} from "@/lib/api";
import { isMissingEndpoint } from "@/lib/errors";
import { readMigrationParams, type MigrationParams } from "@/lib/migration";
import type { MemberMigration, RecoveryCommitmentSet, RepMember } from "@/types/rep";

export interface MigrationState {
  /** The address the state was loaded for. */
  address: string;
  params: MigrationParams;
  /** The member record held by `address`, or null when it holds none (or moved away). */
  member: RepMember | null;
  tombstoned: boolean;
  canonical: string;
  tombstonePath: string;
  /** Every address of the member, canonical first. */
  aliases: string[];
  recentAliases: string[];
  /** Pending migration away from `address` (it is the old address). */
  outgoing: MemberMigration | null;
  /** Pending migration whose new address is `address`. */
  incoming: MemberMigration | null;
  commitments: RecoveryCommitmentSet;
  history: MemberMigration[];
  /** The node predates member migration: hide the whole surface. */
  unsupported: boolean;
}

/** Wall-clock milliseconds, re-read every `intervalMs` for live countdowns. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const soft = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

/**
 * Everything the identity panels need about `address` under x/rep member key
 * migration: its own record, the migration it is leaving through or arriving
 * by, its recovery commitments, its aliases and its history. Each read is
 * independent so one missing endpoint degrades one panel, not all of them.
 */
export function useMigrationState(address: string | null) {
  const [state, setState] = useState<MigrationState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!address) return;
    let live = true;
    (async () => {
      try {
        const canon = await getRepCanonical(address).catch((err) => {
          if (isMissingEndpoint(err)) return null;
          throw err;
        });
        if (!canon) {
          if (live) setState((s) => ({ ...(s ?? emptyState(address)), address, unsupported: true }));
          return;
        }
        const [paramsRes, memberRes, aliasesRes, outgoing, incoming, commitments, historyRes] = await Promise.all([
          soft(getRepParams(), null),
          soft(getRepMember(address), null),
          soft(getRepAliases(canon.canonical || address), null),
          soft(getRepPendingMigration(address), null),
          soft(getRepPendingMigrationByTarget(address), null),
          soft(getRepRecoveryCommitments(address), {} as RecoveryCommitmentSet),
          soft(listRepMemberMigrations({ address }, { limit: "50", reverse: true }), null),
        ]);
        if (!live) return;
        // member/{address} answers an old address with the moved record.
        const member = memberRes?.member && memberRes.member.address === address ? memberRes.member : null;
        setState({
          address,
          params: readMigrationParams(paramsRes?.params),
          member,
          tombstoned: !!canon.tombstoned,
          canonical: canon.canonical || address,
          tombstonePath: canon.path ?? "",
          aliases: aliasesRes?.addresses?.length ? aliasesRes.addresses : [address],
          recentAliases: aliasesRes?.recent?.length ? aliasesRes.recent : [address],
          outgoing,
          incoming,
          commitments,
          history: historyRes?.migrations ?? [],
          unsupported: false,
        });
        setError(null);
      } catch (err) {
        if (live) setError(err);
      }
    })();
    return () => {
      live = false;
    };
  }, [address, nonce]);

  const refresh = useCallback(() => {
    invalidateRepMigration();
    setNonce((n) => n + 1);
  }, []);

  const current = state && state.address === address ? state : null;
  return { state: current, loading: !!address && !current && !error, error, refresh };
}

function emptyState(address: string): MigrationState {
  return {
    address,
    params: readMigrationParams(null),
    member: null,
    tombstoned: false,
    canonical: address,
    tombstonePath: "",
    aliases: [address],
    recentAliases: [address],
    outgoing: null,
    incoming: null,
    commitments: {},
    history: [],
    unsupported: false,
  };
}
