"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { CommonsMsgTypeUrls, FederationMsgTypeUrls } from "@/lib/tx";
import { DIRECT_COUNCIL_SIGNING } from "@/lib/devFlags";
import { listGroups, getCouncilMembers } from "@/lib/api";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import {
  PeerType,
  PeerStatus,
  PEER_TYPE_LABELS,
  PEER_STATUS_LABELS,
  type Peer,
} from "@/types/federation";
import type { Group } from "@/types/commons";

// The council that owns peer lifecycle. x/federation accepts these four
// messages from the gov authority or the Commons Council policy address, and
// that policy's `allowed_messages` lists exactly them -- so every action here
// travels as an inner message of a Commons Council proposal.
const COUNCIL_NAME = "Commons Council";

export type PeerAction = "register" | "resume" | "suspend" | "remove";

const ACTION_LABELS: Record<PeerAction, string> = {
  register: "Register a peer",
  resume: "Activate or resume",
  suspend: "Suspend",
  remove: "Remove",
};

// The chain's ValidatePeerID, mirrored so a bad id fails in the form rather
// than three council votes later.
const PEER_ID_RE = /^[a-z0-9][a-z0-9.\-]{1,62}[a-z0-9]$/;

// Peer types a user can propose. UNSPECIFIED is rejected by the keeper.
const PROPOSABLE_TYPES = [
  PeerType.SPARK_DREAM,
  PeerType.ACTIVITYPUB,
  PeerType.ATPROTO,
  PeerType.NOSTR,
  PeerType.LENS,
];

/**
 * Compose a Commons Council proposal carrying one federation peer-lifecycle
 * message.
 *
 * These messages take `authority`, not `creator`. The authority defaults to
 * the council's policy address, which means the message must be executed by
 * the policy -- i.e. wrapped in MsgSubmitProposal, voted through, then
 * executed. So a successful broadcast here opens a vote; it does not change
 * the peer.
 *
 * The chain is more permissive than that: IsCouncilAuthorized also accepts an
 * individual Operations Committee member signing for themselves. DIRECT_
 * COUNCIL_SIGNING (development only) takes that path instead, signing as the
 * connected wallet and broadcasting the message alone -- see lib/devFlags.
 */
