"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { FutarchyMsgTypeUrls } from "@/lib/tx";
import { formatDream } from "@/lib/reveal-fmt";
import { MarketStatus, MARKET_STATUS_LABELS, type Market } from "@/types/futarchy";
import Modal from "./Modal";

export default function RedeemModal({
  market,
  yesShares,
  noShares,
  onClose,
  onRedeemed,
}: {
  market: Market;
  yesShares: string;
  noShares: string;
  onClose: () => void;
  onRedeemed: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute the redeemable payout the keeper will mint. Mirrors
  // x/futarchy/keeper/msg_server_redeem.go:
  //   RESOLVED_YES → 1 spark per YES share
  //   RESOLVED_NO  → 1 spark per NO share
  //   CANCELLED / RESOLVED_INVALID → settlement_price_yes per YES share +
  //                                  (1 − settlement_price_yes) per NO share
  const status = market.status;
  let payoutMicro = BigInt(0);
  let breakdown: { lab: string; val: string }[] = [];

  if (status === MarketStatus.RESOLVED_YES) {
    payoutMicro = bigIntFromOptional(yesShares);
    breakdown = [
      { lab: "YES shares", val: bigIntFromOptional(yesShares).toString() },
      { lab: "Pays 1:1 in", val: config.displayDenom },
    ];
  } else if (status === MarketStatus.RESOLVED_NO) {
    payoutMicro = bigIntFromOptional(noShares);
    breakdown = [
      { lab: "NO shares", val: bigIntFromOptional(noShares).toString() },
      { lab: "Pays 1:1 in", val: config.displayDenom },
    ];
  } else if (status === MarketStatus.RESOLVED_INVALID || status === MarketStatus.CANCELLED) {
    const p = parseLegacyDec(market.settlement_price_yes);
    const yesN = bigIntFromOptional(yesShares);
    const noN = bigIntFromOptional(noShares);
    if (p > 0 && p < 1) {
      payoutMicro =
        BigInt(Math.round(Number(yesN) * p)) +
        BigInt(Math.round(Number(noN) * (1 - p)));
    }
    breakdown = [
      { lab: "Settlement price", val: p.toFixed(4) },
      { lab: "YES shares", val: yesN.toString() },
      { lab: "NO shares", val: noN.toString() },
    ];
  }

  const submit = async () => {
    if (!address) return setError("Wallet not connected");
    setError(null);
    setSubmitting(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: FutarchyMsgTypeUrls.Redeem,
          value: {
            creator: address,
            marketId: market.index,
          },
        },
      ]);
      onRedeemed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Redeem failed");
    } finally {
      setSubmitting(false);
    }
  };

  const canRedeem =
    status === MarketStatus.RESOLVED_YES ||
    status === MarketStatus.RESOLVED_NO ||
    status === MarketStatus.RESOLVED_INVALID ||
    status === MarketStatus.CANCELLED;

  return (
    <Modal
      title={`Redeem · #${market.index}`}
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
            disabled={submitting || !canRedeem || !address}
          >
            {submitting ? "Submitting…" : "Redeem"}
          </button>
        </>
      }
    >
      <div className="sd-quote-card">
        <div className="row">
          <span className="lab">Status</span>
          <span className="val">{MARKET_STATUS_LABELS[status] || status}</span>
        </div>
        {breakdown.map((b) => (
          <div className="row" key={b.lab}>
            <span className="lab">{b.lab}</span>
            <span className="val muted">{b.val}</span>
          </div>
        ))}
        <div className="row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 8, marginTop: 4 }}>
          <span className="lab">You receive</span>
          <span className="val green">
            {formatDream(payoutMicro.toString())} {config.displayDenom}
          </span>
        </div>
      </div>

      {!canRedeem && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>
          This market hasn&apos;t resolved yet. Wait for the EndBlocker to settle it
          at <span className="sd-mono">end_block</span>.
        </p>
      )}

      {canRedeem && (
        <p style={{ fontSize: 12, color: "var(--ink-mute)", margin: 0 }}>
          MsgRedeem burns all of your outstanding{" "}
          <span className="sd-mono">f/{market.index}/yes</span> and{" "}
          <span className="sd-mono">f/{market.index}/no</span> shares and pays
          out {config.displayDenom} in a single tx.
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

function parseLegacyDec(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
