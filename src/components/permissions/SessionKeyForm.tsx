"use client";

import { useState } from "react";
import type { SessionParams } from "@/types/session";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { parseSparkToUspark } from "@/lib/utils";
import { durationSeconds, int, msgTypeLabel } from "@/lib/grants";
import NumberInput from "@/components/NumberInput";
import { AddressInput, Field, FormActions, FormShell, INPUT_CLASS, useResolvedAddress } from "./fields";

const DAY = 86_400;

export default function SessionKeyForm({
  params,
  allowedTypes,
  onDone,
  onCancel,
}: {
  params: SessionParams | null;
  allowedTypes: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();

  // Caps from live params; fallbacks match the chain defaults.
  const maxDays = Math.max(1, Math.floor((durationSeconds(params?.max_expiration) || 7 * DAY) / DAY));
  const maxSpend = (int(params?.max_spend_limit_amount) || 100_000_000) / 1_000_000;
  const maxExec = int(params?.max_exec_count) || 10_000;
  const maxTypes = int(params?.max_msg_types_per_session) || allowedTypes.length;

  const [grantee, setGrantee] = useState("");
  const resolved = useResolvedAddress(grantee);
  const [types, setTypes] = useState<string[]>([]);
  const [spend, setSpend] = useState(String(maxSpend));
  const [days, setDays] = useState(String(maxDays));
  const [execs, setExecs] = useState(String(maxExec));
  const [selfRevoke, setSelfRevoke] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spendBase = parseSparkToUspark(spend);
  const d = parseInt(days, 10) || 0;
  const n = parseInt(execs, 10) || 0;
  const typeCount = types.length + (selfRevoke ? 1 : 0);

  function validate(): string | null {
    if (!resolved.address) return "Enter a valid address for the key";
    if (resolved.address === signerAddress) return "The key must be a different address";
    if (types.length === 0) return "Pick at least one action";
    if (typeCount > maxTypes) return `At most ${maxTypes} actions per key`;
    if (!spendBase || BigInt(spendBase) <= BigInt(0)) return `Fee budget must be greater than 0 ${DISPLAY}`;
    if (Number(spend) > maxSpend) return `Fee budget is limited to ${maxSpend} ${DISPLAY}`;
    if (d < 1 || d > maxDays) return `Duration must be between 1 and ${maxDays} days`;
    if (n < 1 || n > maxExec) return `Uses must be between 1 and ${maxExec.toLocaleString()}`;
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
            // A minute short of the cap so a late block can't push it over.
            expiresAt: new Date(Date.now() + (d * DAY - 60) * 1000),
            note: note.trim(),
            sessionKey: {
              allowedMsgTypes: selfRevoke ? [...types, SessionMsgTypeUrls.RevokeGrant] : types,
              spendLimit: { denom: DENOM, amount: spendBase },
              maxExecCount: BigInt(n),
              allowSelfRevoke: selfRevoke,
            },
          },
        },
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session key");
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (t: string) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <FormShell
      title="New session key"
      intro="Let another address (such as a hot wallet or a bot) sign selected actions as you, with fees paid from a budget you set."
      onSubmit={handleSubmit}
    >
      <Field id="sk-grantee" label="Key address" help="The address that will sign on your behalf">
        <AddressInput id="sk-grantee" value={grantee} onChange={setGrantee} resolved={resolved} />
      </Field>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-300">Allowed actions</span>
          <button
            type="button"
            onClick={() => setTypes(types.length === allowedTypes.length ? [] : [...allowedTypes])}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            {types.length === allowedTypes.length ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
          {allowedTypes.length === 0 ? (
            <p className="text-xs text-zinc-500">Loading allowed actions...</p>
          ) : (
            allowedTypes.map((t) => (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-700/50"
              >
                <input
                  type="checkbox"
                  checked={types.includes(t)}
                  onChange={() => toggle(t)}
                  className="rounded border-zinc-600 bg-zinc-800 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-zinc-300">{msgTypeLabel(t)}</span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {typeCount} of up to {maxTypes} selected
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field id="sk-spend" label={`Fee budget (${DISPLAY})`} help={`Max ${maxSpend} ${DISPLAY}`}>
          <NumberInput
            id="sk-spend"
            min="0"
            max={String(maxSpend)}
            step="any"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="sk-days" label="Expires in (days)" help={`Max ${maxDays} day${maxDays === 1 ? "" : "s"}`}>
          <NumberInput
            id="sk-days"
            min="1"
            max={String(maxDays)}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="sk-execs" label="Max uses" help={`Max ${maxExec.toLocaleString()}`}>
          <NumberInput
            id="sk-execs"
            min="1"
            max={String(maxExec)}
            value={execs}
            onChange={(e) => setExecs(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm text-zinc-300">
        <input type="checkbox" className="mt-1" checked={selfRevoke} onChange={(e) => setSelfRevoke(e.target.checked)} />
        <span>
          Let this key cancel your other permissions
          <span className="block text-xs text-zinc-500">
            Useful for an emergency key. It can only cancel permissions you granted.
          </span>
        </span>
      </label>

      <Field id="sk-note" label="Note (optional)">
        <input
          id="sk-note"
          type="text"
          maxLength={256}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Which device or bot this is"
          className={INPUT_CLASS}
        />
      </Field>

      <FormActions
        submitting={submitting}
        disabled={!!validate()}
        label="Create session key"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
