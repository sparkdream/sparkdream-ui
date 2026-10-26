"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactAuction, listArtifactOffers, listArtifactTokensByOwner } from "@/lib/artifactApi";
import { formatSpark, formatTime, timeRemaining } from "@/lib/utils";
import {
  TokenLock,
  type ArtifactClass,
  type ArtifactParams,
  type Auction,
  type AuctionResponse,
  type Coin,
  type Offer,
  type TokenView,
} from "@/types/artifact";
import type {
  MsgAcceptOffer,
  MsgBid,
  MsgCancelAuction,
  MsgCancelOffer,
  MsgMakeOffer,
  MsgSettleAuction,
  MsgStartAuction,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  FieldLabel,
  Note,
  bpsToPercent,
  fieldCls,
  formatCoin,
  formatSeconds,
  lockOf,
  nowUnix,
  parsePositiveAmount,
  shownToken,
  tokenTitle,
  useArtifactTx,
} from "./shared";

/** Longest offer, listing or auction, in whole days. */
export function maxMarketDays(params: ArtifactParams | null): number {
  return params?.max_listing_duration ? Math.max(1, Math.floor(Number(params.max_listing_duration) / 86400)) : 30;
}

function parseDays(s: string, max: number): number | null {
  const d = Number(s.trim());
  if (!Number.isFinite(d) || d <= 0 || d > max) return null;
  return Math.round(d * 86400);
}

function sameCoin(c: Coin | undefined): { denom: string; amount: string } {
  return { denom: c?.denom || "", amount: c?.amount || "0" };
}

// ---- Offers ----------------------------------------------------------------------

/**
 * Offers on one token, plus the class's collection offers, which the holder
 * can accept too. Bidders make and cancel their own; the holder accepts.
 */
