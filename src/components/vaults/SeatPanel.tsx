"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { VaultMsgTypeUrls } from "@/lib/tx";
import ActionBanner from "@/components/ActionBanner";
import { formatInviteExpiry, inviteExpiry, type Vault } from "@/types/vault";
import { CARD } from "./shared";

/**
 * The connected member's own seat on a vault: accept or decline a listing
 * someone else made, or leave a vault they accepted. Rendered only for a
 * listed signer.
 */
export default function SeatPanel({
  vault,
  pending,
  pendingProposals,
  onChanged,
}: {
  vault: Vault;
  /** The member's listing still waits for them to accept it. */
  pending: boolean;
  /** Pending proposals that leaving would invalidate. */
  pendingProposals: number;
  onChanged: (outcome: string) => void;
}) {
  const { signerAddress, signAndBroadcast, sessionActive } = useWallet();
  const tx = useTxAction();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const name = vault.label || `vault #${vault.vault_id}`;
  const mine = vault.signers.find((s) => s.address === signerAddress && !s.accepted);
  const expiresAt = mine ? inviteExpiry(mine) : null;

  const send = async (key: string, typeUrl: string, done: string) => {
    const ok = await tx.run(key, async () => {
      await signAndBroadcast([{ typeUrl, value: { signer: signerAddress, vaultId: BigInt(vault.vault_id) } }]);
    });
    if (ok) {
      setConfirmLeave(false);
      onChanged(done);
    }
  };

  const disabled = tx.busy || sessionActive;
  const sessionTitle = sessionActive ? "Switch off session mode to sign vault actions" : undefined;

  return (
    <section className={pending ? "rounded-xl border border-amber-800/60 bg-amber-900/10 p-5" : CARD}>
      <ActionBanner message={tx.error} onDismiss={tx.clearError} />
      {pending ? (
        <>
          <h3 className="text-sm font-semibold text-amber-200">You&apos;ve been listed as a signer</h3>
          <p className="mt-1 text-sm text-zinc-300">
            Someone named you on this vault. Your entry has no weight and can&apos;t propose or approve until you accept
            it. Decline if you don&apos;t want to sign for it.
          </p>
          {expiresAt && (
            <p className="mt-1 text-xs text-amber-300/80">
              {`Accept by ${formatInviteExpiry(expiresAt)}. After that the listing is removed.`}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            Declining is refused when the remaining signers could no longer reach the threshold.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => send("accept", VaultMsgTypeUrls.AcceptVaultSigner, `You're now a signer of ${name}`)}
              disabled={disabled}
              title={sessionTitle}
              className="sd-btn sd-btn-primary"
            >
              {tx.pending === "accept" ? "Accepting…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => send("decline", VaultMsgTypeUrls.LeaveVault, `You declined ${name}`)}
              disabled={disabled}
              title={sessionTitle}
              className="sd-btn sd-btn-secondary"
            >
              {tx.pending === "decline" ? "Declining…" : "Decline"}
            </button>
          </div>
        </>
      ) : confirmLeave ? (
        <>
          <h3 className="text-sm font-semibold text-white">Leave this vault?</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">
            <li>Your entry is removed and you can no longer propose or approve.</li>
            <li>
              {pendingProposals > 0
                ? `The vault's ${pendingProposals} pending proposal${pendingProposals === 1 ? " is" : "s are"} invalidated and must be proposed again.`
                : "Any pending proposal is invalidated and must be proposed again."}
            </li>
            <li>
              The chain refuses it when the remaining signers&apos; accepted weight would fall below the threshold. Ask
              them to update the vault first (lower the threshold or add a replacement).
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => send("leave", VaultMsgTypeUrls.LeaveVault, `You left ${name}`)}
              disabled={disabled}
              title={sessionTitle}
              className="sd-btn border border-red-800 bg-red-900/30 text-red-300 hover:bg-red-900/50"
            >
              {tx.pending === "leave" ? "Leaving…" : "Leave vault"}
            </button>
            <button type="button" onClick={() => setConfirmLeave(false)} disabled={tx.busy} className="sd-btn sd-btn-secondary">
              Keep my seat
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">You&apos;re a signer of this vault.</p>
          <button
            type="button"
            onClick={() => setConfirmLeave(true)}
            disabled={disabled}
            title={sessionTitle}
            className="text-xs text-zinc-400 hover:text-red-400 disabled:opacity-50"
          >
            Leave vault
          </button>
        </div>
      )}
    </section>
  );
}
