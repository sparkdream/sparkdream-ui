"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import ErrorState from "@/components/ErrorState";
import { getArtifactClass, listArtifactTokensByOwner } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import type { TokenView } from "@/types/artifact";
import TokenGrid from "./TokenGrid";
import { classTitle } from "./shared";

const PAGE = "40";

interface Props {
  search: string;
  onSelectToken: (classId: string, tokenId: string) => void;
}

export default function MyTokens({ search, onSelectToken }: Props) {
  const { address } = useWallet();
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [classNames, setClassNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const addNames = useCallback((list: TokenView[]) => {
    const ids = Array.from(new Set(list.map((t) => t.token.class_id)));
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
      addNames(res.tokens || []);
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
      addNames(res.tokens || []);
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
          (t.token.metadata?.name || "").toLowerCase().includes(q) ||
          (classNames[t.token.class_id] || "").toLowerCase().includes(q) ||
          `${t.token.class_id}/${t.token.id}` === q
      )
    : tokens;

  return (
    <div>
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
