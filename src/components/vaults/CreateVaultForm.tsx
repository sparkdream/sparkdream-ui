"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { VaultMsgTypeUrls } from "@/lib/tx";
import { getTxMsgResponses } from "@/lib/api";
import { getVaultParams, invalidateVaults } from "@/lib/vaultApi";
import { errorMessage } from "@/lib/errors";
import { formatSpark } from "@/lib/utils";
import NumberInput from "@/components/NumberInput";
import ErrorState from "@/components/ErrorState";
import { Field, FormActions, FormShell, INPUT_CLASS, Preview } from "@/components/permissions/fields";
import { VAULT_LIMITS, type VaultParams } from "@/types/vault";
import {
  SignerListEditor, TtlInput, formatTtl, newSignerDraft, toProtoSigners, totalWeight, ttlSeconds,
  validateConfig, type SignerDraft,
} from "./shared";

/** Reads the new vault's id from the tx's MsgCreateVaultResponse, or null. */
async function createdVaultId(hash: string): Promise<string | null> {
  try {
    const { MsgCreateVaultResponse } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/vault/v1/tx");
    for (const r of await getTxMsgResponses(hash)) {
      if (r.typeUrl === "/sparkdream.vault.v1.MsgCreateVaultResponse") {
        return MsgCreateVaultResponse.decode(r.value).vaultId.toString();
      }
    }
  } catch {
    // the tx landed; the caller falls back to the vault list
  }
  return null;
}

export default function CreateVaultForm({
  onCreated,
  onCancel,
}: {
  /** Called with the new vault's id, or null when it couldn't be read back. */
  onCreated: (vaultId: string | null) => void;
  onCancel: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const { config: { displayDenom: DISPLAY } } = useChainConfig();

  const [params, setParams] = useState<VaultParams | null>(null);
  const [paramsError, setParamsError] = useState<unknown>(null);
  const [signers, setSigners] = useState<SignerDraft[]>(() => [newSignerDraft(signerAddress ?? "")]);
  const [threshold, setThreshold] = useState("1");
  const [ttlAmount, setTtlAmount] = useState("3");
  const [ttlUnit, setTtlUnit] = useState<"hours" | "days">("days");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadParams = () => {
    getVaultParams()
      .then((r) => {
        setParams(r.params ?? {});
        setParamsError(null);
      })
      .catch(setParamsError);
  };
  useEffect(loadParams, []);

  const ttl = ttlSeconds(ttlAmount, ttlUnit);
  const thresholdNum = Number(threshold);
  const sum = totalWeight(signers);
  const problem = validateConfig(signers, thresholdNum, ttl, label.trim());
  const enabled = params?.creation_enabled !== false;
  const fee = params?.creation_fee_amount || "0";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const hash = await signAndBroadcast([
        {
          typeUrl: VaultMsgTypeUrls.CreateVault,
          value: {
            creator: signerAddress,
            signers: toProtoSigners(signers),
            threshold: BigInt(thresholdNum),
            proposalTtl: BigInt(ttl),
            label: label.trim(),
          },
        },
      ]);
      invalidateVaults();
      onCreated(await createdVaultId(hash));
    } catch (err) {
      setError(errorMessage(err) || "Failed to create vault");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormShell
      title="New vault"
      intro="A shared account with its own address and no key. Funds move only when signers holding enough weight approve a proposal."
      onSubmit={handleSubmit}
    >
      {paramsError ? <ErrorState error={paramsError} onRetry={loadParams} compact /> : null}
      {params && !enabled && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
          Creating vaults is switched off on this chain right now. Existing vaults keep working.
        </div>
      )}

      <Field
        label={`Signers (${signers.length} of ${VAULT_LIMITS.maxSigners})`}
        help={`Address or name, and a voting weight from 1 to ${VAULT_LIMITS.maxSignerWeight}. You don't have to be a signer yourself.`}
      >
        <SignerListEditor idPrefix="cv" signers={signers} onChange={setSigners} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="cv-threshold" label="Threshold" help={`Approving weight needed to run a proposal, out of ${sum}`}>
          <NumberInput
            id="cv-threshold"
            min="1"
            max={String(Math.max(1, sum))}
            step="1"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field id="cv-ttl" label="Proposals stay open for" help="From 1 hour to 30 days">
          <TtlInput id="cv-ttl" amount={ttlAmount} unit={ttlUnit} onAmount={setTtlAmount} onUnit={setTtlUnit} />
        </Field>
      </div>

      <Field id="cv-label" label="Label (optional)">
        <input
          id="cv-label"
          type="text"
          maxLength={VAULT_LIMITS.maxLabelLength}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Team treasury"
          className={INPUT_CLASS}
        />
      </Field>

      {!problem && (
        <Preview>
          {signers.length} signer{signers.length === 1 ? "" : "s"} with a total weight of {sum}. A proposal runs once
          signers with a combined weight of at least <strong>{thresholdNum}</strong> approve it, and lapses after{" "}
          {formatTtl(ttl)}. Every signer other than you has to accept their seat before their weight counts.
        </Preview>
      )}

      {params && (
        <p className="text-xs text-zinc-400">
          {BigInt(fee) > BigInt(0) ? (
            <>
              Creation fee: <strong className="text-zinc-200">{formatSpark(fee)} {DISPLAY}</strong>, burned from your
              wallet. It isn&apos;t refunded.
            </>
          ) : (
            "Creating a vault is free right now."
          )}
        </p>
      )}

      <FormActions
        submitting={submitting}
        disabled={!!problem || !params || !enabled}
        label="Create vault"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
