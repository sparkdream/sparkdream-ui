"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import ErrorState from "@/components/ErrorState";
import { getArtifactClass, getArtifactEdition, listArtifactBalancesByOwner, listArtifactTokensByOwner } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { formatSpark } from "@/lib/utils";
import type { BalanceView, TokenView } from "@/types/artifact";
import TokenGrid from "./TokenGrid";
import { ArtifactMedia, classTitle, shownToken } from "./shared";

const PAGE = "40";

interface Props {
  search: string;
  onSelectToken: (classId: string, tokenId: string) => void;
  onOpenEdition: (classId: string, editionId: string) => void;
}

export default function MyTokens({ search, onSelectToken, onOpenEdition }: Props) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const [balances, setBalances] = useState<BalanceView[]>([]);
  const [editionNames, setEditionNames] = useState<Record<string, string>>({});
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [classNames, setClassNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const addNames = useCallback((classIds: string[]) => {
    const ids = Array.from(new Set(classIds));
    Promise.all(ids.map((id) => getArtifactClass(id).then((r) => r.class).catch(() => null))).then((views) => {
      setClassNames((prev) => {
        const next = { ...prev };
        for (const v of views) if (v) next[v.class.id] = classTitle(v.class, v.withheld);
        return next;
      });
    });
  }, []);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listArtifactTokensByOwner(address, { limit: PAGE });
      setTokens(res.tokens || []);
      setNextKey(res.pagination?.next_key || null);
      addNames((res.tokens || []).map((t) => t.token.class_id));
      listArtifactBalancesByOwner(address, { limit: "100" })
        .then((r) => {
          const list = r.balances || [];
          setBalances(list);
          addNames(list.map((b) => b.balance.class_id));
          for (const b of list) {
            const k = `${b.balance.class_id}/${b.balance.edition_id}`;
            getArtifactEdition(b.balance.class_id, b.balance.edition_id)
              .then((e) =>
                setEditionNames((prev) => ({
                  ...prev,
                  [k]: e.edition.withheld ? `Edition #${b.balance.edition_id}` : e.edition.edition.metadata?.name?.trim() || `Edition #${b.balance.edition_id}`,
                }))
              )
              .catch(() => {});
          }
        })
        .catch(() => setBalances([]));
    } catch (err) {
      if (isMissingEndpoint(err)) setTokens([]);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [address, addNames]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!address || !nextKey) return;
    try {
      const res = await listArtifactTokensByOwner(address, { limit: PAGE, key: nextKey });
      setTokens((prev) => [...prev, ...(res.tokens || [])]);
      setNextKey(res.pagination?.next_key || null);
      addNames((res.tokens || []).map((t) => t.token.class_id));
    } catch {
      // Leave the button for a retry.
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={load} />;

  const q = search.trim().toLowerCase();
  const shown = q
    ? tokens.filter(
        (t) =>
          (shownToken(t).metadata?.name || "").toLowerCase().includes(q) ||
          (classNames[t.token.class_id] || "").toLowerCase().includes(q) ||
          `${t.token.class_id}/${t.token.id}` === q
      )
    : tokens;

  const shownBalances = q
    ? balances.filter((b) => (editionNames[`${b.balance.class_id}/${b.balance.edition_id}`] || "").toLowerCase().includes(q))
    : balances;

  return (
    <div>
      {shownBalances.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-zinc-300">Edition units</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shownBalances.map((b) => {
              const k = `${b.balance.class_id}/${b.balance.edition_id}`;
              const units = BigInt(b.balance.amount || "0") + BigInt(b.balance.locked || "0");
              return (
                <button
                  key={k}
                  onClick={() => onOpenEdition(b.balance.class_id, b.balance.edition_id)}
                  className="sd-hull-tile interactive flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                >
                  <ArtifactMedia uri="" size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-100">{editionNames[k] || `Edition #${b.balance.edition_id}`}</span>
                      {b.claimable && b.claimable !== "0" && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          {formatSpark(b.claimable)} {config.displayDenom} to claim
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">
                      <span className="font-mono">{k}</span> · {units.toString()} unit{units === BigInt(1) ? "" : "s"}
                      {classNames[b.balance.class_id] && <span className="ml-2">{classNames[b.balance.class_id]}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-300">Tokens</h3>
        </section>
      )}
      <TokenGrid
        tokens={shown}
        onSelect={onSelectToken}
        classNames={classNames}
        empty={q ? "No tokens match." : "You don't hold any tokens yet."}
      />
      {nextKey && (
        <button
          onClick={loadMore}
          className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
        >
          Load more
        </button>
      )}
    </div>
  );
}
