"use client";

import { useEffect, useMemo, useState } from "react";
import { listIbcChannels } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { CommonsMsgTypeUrls, FederationMsgTypeUrls } from "@/lib/tx";
import {
  usePeerAuthRoute,
  COUNCIL_NAME,
  COMMITTEE_NAME,
} from "@/hooks/usePeerAuthRoute";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import {
  PeerType,
  PeerStatus,
  PEER_TYPE_LABELS,
  PEER_STATUS_LABELS,
  type Peer,
} from "@/types/federation";

// Routing (who may sign what, and which body a vote goes to) lives in
// usePeerAuthRoute, because PeerPolicyForm needs the same rules and the two
// drifting apart is how a proposal ends up at the wrong policy.
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
/**
 * Register fields handed in from outside, e.g. the SparkDream launcher's
 * "finish in the chain's frontend" link (federation page URL parameters).
 * Applied at mount only, like initialPeerId.
 */
export interface RegisterPrefill {
  peerId?: string;
  displayName?: string;
  ibcChannelId?: string;
  ibcTransferChannelId?: string;
  /** The peer chain's REST (LCD) base URL, to fetch its chain identity. */
  peerApi?: string;
  /** The peer chain's identity as the LCD returns it (snake_case JSON). */
  peerIdentity?: Record<string, unknown>;
}

