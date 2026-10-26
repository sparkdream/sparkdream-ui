"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import { useTxAction } from "@/hooks/useTxAction";
import { VaultMsgTypeUrls } from "@/lib/tx";
import { getVaultTally, invalidateVaults } from "@/lib/vaultApi";
import { formatTime, timeRemaining, truncateAddress } from "@/lib/utils";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import {
  VAULT_PROPOSAL_STATUS_LABELS,
  VaultProposalStatus,
  type Vault,
  type VaultProposal,
  type VaultTallyResponse,
} from "@/types/vault";
import { CARD, base64ToBytes, describeInner, myWeight, useNow } from "./shared";

const STATUS_TONE: Record<string, string> = {
  [VaultProposalStatus.PENDING]: "border-indigo-700 bg-indigo-900/30 text-indigo-300",
  [VaultProposalStatus.EXECUTED]: "border-emerald-800 bg-emerald-900/20 text-emerald-400",
  [VaultProposalStatus.CANCELLED]: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
  [VaultProposalStatus.EXPIRED]: "border-zinc-700 bg-zinc-800/50 text-zinc-400",
  [VaultProposalStatus.INVALIDATED]: "border-amber-800 bg-amber-900/20 text-amber-300",
};

export default function ProposalCard({
  vault,
  proposal: p,
  onChanged,
}: {
  vault: Vault;
  proposal: VaultProposal;
  /** Called after a successful action, with a line describing it. */
  onChanged: (outcome: string) => void;
}) {
  const { signerAddress, signAndBroadcast, sessionActive } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY } } = useChainConfig();
  const { isMine } = useMyAliases();
  const tx = useTxAction();
  const now = useNow();

  const pending = p.status === VaultProposalStatus.PENDING;
  const [tally, setTally] = useState<VaultTallyResponse | null>(null);

  // Refetch whenever the approvals change (the parent reloads after actions).
  const approvalsKey = (p.approvals || []).join(",");
  const loadTally = useCallback(() => {
    if (!pending) return;
    getVaultTally(p.proposal_id)
      .then(setTally)
      .catch(() => setTally(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, p.proposal_id, approvalsKey]);
  useEffect(loadTally, [loadTally]);

  const approvals = p.approvals || [];
  const threshold = Number(tally?.threshold || vault.threshold);
  const approvedWeight = Number(tally?.approved_weight || 0);
  const met = tally?.met ?? approvedWeight >= threshold;
  const weight = myWeight(vault, isMine);
  const approvedByMe = approvals.some((a) => isMine(a));
  const isProposer = isMine(p.proposer);
  const expiresMs = Number(p.expires_at || 0) * 1000;
  const expired = pending && expiresMs > 0 && now >= expiresMs;
  const stale = pending && p.config_version !== vault.config_version;

  // Why the signer actions can't run, in order of what the user can fix least.
  const blocked = !pending
    ? null
    : stale
      ? "Made against an older vault configuration. Propose it again."
      : expired
        ? "This proposal has expired."
        : sessionActive
          ? "Switch off session mode to sign vault actions with your main wallet."
          : weight === 0
            ? "You aren't a signer on this vault."
            : null;

  const send = async (key: string, typeUrl: string, value: Record<string, unknown>, done: string) => {
    const ok = await tx.run(key, async () => {
      await signAndBroadcast([{ typeUrl, value: { signer: signerAddress, proposalId: BigInt(p.proposal_id), ...value } }]);
    });
    if (ok) {
      invalidateVaults();
      onChanged(done);
    }
  };

  const approve = (execute: boolean) =>
    send(
      execute ? "approve-exec" : "approve",
      VaultMsgTypeUrls.Approve,
      // The stored hash, echoed as-is: it pins exactly the messages shown here.
      { messagesHash: base64ToBytes(p.messages_hash), execute },
      execute ? `Approved and executed proposal #${p.proposal_id}` : `Approved proposal #${p.proposal_id}`
    );

  const wouldMeet = !approvedByMe && approvedWeight + weight >= threshold;

  return (
    <article className={CARD}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-400">#{p.proposal_id}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_TONE[p.status] || STATUS_TONE[VaultProposalStatus.CANCELLED]}`}>
          {expired ? "Expired" : stale ? "Out of date" : VAULT_PROPOSAL_STATUS_LABELS[p.status] || p.status}
        </span>
        {pending && expiresMs > 0 && !expired && (
          <span className="text-xs text-zinc-400" title={formatTime(p.expires_at || "")}>
            {timeRemaining(expiresMs, now)}
          </span>
        )}
        {!pending && p.resolved_at && (
          <span className="text-xs text-zinc-500">{formatTime(p.resolved_at)}</span>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          by{" "}
          <CopyableAddress address={p.proposer} resolveName className="text-zinc-300" />
          {isProposer && " (you)"}
        </span>
      </header>

      {p.memo && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-200">{p.memo}</p>}

      <ol className="mt-3 space-y-2">
        {(p.messages || []).map((m, i) => (
          <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
            <details>
              <summary className="cursor-pointer text-sm text-zinc-200">
                {(p.messages || []).length > 1 && <span className="mr-1 text-zinc-500">{i + 1}.</span>}
                {describeInner(m, DENOM, DISPLAY, (a) => truncateAddress(a))}
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-400">
                {JSON.stringify(m, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ol>

      {pending && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>
              Approved weight <strong className="text-zinc-200">{tally ? approvedWeight : "…"}</strong> of {threshold}
            </span>
            {met && <span className="text-emerald-400">Ready to run</span>}
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full ${met ? "bg-emerald-500" : "bg-indigo-500"}`}
              style={{ width: `${Math.min(100, threshold ? (approvedWeight / threshold) * 100 : 0)}%` }}
            />
          </div>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="mt-3 text-xs text-zinc-400">
          <span className="text-zinc-500">{pending ? "Approved by" : "Approvals"}:</span>{" "}
          {approvals.map((a, i) => {
            const w = vault.signers.find((s) => s.address === a)?.weight;
            return (
              <span key={a}>
                {i > 0 && ", "}
                <CopyableAddress address={a} resolveName className="text-zinc-300" />
                {w && <span className="text-zinc-500"> ({w})</span>}
                {isMine(a) && " (you)"}
              </span>
            );
          })}
        </div>
      )}

      {pending && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {blocked ? (
            <p className="text-xs text-zinc-500">{blocked}</p>
          ) : (
            <>
              {!approvedByMe && wouldMeet && (
                <button type="button" disabled={tx.busy} onClick={() => approve(true)} className="sd-btn sd-btn-primary">
                  {tx.pending === "approve-exec" ? "Signing..." : "Approve and run"}
                </button>
              )}
              {!approvedByMe && (
                <button
                  type="button"
                  disabled={tx.busy}
                  onClick={() => approve(false)}
                  className={`sd-btn ${wouldMeet ? "sd-btn-secondary" : "sd-btn-primary"}`}
                >
                  {tx.pending === "approve" ? "Signing..." : wouldMeet ? "Approve only" : "Approve"}
                </button>
              )}
              {met && approvedByMe && (
                <button
                  type="button"
                  disabled={tx.busy}
                  onClick={() => send("execute", VaultMsgTypeUrls.Execute, {}, `Executed proposal #${p.proposal_id}`)}
                  className="sd-btn sd-btn-primary"
                >
                  {tx.pending === "execute" ? "Signing..." : "Run now"}
                </button>
              )}
              {approvedByMe && (
                <button
                  type="button"
                  disabled={tx.busy}
                  onClick={() =>
                    send("revoke", VaultMsgTypeUrls.RevokeApproval, {}, `Withdrew your approval of proposal #${p.proposal_id}`)
                  }
                  className="sd-btn sd-btn-secondary"
                >
                  {tx.pending === "revoke" ? "Signing..." : "Withdraw approval"}
                </button>
              )}
            </>
          )}
          {/* Cancelling only needs the proposer, not current signer status. */}
          {isProposer && !sessionActive && (
            <button
              type="button"
              disabled={tx.busy}
              onClick={() => send("cancel", VaultMsgTypeUrls.CancelProposal, {}, `Cancelled proposal #${p.proposal_id}`)}
              className="sd-btn sd-btn-ghost ml-auto"
            >
              {tx.pending === "cancel" ? "Signing..." : "Cancel proposal"}
            </button>
          )}
        </div>
      )}
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </article>
  );
}
