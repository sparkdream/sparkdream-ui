"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import { VaultMsgTypeUrls } from "@/lib/tx";
import { getTxMsgResponses } from "@/lib/api";
import { invalidateVaults, listVaultProposalsByProposer } from "@/lib/vaultApi";
import { errorMessage } from "@/lib/errors";
import { parseSparkToUspark } from "@/lib/utils";
import NumberInput from "@/components/NumberInput";
import { AddressInput, Field, FormActions, FormShell, INPUT_CLASS, useResolvedAddress } from "@/components/permissions/fields";
import { VAULT_LIMITS, VaultProposalStatus, type Vault, type VaultProposal } from "@/types/vault";
import {
  SignerListEditor, TtlInput, formatCoin, isUpdateOnly, myWeight, newSignerDraft, toProtoSigners, totalWeight,
  ttlSeconds, ttlToPicker, validateConfig, type SignerDraft,
} from "./shared";

const SEND_URL = "/cosmos.bank.v1beta1.MsgSend";

type Coin = { denom: string; amount: string };

type Draft =
  | { key: number; kind: "send"; to: string; toAddress: string | null; amount: string; denom: string }
  | {
      key: number;
      kind: "update";
      signers: SignerDraft[];
      threshold: string;
      ttlAmount: string;
      ttlUnit: "hours" | "days";
      label: string;
    }
  | { key: number; kind: "cancel"; proposalId: string };

type Kind = Draft["kind"];

const KIND_LABEL: Record<Kind, string> = {
  send: "Send tokens",
  update: "Change signers or settings",
  cancel: "Cancel a pending proposal",
};

const KIND_URL: Record<Kind, string> = {
  send: SEND_URL,
  update: VaultMsgTypeUrls.UpdateVault,
  cancel: VaultMsgTypeUrls.CancelProposal,
};

let nextKey = 1;

