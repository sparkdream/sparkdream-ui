"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { FutarchyMsgTypeUrls } from "@/lib/tx";
import { dreamToMicro, formatDream } from "@/lib/reveal-fmt";
import { MarketStatus, MARKET_STATUS_LABELS, type Market, type FutarchyParams } from "@/types/futarchy";
import Modal from "./Modal";
import NumberInput from "@/components/NumberInput";

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

  // The board polls while this modal is open, so a market can settle under
  // it. Trading a settled market is rejected by the keeper; say so here
  // instead of letting the user pay gas to find out.
  const settled = market.status !== MarketStatus.ACTIVE;

  const minTick = BigInt(market.min_tick || "0");
  const amountBelowTick =
    amountMicro !== null && minTick > BigInt(0) && BigInt(amountMicro) < minTick;

  const feeBps = params ? parseInt(params.trading_fee_bps, 10) : null;
  // Floor division matches the keeper's TruncateInt on amount·bps/10000
  // (msg_server_trade.go).
  const feeMicro = useMemo(() => {
    if (!amountMicro || feeBps === null) return null;
    return ((BigInt(amountMicro) * BigInt(feeBps)) / BigInt(10_000)).toString();
  }, [amountMicro, feeBps]);

  // Local shares-out estimate. The chain's GetMarketPrice can't be handed a
  // size over the LCD (see getFutarchyMarketPrice), so the quote is computed
  // here with the same LMSR cost function the keeper uses:
  // C = b·ln(Σ e^(q_i/b)) with b = subsidy/ln 2 (x/futarchy market_logic.go).
  // Solving C(q') − C(q) = A for the bought leg:
  //   q'_leg = b·ln(e^(A/b)·(e^(qYes/b)+e^(qNo/b)) − e^(qOther/b))
  //
  // Two details keep this honest against the keeper:
  //   · A is the amount *after* fee. The keeper mints from amountIn − fee
  //     (msg_server_trade.go), so quoting the gross would promise shares the
  //     trade does not buy, and contradict the fee row below.
  //   · The exponentials are evaluated log-sum-exp style, factoring out the
  //     largest exponent. Done naively, e^(A/b) is Infinity once A/b > 709 —
  //     around a thousand times the subsidy — and the card renders "Infinity"
  //     shares at a zero price with Buy still live. The keeper has no such
  //     cliff: it works in the stable form under ClampExponent.
  const localQuote = useMemo(() => {
    if (!amountMicro || amountMicro === "0") return null;
    const gross = parseFloat(amountMicro);
    const b = parseFloat(market.b_value || "0");
    const A = gross - parseFloat(feeMicro || "0");
    const qY = parseFloat(market.pool_yes || "0");
    const qN = parseFloat(market.pool_no || "0");
    if (!(b > 0) || !(A > 0) || !Number.isFinite(b) || !Number.isFinite(A)) return null;
    if (!Number.isFinite(qY) || !Number.isFinite(qN)) return null;

    const x = A / b;
    const y = qY / b;
    const n = qN / b;
    const other = outcome === "yes" ? n : y;
    // x ≥ 0, so x + max(y, n) dominates all three exponents; every shifted
    // term is then ≤ 1 and the sum can't overflow.
    const m = x + Math.max(y, n);
    const inner =
      Math.exp(x + y - m) + Math.exp(x + n - m) - Math.exp(other - m);
    if (!(inner > 0)) return null;
    const qOut = b * (m + Math.log(inner));
    const qOld = outcome === "yes" ? qY : qN;
    const shares = qOut - qOld;
    if (!Number.isFinite(shares) || shares <= 0) return null;
    // Average price is struck against the gross amount: that is what leaves
    // the wallet for these shares, fee included.
    return { shares: Math.round(shares), avgPrice: gross / shares };
  }, [amountMicro, feeMicro, market.b_value, market.pool_yes, market.pool_no, outcome]);

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
            // market_id is uint64; pass BigInt so the amino override's
            // `!== BigInt(0)` zero-omit branch works under JS strict equality
            // (a Number/string from `market.index` would sign "market_id":"0"
            // for a zero id, mismatching the chain's omit-zero aminojson).
            marketId: BigInt(market.index),
            isYes: outcome === "yes",
            amountIn: amountMicro,
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
          {settled && !error && (
            <div className="err">
              This market settled while the ticket was open (
              {MARKET_STATUS_LABELS[market.status] || market.status}). Trading
              is closed.
            </div>
          )}
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
            disabled={submitting || settled || !address || !amountMicro || amountBelowTick}
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
        <NumberInput
          id="trade-amt"
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
            {localQuote ? formatIntCompact(String(localQuote.shares)) : "—"}
          </span>
        </div>
        <div className="row">
          <span className="lab">Avg price / share</span>
          <span className="val muted">
            {localQuote ? localQuote.avgPrice.toFixed(4) : "—"}
          </span>
        </div>
        <div className="row">
          <span className="lab">Trading fee ({feeBps ?? "—"} bps)</span>
          <span className="val muted">
            {feeMicro ? `${formatDream(feeMicro)} ${config.displayDenom}` : "—"}
          </span>
        </div>
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
