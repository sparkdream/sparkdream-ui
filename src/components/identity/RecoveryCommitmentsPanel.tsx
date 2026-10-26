"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { RepIdentityMsgTypeUrls } from "@/lib/tx";
import { MAX_RECOVERY_COMMITMENTS, base64ToBytes, toHex } from "@/lib/recovery";
import { formatDurationApprox } from "@/lib/utils";
import type { MigrationState } from "@/hooks/useMigrationState";
import ActionBanner from "@/components/ActionBanner";
import RecoveryCodeSetup from "./RecoveryCodeSetup";
import { Deadline, Panel, SUBCARD } from "./shared";

/**
 * The member's recovery commitments (up to four). Each is the hash of a code
 * only the member holds; revealing the code later moves the membership
 * without a signature from this wallet. Every change waits out
 * recovery_change_delay, so a thief holding the wallet can't swap in their
 * own code or strip the owner's on the spot.
 */
export default function RecoveryCommitmentsPanel({
  state,
  nowMs,
  disabled,
  onChanged,
}: {
  state: MigrationState;
  nowMs: number;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const tx = useTxAction();
  // null: closed; "": new commitment; base64: replacing that commitment.
  const [setup, setSetup] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<Uint8Array | null>(null);
  const onReady = useCallback((c: Uint8Array | null) => setCommitment(c), []);

  const now = Math.floor(nowMs / 1000);
  const list = state.commitments.commitments ?? [];
  const removals = new Map((state.commitments.pending_removals ?? []).map((r) => [r.commitment, Number(r.removal_at ?? 0)]));
  const delay = formatDurationApprox(state.params.recoveryChangeDelay);

  const register = () =>
    tx.run("set", async () => {
      if (!commitment) throw new Error("Save the code first");
      await signAndBroadcast([
        {
          typeUrl: RepIdentityMsgTypeUrls.SetRecoveryCommitment,
          value: {
            member: signerAddress,
            commitment,
            replaces: setup ? base64ToBytes(setup) : new Uint8Array(),
          },
        },
      ]);
      setSetup(null);
      setCommitment(null);
      onChanged();
    });

  const remove = (b64: string) => {
    if (!confirm(`Remove this recovery code? It stays usable for ${delay}, then stops working.`)) return;
    void tx.run(`remove-${b64}`, async () => {
      await signAndBroadcast([
        {
          typeUrl: RepIdentityMsgTypeUrls.RemoveRecoveryCommitment,
          value: { member: signerAddress, commitment: base64ToBytes(b64) },
        },
      ]);
      onChanged();
    });
  };

  return (
    <Panel
      id="recovery"
      title="Recovery codes"
      intro={
        <>
          If you lose this wallet, a recovery code moves your membership to a new address, no signature needed. New
          codes, replacements and removals take effect after {delay}.
        </>
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-zinc-400">No recovery codes yet. Without one, losing this wallet loses the membership.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((c) => {
            const effective = Number(c.effective_at ?? 0);
            const removalAt = removals.get(c.commitment);
            return (
              <li key={c.commitment} className={`${SUBCARD} flex flex-wrap items-center justify-between gap-3 text-sm`}>
                <div>
                  <span className="font-mono text-zinc-300" title={toHex(base64ToBytes(c.commitment))}>
                    {toHex(base64ToBytes(c.commitment)).slice(0, 12)}
                  </span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {effective > now ? (
                      <>pending, usable from <Deadline at={effective} nowMs={nowMs} /></>
                    ) : removalAt ? (
                      <>active, removed on <Deadline at={removalAt} nowMs={nowMs} /></>
                    ) : (
                      "active"
                    )}
                  </span>
                </div>
                {!disabled && setup === null && (
                  <div className="flex gap-3 text-xs">
                    <button type="button" onClick={() => setSetup(c.commitment)} className="text-indigo-400 hover:text-indigo-300">
                      Replace
                    </button>
                    {!removalAt && (
                      <button
                        type="button"
                        onClick={() => remove(c.commitment)}
                        disabled={tx.busy}
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        The first characters match the &quot;Commitment&quot; line in a downloaded backup.
      </p>

      {!disabled && setup === null && list.length < MAX_RECOVERY_COMMITMENTS && (
        <button type="button" onClick={() => setSetup("")} className="sd-btn sd-btn-secondary mt-4">
          {list.length === 0 ? "Set up a recovery code" : "Add another code"}
        </button>
      )}
      {!disabled && setup !== null && signerAddress && (
        <div className="mt-4 space-y-3">
          {setup && (
            <p className="text-xs text-zinc-400">
              The old code keeps working until the new one takes effect, then stops.
            </p>
          )}
          <RecoveryCodeSetup member={signerAddress} onReady={onReady} />
          <div className="flex gap-2">
            <button type="button" onClick={register} disabled={tx.busy || !commitment} className="sd-btn sd-btn-primary">
              {tx.pending === "set" ? "Signing…" : setup ? "Replace code" : "Register code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCommitment(null);
              }}
              className="sd-btn sd-btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </Panel>
  );
}
