"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactClass, listArtifactOffers, listArtifactOffersByBidder, listArtifactTokensByOwner } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { timeRemaining } from "@/lib/utils";
import { TokenLock, type Offer, type TokenView } from "@/types/artifact";
import type { MsgAcceptOffer, MsgCancelOffer } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import { classTitle, fieldCls, formatCoin, lockOf, shownToken, tokenRef, tokenTitle, useArtifactTx } from "./shared";

// There is no "offers received" query: it's built from the holder's tokens,
// one offers read per token and one per class (collection offers). Bounded
// so a large collection can't fan out into hundreds of requests.
const MAX_TOKENS_SCANNED = 60;
const MAX_CLASSES_SCANNED = 20;

/** An offers read, empty on a node without the endpoint. */
function orEmpty(p: Promise<{ offers: Offer[] }>): Promise<{ offers: Offer[] }> {
  return p.catch((err) => {
    if (isMissingEndpoint(err)) return { offers: [] };
    throw err;
  });
}

/** The bidder's own offers, and offers received on their tokens (token and collection offers). */
async function fetchOffers(address: string) {
  const mine = await orEmpty(listArtifactOffersByBidder(address, { limit: "100" }));
  const tokens = await listArtifactTokensByOwner(address, { limit: String(MAX_TOKENS_SCANNED) });
  const held = tokens.tokens || [];
  const classIds = Array.from(new Set(held.map((v) => v.token.class_id))).slice(0, MAX_CLASSES_SCANNED);
  const [perToken, perClass] = await Promise.all([
    Promise.all(held.map((v) => listArtifactOffers(v.token.class_id, v.token.id, { limit: "20" }).then((r) => r.offers || []).catch(() => []))),
    Promise.all(classIds.map((c) => listArtifactOffers(c, "0", { limit: "20" }).then((r) => r.offers || []).catch(() => []))),
  ]);
  const received = [...perToken.flat(), ...perClass.flat()];
  received.sort((a, b) => (BigInt(b.price?.amount || "0") > BigInt(a.price?.amount || "0") ? 1 : -1));
  return { made: mine.offers || [], held, truncated: !!tokens.pagination?.next_key, received };
}

interface Props {
  onSelectToken: (classId: string, tokenId: string) => void;
  onOpenClass: (classId: string) => void;
}

