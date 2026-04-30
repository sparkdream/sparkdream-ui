"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { FutarchyMsgTypeUrls } from "@/lib/tx";
import { dreamToMicro, formatDream } from "@/lib/reveal-fmt";
import { getFutarchyMarketPrice } from "@/lib/api";
import type { Market, FutarchyParams } from "@/types/futarchy";
import Modal from "./Modal";

export default function TradeModal({
  market,
  initialOutcome = "yes",
  params,
  onClose,
  onTraded,
  onProposeCancel,
}: {
  market: Market;
  initialOutcome?: "yes" | "no";
  params: FutarchyParams | null;
  onClose: () => void;
  onTraded: () => void;
  /** Optional handoff to a "Propose cancellation" gov-proposal flow. The
      futarchy keeper only honours MsgCancelMarket from the gov authority
      today, so cancellation always goes through this proposal route. */
  onProposeCancel?: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();

  const [outcome, setOutcome] = useState<"yes" | "no">(initialOutcome);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountMicro = useMemo(() => dreamToMicro(amount), [amount]);

  // Live quote — re-runs when the user changes outcome or amount. We hit
  // GetMarketPrice with the proposed amount_in to ask the keeper for the
  // exact shares-out and marginal price.
  const [quote, setQuote] = useState<{ price: string; sharesOut: string } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!amountMicro || amountMicro === "0") {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const t = setTimeout(() => {
      getFutarchyMarketPrice(market.index, outcome === "yes", amountMicro)
        .then((res) => {
          if (cancelled) return;
          setQuote({ price: res.price, sharesOut: res.shares_out });
        })
        .catch((err) => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : "Quote failed");
        })
        .finally(() => !cancelled && setQuoteLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountMicro, market.index, outcome]);

  const minTick = BigInt(market.min_tick || "0");
  const amountBelowTick =
    amountMicro !== null && minTick > BigInt(0) && BigInt(amountMicro) < minTick;

  const feeBps = params ? parseInt(params.trading_fee_bps, 10) : null;
  const feeMicro = useMemo(() => {
    if (!amountMicro || feeBps === null) return null;
    return ((BigInt(amountMicro) * BigInt(feeBps)) / BigInt(10_000)).toString();
  }, [amountMicro, feeBps]);

  const yesProb = lmsrYesProbFromPools(market);
  const probLabel = outcome === "yes" ? yesProb : 1 - yesProb;

  const submit = async () => {
    if (!address) return setError("Wallet not connected");
    setError(null);

    if (!amountMicro) return setError("Enter a valid amount");
    if (amountBelowTick) return setError(`Amount must be ≥ market.min_tick (${market.min_tick} ${config.denom})`);

    setSubmitting(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: FutarchyMsgTypeUrls.Trade,
          value: {
            creator: address,
            market_id: market.index,
            is_yes: outcome === "yes",
            amount_in: amountMicro,
          },
        },
      ]);
      onTraded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Trade · #${market.index}`}
      subtitle={market.question || market.symbol}
      onClose={onClose}
      footer={
        <>
          {error && <div className="err">{error}</div>}
          {onProposeCancel && (
            <button
              type="button"
              className="sd-modal-tertiary"
              onClick={onProposeCancel}
              disabled={submitting}
              title="Open a gov proposal to cancel this market"
            >
              Propose cancellation →
            </button>
          )}
          <button type="button" className="sd-btn sd-btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={`sd-btn ${outcome === "yes" ? "sd-btn-yes" : "sd-btn-no"}`}
            onClick={submit}
            disabled={submitting || !address || !amountMicro || amountBelowTick}
          >
            {submitting ? "Submitting…" : `Buy ${outcome.toUpperCase()}`}
          </button>
        </>
      }
    >
      <div className="sd-field">
        <label>Outcome</label>
        <div className="sd-outcome-toggle">
          <button
            type="button"
            className={outcome === "yes" ? "on yes" : ""}
            onClick={() => setOutcome("yes")}
          >
            <span>YES</span>
            <span className="pct">@ {yesProb.toFixed(2)}</span>
          </button>
          <button
            type="button"
            className={outcome === "no" ? "on no" : ""}
            onClick={() => setOutcome("no")}
          >
            <span>NO</span>
            <span className="pct">@ {(1 - yesProb).toFixed(2)}</span>
          </button>
        </div>
      </div>

      <div className="sd-field">
        <label htmlFor="trade-amt">Amount in ({config.displayDenom})</label>
        <input
          id="trade-amt"
          type="number"
          step="any"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 10"
          autoFocus
        />
        <span className="hint">
          min tick <b>{market.min_tick} {config.denom}</b>
          {amountBelowTick && <span className="warn"> · below min tick</span>}
        </span>
      </div>

      <div className="sd-quote-card">
        <div className="row">
          <span className="lab">Marginal probability</span>
          <span className={`val ${outcome === "yes" ? "green" : "rose"}`}>
            {(probLabel * 100).toFixed(1)}%
          </span>
        </div>
        <div className="row">
          <span className="lab">Shares out</span>
          <span className="val">
            {quoteLoading
              ? "…"
              : quote?.sharesOut
                ? formatIntCompact(quote.sharesOut)
                : "—"}
          </span>
        </div>
        <div className="row">
          <span className="lab">Avg price / share</span>
          <span className="val muted">
            {quote?.price ? Number(quote.price).toFixed(4) : "—"}
          </span>
        </div>
        <div className="row">
          <span className="lab">Trading fee ({feeBps ?? "—"} bps)</span>
          <span className="val muted">
            {feeMicro ? `${formatDream(feeMicro)} ${config.displayDenom}` : "—"}
          </span>
        </div>
        {quoteError && (
          <div className="row">
            <span className="lab" style={{ color: "var(--rose)" }}>quote</span>
            <span className="val" style={{ color: "var(--rose)" }}>{quoteError}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function bigIntFromOptional(s: string | undefined | null): bigint {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

function parseLegacyDec(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Same numerically-stable form as on the page; duplicated here to avoid
// circular component → page imports.
function lmsrYesProbFromPools(m: Market): number {
  if (m.settlement_price_yes && m.settlement_price_yes !== "0") {
    const p = parseLegacyDec(m.settlement_price_yes);
    if (p > 0 && p < 1) return p;
  }
  const b = parseLegacyDec(m.b_value);
  if (b <= 0) return 0.5;
  const qYes = Number(bigIntFromOptional(m.pool_yes));
  const qNo = Number(bigIntFromOptional(m.pool_no));
  const diff = (qNo - qYes) / b;
  const clamped = Math.max(-50, Math.min(50, diff));
  return 1 / (1 + Math.exp(clamped));
}

function formatIntCompact(s: string | undefined | null): string {
  if (!s || s === "0") return "0";
  let n: bigint;
  try {
    n = BigInt(s);
  } catch {
    return s;
  }
  if (n < BigInt(1_000_000)) return n.toLocaleString();
  const million = BigInt(1_000_000);
  const billion = BigInt(1_000_000_000);
  if (n < billion) return `${(Number(n) / Number(million)).toFixed(2)}M`;
  return `${(Number(n) / Number(billion)).toFixed(2)}B`;
}
