"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { FutarchyMsgTypeUrls } from "@/lib/tx";
import { dreamToMicro, formatDream } from "@/lib/reveal-fmt";
import type { FutarchyParams } from "@/types/futarchy";
import NumberInput from "@/components/NumberInput";

const APPROX_BLOCK_TIME_S = 6;

export default function CreateMarketForm({
  params,
  currentBlock,
  onCancel,
  onCreated,
}: {
  params: FutarchyParams | null;
  currentBlock: bigint | null;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();

  const [symbol, setSymbol] = useState("");
  const [question, setQuestion] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert the user-facing duration into an absolute end_block. We pad by 30s
  // to absorb the gap between quoting and the tx landing on chain.
  const endBlock = useMemo(() => {
    if (currentBlock === null) return null;
    const days = parseFloat(durationDays);
    if (!isFinite(days) || days <= 0) return null;
    const blocks = BigInt(Math.ceil((days * 24 * 60 * 60 + 30) / APPROX_BLOCK_TIME_S));
    return currentBlock + blocks;
  }, [currentBlock, durationDays]);

  const liquidityMicro = useMemo(() => dreamToMicro(liquidity), [liquidity]);

  const minLiq = params ? BigInt(params.min_liquidity) : null;
  const maxDuration = params ? BigInt(params.max_duration) : null;

  const liquidityBelowMin =
    minLiq !== null &&
    liquidityMicro !== null &&
    BigInt(liquidityMicro) < minLiq;

  const durationOverMax =
    maxDuration !== null &&
    endBlock !== null &&
    currentBlock !== null &&
    endBlock - currentBlock > maxDuration;

  // b = subsidy / ln(2) — same derivation x/futarchy uses internally.
  const bValuePreview = useMemo(() => {
    if (!liquidityMicro) return null;
    const subsidy = parseFloat(liquidityMicro) / 1_000_000;
    if (!isFinite(subsidy) || subsidy <= 0) return null;
    return subsidy / Math.LN2;
  }, [liquidityMicro]);

  const submit = async () => {
    if (!address) return setError("Wallet not connected");
    setError(null);

    if (!symbol.trim()) return setError("Symbol is required");
    if (!question.trim()) return setError("Question is required");
    if (!liquidityMicro) return setError("Enter a valid initial liquidity amount");
    if (liquidityBelowMin) return setError(`Initial liquidity must be ≥ ${minLiq?.toString()} ${config.denom}`);
    if (endBlock === null) return setError("Could not compute end_block — current block height unavailable");
    if (durationOverMax) return setError("Duration exceeds params.max_duration");

    setSubmitting(true);
    try {
      await signAndBroadcast([
        {
          typeUrl: FutarchyMsgTypeUrls.CreateMarket,
          value: {
            creator: address,
            symbol: symbol.trim(),
            question: question.trim(),
            initialLiquidity: liquidityMicro,
            endBlock: endBlock.toString(),
          },
        },
      ]);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create market failed");
    } finally {
      setSubmitting(false);
    }
  };

  const previewSeconds = endBlock !== null && currentBlock !== null
    ? Number(endBlock - currentBlock) * APPROX_BLOCK_TIME_S
    : null;

  return (
    <div className="sd-fut-form-card" role="region" aria-label="Create market">
      <div className="sd-fut-form-head">
        <div>
          <h3>Create market</h3>
          <span className="sub">
            MsgCreateMarket — opens a YES/NO LMSR pool. Your stake sets b and
            bounds your maximum subsidy loss.
          </span>
        </div>
      </div>

      <div className="sd-fut-form-body">
        <div className="sd-field">
          <label htmlFor="cm-symbol">Symbol</label>
          <input
            id="cm-symbol"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="e.g. REVEAL-R4-SHIP or CONF-Commons-1248k"
            maxLength={64}
          />
          <span className="hint">
            Confidence-vote markets conventionally use a <span className="sd-mono">CONF-</span> prefix.
          </span>
        </div>

        <div className="sd-field">
          <label htmlFor="cm-question">Question</label>
          <textarea
            id="cm-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Will the council approve federation peer “nightingale-1” within 14 days?"
            rows={3}
          />
        </div>

        <div className="sd-field">
          <label htmlFor="cm-liquidity">Initial liquidity ({config.displayDenom})</label>
          <NumberInput
            id="cm-liquidity"
            step="any"
            min="0"
            value={liquidity}
            onChange={(e) => setLiquidity(e.target.value)}
            placeholder="e.g. 1000"
          />
          <span className="hint">
            {minLiq && (
              <>min <span className={liquidityBelowMin ? "warn" : "ok"}>{formatDream(minLiq.toString())} {config.displayDenom}</span> · </>
            )}
            {bValuePreview !== null && (
              <>b ≈ <b>{bValuePreview.toFixed(2)} {config.displayDenom}</b> · </>
            )}
            max subsidy loss = your stake
          </span>
        </div>

        <div className="sd-field">
          <label htmlFor="cm-duration">Duration (days)</label>
          <NumberInput
            id="cm-duration"
            step="1"
            min="1"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
          />
          <span className="hint">
            {endBlock !== null && (
              <>resolves at block <b>{endBlock.toString()}</b></>
            )}
            {previewSeconds !== null && (
              <> · ~{Math.round(previewSeconds / 86400)} day{Math.round(previewSeconds / 86400) === 1 ? "" : "s"}</>
            )}
            {durationOverMax && <span className="warn"> · exceeds params.max_duration</span>}
          </span>
        </div>
      </div>

      <div className="sd-fut-form-foot">
        {error && <div className="err">{error}</div>}
        <button
          type="button"
          className="sd-btn sd-btn-primary"
          onClick={submit}
          disabled={submitting || !address}
        >
          {submitting ? "Submitting…" : "Create market"}
        </button>
        <button type="button" className="sd-btn sd-btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </div>
  );
}