export default function OffersView({ onSelectToken, onOpenClass }: Props) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const [tab, setTab] = useState<"received" | "made">("received");
  const [made, setMade] = useState<Offer[] | null>(null);
  const [received, setReceived] = useState<Offer[] | null>(null);
  const [held, setHeld] = useState<TokenView[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [classNames, setClassNames] = useState<Record<string, string>>({});
  const [sellFor, setSellFor] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(() => {
    if (!address) return;
    fetchOffers(address)
      .then((r) => {
        setMade(r.made);
        setHeld(r.held);
        setTruncated(r.truncated);
        setReceived(r.received);
        const ids = Array.from(new Set([...r.received, ...r.made].map((o) => o.class_id)));
        Promise.all(ids.map((id) => getArtifactClass(id).then((c) => c.class).catch(() => null))).then((views) => {
          const next: Record<string, string> = {};
          for (const v of views) if (v) next[v.class.id] = classTitle(v.class, v.withheld);
          setClassNames(next);
        });
      })
      .catch(setLoadError);
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  const { pending, error, clearError, setError, send } = useArtifactTx(load);

  const cancel = (o: Offer) => {
    if (!address) return;
    const value: MsgCancelOffer = { bidder: address, offerId: BigInt(o.id) };
    return send(`cancel-${o.id}`, { typeUrl: ArtifactMsgTypeUrls.CancelOffer, value }, "Couldn't cancel the offer");
  };

  const sellable = (classId: string) =>
    held.filter((v) => {
      const l = lockOf(v.token);
      return v.token.class_id === classId && (l === TokenLock.NONE || l === TokenLock.LISTED) && !v.expired;
    });

  const accept = (o: Offer) => {
    if (!address) return;
    const tokenId = o.token_id !== "0" ? o.token_id : sellFor[o.id] || sellable(o.class_id)[0]?.token.id;
    if (!tokenId) return setError("You have no token of that class to sell.");
    if (!confirm(`Sell ${tokenRef(o.class_id, tokenId)} for ${formatCoin(o.price, config.displayDenom)}?`)) return;
    const value: MsgAcceptOffer = {
      seller: address,
      offerId: BigInt(o.id),
      tokenId: BigInt(tokenId),
      expectedPrice: { denom: o.price?.denom || "", amount: o.price?.amount || "0" },
    };
    return send(`accept-${o.id}`, { typeUrl: ArtifactMsgTypeUrls.AcceptOffer, value }, "Couldn't accept the offer");
  };

  if (loadError) {
    return (
      <ErrorState
        error={loadError}
        onRetry={() => {
          setLoadError(null);
          load();
        }}
      />
    );
  }

  const list = tab === "made" ? made : received && received.filter((o) => !isMine(o.bidder));
  const busy = pending !== null;

  const label = (o: Offer) =>
    o.token_id === "0" ? (
      <button type="button" onClick={() => onOpenClass(o.class_id)} className="sd-artifact-link">
        Any token of {classNames[o.class_id] || `class #${o.class_id}`}
      </button>
    ) : (
      <button type="button" onClick={() => onSelectToken(o.class_id, o.token_id)} className="sd-artifact-link">
        {(() => {
          const v = held.find((h) => h.token.class_id === o.class_id && h.token.id === o.token_id);
          return v ? tokenTitle(shownToken(v), v.withheld) : `Token ${tokenRef(o.class_id, o.token_id)}`;
        })()}
      </button>
    );

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button onClick={() => setTab("received")} className={`sd-btn ${tab === "received" ? "sd-btn-verdigris" : "sd-btn-secondary"}`}>
          Offers on my tokens{received ? ` (${received.length})` : ""}
        </button>
        <button onClick={() => setTab("made")} className={`sd-btn ${tab === "made" ? "sd-btn-verdigris" : "sd-btn-secondary"}`}>
          My offers{made ? ` (${made.length})` : ""}
        </button>
      </div>
      {tab === "received" && (
        <p className="text-xs text-zinc-500">
          Offers on tokens you hold and collection offers on their classes, best first.
          {truncated ? ` Only your first ${MAX_TOKENS_SCANNED} tokens are checked.` : ""}
        </p>
      )}
      {tab === "made" && <p className="text-xs text-zinc-500">Your escrowed offers. Cancelling returns the amount to you.</p>}
      <ActionBanner message={error} onDismiss={clearError} />
      {list === null ? (
        <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      ) : list.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-10 text-center text-sm text-zinc-400">
          {tab === "made" ? "You have no open offers." : "No offers on your tokens."}
        </div>
      ) : (
        list.map((o) => {
          const options = o.token_id === "0" ? sellable(o.class_id) : [];
          return (
            <div key={o.id} className="sd-hull-tile flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
              <div className="min-w-0 text-sm">
                <div className="text-zinc-100">{label(o)}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                  {tab === "received" && (
                    <>
                      <span>from</span>
                      <CopyableAddress address={o.bidder} resolveName className="text-zinc-400" />
                    </>
                  )}
                  {o.expires_at && <span>· {timeRemaining(o.expires_at)}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-amber-200">{formatCoin(o.price, config.displayDenom)}</span>
                {tab === "made" ? (
                  <button onClick={() => cancel(o)} disabled={busy} className="sd-btn sd-btn-secondary">
                    {pending === `cancel-${o.id}` ? "Cancelling…" : "Cancel"}
                  </button>
                ) : (
                  <>
                    {options.length > 1 && (
                      <select
                        value={sellFor[o.id] || options[0].token.id}
                        onChange={(e) => setSellFor({ ...sellFor, [o.id]: e.target.value })}
                        className={`${fieldCls} w-36 py-1 text-xs`}
                      >
                        {options.map((v) => (
                          <option key={v.token.id} value={v.token.id}>#{v.token.id} {tokenTitle(shownToken(v), v.withheld)}</option>
                        ))}
                      </select>
                    )}
                    {(o.token_id !== "0" || options.length > 0) && (
                      <button onClick={() => accept(o)} disabled={busy} className="sd-btn sd-btn-verdigris">
                        {pending === `accept-${o.id}` ? "Selling…" : "Accept"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
