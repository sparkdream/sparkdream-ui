"use client";

import { useCallback, useEffect, useState } from "react";
import type { Group } from "@/types/commons";
import { getAllBankBalances } from "@/lib/api";
import type { BankBalance } from "@/lib/api";
import { formatDream } from "@/lib/reveal-fmt";
import { truncateAddress } from "@/lib/utils";
import { useChainConfig } from "@/contexts/ChainConfigContext";

interface Balances {
  spark: string;
}

function pickBalance(balances: BankBalance[], denom: string): string {
  return balances.find((b) => b.denom === denom)?.amount || "0";
}

/** Fetch SPARK balances for a set of policy addresses in parallel. */
function useGroupTreasuries(addresses: string[], sparkDenom: string) {
  const [balances, setBalances] = useState<Map<string, Balances>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the caller (or refresh button) to force a re-fetch.
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Stable key so the effect doesn't re-run when the parent passes a fresh
  // array with the same contents on every render.
  const key = addresses.join(",");

  useEffect(() => {
    if (addresses.length === 0) {
      setBalances(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(
      addresses.map(async (addr) => {
        const res = await getAllBankBalances(addr);
        return [
          addr,
          { spark: pickBalance(res.balances || [], sparkDenom) },
        ] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setBalances(new Map(pairs));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load balances");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sparkDenom, tick]);

  return { balances, loading, error, refresh };
}

// ── Compact banner for the Proposals view ──────────────────────────

interface CouncilTreasuryBannerProps {
  group: Group;
}

export function CouncilTreasuryBanner({ group }: CouncilTreasuryBannerProps) {
  const { config } = useChainConfig();
  const { balances, loading, error } = useGroupTreasuries(
    [group.policy_address],
    config.denom,
  );
  const b = balances.get(group.policy_address);

  return (
    <div className="mb-4 rounded-xl sd-hull-tile px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Treasury</span>
          <span
            className="font-mono text-zinc-400"
            title={group.policy_address}
          >
            {truncateAddress(group.policy_address)}
          </span>
        </div>
        {error ? (
          <span className="text-xs text-red-400">{error}</span>
        ) : loading || !b ? (
          <div>
            <span className="text-xs text-zinc-500">{config.displayDenom} </span>
            <span className="font-medium text-zinc-200">…</span>
          </div>
        ) : b.spark === "0" ? (
          <span className="text-xs text-zinc-500">Empty</span>
        ) : (
          <div>
            <span className="text-xs text-zinc-500">{config.displayDenom} </span>
            <span className="font-medium text-zinc-200">
              {formatDream(b.spark)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Full overview of every group's treasury ────────────────────────

interface CommunityTreasuriesProps {
  groups: Group[];
}

export function CommunityTreasuries({ groups }: CommunityTreasuriesProps) {
  const { config } = useChainConfig();
  const addresses = groups.map((g) => g.policy_address);
  const { balances, loading, error, refresh } = useGroupTreasuries(
    addresses,
    config.denom,
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Treasuries
          <span className="ml-2 text-sm font-normal text-zinc-500">
            {groups.length} {groups.length === 1 ? "group" : "groups"}
          </span>
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="sd-btn"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No groups</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const b = balances.get(g.policy_address);
            return (
              <div key={g.index} className="rounded-xl sd-hull-tile p-4">
                <div className="mb-2 font-medium text-zinc-100">{g.index}</div>
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-zinc-500">{config.displayDenom}</p>
                    <p className="font-medium text-zinc-200">
                      {loading && !b ? "…" : formatDream(b?.spark || "0")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Max spend / epoch</p>
                    <p className="font-medium text-zinc-300">
                      {formatDream(g.max_spend_per_epoch)} {config.displayDenom}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Funding weight</p>
                    <p className="font-medium text-zinc-300">
                      {g.funding_weight}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Address</p>
                    <p
                      className="font-mono text-zinc-300"
                      title={g.policy_address}
                    >
                      {truncateAddress(g.policy_address)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
