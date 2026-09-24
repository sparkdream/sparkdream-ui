"use client";

import { useState } from "react";
import type { SessionParams } from "@/types/session";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { formatSpark, parseSparkToUspark } from "@/lib/utils";
import { formatPeriod, int } from "@/lib/grants";
import NumberInput from "@/components/NumberInput";
import {
  AddressInput, Field, FormActions, FormShell, INPUT_CLASS, Preview,
  fmtDate, useResolvedAddress,
} from "./fields";

const HOUR = 3600;
const DAY = 86_400;
const PERIODS = [
  { value: String(HOUR), label: "Per hour" },
  { value: String(DAY), label: "Per day" },
  { value: String(7 * DAY), label: "Per week" },
  { value: String(30 * DAY), label: "Per 30 days" },
];

export default function SpendingAllowanceForm({
  params,
  onDone,
  onCancel,
}: {
  params: SessionParams | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY, bech32Prefix } } = useChainConfig();

  const [spender, setSpender] = useState("");
  const resolved = useResolvedAddress(spender);
  const [budget, setBudget] = useState("");
  const [period, setPeriod] = useState(String(30 * DAY));
  const [days, setDays] = useState("90");
  const [restrict, setRestrict] = useState(false);
  const [recipientsText, setRecipientsText] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minPeriod = int(params?.min_allowance_period_seconds) || HOUR;
  const maxDays = Math.floor((int(params?.max_grant_lifetime_seconds) || 365 * DAY) / DAY);
  const maxRecipients = params?.max_allowance_recipient_list ?? 50;
  const periods = PERIODS.filter((p) => int(p.value) >= minPeriod);

  const budgetBase = parseSparkToUspark(budget);
  const d = parseInt(days, 10) || 0;
  const recipients = restrict
    ? Array.from(new Set(recipientsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)))
    : [];
  const addrRe = new RegExp(`^${bech32Prefix}1[02-9ac-hj-np-z]{38}$`);

  function validate(): string | null {
    if (!resolved.address) return "Enter a valid spender";
    if (resolved.address === signerAddress) return "You can't give an allowance to yourself";
    if (!budgetBase || BigInt(budgetBase) <= BigInt(0)) return "Enter a budget greater than 0";
    if (d < 1 || d > maxDays) return `Duration must be between 1 and ${maxDays} days`;
    if (restrict) {
      if (recipients.length === 0) return "Add at least one allowed recipient, or turn off the restriction";
      if (recipients.length > maxRecipients) return `At most ${maxRecipients} recipients`;
      const bad = recipients.find((r) => !addrRe.test(r));
      if (bad) return `Not a valid address: ${bad}`;
      if (recipients.includes(signerAddress ?? "")) return "Your own address can't be a recipient";
    }
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
            grantee: resolved.address,
            expiresAt: new Date(Date.now() + d * DAY * 1000),
            note: note.trim(),
            spendingAllowance: {
              maxPerPeriod: { denom: DENOM, amount: budgetBase },
              periodSeconds: BigInt(int(period)),
              allowedRecipients: recipients,
              denom: DENOM,
            },
          },
        },
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create allowance");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = !validate();

  return (
    <FormShell
      title="New spending allowance"
      intro="Give someone a budget they can spend from your wallet, sending to whoever they choose within the limit. The budget refills every period."
      onSubmit={handleSubmit}
    >
      <Field id="sa-spender" label="Spender" help="The address that can spend from the budget">
        <AddressInput id="sa-spender" value={spender} onChange={setSpender} resolved={resolved} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id="sa-budget" label={`Budget (${DISPLAY})`}>
          <NumberInput
            id="sa-budget"
            min="0"
            step="any"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="0"
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="sa-period" label="Refills">
          <select id="sa-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={INPUT_CLASS}>
            {periods.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field id="sa-days" label="Lasts (days)" help={`Up to ${maxDays}`}>
          <NumberInput
            id="sa-days"
            min="1"
            max={String(maxDays)}
            step="1"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
          Only allow sending to specific addresses
        </label>
        {restrict && (
          <textarea
            aria-label="Allowed recipients"
            rows={3}
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder={`${bech32Prefix}1…, one per line`}
            className={`${INPUT_CLASS} mt-2 font-mono`}
          />
        )}
        {restrict && (
          <p className="mt-1 text-xs text-zinc-500">
            {recipients.length} of up to {maxRecipients} addresses
          </p>
        )}
      </div>

      <Field id="sa-note" label="Note (optional)">
        <input
          id="sa-note"
          type="text"
          maxLength={256}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What it's for"
          className={INPUT_CLASS}
        />
      </Field>

      {ready && budgetBase && (
        <Preview>
          The spender can send up to <strong>{formatSpark(budgetBase)} {DISPLAY}</strong> per{" "}
          {formatPeriod(int(period))} from your wallet
          {restrict ? `, to ${recipients.length} approved address${recipients.length === 1 ? "" : "es"}` : ""},
          until {fmtDate(Math.floor(Date.now() / 1000) + d * DAY)}.
        </Preview>
      )}

      <FormActions
        submitting={submitting}
        disabled={!ready}
        label="Create allowance"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
