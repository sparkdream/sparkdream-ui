"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { FutarchyMsgTypeUrls } from "@/lib/tx";
import { formatDream } from "@/lib/reveal-fmt";
import { MarketStatus, MARKET_STATUS_LABELS, type Market } from "@/types/futarchy";
import Modal from "./Modal";

/**
 * Creator-only flow for pulling the residual subsidy back out after a market
 * resolves. Mirrors x/futarchy/keeper/msg_server_withdraw_liquidity.go:
 *
 *   - Only the original creator may call MsgWithdrawLiquidity.
 *   - Status must be RESOLVED_YES, RESOLVED_NO, or RESOLVED_INVALID.
 *     CANCELLED markets refund creators inline during the cancel tx.
 *   - The keeper computes the LMSR-correct residual server-side; we only
 *     surface the bounds so the user knows what they're agreeing to.
 */
export default function WithdrawLiquidityModal({
  market,
  onClose,
  onWithdrawn,
}: {
  market: Market;
  onClose: () => void;
  onWithdrawn: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreator = address === market.creator;
  const eligibleStatus =
    market.status === MarketStatus.RESOLVED_YES ||
    market.status === MarketStatus.RESOLVED_NO ||
    market.status === MarketStatus.RESOLVED_INVALID;

  const initial = bigIntFromOptional(market.initial_liquidity);
  const withdrawn = bigIntFromOptional(market.liquidity_withdrawn);
  const remaining = initial > withdrawn ? initial - withdrawn : BigInt(0);

  const submit = async () => {
    if (!address) return setError("Wallet not connected");
    if (!isCreator) return setError("Only the market creator can withdraw");
    if (!eligibleStatus) return setError(`Market must be resolved (current: ${market.status})`);

    setSubmitting(true);
    setError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: FutarchyMsgTypeUrls.WithdrawLiquidity,
          value: {
            creator: address,
            market_id: market.index,
          },
        },
      ]);
      onWithdrawn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`Withdraw subsidy · #${market.index}`}
      subtitle={market.question || market.symbol}
      onClose={onClose}
      footer={
        <>
          {error && <div className="err">{error}</div>}
          <button type="button" className="sd-btn sd-btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            onClick={submit}
            disabled={submitting || !isCreator || !eligibleStatus || remaining === BigInt(0)}
          >
            {submitting ? "Submitting…" : "Withdraw residual"}
          </button>
        </>
      }
    >
      <div className="sd-quote-card">
        <div className="row">
          <span className="lab">Status</span>
          <span className="val">{MARKET_STATUS_LABELS[market.status] || market.status}</span>
        </div>
        <div className="row">
          <span className="lab">Initial liquidity</span>
          <span className="val muted">
            {formatDream(initial.toString())} {config.displayDenom}
          </span>
        </div>
        <div className="row">
          <span className="lab">Already withdrawn</span>
          <span className="val muted">
            {formatDream(withdrawn.toString())} {config.displayDenom}
          </span>
        </div>
        <div className="row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 8, marginTop: 4 }}>
          <span className="lab">Upper bound</span>
          <span className="val green">
            {formatDream(remaining.toString())} {config.displayDenom}
          </span>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0, lineHeight: 1.55 }}>
        The keeper computes the LMSR-correct residual server-side — typically less
        than the upper bound shown above, equal to it when one outcome went
        unfilled. The exact paid-out amount is returned by{" "}
        <span className="sd-mono">MsgWithdrawLiquidityResponse.amount</span>.
      </p>

      {!isCreator && (
        <p style={{ fontSize: 12, color: "var(--rose)", margin: 0 }}>
          Only the market creator (<span className="sd-mono">{shortAddr(market.creator)}</span>)
          can withdraw subsidy from this market.
        </p>
      )}
      {isCreator && !eligibleStatus && market.status === MarketStatus.ACTIVE && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>
          Market is still active. Wait for the EndBlocker to settle it at{" "}
          <span className="sd-mono">end_block</span>.
        </p>
      )}
      {isCreator && !eligibleStatus && market.status === MarketStatus.CANCELLED && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>
          Cancelled markets refund the creator inline during{" "}
          <span className="sd-mono">MsgCancelMarket</span>; there&apos;s nothing
          additional to withdraw.
        </p>
      )}
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

function shortAddr(addr: string | undefined | null): string {
  if (!addr) return "—";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 9)}…${addr.slice(-4)}`;
}
