"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { usePeerAuthRoute, COMMITTEE_NAME } from "@/hooks/usePeerAuthRoute";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import { revokeIdentityLinkMsgs } from "@/lib/peerPolicy";
import type { IdentityLink, Peer } from "@/types/federation";

const MAX_REASON = 512;

/**
 * Propose removing one member's identity link to a peer with
 * MsgRevokeIdentityLink (chain v1.0.57). The remedy for a false bridge
 * attestation whose operator has retired and can no longer be reported. The
 * keeper takes only a policy signer, so this always opens a vote.
 */
export default function RevokeIdentityLinkForm({
  peer,
  links,
  onSubmitted,
  onCancel,
}: {
  peer: Peer;
  /** Known links to this peer, offered as suggestions. */
  links: IdentityLink[];
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { busy, error, clearError, run } = useTxAction();
  const { route } = usePeerAuthRoute("revokeLink", address);

  const [localAddress, setLocalAddress] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const local = localAddress.trim();
  const match = useMemo(() => links.find((l) => l.local_address === local), [links, local]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || route.kind !== "vote") return;
    await run(
      "revoke",
      async () => {
        if (!local) throw new Error("Enter the member's address.");
        const reasonTrim = reason.trim();
        if (!reasonTrim) throw new Error("Give a reason. It is recorded with the revocation.");
        if (new TextEncoder().encode(reasonTrim).length > MAX_REASON) {
          throw new Error(`Keep the reason to ${MAX_REASON} characters.`);
        }
        const msgs = await revokeIdentityLinkMsgs({
          address,
          policyAddress: route.policyAddress,
          localAddress: local,
          peerId: peer.id,
          reason: reasonTrim,
          metadata: note.trim() || `Revoke the identity link of ${local} to peer ${peer.id}`,
        });
        await signAndBroadcast(msgs);
        onSubmitted();
      },
      (raw) => `Could not submit the proposal: ${raw}`
    );
  };

  if (!address) {
    return (
      <div className="sd-positions-empty">
        Connect your wallet to propose revoking an identity link. Only {COMMITTEE_NAME} members
        can submit one.
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  return (
    <form onSubmit={submit} className="sd-hull-tile space-y-4 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Revoke an identity link</h3>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>
      <ActionBanner message={error} onDismiss={clearError} />
      {route.kind === "vote" && !route.isMemberOfBody && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Your address is not a member of the {COMMITTEE_NAME}, so the chain will reject this
          proposal.
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Removes one member&apos;s link to <span className="font-mono text-zinc-300">{peer.id}</span>,
        verified or not. Use it when a bridge operator attested a link falsely and has since
        retired, so the real owner of the remote identity can link it.
      </p>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-revoke-local">
          Member address
        </label>
        <input
          id="fed-revoke-local"
          value={localAddress}
          onChange={(e) => setLocalAddress(e.target.value)}
          list="fed-revoke-known"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <datalist id="fed-revoke-known">
          {links.map((l) => (
            <option key={l.local_address} value={l.local_address}>
              {l.remote_identity}
            </option>
          ))}
        </datalist>
        {match && (
          <p className="mt-1 text-xs text-zinc-500">
            Linked to <span className="font-mono text-zinc-300">{match.remote_identity}</span>
            {match.attested_by ? `, attested by ${match.attested_by}` : ""}.
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-revoke-reason">
          Reason
        </label>
        <textarea
          id="fed-revoke-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={MAX_REASON}
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-revoke-note">
          Proposal note
        </label>
        <input
          id="fed-revoke-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Defaults to a summary."
          className={inputClass}
        />
      </div>

      <p className="text-xs text-zinc-500">
        This opens a {COMMITTEE_NAME} vote. The link is removed only once the proposal passes and
        is executed.
      </p>

      <button
        type="submit"
        disabled={busy || route.kind !== "vote"}
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit proposal"}
      </button>
    </form>
  );
}
