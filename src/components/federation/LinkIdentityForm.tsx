"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { FederationMsgTypeUrls } from "@/lib/tx";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import {
  PeerType,
  PeerStatus,
  PEER_STATUS_LABELS,
  type Peer,
  type IdentityLink,
} from "@/types/federation";

// What a remote identity looks like on each kind of peer. These are hints for
// the user, not validation: the chain stores remote_identity as an opaque
// string and leaves the format to the bridge that verifies it.
const REMOTE_HINTS: Record<string, { placeholder: string; hint: string }> = {
  [PeerType.SPARK_DREAM]: {
    placeholder: "sprkdrm1…",
    hint: "The bech32 address you control on the peer chain. It confirms over IBC.",
  },
  [PeerType.ACTIVITYPUB]: {
    placeholder: "@you@mastodon.social",
    hint: "Your full fediverse handle, including the instance.",
  },
  [PeerType.ATPROTO]: {
    placeholder: "you.bsky.social",
    hint: "Your handle or DID on the AT Protocol service.",
  },
  [PeerType.NOSTR]: {
    placeholder: "npub1…",
    hint: "Your Nostr public key. The same key can be linked on several relays.",
  },
  [PeerType.LENS]: {
    placeholder: "0x… or you.lens",
    hint: "Your Lens wallet address or handle. The bridge checks handle-NFT ownership.",
  },
};

/**
 * Compose a MsgLinkIdentity.
 *
 * The link lands UNVERIFIED and the keeper sends a challenge packet to the
 * peer; verification arrives later over IBC (or from the protocol's bridge),
 * so a successful broadcast here is the start of the handshake, not the end.
 *
 * The gates below mirror the keeper's, in its order, so a user gets a specific
 * message in the form instead of a generic chain error after paying a fee:
 * peer must be ACTIVE, one link per (address, peer), and the per-user cap from
 * params. The "remote identity already claimed" case is deliberately not
 * mirrored -- it needs a lookup across every local address, and the chain's own
 * error says it clearly.
 */
export default function LinkIdentityForm({
  peers,
  myLinks,
  maxLinks,
  onLinked,
  onCancel,
}: {
  peers: Peer[];
  myLinks: IdentityLink[];
  maxLinks: number | null;
  onLinked: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { busy, error, clearError, setError, run } = useTxAction();
  const [peerId, setPeerId] = useState("");
  const [remoteIdentity, setRemoteIdentity] = useState("");

  // Only ACTIVE peers accept a link (keeper: GetPeerRequireActive). Keep the
  // others in the list but disabled, so a PENDING peer reads as "not yet"
  // rather than as a peer that does not exist.
  const linkablePeers = useMemo(
    () => peers.filter((p) => p.status === PeerStatus.ACTIVE),
    [peers]
  );
  const linkedPeerIds = useMemo(
    () => new Set(myLinks.map((l) => l.peer_id)),
    [myLinks]
  );
  const selected = peers.find((p) => p.id === peerId);
  const hints = selected ? REMOTE_HINTS[selected.type] : undefined;
  const atCap = maxLinks !== null && myLinks.length >= maxLinks;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    if (!peerId) {
      setError("Choose a peer to link to.");
      return;
    }
    if (!remoteIdentity.trim()) {
      setError("Enter the remote identity you control.");
      return;
    }
    if (linkedPeerIds.has(peerId)) {
      setError(`You already have a link on ${peerId}. Unlink it first to replace it.`);
      return;
    }
    if (atCap) {
      setError(`You have used all ${maxLinks} identity links this chain allows.`);
      return;
    }
    const ok = await run(
      "link",
      async () => {
        await signAndBroadcast([
          {
            typeUrl: FederationMsgTypeUrls.LinkIdentity,
            value: {
              creator: address,
              peerId,
              remoteIdentity: remoteIdentity.trim(),
            },
          },
        ]);
      },
      (raw) => `Could not link the identity: ${raw}`
    );
    if (!ok) return;
    setPeerId("");
    setRemoteIdentity("");
    onLinked();
  };

  if (!address) {
    return (
      <div className="sd-positions-empty">
        Connect your wallet to link a remote identity.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="sd-hull-tile space-y-4 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Link a remote identity</h3>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>

      <ActionBanner message={error} onDismiss={clearError} />

      {linkablePeers.length === 0 && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          No peer is active yet. A peer accepts identity links only once the
          council activates it, so there is nothing to link to right now.
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-link-peer">
          Peer
        </label>
        <select
          id="fed-link-peer"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-600 focus:outline-none"
        >
          <option value="">Select a peer…</option>
          {peers.map((p) => {
            const inactive = p.status !== PeerStatus.ACTIVE;
            const already = linkedPeerIds.has(p.id);
            return (
              <option key={p.id} value={p.id} disabled={inactive || already}>
                {p.display_name || p.id}
                {inactive ? ` — ${PEER_STATUS_LABELS[p.status] || p.status}` : ""}
                {!inactive && already ? " — already linked" : ""}
              </option>
            );
          })}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-link-remote">
          Remote identity
        </label>
        <input
          id="fed-link-remote"
          value={remoteIdentity}
          onChange={(e) => setRemoteIdentity(e.target.value)}
          placeholder={hints?.placeholder || "Select a peer first"}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          {hints?.hint ||
            "Pick a peer to see what its identities look like."}
        </p>
      </div>

      <p className="text-xs text-zinc-500">
        The link is created unverified and a challenge goes out to the peer.
        Verification comes back over the peer&apos;s own channel, so the row
        stays pending until that lands.
        {maxLinks !== null && ` You have used ${myLinks.length} of ${maxLinks} links.`}
      </p>

      <button
        type="submit"
        disabled={busy || !peerId || !remoteIdentity.trim() || atCap}
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy ? "Linking…" : "Link identity"}
      </button>
    </form>
  );
}
