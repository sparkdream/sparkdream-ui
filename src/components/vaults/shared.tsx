"use client";

import { useEffect, useState } from "react";
import NumberInput from "@/components/NumberInput";
import { AddressInput, INPUT_CLASS, useResolvedAddress } from "@/components/permissions/fields";
import { formatDurationApprox, formatSpark, messageTypeLabel } from "@/lib/utils";
import { VaultMsgTypeUrls } from "@/lib/tx";
import { VAULT_LIMITS, type Vault, type VaultInnerMessage } from "@/types/vault";

export const CARD = "rounded-xl border border-zinc-800 bg-zinc-900/50 p-5";

/** A proposal's stored messages_hash (base64) as bytes, for MsgApprove. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function totalWeight(signers: { weight: string | number | bigint }[]): number {
  return signers.reduce((sum, s) => sum + (Number(s.weight) || 0), 0);
}

/** "1d 6h" style, or "1 hour" for the round values people usually pick. */
export function formatTtl(seconds: number): string {
  if (seconds > 0 && seconds % 86_400 === 0) {
    const d = seconds / 86_400;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (seconds > 0 && seconds % 3600 === 0) {
    const h = seconds / 3600;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return formatDurationApprox(seconds);
}

/** Wall-clock milliseconds, re-read every `intervalMs` for live countdowns. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** A proposal whose only message is MsgUpdateVault: it has its own pending cap. */
export function isUpdateOnly(typeUrls: string[]): boolean {
  return typeUrls.length === 1 && typeUrls[0] === VaultMsgTypeUrls.UpdateVault;
}

type Coin = { denom?: string; amount?: string };

export function formatCoin(c: Coin, denom: string, display: string): string {
  if (c.denom === denom) return `${formatSpark(c.amount || "0")} ${display}`;
  return `${c.amount || "0"} ${c.denom || ""}`.trim();
}

/** One plain-words line for an inner message as the LCD renders it. */
export function describeInner(m: VaultInnerMessage, denom: string, display: string, short: (a: string) => string): string {
  const t = m["@type"];
  if (t === "/cosmos.bank.v1beta1.MsgSend") {
    const amount = ((m.amount as Coin[] | undefined) || []).map((c) => formatCoin(c, denom, display)).join(" + ");
    return `Send ${amount || "nothing"} to ${short(String(m.to_address || ""))}`;
  }
  if (t === VaultMsgTypeUrls.UpdateVault) {
    const signers = (m.signers as { address: string; weight: string }[] | undefined) || [];
    const ttl = Number(m.proposal_ttl || 0);
    return `Change the vault to ${signers.length} signer${signers.length === 1 ? "" : "s"} (total weight ${totalWeight(signers)}), threshold ${m.threshold}, proposals open for ${formatTtl(ttl)}${m.label ? `, label "${m.label}"` : ""}`;
  }
  if (t === VaultMsgTypeUrls.CancelProposal) {
    return `Cancel proposal #${m.proposal_id}`;
  }
  return messageTypeLabel(t);
}

export interface SignerDraft {
  /** Stable key for React. */
  key: number;
  input: string;
  weight: string;
  /** Resolved bech32 address, or null while empty, resolving or invalid. */
  address: string | null;
}

let nextKey = 1;
export function newSignerDraft(input = "", weight = "1"): SignerDraft {
  return { key: nextKey++, input, weight, address: null };
}

/** Problems with a signer set, threshold, TTL and label, or null when valid. */
export function validateConfig(
  signers: SignerDraft[],
  threshold: number,
  ttlSeconds: number,
  label: string,
  vaultAddress?: string
): string | null {
  if (signers.length === 0) return "Add at least one signer";
  if (signers.length > VAULT_LIMITS.maxSigners) return `At most ${VAULT_LIMITS.maxSigners} signers`;
  const seen = new Set<string>();
  for (const s of signers) {
    if (!s.address) return "Every signer needs a valid address";
    if (vaultAddress && s.address === vaultAddress) return "A vault can't be its own signer";
    if (seen.has(s.address)) return "Each signer can only be listed once";
    seen.add(s.address);
    const w = Number(s.weight);
    if (!Number.isInteger(w) || w < 1 || w > VAULT_LIMITS.maxSignerWeight) {
      return `Weights must be whole numbers from 1 to ${VAULT_LIMITS.maxSignerWeight}`;
    }
  }
  const sum = totalWeight(signers);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > sum) {
    return `Threshold must be from 1 to the total weight (${sum})`;
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < VAULT_LIMITS.minProposalTtl) return "Proposals must stay open at least 1 hour";
  if (ttlSeconds > VAULT_LIMITS.maxProposalTtl) return "Proposals can stay open at most 30 days";
  if (label.length > VAULT_LIMITS.maxLabelLength) return `Label is limited to ${VAULT_LIMITS.maxLabelLength} characters`;
  return null;
}

/** Signers as the proto expects them (camelCase, weight as BigInt). */
export function toProtoSigners(signers: SignerDraft[]): { address: string; weight: bigint }[] {
  return signers.map((s) => ({ address: s.address as string, weight: BigInt(s.weight) }));
}

/** Editable list of signer rows, each resolving a name or address. */
export function SignerListEditor({
  idPrefix,
  signers,
  onChange,
}: {
  idPrefix: string;
  signers: SignerDraft[];
  onChange: (next: SignerDraft[]) => void;
}) {
  const update = (key: number, patch: Partial<SignerDraft>) =>
    onChange(signers.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-3">
      {signers.map((s, i) => (
        <SignerRow
          key={s.key}
          id={`${idPrefix}-signer-${i}`}
          draft={s}
          onInput={(input) => update(s.key, { input })}
          onWeight={(weight) => update(s.key, { weight })}
          onResolved={(address) => {
            if (address !== s.address) update(s.key, { address });
          }}
          onRemove={signers.length > 1 ? () => onChange(signers.filter((x) => x.key !== s.key)) : undefined}
        />
      ))}
      {signers.length < VAULT_LIMITS.maxSigners && (
        <button
          type="button"
          onClick={() => onChange([...signers, newSignerDraft()])}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          + Add signer
        </button>
      )}
    </div>
  );
}

function SignerRow({
  id,
  draft,
  onInput,
  onWeight,
  onResolved,
  onRemove,
}: {
  id: string;
  draft: SignerDraft;
  onInput: (v: string) => void;
  onWeight: (v: string) => void;
  onResolved: (address: string | null) => void;
  onRemove?: () => void;
}) {
  const resolved = useResolvedAddress(draft.input);
  const address = resolved.address;
  useEffect(() => {
    onResolved(address);
    // onResolved is a fresh closure every render; the address is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <AddressInput id={id} value={draft.input} onChange={onInput} resolved={resolved} />
      </div>
      <div className="w-24 shrink-0">
        <NumberInput
          aria-label="Weight"
          min="1"
          max={String(VAULT_LIMITS.maxSignerWeight)}
          step="1"
          value={draft.weight}
          onChange={(e) => onWeight(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!onRemove}
        aria-label="Remove signer"
        className="mt-2.5 shrink-0 text-zinc-500 hover:text-red-400 disabled:invisible"
      >
        ✕
      </button>
    </div>
  );
}

/** TTL picker: a number and a unit, reported in seconds. */
export function TtlInput({
  id,
  amount,
  unit,
  onAmount,
  onUnit,
}: {
  id: string;
  amount: string;
  unit: "hours" | "days";
  onAmount: (v: string) => void;
  onUnit: (v: "hours" | "days") => void;
}) {
  return (
    <div className="flex gap-2">
      <NumberInput
        id={id}
        min="0"
        step="any"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
        className={INPUT_CLASS}
        wrapperClassName="block flex-1"
      />
      <select
        aria-label="Unit"
        value={unit}
        onChange={(e) => onUnit(e.target.value as "hours" | "days")}
        className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 text-sm text-white"
      >
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}

export function ttlSeconds(amount: string, unit: "hours" | "days"): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * (unit === "days" ? 86_400 : 3600));
}

/** Split a TTL into the friendliest whole unit for the picker. */
export function ttlToPicker(seconds: number): { amount: string; unit: "hours" | "days" } {
  if (seconds >= 86_400 && seconds % 86_400 === 0) return { amount: String(seconds / 86_400), unit: "days" };
  // Fractional hours keep an odd TTL exact instead of rounding it.
  return { amount: String(Number((seconds / 3600).toFixed(4))), unit: "hours" };
}

/** The connected member's weight in the vault (alias aware), 0 when not a signer. */
export function myWeight(vault: Vault, isMine: (a: string) => boolean): number {
  const s = vault.signers.find((x) => isMine(x.address));
  return s ? Number(s.weight) : 0;
}