export default function PeerProposalForm({
  peers,
  initialAction = "register",
  initialPeerId = "",
  onSubmitted,
  onCancel,
}: {
  peers: Peer[];
  initialAction?: PeerAction;
  // Preselected target when the form is opened from a specific peer's card.
  // Applied at mount only; the caller remounts (via `key`) to re-seed it.
  initialPeerId?: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  // Validation here throws inside `run`, so the hook routes it to the same
  // banner as a chain error -- no separate setError path.
  const { busy, error, clearError, run } = useTxAction();

  const [action, setAction] = useState<PeerAction>(initialAction);
  const [council, setCouncil] = useState<Group | null>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);

  // Register fields
  const [peerId, setPeerId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [peerType, setPeerType] = useState<string>(PeerType.SPARK_DREAM);
  const [ibcChannelId, setIbcChannelId] = useState("");
  const [metadata, setMetadata] = useState("");

  // Lifecycle fields
  const [targetPeerId, setTargetPeerId] = useState(initialPeerId);
  const [reason, setReason] = useState("");

  const [proposalNote, setProposalNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    listGroups()
      .then((res) => {
        if (cancelled) return;
        setCouncil((res.group || []).find((g) => g.index === COUNCIL_NAME) ?? null);
      })
      .catch(() => setCouncil(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // Only council members may submit; the chain rejects anyone else, so tell
  // the user before they sign rather than after.
  useEffect(() => {
    if (!address) {
      setIsMember(null);
      return;
    }
    let cancelled = false;
    getCouncilMembers(COUNCIL_NAME)
      .then((res) => {
        if (cancelled) return;
        setIsMember((res.members || []).some((m) => m.address === address));
      })
      .catch(() => {
        if (!cancelled) setIsMember(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Which peers each lifecycle action can target, per the keeper's status
  // guards: resume takes PENDING or SUSPENDED, suspend takes ACTIVE, remove
  // takes anything not already removed.
  const targets = useMemo(() => {
    if (action === "resume") {
      return peers.filter(
        (p) => p.status === PeerStatus.PENDING || p.status === PeerStatus.SUSPENDED
      );
    }
    if (action === "suspend") return peers.filter((p) => p.status === PeerStatus.ACTIVE);
    if (action === "remove") return peers.filter((p) => p.status !== PeerStatus.REMOVED);
    return [];
  }, [action, peers]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !council) return;
    // Direct mode signs as the member; otherwise the council policy is the
    // authority and the message has to be executed by a passed proposal.
    const authority = DIRECT_COUNCIL_SIGNING ? address : council.policy_address;

    await run(
      "propose",
      async () => {
        const [{ MsgRegisterPeer, MsgResumePeer, MsgSuspendPeer, MsgRemovePeer }, { peerTypeFromJSON }] =
          await Promise.all([
            import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx"),
            import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/types"),
          ]);

        let inner: { typeUrl: string; value: Uint8Array };
        let summary: string;

        if (action === "register") {
          const id = peerId.trim();
          if (!PEER_ID_RE.test(id)) {
            throw new Error(
              "Peer id must be 3-64 characters of lowercase letters, digits, dots or hyphens, and cannot start or end with a dot or hyphen."
            );
          }
          if (peers.some((p) => p.id === id && p.status !== PeerStatus.REMOVED)) {
            throw new Error(`Peer ${id} is already registered.`);
          }
          const channel = ibcChannelId.trim();
          if (channel && peers.some((p) => p.ibc_channel_id === channel && p.status !== PeerStatus.REMOVED)) {
            throw new Error(`Channel ${channel} is already bound to another peer.`);
          }
          inner = {
            typeUrl: FederationMsgTypeUrls.RegisterPeer,
            value: MsgRegisterPeer.encode(
              MsgRegisterPeer.fromPartial({
                authority,
                peerId: id,
                displayName: displayName.trim(),
                // PeerType is a proto3 int32 enum. The form holds the
                // enum-string for the <select>, so convert before encoding --
                // passing the string NaN-coerces to 0 (UNSPECIFIED), which the
                // keeper rejects outright.
                type: peerTypeFromJSON(peerType),
                ibcChannelId: channel,
                metadata: metadata.trim(),
                // Left unset: controller_group resolves to the Operations
                // Committee at bridge-registration time, and peer_identity is
                // only meaningful for a Spark Dream peer whose denom metadata
                // we would have to be told out of band.
                controllerGroup: "",
              })
            ).finish(),
          };
          summary = `Register federation peer ${id}`;
        } else {
          const id = targetPeerId;
          if (!id) throw new Error("Select a peer.");
          if (action === "resume") {
            inner = {
              typeUrl: FederationMsgTypeUrls.ResumePeer,
              value: MsgResumePeer.encode(
                MsgResumePeer.fromPartial({ authority, peerId: id })
              ).finish(),
            };
            summary = `Activate federation peer ${id}`;
          } else if (action === "suspend") {
            inner = {
              typeUrl: FederationMsgTypeUrls.SuspendPeer,
              value: MsgSuspendPeer.encode(
                MsgSuspendPeer.fromPartial({ authority, peerId: id, reason: reason.trim() })
              ).finish(),
            };
            summary = `Suspend federation peer ${id}`;
          } else {
            inner = {
              typeUrl: FederationMsgTypeUrls.RemovePeer,
              value: MsgRemovePeer.encode(
                MsgRemovePeer.fromPartial({ authority, peerId: id, reason: reason.trim() })
              ).finish(),
            };
            summary = `Remove federation peer ${id}`;
          }
        }

        if (DIRECT_COUNCIL_SIGNING) {
          // `inner` already carries authority = the connected address, so it
          // is a complete, self-signed message. The chain rejects it with
          // ErrNotAuthorized if the signer is not on the Operations
          // Committee, which is the only gate either path relies on.
          await signAndBroadcast([inner]);
        } else {
          await signAndBroadcast([
            {
              typeUrl: CommonsMsgTypeUrls.SubmitProposal,
              value: {
                proposer: address,
                policyAddress: authority,
                messages: [inner],
                metadata: proposalNote.trim() || summary,
              },
            },
          ]);
        }

        setPeerId("");
        setDisplayName("");
        setIbcChannelId("");
        setMetadata("");
        setTargetPeerId("");
        setReason("");
        setProposalNote("");
        onSubmitted();
      },
      (raw) => `Could not submit the proposal: ${raw}`
    );
  };

  if (!address) {
    return (
      <div className="sd-positions-empty">
        Connect your wallet to propose a peer. Only Commons Council members can
        submit one.
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  return (
    <form onSubmit={submit} className="sd-hull-tile space-y-4 rounded-xl p-5">
      {DIRECT_COUNCIL_SIGNING && (
        <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <span className="font-semibold">Direct signing enabled (development).</span>{" "}
          This submits the message immediately as your own account instead of
          opening a council vote. It succeeds only if you are on the Operations
          Committee. Turn off NEXT_PUBLIC_DIRECT_COUNCIL_SIGNING for any chain
          other than a devnet.
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Peer proposal</h3>
        <button type="button" onClick={onCancel} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>

      <ActionBanner message={error} onDismiss={clearError} />

      {isMember === false && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Your address is not a member of the {COUNCIL_NAME}, so the chain will
          reject this proposal. Ask a council member to submit it.
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-sm text-zinc-400">Action</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(ACTION_LABELS) as PeerAction[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                action === a
                  ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
                  : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
              }`}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {action === "register" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-id">
                Peer id
              </label>
              <input
                id="fed-peer-id"
                value={peerId}
                onChange={(e) => setPeerId(e.target.value)}
                placeholder="sparkdream-test-1"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Lowercase letters, digits, dots and hyphens. 3 to 64 characters.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-name">
                Display name
              </label>
              <input
                id="fed-peer-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Spark Dream Testnet"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-type">
                Transport
              </label>
              <select
                id="fed-peer-type"
                value={peerType}
                onChange={(e) => setPeerType(e.target.value)}
                className={inputClass}
              >
                {PROPOSABLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PEER_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-channel">
                IBC channel
              </label>
              <input
                id="fed-peer-channel"
                value={ibcChannelId}
                onChange={(e) => setIbcChannelId(e.target.value)}
                placeholder="channel-0"
                disabled={peerType !== PeerType.SPARK_DREAM}
                className={`${inputClass} disabled:opacity-50`}
              />
              <p className="mt-1 text-xs text-zinc-500">
                {peerType === PeerType.SPARK_DREAM
                  ? "Optional. Can be bound later, but only one peer per channel."
                  : "Only Spark Dream peers federate over IBC. Other transports use an off-chain bridge."}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-meta">
              Peer metadata
            </label>
            <textarea
              id="fed-peer-meta"
              value={metadata}
              onChange={(e) => setMetadata(e.target.value)}
              rows={2}
              placeholder="Who runs this peer and why we are federating with it."
              className={inputClass}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-target">
              Peer
            </label>
            <select
              id="fed-peer-target"
              value={targetPeerId}
              onChange={(e) => setTargetPeerId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a peer…</option>
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name || p.id} — {PEER_STATUS_LABELS[p.status] || p.status}
                </option>
              ))}
            </select>
            {targets.length === 0 && (
              <p className="mt-1 text-xs text-zinc-500">
                No peer is in a state this action can target.
              </p>
            )}
          </div>

          {action !== "resume" && (
            <div>
              <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-reason">
                Reason
              </label>
              <input
                id="fed-peer-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Recorded on chain with the peer."
                className={inputClass}
              />
            </div>
          )}
        </>
      )}

      <div>
        <label className="mb-1 block text-sm text-zinc-400" htmlFor="fed-peer-note">
          Proposal note
        </label>
        <input
          id="fed-peer-note"
          value={proposalNote}
          onChange={(e) => setProposalNote(e.target.value)}
          placeholder="Defaults to a summary of the action."
          className={inputClass}
        />
      </div>

      <p className="text-xs text-zinc-500">
        This opens a {COUNCIL_NAME} vote. The peer changes only once the
        proposal passes and is executed.
        {action === "register" && " A newly registered peer starts pending, and needs a second proposal to activate it."}
      </p>

      <button
        type="submit"
        disabled={busy || !council || (action !== "register" && !targetPeerId)}
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit proposal"}
      </button>
    </form>
  );
}
