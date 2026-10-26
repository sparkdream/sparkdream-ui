"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import {
  getArtifactClass,
  getArtifactParams,
  getArtifactToken,
  listArtifactListings,
  listArtifactListingsBySeller,
} from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { timeRemaining } from "@/lib/utils";
import type { Listing } from "@/types/artifact";
import { classTitle, formatCoin, shownToken, tokenRef, tokenTitle } from "./shared";

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

export default function MarketList({ mode, search, sort, onSelectToken }: Props) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const [listings, setListings] = useState<Listing[]>([]);
  const [labels, setLabels] = useState<Record<string, Label>>({});
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [marketOn, setMarketOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchPage = useCallback(
    (key?: string) => {
      const p = { limit: PAGE, key, reverse: sort === "newest" };
      if (mode === "mine") {
        if (!address) return Promise.resolve({ listings: [] as Listing[], pagination: undefined });
        return listArtifactListingsBySeller(address, p);
      }
      return listArtifactListings(p);
    },
    [mode, address, sort]
  );

  // Listings carry ids only; resolve names for display (both reads are cached).
  const addLabels = useCallback((list: Listing[]) => {
    for (const l of list) {
      const k = tokenRef(l.class_id, l.token_id);
      Promise.all([
        getArtifactToken(l.class_id, l.token_id).catch(() => null),
        getArtifactClass(l.class_id).catch(() => null),
      ]).then(([t, c]) => {
        setLabels((prev) => ({
          ...prev,
          [k]: {
            token: t ? tokenTitle(shownToken(t.token), t.token.withheld) : `Token #${l.token_id}`,
            cls: c ? classTitle(c.class.class, c.class.withheld) : `Class #${l.class_id}`,
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
      setListings(res.listings || []);
      setNextKey(res.pagination?.next_key || null);
      addLabels(res.listings || []);
      getArtifactParams()
        .then((r) => setMarketOn(r.params.market_enabled !== false))
        .catch(() => {});
    } catch (err) {
      if (isMissingEndpoint(err)) setListings([]);
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
      setListings((prev) => [...prev, ...(res.listings || [])]);
      setNextKey(res.pagination?.next_key || null);
      addLabels(res.listings || []);
    } catch {
      // Leave the button for a retry.
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={load} />;

  const q = search.trim().toLowerCase();
  const shown = q
    ? listings.filter((l) => {
        const lab = labels[tokenRef(l.class_id, l.token_id)];
        return (
          (lab?.token || "").toLowerCase().includes(q) ||
          (lab?.cls || "").toLowerCase().includes(q) ||
          tokenRef(l.class_id, l.token_id) === q
        );
      })
    : listings;

  return (
    <div className="space-y-2">
      {!marketOn && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-900/15 px-3 py-2 text-xs text-amber-300">
          The market is turned off right now. Sellers can still delist.
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Fixed prices in {config.displayDenom}. Nothing is held in escrow: the token stays with the seller until someone buys.
      </p>
      {shown.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-10 text-center text-sm text-zinc-400">
          {q ? "No listings match." : mode === "mine" ? "You have nothing listed." : "Nothing for sale right now."}
        </div>
      ) : (
        shown.map((l) => {
          const k = tokenRef(l.class_id, l.token_id);
          const lab = labels[k];
          return (
            <button
              key={k}
              onClick={() => onSelectToken(l.class_id, l.token_id)}
              className="sd-hull-tile interactive flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{lab?.token || `Token #${l.token_id}`}</span>
                  <span className="font-mono text-[11px] text-zinc-500">{k}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  <span>{lab?.cls || `Class #${l.class_id}`}</span>
                  {mode === "all" && (
                    <>
                      <span>· by</span>
                      <CopyableAddress address={l.seller} resolveName nested className="text-zinc-400" />
                    </>
                  )}
                  {l.expires_at && <span>· {timeRemaining(l.expires_at)}</span>}
                </div>
              </div>
              <span className="shrink-0 font-semibold text-amber-200">{formatCoin(l.price, config.displayDenom)}</span>
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