/** A micro amount as a plain decimal string for an input ("1.5", no grouping). */
function microToDecimal(micro: string): string {
  const n = BigInt(micro || "0");
  const whole = n / BigInt(1_000_000);
  const frac = (n % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function newDraft(kind: Kind, vault: Vault, denom: string): Draft {
  const key = nextKey++;
  if (kind === "send") return { key, kind, to: "", toAddress: null, amount: "", denom };
  if (kind === "cancel") return { key, kind, proposalId: "" };
  const ttl = ttlToPicker(Number(vault.proposal_ttl));
  return {
    key,
    kind,
    signers: vault.signers.map((s) => newSignerDraft(s.address, s.weight)),
    threshold: vault.threshold,
    ttlAmount: ttl.amount,
    ttlUnit: ttl.unit,
    label: vault.label || "",
  };
}

function baseAmount(d: Extract<Draft, { kind: "send" }>, chainDenom: string): string | null {
  if (d.denom === chainDenom) return parseSparkToUspark(d.amount);
  return /^\d+$/.test(d.amount.trim()) ? d.amount.trim() : null;
}

function draftProblem(d: Draft, vault: Vault, chainDenom: string, pendingIds: Set<string>): string | null {
  if (d.kind === "send") {
    if (!d.toAddress) return "Enter a valid recipient";
    if (d.toAddress === vault.address) return "The vault can't send to itself";
    const amt = baseAmount(d, chainDenom);
    if (!amt || BigInt(amt) <= BigInt(0)) return "Enter an amount greater than 0";
    return null;
  }
  if (d.kind === "cancel") {
    if (!pendingIds.has(d.proposalId)) return "Pick a pending proposal to cancel";
    return null;
  }
  return validateConfig(d.signers, Number(d.threshold), ttlSeconds(d.ttlAmount, d.ttlUnit), d.label.trim(), vault.address);
}

export default function ProposeForm({
  vault,
  balances,
  pending,
  onDone,
  onCancel,
}: {
  vault: Vault;
  balances: Coin[];
  /** The vault's pending proposals, for the cancel template. */
  pending: VaultProposal[];
  /** Called after a successful broadcast with a line describing the outcome. */
  onDone: (outcome: string) => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { isMine } = useMyAliases();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();

  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft("send", vault, DENOM)]);
  const [memo, setMemo] = useState("");
  const [execute, setExecute] = useState(true);
  const [counts, setCounts] = useState<{ general: number; updateOnly: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // My pending proposals in this vault, split the way the chain caps them.
  useEffect(() => {
    if (!signerAddress) return;
    let live = true;
    listVaultProposalsByProposer(signerAddress, VaultProposalStatus.PENDING, { limit: "200" })
      .then((res) => {
        if (!live) return;
        let general = 0;
        let updateOnly = 0;
        for (const p of res.proposals || []) {
          if (p.vault_id !== vault.vault_id) continue;
          if (isUpdateOnly((p.messages || []).map((m) => m["@type"]))) updateOnly++;
          else general++;
        }
        setCounts({ general, updateOnly });
      })
      .catch(() => live && setCounts(null));
    return () => {
      live = false;
    };
  }, [signerAddress, vault.vault_id]);

  const weight = myWeight(vault, isMine);
  const canSelfExecute = weight >= Number(vault.threshold);
  const pendingIds = new Set(pending.map((p) => p.proposal_id));
  const updateOnly = isUpdateOnly(drafts.map((d) => KIND_URL[d.kind]));
  const hasUpdate = drafts.some((d) => d.kind === "update");
  const capHit = counts
    ? updateOnly
      ? counts.updateOnly >= VAULT_LIMITS.maxPendingUpdatesPerProposer
      : counts.general >= VAULT_LIMITS.maxPendingPerProposer
    : false;

  const problem = (() => {
    if (drafts.length === 0) return "Add at least one action";
    if (drafts.length > VAULT_LIMITS.maxMessagesPerProposal) return `At most ${VAULT_LIMITS.maxMessagesPerProposal} actions`;
    if (drafts.filter((d) => d.kind === "update").length > 1) return "Only one settings change per proposal";
    for (const [i, d] of drafts.entries()) {
      const p = draftProblem(d, vault, DENOM, pendingIds);
      if (p) return drafts.length > 1 ? `Action ${i + 1}: ${p}` : p;
    }
    if (memo.length > VAULT_LIMITS.maxMemoLength) return `Memo is limited to ${VAULT_LIMITS.maxMemoLength} characters`;
    if (capHit) return "You have too many pending proposals in this vault";
    return null;
  })();

  const setDraft = (key: number, next: Draft) => setDrafts((ds) => ds.map((d) => (d.key === key ? next : d)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const [{ MsgSend }, { MsgUpdateVault, MsgCancelProposal, MsgProposeResponse }] = await Promise.all([
        import("cosmjs-types/cosmos/bank/v1beta1/tx"),
        import("@sparkdreamnft/sparkdreamjs/sparkdream/vault/v1/tx"),
      ]);
      // Every inner message is signed by the vault address itself.
      const messages = drafts.map((d) => {
        if (d.kind === "send") {
          return {
            typeUrl: SEND_URL,
            value: MsgSend.encode(
              MsgSend.fromPartial({
                fromAddress: vault.address,
                toAddress: d.toAddress as string,
                amount: [{ denom: d.denom, amount: baseAmount(d, DENOM) as string }],
              })
            ).finish(),
          };
        }
        if (d.kind === "cancel") {
          return {
            typeUrl: VaultMsgTypeUrls.CancelProposal,
            value: MsgCancelProposal.encode(
              MsgCancelProposal.fromPartial({ signer: vault.address, proposalId: BigInt(d.proposalId) })
            ).finish(),
          };
        }
        return {
          typeUrl: VaultMsgTypeUrls.UpdateVault,
          value: MsgUpdateVault.encode(
            MsgUpdateVault.fromPartial({
              vault: vault.address,
              signers: toProtoSigners(d.signers),
              threshold: BigInt(Number(d.threshold)),
              proposalTtl: BigInt(ttlSeconds(d.ttlAmount, d.ttlUnit)),
              label: d.label.trim(),
            })
          ).finish(),
        };
      });
      const hash = await signAndBroadcast([
        {
          typeUrl: VaultMsgTypeUrls.Propose,
          value: {
            signer: signerAddress,
            vaultId: BigInt(vault.vault_id),
            messages,
            memo: memo.trim(),
            execute: canSelfExecute && execute,
          },
        },
      ]);
      invalidateVaults();
      let outcome = "Proposal submitted";
      try {
        for (const r of await getTxMsgResponses(hash)) {
          if (r.typeUrl === "/sparkdream.vault.v1.MsgProposeResponse") {
            const res = MsgProposeResponse.decode(r.value);
            outcome = res.executed
              ? `Proposal #${res.proposalId} was approved and executed`
              : `Proposal #${res.proposalId} is open for approvals`;
          }
        }
      } catch {
        // the tx landed; the generic outcome is enough
      }
      onDone(outcome);
    } catch (err) {
      setError(errorMessage(err) || "Failed to submit proposal");
    } finally {
      setSubmitting(false);
    }
  };

  const denoms = Array.from(new Set([DENOM, ...balances.map((b) => b.denom)]));

  return (
    <FormShell
      title="New proposal"
      intro="Propose actions for the vault to take. Submitting counts as your approval; it runs once approvals reach the threshold."
      onSubmit={handleSubmit}
    >
      {drafts.map((d, i) => (
        <div key={d.key} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <select
              aria-label="Action type"
              value={d.kind}
              onChange={(e) => setDraft(d.key, newDraft(e.target.value as Kind, vault, DENOM))}
              className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-sm text-white"
            >
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {drafts.length > 1 ? `${i + 1}. ` : ""}
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                className="text-xs text-zinc-400 hover:text-red-400"
              >
                Remove
              </button>
            )}
          </div>

          {d.kind === "send" && (
            <SendEditor
              draft={d}
              idPrefix={`pf-${d.key}`}
              denoms={denoms}
              chainDenom={DENOM}
              display={DISPLAY}
              balances={balances}
              onChange={(next) => setDraft(d.key, next)}
            />
          )}

          {d.kind === "update" && (
            <>
              <p className="text-xs text-amber-300">
                When this runs, every other pending proposal of the vault is invalidated and has to be proposed again.
              </p>
              <Field label="Signers">
                <SignerListEditor
                  idPrefix={`pf-${d.key}`}
                  signers={d.signers}
                  onChange={(signers) => setDraft(d.key, { ...d, signers })}
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id={`pf-${d.key}-threshold`} label="Threshold" help={`Out of ${totalWeight(d.signers)}`}>
                  <NumberInput
                    id={`pf-${d.key}-threshold`}
                    min="1"
                    step="1"
                    value={d.threshold}
                    onChange={(e) => setDraft(d.key, { ...d, threshold: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </Field>
                <Field id={`pf-${d.key}-ttl`} label="Proposals stay open for" help="From 1 hour to 30 days">
                  <TtlInput
                    id={`pf-${d.key}-ttl`}
                    amount={d.ttlAmount}
                    unit={d.ttlUnit}
                    onAmount={(ttlAmount) => setDraft(d.key, { ...d, ttlAmount })}
                    onUnit={(ttlUnit) => setDraft(d.key, { ...d, ttlUnit })}
                  />
                </Field>
              </div>
              <Field id={`pf-${d.key}-label`} label="Label">
                <input
                  id={`pf-${d.key}-label`}
                  type="text"
                  maxLength={VAULT_LIMITS.maxLabelLength}
                  value={d.label}
                  onChange={(e) => setDraft(d.key, { ...d, label: e.target.value })}
                  className={INPUT_CLASS}
                />
              </Field>
            </>
          )}

          {d.kind === "cancel" && (
            <Field id={`pf-${d.key}-cancel`} label="Proposal" help="The vault cancels it, so this works even when its proposer is gone.">
              {pending.length === 0 ? (
                <p className="text-sm text-zinc-500">There are no pending proposals.</p>
              ) : (
                <select
                  id={`pf-${d.key}-cancel`}
                  value={d.proposalId}
                  onChange={(e) => setDraft(d.key, { ...d, proposalId: e.target.value })}
                  className={INPUT_CLASS}
                >
                  <option value="">Choose…</option>
                  {pending.map((p) => (
                    <option key={p.proposal_id} value={p.proposal_id}>
                      #{p.proposal_id}
                      {p.memo ? ` · ${p.memo.slice(0, 60)}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </div>
      ))}

      {drafts.length < VAULT_LIMITS.maxMessagesPerProposal && (
        <button
          type="button"
          onClick={() => setDrafts((ds) => [...ds, newDraft("send", vault, DENOM)])}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          + Add another action
        </button>
      )}
      {hasUpdate && drafts.length > 1 && (
        <p className="text-xs text-zinc-500">
          Actions run in order, all or nothing. A settings change mixed with other actions counts toward your general
          pending limit.
        </p>
      )}

      <Field id="pf-memo" label="Memo (optional)" help={`${memo.length}/${VAULT_LIMITS.maxMemoLength}`}>
        <input
          id="pf-memo"
          type="text"
          maxLength={VAULT_LIMITS.maxMemoLength}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="What it's for"
          className={INPUT_CLASS}
        />
      </Field>

      {canSelfExecute ? (
        <label className="flex items-start gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={execute} onChange={(e) => setExecute(e.target.checked)} className="mt-1" />
          <span>
            Run it now. Your weight ({weight}) meets the threshold ({vault.threshold}) on its own. If running fails, the
            proposal isn&apos;t created either.
          </span>
        </label>
      ) : (
        <p className="text-xs text-zinc-500">
          Your weight is {weight} of the {vault.threshold} needed, so other signers have to approve before it runs.
        </p>
      )}

      {counts && (
        <p className={`text-xs ${capHit ? "text-red-400" : "text-zinc-500"}`}>
          Your pending proposals here: {counts.general} of {VAULT_LIMITS.maxPendingPerProposer}, plus{" "}
          {counts.updateOnly} of {VAULT_LIMITS.maxPendingUpdatesPerProposer} settings-only changes.
          {capHit && " Wait for one to resolve, or cancel one, before proposing more."}
        </p>
      )}

      <FormActions submitting={submitting} disabled={!!problem} label="Submit proposal" onCancel={onCancel} error={error} />
      {problem && drafts.length > 0 && <p className="text-xs text-zinc-500">{problem}</p>}
    </FormShell>
  );
}

function SendEditor({
  draft,
  idPrefix,
  denoms,
  chainDenom,
  display,
  balances,
  onChange,
}: {
  draft: Extract<Draft, { kind: "send" }>;
  idPrefix: string;
  denoms: string[];
  chainDenom: string;
  display: string;
  balances: Coin[];
  onChange: (next: Extract<Draft, { kind: "send" }>) => void;
}) {
  const resolved = useResolvedAddress(draft.to);
  const address = resolved.address;
  useEffect(() => {
    if (address !== draft.toAddress) onChange({ ...draft, toAddress: address });
    // Only a newly resolved address should write back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  const held = balances.find((b) => b.denom === draft.denom);
  return (
    <>
      <Field id={`${idPrefix}-to`} label="Recipient">
        <AddressInput
          id={`${idPrefix}-to`}
          value={draft.to}
          onChange={(to) => onChange({ ...draft, to })}
          resolved={resolved}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
        <Field
          id={`${idPrefix}-amount`}
          label={draft.denom === chainDenom ? `Amount (${display})` : "Amount (base units)"}
          help={held ? `Vault holds ${formatCoin(held, chainDenom, display)}` : "The vault holds none of this"}
        >
          <NumberInput
            id={`${idPrefix}-amount`}
            min="0"
            step="any"
            value={draft.amount}
            onChange={(e) => onChange({ ...draft, amount: e.target.value })}
            placeholder="0"
            className={INPUT_CLASS}
          />
        </Field>
        {denoms.length > 1 && (
          <Field id={`${idPrefix}-denom`} label="Token">
            <select
              id={`${idPrefix}-denom`}
              value={draft.denom}
              onChange={(e) => onChange({ ...draft, denom: e.target.value, amount: "" })}
              className={INPUT_CLASS}
            >
              {denoms.map((d) => (
                <option key={d} value={d}>
                  {d === chainDenom ? display : d}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {held && draft.denom === chainDenom && (
        <button
          type="button"
          onClick={() => onChange({ ...draft, amount: microToDecimal(held.amount) })}
          className="text-xs text-indigo-400 hover:text-indigo-300"
        >
          Send everything
        </button>
      )}
    </>
  );
}