export default function PeerProposalForm({
  peers,
  initialAction = "register",
  initialPeerId = "",
  prefill,
  onSubmitted,
  onCancel,
}: {
  peers: Peer[];
  initialAction?: PeerAction;
  // Preselected target when the form is opened from a specific peer's card.
  // Applied at mount only; the caller remounts (via `key`) to re-seed it.
  initialPeerId?: string;
  prefill?: RegisterPrefill;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  // Runtime flag: NEXT_PUBLIC_* is inlined at build time, so a deployment
  // that flips this in its env would otherwise see no change at all. It
  // arrives via /api/config; until that resolves the build-time default
  // applies, which is `false` -- i.e. the safe, proposal-based path.
  // Validation here throws inside `run`, so the hook routes it to the same
  // banner as a chain error -- no separate setError path.
  const { busy, error, clearError, run } = useTxAction();

  const [action, setAction] = useState<PeerAction>(initialAction);

  // Register fields
  const [peerId, setPeerId] = useState(prefill?.peerId ?? "");
  const [displayName, setDisplayName] = useState(prefill?.displayName ?? "");
  const [peerType, setPeerType] = useState<string>(PeerType.SPARK_DREAM);
  const [ibcChannelId, setIbcChannelId] = useState(prefill?.ibcChannelId ?? "");
  const [metadata, setMetadata] = useState("");
  // A Spark Dream peer's ICS-20 channel and chain identity: the chain keys
  // the peer's voucher metadata (its token's name in wallets) and its relay
  // fee refunds on them, and neither can be added after registration (that
  // takes remove + re-register), so the form asks for both up front.
  const [transferChannelId, setTransferChannelId] = useState(prefill?.ibcTransferChannelId ?? "");
  const [transferSuggested, setTransferSuggested] = useState(false);
  const [peerApi, setPeerApi] = useState(prefill?.peerApi ?? "");
  const [peerIdentity, setPeerIdentity] = useState<Record<string, unknown> | null>(
    prefill?.peerIdentity ?? null
  );
  const [identityNote, setIdentityNote] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);

  // The transfer channel to the same chain shares the federation channel's
  // connection: suggest it once the federation channel is known, unless the
  // user (or a prefill) already chose one.
  useEffect(() => {
    const channel = ibcChannelId.trim();
    if (!channel || peerType !== PeerType.SPARK_DREAM) return;
    if (transferChannelId && !transferSuggested) return;
    let live = true;
    suggestTransferChannel(channel)
      .then((suggested) => {
        if (!live || !suggested) return;
        setTransferChannelId(suggested);
        setTransferSuggested(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ibcChannelId, peerType]);

  const fetchIdentity = async () => {
    const base = peerApi.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/\S+$/.test(base)) {
      setIdentityNote("Enter the peer chain's API (LCD) URL, e.g. https://api.example.org");
      return;
    }
    setIdentityBusy(true);
    setIdentityNote(null);
    try {
      const res = await fetch(`${base}/sparkdream/identity/v1/chain-identity`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { identity?: Record<string, unknown> };
      if (!body.identity?.bond_denom) throw new Error("no chain identity in the answer");
      setPeerIdentity(body.identity);
    } catch (err) {
      setPeerIdentity(null);
      setIdentityNote(
        `Could not read the chain identity from ${base} (${err instanceof Error ? err.message : String(err)}).`
      );
    } finally {
      setIdentityBusy(false);
    }
  };

  // Lifecycle fields
  const [targetPeerId, setTargetPeerId] = useState(initialPeerId);
  const [reason, setReason] = useState("");

  const [proposalNote, setProposalNote] = useState("");

  // Direct vs vote is decided by who is connected, not by a deployment flag.
  const [preferVote, setPreferVote] = useState(false);
  const { route } = usePeerAuthRoute(
    action,
    address,
    preferVote
  );

  // Which peers each lifecycle action can target, per the keeper's status
  // guards: resume takes PENDING or SUSPENDED, suspend takes ACTIVE, remove
  // takes anything not already removed.
  const targets = useMemo(() => {
    if (action === "resume") {
      return peers.filter(
        (p) =>
          p.status === PeerStatus.PENDING || p.status === PeerStatus.SUSPENDED
      );
    }
    if (action === "suspend")
      return peers.filter((p) => p.status === PeerStatus.ACTIVE);
    if (action === "remove")
      return peers.filter((p) => p.status !== PeerStatus.REMOVED);
    return [];
  }, [action, peers]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    // The hook has already decided direct vs vote, and which body a vote goes
    // to. Anything other than those two is not submittable.
    if (route.kind !== "direct" && route.kind !== "vote") return;

    const useDirect = route.kind === "direct";
    const authority = useDirect ? address : route.policyAddress;

    await run(
      "propose",
      async () => {
        const [
          { MsgRegisterPeer, MsgResumePeer, MsgSuspendPeer, MsgRemovePeer },
          { peerTypeFromJSON },
          { ChainIdentity },
        ] = await Promise.all([
          import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx"),
          import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/types"),
          import("@sparkdreamnft/sparkdreamjs/sparkdream/identity/v1/chain_identity"),
        ]);

        // Two shapes of the same message. `inner` is pre-encoded bytes for
        // embedding in MsgSubmitProposal.messages; `direct` is the plain
        // object the registry encodes when broadcasting it on its own.
        // Passing the encoded bytes to signAndBroadcast silently produces a
        // message with every field empty -- the chain then rejects it with
        // "empty address string is not allowed" on the authority.
        let inner: { typeUrl: string; value: Uint8Array };
        let direct: { typeUrl: string; value: unknown };
        let summary: string;

        if (action === "register") {
          const id = peerId.trim();
          if (!PEER_ID_RE.test(id)) {
            throw new Error(
              "Peer id must be 3-64 characters of lowercase letters, digits, dots or hyphens, and cannot start or end with a dot or hyphen."
            );
          }
          if (
            peers.some((p) => p.id === id && p.status !== PeerStatus.REMOVED)
          ) {
            throw new Error(`Peer ${id} is already registered.`);
          }
          const channel = ibcChannelId.trim();
          if (
            channel &&
            peers.some(
              (p) =>
                p.ibc_channel_id === channel && p.status !== PeerStatus.REMOVED
            )
          ) {
            throw new Error(
              `Channel ${channel} is already bound to another peer.`
            );
          }
          const sparkDream = peerType === PeerType.SPARK_DREAM;
          const transfer = sparkDream ? transferChannelId.trim() : "";
          if (transfer && !/^channel-\d+$/.test(transfer)) {
            throw new Error(`Transfer channel ${transfer} is not a channel id (channel-N).`);
          }
          const registerFields = MsgRegisterPeer.fromPartial({
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
            // Committee at bridge-registration time.
            controllerGroup: "",
            ...(transfer ? { ibcTransferChannelId: transfer } : {}),
            ...(sparkDream && peerIdentity
              ? { peerIdentity: ChainIdentity.fromAmino(peerIdentity as never) }
              : {}),
          });
          inner = {
            typeUrl: FederationMsgTypeUrls.RegisterPeer,
            value: MsgRegisterPeer.encode(registerFields).finish(),
          };
          direct = {
            typeUrl: FederationMsgTypeUrls.RegisterPeer,
            value: registerFields,
          };
          summary = `Register federation peer ${id}`;
        } else {
          const id = targetPeerId;
          if (!id) throw new Error("Select a peer.");
          if (action === "resume") {
            const fields = MsgResumePeer.fromPartial({ authority, peerId: id });
            inner = {
              typeUrl: FederationMsgTypeUrls.ResumePeer,
              value: MsgResumePeer.encode(fields).finish(),
            };
            direct = {
              typeUrl: FederationMsgTypeUrls.ResumePeer,
              value: fields,
            };
            summary = `Activate federation peer ${id}`;
          } else if (action === "suspend") {
            const fields = MsgSuspendPeer.fromPartial({
              authority,
              peerId: id,
              reason: reason.trim(),
            });
            inner = {
              typeUrl: FederationMsgTypeUrls.SuspendPeer,
              value: MsgSuspendPeer.encode(fields).finish(),
            };
            direct = {
              typeUrl: FederationMsgTypeUrls.SuspendPeer,
              value: fields,
            };
            summary = `Suspend federation peer ${id}`;
          } else {
            const fields = MsgRemovePeer.fromPartial({
              authority,
              peerId: id,
              reason: reason.trim(),
            });
            inner = {
              typeUrl: FederationMsgTypeUrls.RemovePeer,
              value: MsgRemovePeer.encode(fields).finish(),
            };
            direct = {
              typeUrl: FederationMsgTypeUrls.RemovePeer,
              value: fields,
            };
            summary = `Remove federation peer ${id}`;
          }
        }

        if (useDirect) {
          // `inner` already carries authority = the connected address, so it
          // is a complete, self-signed message. The chain rejects it with
          // ErrNotAuthorized if the signer is not on the Operations
          // Committee, which is the only gate this path relies on.
          await signAndBroadcast([direct]);
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
      {route.kind === "direct" && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-300">
          You are on the {COMMITTEE_NAME}, so the chain accepts your signature
          for this action directly — no vote required.
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Peer proposal</h3>
        <button
          type="button"
          onClick={onCancel}
          className="sd-btn sd-btn-secondary"
        >
          Cancel
        </button>
      </div>

      <ActionBanner message={error} onDismiss={clearError} />

      {route.kind === "blocked" && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Your address is on neither the {COMMITTEE_NAME} nor the{" "}
          {COUNCIL_NAME}, so the chain will reject this. Ask a member of either
          body to submit it.
        </div>
      )}

      {route.kind === "vote" && !route.isMemberOfBody && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          This action is carried by the{" "}
          {route.body === "committee" ? COMMITTEE_NAME : COUNCIL_NAME}, and
          your address is not a member of it, so the proposal will be rejected.
          Ask a member of that body to submit it.
        </div>
      )}

      {route.kind === "unavailable" && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Could not read the governance groups from the chain, so this action
          cannot be routed. Try again once the node is reachable.
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
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-peer-id"
              >
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
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-peer-name"
              >
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
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-peer-type"
              >
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
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-peer-channel"
              >
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
                  ? "This chain's end of the federation channel. One peer per channel; changing it later means removing and re-registering the peer."
                  : "Only Spark Dream peers federate over IBC. Other transports use an off-chain bridge."}
              </p>
            </div>
          </div>

          {peerType === PeerType.SPARK_DREAM && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  className="mb-1 block text-sm text-zinc-400"
                  htmlFor="fed-peer-transfer"
                >
                  Transfer channel
                </label>
                <input
                  id="fed-peer-transfer"
                  value={transferChannelId}
                  onChange={(e) => {
                    setTransferChannelId(e.target.value);
                    setTransferSuggested(false);
                  }}
                  placeholder="channel-1"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-zinc-500">
                  {transferSuggested
                    ? "The open transfer channel on the federation channel's connection. "
                    : "This chain's end of the ICS-20 transfer channel to the same chain. "}
                  The peer&apos;s token is named in wallets and relay fees are refunded through it;
                  it cannot be added after registration.
                </p>
              </div>
              <div>
                <label
                  className="mb-1 block text-sm text-zinc-400"
                  htmlFor="fed-peer-api"
                >
                  Peer chain API
                </label>
                <div className="flex gap-2">
                  <input
                    id="fed-peer-api"
                    value={peerApi}
                    onChange={(e) => setPeerApi(e.target.value)}
                    placeholder="https://api.example.org"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={fetchIdentity}
                    disabled={identityBusy}
                    className="sd-btn sd-btn-secondary"
                  >
                    {identityBusy ? "Reading…" : "Fetch"}
                  </button>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {peerIdentity
                    ? `Chain identity: ${String(peerIdentity.chain_human_name ?? "?")} (${String(
                        peerIdentity.chain_ticker_prefix ?? "?"
                      )}), token ${String(peerIdentity.bond_display_symbol ?? peerIdentity.bond_denom)}. `
                    : "Fetches the peer chain's identity, which names its token here. "}
                  {identityNote ?? ""}
                </p>
              </div>
            </div>
          )}

          <div>
            <label
              className="mb-1 block text-sm text-zinc-400"
              htmlFor="fed-peer-meta"
            >
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
            <label
              className="mb-1 block text-sm text-zinc-400"
              htmlFor="fed-peer-target"
            >
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
                  {p.display_name || p.id} —{" "}
                  {PEER_STATUS_LABELS[p.status] || p.status}
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
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-peer-reason"
              >
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
        <label
          className="mb-1 block text-sm text-zinc-400"
          htmlFor="fed-peer-note"
        >
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

      {/* A committee member may choose deliberation even where the chain
          would accept their lone signature -- worth having for a destructive
          action like remove. Hidden when a vote is already mandatory. */}
      {(route.kind === "direct" || (preferVote && route.kind === "vote")) &&
        action !== "resume" && (
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
        {action === "resume" ? (
          <>
            This opens an {COMMITTEE_NAME} vote. Activation is the one peer
            action the chain will not accept from a single signature, so it
            takes a passed proposal however you are connected. The peer becomes
            active only after the proposal passes AND its minimum execution
            period has elapsed, so expect to come back and execute it.
          </>
        ) : route.kind === "direct" ? (
          <>
            This is submitted directly as your own account and takes effect
            immediately.
            {action === "register" &&
              " A newly registered peer starts pending, and needs a separate activate to use it."}
          </>
        ) : route.kind === "vote" ? (
          <>
            This opens a{" "}
            {route.body === "committee" ? COMMITTEE_NAME : COUNCIL_NAME} vote.
            The peer changes only once the proposal passes and is executed.
            {action === "register" &&
              " A newly registered peer starts pending, and needs a second proposal to activate it."}
          </>
        ) : null}
      </p>

      <button
        type="submit"
        disabled={
          busy ||
          (route.kind !== "direct" && route.kind !== "vote") ||
          (action !== "register" && !targetPeerId)
        }
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy
          ? "Submitting…"
          : route.kind === "direct"
          ? "Submit directly"
          : "Submit proposal"}
      </button>
    </form>
  );
}

/**
 * The open ICS-20 transfer channel on the same connection as `federationChannel`
 * (both run between the same two chains), if exactly one exists.
 */
async function suggestTransferChannel(federationChannel: string): Promise<string | undefined> {
  const { channels } = await listIbcChannels();
  const fed = channels.find((c) => c.channel_id === federationChannel && c.port_id === "federation");
  const connection = fed?.connection_hops?.[0];
  if (!connection) return undefined;
  const transfers = channels.filter(
    (c) => c.port_id === "transfer" && c.state === "STATE_OPEN" && c.connection_hops?.[0] === connection
  );
  return transfers.length === 1 ? transfers[0]!.channel_id : undefined;
}
