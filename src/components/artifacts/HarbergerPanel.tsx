"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import ActionBanner from "@/components/ActionBanner";
import { ArtifactMsgTypeUrls, SessionMsgTypeUrls } from "@/lib/tx";
import { getSessionParams, getTxMsgResponses } from "@/lib/api";
import { getArtifactHarbergerQuote } from "@/lib/artifactApi";
import { artifactModuleAddress, harbergerTaxPerPeriod } from "@/lib/artifactModule";
import { formatSpark, formatTime, timeRemaining } from "@/lib/utils";
import type { ArtifactClass, ArtifactParams, HarbergerQuoteResponse, TokenView } from "@/types/artifact";
import type { SessionParams } from "@/types/session";
import type { MsgForceBuy, MsgSetHarbergerPrice } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import { FieldLabel, Note, bpsToPercent, fieldCls, formatSeconds, nowUnix, parsePositiveAmount, useArtifactTx } from "./shared";

// expires_at sits this far before the session caps, so block-time drift
// can't push the grant past them.
const EXPIRY_SLACK = 600;

/**
 * A Harberger token: the holder self-assesses a price and pays a yearly tax
 * on it through an x/session recurring payment to the artifact module;
 * anyone can buy the token at that price at any time.
 */
export default function HarbergerPanel({
  cls,
  view,
  params,
  isHolder,
  onChanged,
}: {
  cls: ArtifactClass;
  view: TokenView;
  params: ArtifactParams | null;
  isHolder: boolean;
  onChanged: () => void;
}) {
  const { address, sessionActive } = useWallet();
  const { config } = useChainConfig();
  const t = view.token;
  const [quote, setQuote] = useState<HarbergerQuoteResponse | null>(null);
  const [sessionParams, setSessionParams] = useState<SessionParams | null>(null);
  const [price, setPrice] = useState("");
  const [grantId, setGrantId] = useState("");
  const [step, setStep] = useState<"idle" | "grant" | "price">("idle");

  const load = useCallback(() => {
    getArtifactHarbergerQuote(t.class_id, t.id)
      .then(setQuote)
      .catch(() => setQuote(null));
  }, [t.class_id, t.id]);

  useEffect(() => {
    load();
    getSessionParams()
      .then((r) => setSessionParams(r.params))
      .catch(() => setSessionParams(null));
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);

  const policy = cls.harberger!;
  const period = BigInt(policy.tax_period || "0");
  const bps = policy.tax_bps_per_year ?? 0;
  const state = quote?.state ?? t.harberger;
  const assessed = state?.price || view.harberger_price || "0";
  const current = quote?.current_price ?? assessed;
  const marketOn = params?.market_enabled !== false;
  const busy = pending !== null;

  const newPrice = parsePositiveAmount(price);
  const newTax = newPrice ? harbergerTaxPerPeriod(BigInt(newPrice), bps, period) : BigInt(0);

  // The longest grant session allows, from now.
  const grantWindow = () => {
    const maxDur = Number(sessionParams?.max_recurring_duration_seconds || 365 * 86400);
    const maxLife = Number(sessionParams?.max_grant_lifetime_seconds || 365 * 86400);
    return Math.min(maxDur, maxLife) - EXPIRY_SLACK;
  };

  // Step 1: the tax grant. Step 2 needs its id, which only the tx result carries.
  const createGrant = () => {
    if (!address || !newPrice) return setError("Enter a price above 0.");
    const span = grantWindow();
    if (span <= Number(period)) return setError("Session limits don't allow a grant long enough for one tax period.");
    const minPeriod = Number(sessionParams?.min_recurring_period_seconds || 0);
    if (minPeriod && Number(period) < minPeriod) return setError("This class's tax period is shorter than recurring payments allow.");
    const start = nowUnix();
    const value = {
      granter: address,
      grantee: artifactModuleAddress(config.bech32Prefix),
      expiresAt: new Date((start + span) * 1000),
      note: `Harberger tax for artifact ${t.class_id}/${t.id}`,
      recurringPull: {
        amountPerPeriod: { denom: config.denom, amount: newTax.toString() },
        periodSeconds: period,
        startTime: BigInt(start),
        maxPerEpoch: "",
      },
    };
    return send("grant", { typeUrl: SessionMsgTypeUrls.CreateGrant, value }, "Couldn't create the tax payment", async (hash) => {
      const { MsgCreateGrantResponse } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx");
      for (const r of await getTxMsgResponses(hash)) {
        if (r.typeUrl === "/sparkdream.session.v1.MsgCreateGrantResponse") {
          setGrantId(MsgCreateGrantResponse.decode(r.value).grantId.toString());
        }
      }
      setStep("price");
    });
  };

  const setAssessed = (zero = false) => {
    if (!address) return;
    if (zero) {
      if (!confirm("Set the price to zero? You abandon the token: once its grace period ends, anyone can take it for free.")) return;
    } else {
      if (!newPrice) return setError("Enter a price above 0.");
      if (!/^\d+$/.test(grantId.trim()) || grantId.trim() === "0") return setError("Enter the id of the tax payment grant.");
    }
    const value: MsgSetHarbergerPrice = {
      owner: address,
      classId: BigInt(t.class_id),
      tokenId: BigInt(t.id),
      price: zero ? "0" : newPrice!,
      grantId: zero ? BigInt(0) : BigInt(grantId.trim()),
    };
    return send("price", { typeUrl: ArtifactMsgTypeUrls.SetHarbergerPrice, value }, "Couldn't set the price", () => {
      setStep("idle");
      setPrice("");
      setGrantId("");
    });
  };

  const forceBuy = () => {
    if (!address || !quote?.current_price) return;
    if (!confirm(`Buy this token for ${formatSpark(quote.current_price)} ${config.displayDenom}? The holder can't refuse.`)) return;
    const value: MsgForceBuy = {
      buyer: address,
      classId: BigInt(t.class_id),
      tokenId: BigInt(t.id),
      // A foreclosed price only falls, so the quote is a safe ceiling.
      maxPrice: { denom: config.denom, amount: quote.current_price },
      expectedMetadataHash: view.metadata_hash || "",
    };
    return send("buy", { typeUrl: ArtifactMsgTypeUrls.ForceBuy, value }, "Purchase failed");
  };

  const nextDue = state?.next_due && state.next_due !== "0" ? state.next_due : null;
  const graceUntil = state?.grace_until && state.grace_until !== "0" ? state.grace_until : null;
  const foreclosed = !!quote?.foreclosed;

  return (
    <div className="sd-hull-tile mt-4 space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Always for sale</h3>
        <span className="text-lg font-semibold text-amber-200">
          {formatSpark(current)} {config.displayDenom}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        The holder sets this price and pays {bpsToPercent(bps)} of it a year in tax, collected every {formatSeconds(String(period))}. Anyone
        can buy the token at the price at any time.
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">Assessed price</dt>
          <dd className="text-zinc-200">{formatSpark(assessed)} {config.displayDenom}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Tax per period</dt>
          <dd className="text-zinc-200">{formatSpark(quote?.tax_per_period || "0")} {config.displayDenom}</dd>
        </div>
        {nextDue && (
          <div>
            <dt className="text-xs text-zinc-500">Next payment</dt>
            <dd className="text-zinc-200">{formatTime(nextDue)}</dd>
          </div>
        )}
        {state?.tax_paid && state.tax_paid !== "0" && (
          <div>
            <dt className="text-xs text-zinc-500">Tax paid by holder</dt>
            <dd className="text-zinc-200">{formatSpark(state.tax_paid)} {config.displayDenom}</dd>
          </div>
        )}
      </dl>
      {foreclosed && (
        <Note tone="warn">
          Foreclosed: a tax payment was missed, so the price is falling to zero over {formatSeconds(policy.foreclosure_duration)}. A new tax
          payment stops the fall.
        </Note>
      )}
      {!foreclosed && graceUntil && (!state?.grant_id || state.grant_id === "0") && (
        <Note tone={isHolder ? "warn" : "muted"}>
          No tax payment set up yet. {isHolder ? "Set a price with a tax payment" : "The holder has"} until {formatTime(graceUntil)} (
          {timeRemaining(graceUntil)}){isHolder ? ", or the price starts falling." : " before the price starts falling."}
        </Note>
      )}

      {!isHolder && address && marketOn && !view.withheld && (
        quote?.for_sale ? (
          <button onClick={forceBuy} disabled={busy} className="sd-btn sd-btn-verdigris">
            {pending === "buy" ? "Buying…" : `Buy for ${formatSpark(quote.current_price || "0")} ${config.displayDenom}`}
          </button>
        ) : (
          <p className="text-xs text-zinc-500">Not for sale until the holder sets a price or its grace period ends.</p>
        )
      )}

      {isHolder && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          {sessionActive && <Note tone="warn">Setting a price creates a recurring payment, which needs your wallet. Turn off session mode first.</Note>}
          {step === "idle" && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setStep("grant")} disabled={sessionActive} className="sd-btn sd-btn-secondary">Set a new price</button>
              {assessed !== "0" && (
                <button onClick={() => setAssessed(true)} disabled={busy || sessionActive} className="sd-btn sd-btn-secondary">
                  {pending === "price" ? "Saving…" : "Abandon"}
                </button>
              )}
            </div>
          )}
          {step !== "idle" && (
            <div className="space-y-2">
              <FieldLabel label={`New price (${config.displayDenom})`} hint="Anyone can buy at this price, so don't set it below what you'd accept.">
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  className={fieldCls}
                  disabled={step === "price"}
                />
              </FieldLabel>
              {newPrice && (
                <p className="text-xs text-zinc-400">
                  Tax: {formatSpark(newTax)} {config.displayDenom} every {formatSeconds(String(period))}.
                </p>
              )}
              {step === "grant" && (
                <>
                  <p className="text-xs text-zinc-500">
                    Step 1 of 2: a recurring payment lets the artifact module collect the tax each period. Your {config.displayDenom} stays
                    in your wallet until each payment is due, and you can see or cancel it under Permissions.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={createGrant} disabled={busy || !newPrice} className="sd-btn sd-btn-verdigris">
                      {pending === "grant" ? "Creating…" : "Create tax payment"}
                    </button>
                    <button onClick={() => setStep("price")} disabled={!newPrice} className="sd-btn sd-btn-secondary">
                      I already have one
                    </button>
                    <button onClick={() => setStep("idle")} className="sd-btn sd-btn-secondary">Cancel</button>
                  </div>
                </>
              )}
              {step === "price" && (
                <>
                  <FieldLabel label="Tax payment grant id" hint="Filled in from step 1. It must pay at least the tax every period.">
                    <input value={grantId} onChange={(e) => setGrantId(e.target.value)} inputMode="numeric" className={fieldCls} />
                  </FieldLabel>
                  <p className="text-xs text-zinc-500">Step 2 of 2: set the price, naming the tax payment.</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setAssessed(false)} disabled={busy} className="sd-btn sd-btn-verdigris">
                      {pending === "price" ? "Saving…" : "Set price"}
                    </button>
                    <button onClick={() => setStep("grant")} className="sd-btn sd-btn-secondary">Back</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