export function TokenOffers({
  view,
  params,
  isHolder,
  onChanged,
}: {
  view: TokenView;
  params: ArtifactParams | null;
  isHolder: boolean;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const t = view.token;
  const [offers, setOffers] = useState<Offer[]>([]);
  const [collection, setCollection] = useState<Offer[]>([]);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("7");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    listArtifactOffers(t.class_id, t.id, { limit: "50" })
      .then((r) => setOffers(r.offers || []))
      .catch(() => setOffers([]));
    listArtifactOffers(t.class_id, "0", { limit: "50" })
      .then((r) => setCollection(r.offers || []))
      .catch(() => setCollection([]));
  }, [t.class_id, t.id]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);

  const marketOn = params?.market_enabled !== false;
  const maxDays = maxMarketDays(params);
  const lock = lockOf(t);
  const canAccept = isHolder && (lock === TokenLock.NONE || lock === TokenLock.LISTED) && marketOn;
  const canOffer = !!address && !isHolder && marketOn && !view.withheld;
  const all = [...offers, ...collection].sort((a, b) => (BigInt(b.price?.amount || "0") > BigInt(a.price?.amount || "0") ? 1 : -1));

  const make = () => {
    if (!address) return;
    const amount = parsePositiveAmount(price);
    if (!amount) return setError("Enter an offer above 0.");
    const duration = parseDays(days, maxDays);
    if (!duration) return setError(`An offer can stay open 1 to ${maxDays} days.`);
    const value: MsgMakeOffer = {
      bidder: address,
      classId: BigInt(t.class_id),
      tokenId: BigInt(t.id),
      price: { denom: config.denom, amount },
      duration: BigInt(duration),
      // Pin what the bidder saw: a metadata swap or a change of nested contents voids the offer.
      expectedMetadataHash: view.metadata_hash || "",
      expectedContentsHash: view.contents_hash || "",
    };
    return send("make", { typeUrl: ArtifactMsgTypeUrls.MakeOffer, value }, "Couldn't make the offer", () => {
      setPrice("");
      setShowForm(false);
    });
  };

  const cancel = (o: Offer) => {
    if (!address) return;
    const value: MsgCancelOffer = { bidder: address, offerId: BigInt(o.id) };
    return send(`cancel-${o.id}`, { typeUrl: ArtifactMsgTypeUrls.CancelOffer, value }, "Couldn't cancel the offer");
  };

  const accept = (o: Offer) => {
    if (!address) return;
    if (!confirm(`Sell this token for ${formatCoin(o.price, config.displayDenom)}? Fees and any royalty come out of the price.`)) return;
    const value: MsgAcceptOffer = {
      seller: address,
      offerId: BigInt(o.id),
      tokenId: BigInt(t.id),
      // The exact price shown, so a swapped offer can't sell for less.
      expectedPrice: sameCoin(o.price),
    };
    return send(`accept-${o.id}`, { typeUrl: ArtifactMsgTypeUrls.AcceptOffer, value }, "Couldn't accept the offer");
  };

  if (all.length === 0 && !canOffer) return null;
  const busy = pending !== null;

  return (
    <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Offers</h3>
        {canOffer && !showForm && (
          <button onClick={() => setShowForm(true)} className="sd-btn sd-btn-verdigris">Make an offer</button>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Offers are held in escrow, so a holder who accepts is always paid. Collection offers are open to any token of the class.
      </p>
      {all.length === 0 && <p className="text-xs text-zinc-600">No offers yet.</p>}
      {all.map((o) => {
        const mine = isMine(o.bidder);
        const isCollection = o.token_id === "0";
        // A collection offer can't pin contents, so it can't buy a token holding others.
        const blocked = isCollection && (t.descendants ?? 0) > 0;
        return (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs">
            <span className="inline-flex flex-wrap items-center gap-1 text-zinc-400">
              <span className="font-semibold text-amber-200">{formatCoin(o.price, config.displayDenom)}</span>
              {isCollection && <span className="rounded-full bg-zinc-700/50 px-1.5 text-[10px] text-zinc-300">Any token</span>}
              from <CopyableAddress address={o.bidder} resolveName className="text-zinc-300" />
              {o.expires_at && <span>· {timeRemaining(o.expires_at)}</span>}
            </span>
            <span className="flex gap-2">
              {mine && (
                <button onClick={() => cancel(o)} disabled={busy} className="text-zinc-400 hover:text-red-400 disabled:opacity-50">
                  {pending === `cancel-${o.id}` ? "Cancelling…" : "Cancel"}
                </button>
              )}
              {canAccept && !mine && !blocked && (
                <button onClick={() => accept(o)} disabled={busy} className="sd-btn sd-btn-verdigris">
                  {pending === `accept-${o.id}` ? "Selling…" : "Accept"}
                </button>
              )}
            </span>
          </div>
        );
      })}
      {showForm && canOffer && (
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <div className="grid grid-cols-2 gap-2">
            <FieldLabel label={`Offer (${config.displayDenom})`}>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
            <FieldLabel label="Open for (days)" hint={`Up to ${maxDays}.`}>
              <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
          </div>
          <p className="text-xs text-zinc-500">
            The amount leaves your wallet now and comes back if you cancel or the offer expires. If the token&apos;s metadata or contents
            change first, the holder can&apos;t accept it.
          </p>
          <div className="flex gap-2">
            <button onClick={make} disabled={busy || !price.trim()} className="sd-btn sd-btn-verdigris">
              {pending === "make" ? "Offering…" : "Place offer"}
            </button>
            <button onClick={() => setShowForm(false)} className="sd-btn sd-btn-secondary">Cancel</button>
          </div>
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}

/** Collection offers on a class: anyone makes one, a holder accepts it with one of their tokens. */
export function CollectionOffers({
  cls,
  params,
  onChanged,
}: {
  cls: ArtifactClass;
  params: ArtifactParams | null;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [held, setHeld] = useState<TokenView[]>([]);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("7");
  const [showForm, setShowForm] = useState(false);
  const [sellFor, setSellFor] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    listArtifactOffers(cls.id, "0", { limit: "50" })
      .then((r) => setOffers(r.offers || []))
      .catch(() => setOffers([]));
    if (address) {
      listArtifactTokensByOwner(address, { limit: "100" }, cls.id)
        .then((r) =>
          setHeld(
            (r.tokens || []).filter((v) => {
              const l = lockOf(v.token);
              return (l === TokenLock.NONE || l === TokenLock.LISTED) && !(v.token.descendants ?? 0) && !v.expired;
            })
          )
        )
        .catch(() => setHeld([]));
    }
  }, [cls.id, address]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);
  const marketOn = params?.market_enabled !== false;
  const maxDays = maxMarketDays(params);

  const make = () => {
    if (!address) return;
    const amount = parsePositiveAmount(price);
    if (!amount) return setError("Enter an offer above 0.");
    const duration = parseDays(days, maxDays);
    if (!duration) return setError(`An offer can stay open 1 to ${maxDays} days.`);
    const value: MsgMakeOffer = {
      bidder: address,
      classId: BigInt(cls.id),
      tokenId: BigInt(0),
      price: { denom: config.denom, amount },
      duration: BigInt(duration),
      expectedMetadataHash: "",
      expectedContentsHash: "",
    };
    return send("make", { typeUrl: ArtifactMsgTypeUrls.MakeOffer, value }, "Couldn't make the offer", () => {
      setPrice("");
      setShowForm(false);
    });
  };

  const cancel = (o: Offer) => {
    if (!address) return;
    const value: MsgCancelOffer = { bidder: address, offerId: BigInt(o.id) };
    return send(`cancel-${o.id}`, { typeUrl: ArtifactMsgTypeUrls.CancelOffer, value }, "Couldn't cancel the offer");
  };

  const accept = (o: Offer) => {
    if (!address) return;
    const tokenId = sellFor[o.id] || held[0]?.token.id;
    if (!tokenId) return setError("Pick one of your tokens to sell.");
    if (!confirm(`Sell token #${tokenId} for ${formatCoin(o.price, config.displayDenom)}?`)) return;
    const value: MsgAcceptOffer = { seller: address, offerId: BigInt(o.id), tokenId: BigInt(tokenId), expectedPrice: sameCoin(o.price) };
    return send(`accept-${o.id}`, { typeUrl: ArtifactMsgTypeUrls.AcceptOffer, value }, "Couldn't accept the offer");
  };

  if (offers.length === 0 && (!address || !marketOn)) return null;
  const busy = pending !== null;

  return (
    <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Collection offers</h3>
        {address && marketOn && !showForm && (
          <button onClick={() => setShowForm(true)} className="sd-btn sd-btn-secondary">Offer on any token</button>
        )}
      </div>
      <p className="text-xs text-zinc-500">Offers for any token of this class. Any holder can accept one with a token of their choice.</p>
      {offers.length === 0 && <p className="text-xs text-zinc-600">No collection offers.</p>}
      {offers.map((o) => {
        const mine = isMine(o.bidder);
        return (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs">
            <span className="inline-flex flex-wrap items-center gap-1 text-zinc-400">
              <span className="font-semibold text-amber-200">{formatCoin(o.price, config.displayDenom)}</span>
              from <CopyableAddress address={o.bidder} resolveName className="text-zinc-300" />
              {o.expires_at && <span>· {timeRemaining(o.expires_at)}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {mine && (
                <button onClick={() => cancel(o)} disabled={busy} className="text-zinc-400 hover:text-red-400 disabled:opacity-50">
                  {pending === `cancel-${o.id}` ? "Cancelling…" : "Cancel"}
                </button>
              )}
              {!mine && held.length > 0 && marketOn && (
                <>
                  <select
                    value={sellFor[o.id] || held[0].token.id}
                    onChange={(e) => setSellFor({ ...sellFor, [o.id]: e.target.value })}
                    className={`${fieldCls} w-40 py-1 text-xs`}
                  >
                    {held.map((v) => (
                      <option key={v.token.id} value={v.token.id}>
                        #{v.token.id} {tokenTitle(shownToken(v), v.withheld)}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => accept(o)} disabled={busy} className="sd-btn sd-btn-verdigris">
                    {pending === `accept-${o.id}` ? "Selling…" : "Sell"}
                  </button>
                </>
              )}
            </span>
          </div>
        );
      })}
      {showForm && (
        <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
          <div className="grid grid-cols-2 gap-2">
            <FieldLabel label={`Offer (${config.displayDenom})`}>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
            <FieldLabel label="Open for (days)" hint={`Up to ${maxDays}.`}>
              <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" className={fieldCls} />
            </FieldLabel>
          </div>
          <p className="text-xs text-zinc-500">
            Held in escrow until a holder accepts, you cancel, or it expires. A collection offer can&apos;t buy a token that holds other
            tokens.
          </p>
          <div className="flex gap-2">
            <button onClick={make} disabled={busy || !price.trim()} className="sd-btn sd-btn-verdigris">
              {pending === "make" ? "Offering…" : "Place offer"}
            </button>
            <button onClick={() => setShowForm(false)} className="sd-btn sd-btn-secondary">Cancel</button>
          </div>
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}

// ---- Auctions --------------------------------------------------------------------

/** Ticks once a second while mounted, for countdowns. */
function useNowSeconds(): number {
  const [now, setNow] = useState(nowUnix);
  useEffect(() => {
    const id = setInterval(() => setNow(nowUnix()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function countdown(endsAt: number, now: number): string {
  const s = endsAt - now;
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${sec}s left`;
}

/**
 * A token's English auction: bid, settle, cancel. Without one, the holder of
 * a free token can start one here.
 */
export function TokenAuction({
  cls,
  view,
  auction,
  params,
  isHolder,
  onChanged,
}: {
  cls: ArtifactClass;
  view: TokenView;
  auction: Auction | null;
  params: ArtifactParams | null;
  isHolder: boolean;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const t = view.token;
  const now = useNowSeconds();
  const [live, setLive] = useState<AuctionResponse | null>(null);
  const [bid, setBid] = useState("");
  // Start form.
  const [showStart, setShowStart] = useState(false);
  const [reserve, setReserve] = useState("");
  const [incPct, setIncPct] = useState("5");
  const [days, setDays] = useState("3");

  const refresh = useCallback(() => {
    if (!auction) return;
    getArtifactAuction(auction.id)
      .then((r) => setLive(r))
      .catch(() => setLive(null));
  }, [auction]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const changed = useCallback(() => {
    refresh();
    onChanged();
  }, [refresh, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);

  const a = live?.auction ?? auction;
  const marketOn = params?.market_enabled !== false;
  const maxDays = maxMarketDays(params);
  const ext = Number(params?.auction_extension || 0);
  const busy = pending !== null;

  if (!a) {
    // Start an auction.
    if (!isHolder || lockOf(t) !== TokenLock.NONE || !marketOn || view.withheld || view.expired) return null;
    if (t.redeemed_at && t.redeemed_at !== "0" && !cls.flags?.redeemed_transferable) return null;
    const start = () => {
      if (!address) return;
      const amount = parsePositiveAmount(reserve);
      if (!amount) return setError("Enter a reserve price above 0.");
      const bps = Math.round(Number(incPct || "0") * 100);
      if (!Number.isFinite(bps) || bps < 0 || bps > 10000) return setError("The minimum raise must be 0% to 100%.");
      const duration = parseDays(days, maxDays);
      if (!duration) return setError(`An auction can run 1 to ${maxDays} days.`);
      if (t.expires_at && t.expires_at !== "0" && nowUnix() + duration > Number(t.expires_at)) {
        return setError("The auction would end after the token expires. Shorten it or renew first.");
      }
      const value: MsgStartAuction = {
        seller: address,
        classId: BigInt(t.class_id),
        tokenId: BigInt(t.id),
        reservePrice: { denom: config.denom, amount },
        minIncrementBps: bps,
        duration: BigInt(duration),
      };
      return send("start", { typeUrl: ArtifactMsgTypeUrls.StartAuction, value }, "Couldn't start the auction", () => setShowStart(false));
    };
    return (
      <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Auction</h3>
          {!showStart && <button onClick={() => setShowStart(true)} className="sd-btn sd-btn-secondary">Start an auction</button>}
        </div>
        {showStart && (
          <>
            <p className="text-xs text-zinc-500">
              An English auction: bids are held in escrow and each must beat the last. The token stays yours and locked until it settles.
              You can cancel only before the first bid.
              {ext > 0 ? ` A bid in the last ${formatSeconds(ext)} extends the end by that much.` : ""}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FieldLabel label={`Reserve (${config.displayDenom})`} hint="The first bid must reach it.">
                <input value={reserve} onChange={(e) => setReserve(e.target.value)} inputMode="decimal" className={fieldCls} />
              </FieldLabel>
              <FieldLabel label="Minimum raise (%)" hint="0 accepts any higher bid.">
                <input value={incPct} onChange={(e) => setIncPct(e.target.value)} inputMode="decimal" className={fieldCls} />
              </FieldLabel>
              <FieldLabel label="Runs for (days)" hint={`Up to ${maxDays}.`}>
                <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" className={fieldCls} />
              </FieldLabel>
            </div>
            <div className="flex gap-2">
              <button onClick={start} disabled={busy || !reserve.trim()} className="sd-btn sd-btn-verdigris">
                {pending === "start" ? "Starting…" : "Start auction"}
              </button>
              <button onClick={() => setShowStart(false)} className="sd-btn sd-btn-secondary">Cancel</button>
            </div>
          </>
        )}
        <ActionBanner message={error} onDismiss={clearError} />
      </div>
    );
  }

  const endsAt = Number(a.ends_at || 0);
  const ended = endsAt > 0 && now >= endsAt;
  const isSeller = isMine(a.seller);
  const hasBids = !!a.high_bidder;
  const denom = a.reserve_price?.denom || config.denom;
  const minNext = live?.min_next_bid || (hasBids ? a.high_bid : a.reserve_price?.amount) || "0";
  const inExtension = ext > 0 && !ended && endsAt - now <= ext;

  const placeBid = () => {
    if (!address) return;
    const amount = parsePositiveAmount(bid || formatSpark(minNext).replace(/,/g, ""));
    if (!amount) return setError("Enter a bid.");
    if (BigInt(amount) < BigInt(minNext)) return setError(`The lowest bid accepted now is ${formatSpark(minNext)} ${config.displayDenom}.`);
    const value: MsgBid = {
      bidder: address,
      auctionId: BigInt(a.id),
      amount: { denom, amount },
      expectedMetadataHash: view.metadata_hash || "",
      expectedContentsHash: view.contents_hash || "",
    };
    return send("bid", { typeUrl: ArtifactMsgTypeUrls.Bid, value }, "Bid failed", () => setBid(""));
  };

  const settle = () => {
    if (!address) return;
    const value: MsgSettleAuction = { signer: address, auctionId: BigInt(a.id) };
    return send("settle", { typeUrl: ArtifactMsgTypeUrls.SettleAuction, value }, "Couldn't settle the auction");
  };

  const cancel = () => {
    if (!address) return;
    if (!confirm("Cancel this auction? The token unlocks.")) return;
    const value: MsgCancelAuction = { seller: address, auctionId: BigInt(a.id) };
    return send("cancel", { typeUrl: ArtifactMsgTypeUrls.CancelAuction, value }, "Couldn't cancel the auction");
  };

  return (
    <div className="sd-hull-tile mt-4 space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Auction</h3>
        <span className={`text-sm ${ended ? "text-zinc-400" : inExtension ? "text-amber-300" : "text-zinc-200"}`}>
          {endsAt ? countdown(endsAt, now) : ""}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">{hasBids ? "High bid" : "Reserve"}</dt>
          <dd className="font-semibold text-amber-200">
            {formatSpark(hasBids ? a.high_bid || "0" : a.reserve_price?.amount || "0")} {config.displayDenom}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Bids</dt>
          <dd className="text-zinc-200">{a.bids ?? 0}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Minimum raise</dt>
          <dd className="text-zinc-200">{bpsToPercent(a.min_increment_bps)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Ends</dt>
          <dd className="text-zinc-200">{endsAt ? formatTime(String(endsAt)) : "?"}</dd>
        </div>
      </dl>
      <p className="text-xs text-zinc-500">
        Seller <CopyableAddress address={a.seller} resolveName className="text-zinc-300" />
        {hasBids && (
          <>
            {" "}· leading <CopyableAddress address={a.high_bidder!} resolveName className="text-zinc-300" />
            {isMine(a.high_bidder) && <span className="text-emerald-300"> (you)</span>}
          </>
        )}
        .{ext > 0 && !ended ? ` A bid in the last ${formatSeconds(ext)} moves the end out by that much.` : ""}
      </p>
      {inExtension && <Note tone="warn">In the final stretch: any bid now extends the auction.</Note>}

      {!ended && address && !isSeller && marketOn && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              placeholder={`${formatSpark(minNext)} or more`}
              inputMode="decimal"
              className={fieldCls}
            />
            <button onClick={placeBid} disabled={busy} className="sd-btn sd-btn-verdigris shrink-0">
              {pending === "bid" ? "Bidding…" : "Place bid"}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            The lowest bid accepted now is {formatSpark(minNext)} {config.displayDenom}. Your bid is held in escrow and comes back if
            someone outbids you.
          </p>
        </div>
      )}
      {!address && !ended && <p className="text-xs text-zinc-500">Connect a wallet to bid.</p>}
      {ended && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-zinc-400">
            {hasBids ? "The auction has ended. Anyone can settle it to hand over the token and pay the seller." : "Ended with no bids. Settling unlocks the token."}
          </p>
          {address && (
            <button onClick={settle} disabled={busy} className="sd-btn sd-btn-verdigris">
              {pending === "settle" ? "Settling…" : "Settle"}
            </button>
          )}
        </div>
      )}
      {isSeller && !hasBids && !ended && (
        <button onClick={cancel} disabled={busy} className="sd-btn sd-btn-secondary">
          {pending === "cancel" ? "Cancelling…" : "Cancel auction"}
        </button>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
