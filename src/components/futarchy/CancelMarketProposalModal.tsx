"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { GovMsgTypeUrls, FutarchyMsgTypeUrls } from "@/lib/tx";
import { getGovModuleAddress } from "@/lib/gov";
import { dreamToMicro } from "@/lib/reveal-fmt";
import type { Market } from "@/types/futarchy";
import Modal from "./Modal";

/**
 * Opens a governance proposal that, if it passes, will execute
 * MsgCancelMarket against the futarchy module. Today the futarchy keeper
 * only honours MsgCancelMarket from the gov module authority, so any user
 * (including council ops) wanting to cancel an active market has to go
 * through this proposal flow.
 *
 * If the keeper is later relaxed to accept an `isCouncilAuthorized(...,
 * "commons", "operations")` check (mirroring MsgUpdateOperationalParams),
 * we can short-circuit this flow for council ops members with a direct
 * MsgCancelMarket broadcast. See the chain-side TODO note in
 * x/futarchy/keeper/msg_server_cancel_market.go.
 */
export default function CancelMarketProposalModal({
  market,
  onClose,
  onSubmitted,
}: {
  market: Market;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();

  const [reason, setReason] = useState("");
  const [title, setTitle] = useState(
    `Cancel futarchy market #${market.index} (${market.symbol || "market"})`
  );
  const [summary, setSummary] = useState("");
  const [deposit, setDeposit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!address) return setError("Wallet not connected");
    if (!title.trim()) return setError("Proposal title is required");
    if (!reason.trim()) return setError("Cancellation reason is required");

    setError(null);
    setSubmitting(true);
    try {
      // Resolve the gov module address (the only signer the keeper accepts
      // for MsgCancelMarket today) and encode the inner message.
      const govAddress = await getGovModuleAddress();
      const { MsgCancelMarket } = await import(
        "@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/tx"
      );
      const innerMsg = {
        typeUrl: FutarchyMsgTypeUrls.CancelMarket,
        value: MsgCancelMarket.encode(
          MsgCancelMarket.fromPartial({
            authority: govAddress,
            marketId: BigInt(market.index),
            reason: reason.trim(),
          })
        ).finish(),
      };

      const microDeposit = deposit ? dreamToMicro(deposit) : "0";
      if (microDeposit === null) return setError("Invalid deposit amount");

      await signAndBroadcast([
        {
          typeUrl: GovMsgTypeUrls.SubmitProposal,
          value: {
            messages: [innerMsg],
            initialDeposit:
              microDeposit !== "0"
                ? [{ denom: config.denom, amount: microDeposit }]
                : [],
            proposer: address,
            metadata: "",
            title: title.trim(),
            summary: (summary.trim() || `Cancel market #${market.index}: ${reason.trim()}`),
            expedited: false,
          },
        },
      ]);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit proposal failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Propose market cancellation"
      subtitle="MsgCancelMarket is gov-authority-only. This wraps it in MsgSubmitProposal — if the proposal passes, x/gov executes the cancel and refunds the creator."
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
            disabled={submitting || !address}
          >
            {submitting ? "Submitting…" : "Submit proposal"}
          </button>
        </>
      }
    >
      <div className="sd-quote-card">
        <div className="row">
          <span className="lab">Market</span>
          <span className="val">#{market.index} · {market.symbol || "—"}</span>
        </div>
        <div className="row">
          <span className="lab">Inner message</span>
          <span className="val muted sd-mono">MsgCancelMarket</span>
        </div>
        <div className="row">
          <span className="lab">On pass</span>
          <span className="val muted">
            sets status = CANCELLED · refunds creator residual · holders settle at snapshot price
          </span>
        </div>
      </div>

      <div className="sd-field">
        <label htmlFor="cm-title">Proposal title</label>
        <input
          id="cm-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="sd-field">
        <label htmlFor="cm-reason">Cancellation reason</label>
        <textarea
          id="cm-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why should this market be cancelled? Stored on-chain in the cancel event."
          rows={3}
        />
        <span className="hint">
          Stored verbatim in the <span className="sd-mono">market_cancelled</span> event.
        </span>
      </div>

      <div className="sd-field">
        <label htmlFor="cm-summary">Proposal summary <span style={{ color: "var(--ink-mute)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
        <textarea
          id="cm-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Defaults to the cancellation reason."
          rows={2}
        />
      </div>

      <div className="sd-field">
        <label htmlFor="cm-deposit">Initial deposit ({config.displayDenom}) <span style={{ color: "var(--ink-mute)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
        <input
          id="cm-deposit"
          type="number"
          step="any"
          min="0"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          placeholder="0"
        />
        <span className="hint">
          Proposals need to reach the min deposit before voting begins. Others can deposit too.
        </span>
      </div>
    </Modal>
  );
}
