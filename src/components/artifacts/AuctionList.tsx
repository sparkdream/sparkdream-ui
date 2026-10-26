"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { getArtifactClass, getArtifactToken, listArtifactAuctions, listArtifactAuctionsBySeller } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { formatSpark, timeRemaining } from "@/lib/utils";
import type { Auction } from "@/types/artifact";
import { classTitle, shownToken, tokenRef, tokenTitle } from "./shared";

const PAGE = "30";

interface Props {
  mode: "all" | "mine";
  search: string;
  sort: "newest" | "oldest";
  onSelectToken: (classId: string, tokenId: string) => void;
}

interface Label {
  token: string;
  cls: string;
}

/** Open English auctions, or the connected seller's. */
export default function AuctionList({ mode, search, sort, onSelectToken }: Props) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [labels, setLabels] = useState<Record<string, Label>>({});
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchPage = useCallback(
    (key?: string) => {
      const p = { limit: PAGE, key, reverse: sort === "newest" };
      if (mode === "mine") {
        if (!address) return Promise.resolve({ auctions: [] as Auction[], pagination: undefined });
        return listArtifactAuctionsBySeller(address, p);
      }
      return listArtifactAuctions(undefined, p);
    },
    [mode, address, sort]
  );

  // Auctions carry ids only; resolve names for display (both reads are cached).
  const addLabels = useCallback((list: Auction[]) => {
    for (const a of list) {
      const k = tokenRef(a.class_id, a.token_id);
      Promise.all([
        getArtifactToken(a.class_id, a.token_id).catch(() => null),
        getArtifactClass(a.class_id).catch(() => null),
      ]).then(([t, c]) => {
        setLabels((prev) => ({
          ...prev,
          [k]: {
            token: t ? tokenTitle(shownToken(t.token), t.token.withheld) : `Token #${a.token_id}`,
            cls: c ? classTitle(c.class.class, c.class.withheld) : `Class #${a.class_id}`,
          },
        }));
      });
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPage();
      setAuctions(res.auctions || []);
      setNextKey(res.pagination?.next_key || null);
      addLabels(res.auctions || []);
    } catch (err) {
      if (isMissingEndpoint(err)) setAuctions([]);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, addLabels]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!nextKey) return;
    try {
      const res = await fetchPage(nextKey);
      setAuctions((prev) => [...prev, ...(res.auctions || [])]);
      setNextKey(res.pagination?.next_key || null);
      addLabels(res.auctions || []);
    } catch {
      // Leave the button for a retry.
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={load} />;

  const q = search.trim().toLowerCase();
  const shown = q
    ? auctions.filter((a) => {
        const lab = labels[tokenRef(a.class_id, a.token_id)];
        return (
          (lab?.token || "").toLowerCase().includes(q) ||
          (lab?.cls || "").toLowerCase().includes(q) ||
          tokenRef(a.class_id, a.token_id) === q
        );
      })
    : auctions;

  return (
    <div className="space-y-2">
      {mode === "mine" ? (
        <h3 className="text-sm font-semibold text-zinc-300">Your auctions</h3>
      ) : (
        <p className="text-xs text-zinc-500">
          English auctions in {config.displayDenom}. Bids are held in escrow and refunded when outbid. A late bid extends the end.
        </p>
      )}
      {shown.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-10 text-center text-sm text-zinc-400">
          {q ? "No auctions match." : mode === "mine" ? "You have no open auctions." : "No auctions right now."}
        </div>
      ) : (
        shown.map((a) => {
          const k = tokenRef(a.class_id, a.token_id);
          const lab = labels[k];
          const hasBids = !!a.high_bidder;
          const ended = Number(a.ends_at || 0) * 1000 <= Date.now();
          return (
            <button
              key={a.id}
              onClick={() => onSelectToken(a.class_id, a.token_id)}
              className="sd-hull-tile interactive flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{lab?.token || `Token #${a.token_id}`}</span>
                  <span className="font-mono text-[11px] text-zinc-500">{k}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span>{lab?.cls || `Class #${a.class_id}`}</span>
                  {mode === "all" && (
                    <>
                      <span>· by</span>
                      <CopyableAddress address={a.seller} resolveName nested className="text-zinc-400" />
                    </>
                  )}
                  <span>· {a.bids ?? 0} bid{a.bids === 1 ? "" : "s"}</span>
                  {a.ends_at && <span className={ended ? "text-amber-300" : ""}>· {ended ? "ended, awaiting settlement" : timeRemaining(a.ends_at)}</span>}
                </div>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] text-zinc-500">{hasBids ? "High bid" : "Reserve"}</span>
                <span className="font-semibold text-amber-200">
                  {formatSpark(hasBids ? a.high_bid || "0" : a.reserve_price?.amount || "0")} {config.displayDenom}
                </span>
              </span>
            </button>
          );
        })
      )}
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
