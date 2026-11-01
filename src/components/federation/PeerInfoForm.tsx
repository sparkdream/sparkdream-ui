"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { usePeerAuthRoute, COMMITTEE_NAME } from "@/hooks/usePeerAuthRoute";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import { peerInfoUpdateMsgs } from "@/lib/peerPolicy";
import type { Peer } from "@/types/federation";

const MAX_DISPLAY_NAME = 128;

/**
 * Correct a peer's display name and metadata with MsgUpdatePeerInfo.
 *
 * The message replaces both fields, so the form is seeded from the peer as
 * loaded and submits the edited pair. Id, type and channels are the peer's
 * identity and cannot change here.
 */
export default function PeerInfoForm({
  peer,
  onSubmitted,
  onCancel,
}: {
  peer: Peer;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { busy, error, clearError, run } = useTxAction();
  const [preferVote, setPreferVote] = useState(false);
  const { route } = usePeerAuthRoute("info", address, preferVote);

  const [displayName, setDisplayName] = useState(peer.display_name || "");
  const [peerMetadata, setPeerMetadata] = useState(peer.metadata || "");
  const [note, setNote] = useState("");

  const nameTrim = displayName.trim();
  const unchanged =
    nameTrim === (peer.display_name || "") && peerMetadata === (peer.metadata || "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    if (route.kind !== "direct" && route.kind !== "vote") return;
    await run(
      "info",
      async () => {
        if (!nameTrim) throw new Error("Enter a display name.");
        if (nameTrim.length > MAX_DISPLAY_NAME) {
          throw new Error(`Keep the display name to ${MAX_DISPLAY_NAME} characters.`);
        }
        const msgs = await peerInfoUpdateMsgs({
          address,
          route:
            route.kind === "direct"
              ? { kind: "direct" }
              : { kind: "vote", policyAddress: route.policyAddress },
          peerId: peer.id,
          displayName: nameTrim,
          peerMetadata,
          metadata: note.trim() || `Rename federation peer ${peer.id} to "${nameTrim}"`,
        });
        await signAndBroadcast(msgs);
        onSubmitted();
      },
      (raw) => `Could not update the peer: ${raw}`
    );
  };

  if (!address) {
    return (
      <div className="sd-positions-empty">
        Connect your wallet to edit a peer. Only {COMMITTEE_NAME} members can
        submit a change.
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  return (
    <form onSubmit={submit} className="sd-hull-tile space-y-4 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Edit peer info</h3>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>
      <ActionBanner message={error} onDismiss={clearError} />
      {(route.kind === "blocked" || (route.kind === "vote" && !route.isMemberOfBody)) && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Your address is not a member of the {COMMITTEE_NAME}, so the chain
          will reject this proposal.
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Peer <span className="font-mono text-zinc-300">{peer.id}</span>. The id,
        type and channels can&apos;t change here.
      </p>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-info-name">
          Display name
        </label>
        <input
          id="fed-info-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={MAX_DISPLAY_NAME}
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-info-meta">
          Metadata
        </label>
        <textarea
          id="fed-info-meta"
          value={peerMetadata}
          onChange={(e) => setPeerMetadata(e.target.value)}
          rows={3}
          className={`${inputClass} font-mono`}
        />
        <p className="mt-1 text-xs text-zinc-500">
          Replaced as shown. Leave it as loaded to keep it.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-info-note">
          Proposal note
        </label>
        <input
          id="fed-info-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Defaults to a summary."
          className={inputClass}
        />
      </div>

      {(route.kind === "direct" || (preferVote && route.kind === "vote")) && (
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={preferVote}
            onChange={(e) => setPreferVote(e.target.checked)}
            className="accent-zinc-500"
          />
          Open a vote instead of signing directly
        </label>
      )}

      <p className="text-xs text-zinc-500">
        {route.kind === "direct"
          ? "This is submitted directly as your own account and takes effect immediately."
          : route.kind === "vote"
          ? `This opens a ${COMMITTEE_NAME} vote. The peer changes only once the proposal passes and is executed.`
          : ""}
      </p>

      <button
        type="submit"
        disabled={busy || (route.kind !== "direct" && route.kind !== "vote") || unchanged}
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy ? "Submitting…" : route.kind === "direct" ? "Save directly" : "Submit proposal"}
      </button>
    </form>
  );
}
