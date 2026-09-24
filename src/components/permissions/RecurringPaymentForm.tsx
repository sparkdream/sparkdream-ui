"use client";

import { useState } from "react";
import type { SessionParams } from "@/types/session";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import { formatPeriod, int, nowSec } from "@/lib/grants";
import NumberInput from "@/components/NumberInput";
import {
  AddressInput, Field, FormActions, FormShell, INPUT_CLASS, Preview,
  fmtDate, toLocalInput, useResolvedAddress,
} from "./fields";

const DAY = 86_400;
const FREQUENCIES = [
  { value: String(DAY), label: "Daily" },
  { value: String(7 * DAY), label: "Weekly" },
  { value: String(30 * DAY), label: "Every 30 days" },
  { value: "custom", label: "Custom" },
];

// expires_at sits this far past the last payment so block-time drift can't
// push that payment's window past expiry.
const EXPIRY_SLACK = 600;

export default function RecurringPaymentForm({
  params,
  onDone,
  onCancel,
}: {
  params: SessionParams | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();

  const [recipient, setRecipient] = useState("");
  const resolved = useResolvedAddress(recipient);
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState(String(30 * DAY));
  const [customDays, setCustomDays] = useState("14");
  const [startNow, setStartNow] = useState(true);
  const [startInput, setStartInput] = useState(() => toLocalInput(new Date(Date.now() + DAY * 1000)));
  const [count, setCount] = useState("12");
  const [maxPerDay, setMaxPerDay] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minPeriod = int(params?.min_recurring_period_seconds) || DAY;
  const maxDuration = int(params?.max_recurring_duration_seconds) || 365 * DAY;
  const maxLifetime = int(params?.max_grant_lifetime_seconds) || 365 * DAY;

  const period = frequency === "custom" ? Math.round(parseFloat(customDays || "0") * DAY) : int(frequency);
  // Time-dependent values, recomputed at submit: the form can sit open long
  // enough for a render-time "now" to go stale past the chain's 1h backstop.
  const schedule = (now: number) => {
    const startSec = startNow ? now : Math.floor(new Date(startInput).getTime() / 1000);
    const lead = Math.max(0, startSec - now);
    const maxCount = period > 0
      ? Math.max(0, Math.floor((Math.min(maxDuration, maxLifetime - lead) - EXPIRY_SLACK) / period))
      : 0;
    return { now, startSec, maxCount };
  };
  const { startSec, maxCount } = schedule(nowSec());
  const n = parseInt(count, 10) || 0;
  const amountBase = parseSparkToUspark(amount);
  const perDayBase = maxPerDay ? parseSparkToUspark(maxPerDay) : null;
  const total = amountBase ? BigInt(amountBase) * BigInt(Math.max(n, 0)) : BigInt(0);

  function validate({ now, startSec, maxCount } = schedule(nowSec())): string | null {
    if (!resolved.address) return "Enter a valid recipient";
    if (resolved.address === signerAddress) return "You can't pay yourself";
    if (!amountBase || BigInt(amountBase) <= BigInt(0)) return "Enter an amount greater than 0";
    if (period < minPeriod) return `Payments can be at most once every ${formatPeriod(minPeriod)}`;
    if (!startNow && (!Number.isFinite(startSec) || startSec < now)) return "Pick a start time in the future";
    if (n < 1) return "Enter how many payments to make";
    if (n > maxCount) return `At most ${maxCount} payments fit in the allowed duration`;
    if (maxPerDay) {
      if (!perDayBase) return "Daily limit is not a valid amount";
      if (BigInt(perDayBase) < BigInt(amountBase)) return "Daily limit can't be less than one payment";
    }
    if (note.length > 256) return "Note is limited to 256 characters";
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const at = schedule(nowSec());
    const problem = validate(at);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: SessionMsgTypeUrls.CreateGrant,
          value: {
            granter: signerAddress,
            grantee: resolved.address,
            expiresAt: new Date((at.startSec + n * period + EXPIRY_SLACK) * 1000),
            note: note.trim(),
            recurringPull: {
              amountPerPeriod: { denom: DENOM, amount: amountBase },
              periodSeconds: BigInt(period),
              startTime: BigInt(at.startSec),
              // Empty lets the chain apply its default of 10 payments per day.
              maxPerEpoch: perDayBase ?? "",
            },
          },
        },
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create recurring payment");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = !validate();

  return (
    <FormShell
      title="New recurring payment"
      intro={
        <>
          Let someone collect a fixed amount from your wallet on a schedule. The recipient claims each
          payment once it&apos;s due. Funds stay in your wallet until then, and you can cancel at any time.
        </>
      }
      onSubmit={handleSubmit}
    >
      <Field id="rp-recipient" label="Recipient">
        <AddressInput id="rp-recipient" value={recipient} onChange={setRecipient} resolved={resolved} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="rp-amount" label={`Amount per payment (${DISPLAY})`}>
          <NumberInput
            id="rp-amount"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="rp-frequency" label="Frequency">
          <div className="flex gap-2">
            <select
              id="rp-frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className={INPUT_CLASS}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            {frequency === "custom" && (
              <NumberInput
                aria-label="Days between payments"
                min={String(minPeriod / DAY)}
                step="1"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                wrapperClassName="w-32 shrink-0"
                className={INPUT_CLASS}
              />
            )}
          </div>
          {frequency === "custom" && <p className="mt-1 text-xs text-zinc-500">Days between payments</p>}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="rp-start" label="Schedule starts">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
              Now
            </label>
            {!startNow && (
              <input
                id="rp-start"
                type="datetime-local"
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                className={INPUT_CLASS}
              />
            )}
          </div>
        </Field>
        <Field id="rp-count" label="Number of payments" help={maxCount > 0 ? `Up to ${maxCount}` : undefined}>
          <NumberInput
            id="rp-count"
            min="1"
            max={String(maxCount)}
            step="1"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <Field id="rp-note" label="Note (optional)">
        <input
          id="rp-note"
          type="text"
          maxLength={256}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What it's for"
          className={INPUT_CLASS}
        />
      </Field>

      <details className="text-sm text-zinc-400">
        <summary className="cursor-pointer select-none text-zinc-300">Advanced</summary>
        <div className="mt-3">
          <Field
            id="rp-perday"
            label={`Daily limit (${DISPLAY}, optional)`}
            help="Caps how much the recipient can collect in one day when catching up on missed payments. Defaults to 10 payments."
          >
            <NumberInput
              id="rp-perday"
              min="0"
              step="any"
              value={maxPerDay}
              onChange={(e) => setMaxPerDay(e.target.value)}
              placeholder={amountBase ? formatSpark(BigInt(amountBase) * BigInt(10)) : ""}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
      </details>

      {ready && amountBase && (
        <Preview>
          The recipient can collect <strong>{formatSpark(amountBase)} {DISPLAY}</strong> every{" "}
          {formatPeriod(period)}, {n} time{n === 1 ? "" : "s"}, for up to{" "}
          <strong>{formatSpark(total)} {DISPLAY}</strong> in total. The first payment is claimable{" "}
          {fmtDate(startSec + period)} and the last {fmtDate(startSec + n * period)}. If your balance
          is short when they claim, that payment waits until you top up.
        </Preview>
      )}

      <FormActions
        submitting={submitting}
        disabled={!ready}
        label="Create recurring payment"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
