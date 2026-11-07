"use client";

import { useState } from "react";
import type { SessionParams } from "@/types/session";
import { useWallet } from "@/contexts/WalletContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { int, nowSec, signInService, validSignInService } from "@/lib/grants";
import {
  AddressInput, ConsentNotice, Field, FormActions, FormShell, INPUT_CLASS, Preview, fmtDate, useResolvedAddress,
} from "./fields";

const DAY = 86_400;
// Headroom for the time between filling the form and the tx landing.
const SIGNING_MARGIN = 120;

const DURATIONS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

export default function SignInGrantForm({
  params,
  onDone,
  onCancel,
}: {
  params: SessionParams | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();

  const [grantee, setGrantee] = useState("");
  const resolved = useResolvedAddress(grantee);
  const [serviceInput, setServiceInput] = useState("");
  const [days, setDays] = useState(90);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxLifetime = int(params?.max_grant_lifetime_seconds) || 365 * DAY;
  const service = signInService(serviceInput);
  const expiresAt = Math.min(nowSec() + days * DAY, nowSec() + maxLifetime - SIGNING_MARGIN);

  function validate(): string | null {
    if (!resolved.address) return "Enter a valid address";
    if (resolved.address === signerAddress) return "You can't grant your own address";
    if (!validSignInService(service)) return "Enter the instance's address, like mstdn.example.org";
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
            expiresAt: new Date(expiresAt * 1000),
            note: note.trim(),
            signIn: { service },
          },
        },
      ]);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the sign-in grant");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = !validate();

  return (
    <FormShell
      title="New sign-in grant"
      intro="Let another address of yours sign in to your account on a Spark Dream Mastodon instance, for example from a computer where you don't keep this wallet."
      onSubmit={handleSubmit}
    >
      <Field id="si-grantee" label="Address that may sign in" help="It doesn't need to be a member. It signs in as you.">
        <AddressInput id="si-grantee" value={grantee} onChange={setGrantee} resolved={resolved} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="si-service"
          label="Instance"
          help={service && service !== serviceInput.trim() ? `Grants sign-in to ${service}` : undefined}
        >
          <input
            id="si-service"
            type="text"
            value={serviceInput}
            onChange={(e) => setServiceInput(e.target.value)}
            placeholder="mstdn.example.org"
            autoCapitalize="none"
            spellCheck={false}
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="si-days" label="Lasts">
          <select
            id="si-days"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className={INPUT_CLASS}
          >
            {DURATIONS.map((d) => (
              <option key={d.days} value={d.days}>{d.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="si-note" label="Note (optional)">
        <input
          id="si-note"
          type="text"
          maxLength={256}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What it's for"
          className={INPUT_CLASS}
        />
      </Field>

      {ready && (
        <Preview>
          Until {fmtDate(expiresAt)}, this address can sign in to <strong>{service}</strong> as you, with
          full use of your account there: posting, messages, follows and settings. Cancel it here at any
          time; its sessions are signed out within about 10 minutes. Apps it authorizes while signed in
          (a phone or desktop client) keep their access until you revoke them in the instance&apos;s
          settings under Authorized apps.
        </Preview>
      )}

      {ready && <ConsentNotice granter={signerAddress ?? ""} grantee={resolved.address} kind="signin" />}

      <FormActions
        submitting={submitting}
        disabled={!ready}
        label="Grant sign-in"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
