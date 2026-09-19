"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { listFederationPeers } from "@/lib/api";
import { FederationMsgTypeUrls } from "@/lib/tx";
import { PeerStatus, type Peer } from "@/types/federation";

/**
 * Publish one piece of local content to a federation peer.
 *
 * Federation is never automatic: creating a post puts it on this chain and
 * nothing else. MsgFederateContent is the explicit act of sending it, and it
 * is creator-signed precisely so a relayer cannot publish someone's content
 * on their behalf. That is why this lives on the content, next to the
 * author's other actions, rather than on the federation page -- the
 * federation page shows what has ARRIVED, and only the author can send.
 *
 * The receiving chain still applies its own inbound policy: content types it
 * does not accept are dropped there, whatever we send.
 */
export default function FederateContentForm({
  contentType,
  localContentId,
  defaultTitle,
  defaultBody,
  onDone,
  onCancel,
}: {
  /** Must be one of the chain's federation params known_content_types. */
  contentType: string;
  /** This chain's id for the content (post_id, collection id, ...). */
  localContentId: string;
  defaultTitle: string;
  defaultBody: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { busy, error, clearError, run } = useTxAction();

  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [peerId, setPeerId] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(defaultBody);
  const [contentUri, setContentUri] = useState("");

  useEffect(() => {
    let cancelled = false;
    listFederationPeers()
      .then((r) => {
        if (cancelled) return;
        // Only ACTIVE peers can receive: the keeper rejects anything else
        // with ErrPeerNotActive, so offering them would only produce a
        // failed transaction.
        const active = (r.peers ?? []).filter((p) => p.status === PeerStatus.ACTIVE);
        setPeers(active);
        if (active.length === 1) setPeerId(active[0].id);
      })
      .catch(() => {
        if (!cancelled) setPeers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !peerId) return;
    const ok = await run(
      "federate",
      async () => {
        await signAndBroadcast([
          {
            typeUrl: FederationMsgTypeUrls.FederateContent,
            value: {
              creator: address,
              peerId,
              contentType,
              localContentId,
              title: title.trim(),
              body: body.trim(),
              contentUri: contentUri.trim(),
            },
          },
        ]);
      },
      (raw) => `Could not federate this content: ${raw}`
    );
    if (ok) onDone();
  };

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  if (peers && peers.length === 0) {
    return (
      <div className="sd-hull-tile space-y-3 rounded-xl p-4 text-sm text-zinc-400">
        No active federation peers on this chain, so there is nowhere to send
        this yet.
        <div>
          <button type="button" onClick={onCancel} className="text-xs text-zinc-400 hover:text-zinc-200">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="sd-hull-tile space-y-3 rounded-xl p-4">
      <div className="text-sm text-zinc-300">Federate this content to a peer</div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-send-peer">
          Peer
        </label>
        <select
          id="fed-send-peer"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
          className={inputClass}
        >
          <option value="">{peers ? "Select a peer" : "Loading peers…"}</option>
          {(peers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name || p.id}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-send-title">
          Title
        </label>
        <input
          id="fed-send-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-send-body">
          Body
        </label>
        <textarea
          id="fed-send-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-zinc-500">
          Sent as-is. The peer hashes the full title and body to verify it
          later, so edits here make the copy differ from the original.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-send-uri">
          Content URI
        </label>
        <input
          id="fed-send-uri"
          value={contentUri}
          onChange={(e) => setContentUri(e.target.value)}
          placeholder="Optional. Where the original can be read."
          className={inputClass}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
          <button type="button" onClick={clearError} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || !peerId}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Federate"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
      </div>
    </form>
  );
}
