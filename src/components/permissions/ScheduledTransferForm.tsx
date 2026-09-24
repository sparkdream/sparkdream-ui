"use client";

import { useState } from "react";
import type { SessionParams } from "@/types/session";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import { int, nowSec, oneshotTransferDeposit } from "@/lib/grants";
import NumberInput from "@/components/NumberInput";
import {
  AddressInput, Field, FormActions, FormShell, INPUT_CLASS, Preview,
  fmtDate, toLocalInput, useResolvedAddress,
} from "./fields";

const DAY = 86_400;
// Headroom for the time between filling the form and the tx landing.
const SIGNING_MARGIN = 120;

export default function ScheduledTransferForm({
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
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + DAY * 1000)));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minDelay = int(params?.min_schedule_delay_seconds) || 60;
  const horizon = int(params?.max_schedule_horizon_seconds) || 365 * DAY;
  const buffer = int(params?.fire_to_expiry_buffer_seconds) || 3600;
  const pausedTtl = int(params?.paused_oneshot_ttl_seconds) || 7 * DAY;
  const maxLifetime = int(params?.max_grant_lifetime_seconds) || 365 * DAY;
  const deposit = oneshotTransferDeposit(params);

  const now = nowSec();
  const fireAt = Math.floor(new Date(when).getTime() / 1000);
  // Keep the grant alive past fire time long enough for a paused transfer to
  // be retried, within the lifetime cap.
  const expiresAt = Math.min(fireAt + buffer + pausedTtl, now + maxLifetime - SIGNING_MARGIN);
  const latestFire = Math.min(now + horizon, now + maxLifetime - buffer) - SIGNING_MARGIN;
  const amountBase = parseSparkToUspark(amount);

  function validate(): string | null {
    if (!resolved.address) return "Enter a valid recipient";
    if (resolved.address === signerAddress) return "You can't send to yourself";
    if (!amountBase || BigInt(amountBase) <= BigInt(0)) return "Enter an amount greater than 0";
    if (!Number.isFinite(fireAt)) return "Pick a send time";
    if (fireAt < now + minDelay + SIGNING_MARGIN) return "Pick a time at least a few minutes from now";
    if (fireAt > latestFire) return `Pick a time before ${fmtDate(latestFire)}`;
    if (note.length > 256) return "Note is limited to 256 characters";
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
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
            // The recipient is the grantee, so they can decline before it sends.
            grantee: resolved.address,
            expiresAt: new Date(expiresAt * 1000),
            note: note.trim(),
            scheduledOneshot: {
              transfer: { recipient: resolved.address, amount: { denom: DENOM, amount: amountBase } },
              fireAt: BigInt(fireAt),
            },
          },
        },
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule transfer");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = !validate();

  return (
    <FormShell
      title="New scheduled transfer"
      intro="Send tokens automatically at a future time. The chain sends it for you, so you don't need to be online."
      onSubmit={handleSubmit}
    >
      <Field id="st-recipient" label="Recipient">
        <AddressInput id="st-recipient" value={recipient} onChange={setRecipient} resolved={resolved} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="st-amount" label={`Amount (${DISPLAY})`}>
          <NumberInput
            id="st-amount"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="st-when" label="Send at">
          <input
            id="st-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <Field id="st-note" label="Note (optional)">
        <input
          id="st-note"
          type="text"
          maxLength={256}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What it's for"
          className={INPUT_CLASS}
        />
      </Field>

      {ready && amountBase && (
        <Preview>
          <strong>{formatSpark(amountBase)} {DISPLAY}</strong> will be sent on {fmtDate(fireAt)}. A
          fee of {formatSpark(deposit)} {DISPLAY} is set aside now and used when it sends. You get it
          back if you cancel first or the recipient declines. The amount itself stays in your wallet
          until then; if your balance is short at send time, the transfer pauses and can be retried.
        </Preview>
      )}

      <FormActions
        submitting={submitting}
        disabled={!ready}
        label="Schedule transfer"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
