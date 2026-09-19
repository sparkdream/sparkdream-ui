"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { CommonsMsgTypeUrls, FederationMsgTypeUrls } from "@/lib/tx";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  listGroups,
  getCouncilMembers,
  getFederationPeerPolicy,
} from "@/lib/api";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import {
  PeerType,
  type Peer,
  type PeerPolicy,
  type FederationParams,
} from "@/types/federation";
import type { Group } from "@/types/commons";

// Peer policy is the Operations Committee's, not the Council's: x/federation
// gates MsgUpdatePeerPolicy on IsCouncilAuthorized(..., "commons", "operations")
// and the Council policy's allowed_messages does not list it.
const COMMITTEE_NAME = "Commons Operations Committee";

// The keeper rejects these outright, whatever known_content_types says.
const NEVER_FEDERATED = ["reveal_proposal", "reveal_tranche"];

const TRUST_LEVELS = [
  { v: 0, label: "Any (0)" },
  { v: 1, label: "Provisional (1)" },
  { v: 2, label: "Established (2)" },
  { v: 3, label: "Trusted (3)" },
  { v: 4, label: "Core (4)" },
];

/**
 * Compose an Operations Committee proposal carrying MsgUpdatePeerPolicy.
 *
 * The message replaces the peer's policy wholesale rather than patching it, so
 * the form loads the current policy and submits the edited whole. A freshly
 * registered peer carries the empty default -- every content list empty, which
 * means nothing federates in either direction until this runs.
 */
export default function PeerPolicyForm({
  peers,
  params,
  initialPeerId = "",
  onSubmitted,
  onCancel,
}: {
  peers: Peer[];
  params: FederationParams | null;
  initialPeerId?: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  // Runtime flag: NEXT_PUBLIC_* is inlined at build time, so a deployment
  // that flips this in its env would otherwise see no change at all. It
  // arrives via /api/config; until that resolves the build-time default
  // applies, which is `false` -- i.e. the safe, proposal-based path.
  const { config } = useChainConfig();
  const directCouncilSigning = config.directCouncilSigning;
  const { busy, error, clearError, run } = useTxAction();

  const [committee, setCommittee] = useState<Group | null>(null);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [peerId, setPeerId] = useState(initialPeerId);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const [outbound, setOutbound] = useState<string[]>([]);
  const [inbound, setInbound] = useState<string[]>([]);
  const [minTrust, setMinTrust] = useState(0);
  const [inRate, setInRate] = useState("0");
  const [outRate, setOutRate] = useState("0");
  const [allowRepQueries, setAllowRepQueries] = useState(false);
  const [acceptRepAttest, setAcceptRepAttest] = useState(false);
  const [requireReview, setRequireReview] = useState(false);
  const [blocked, setBlocked] = useState("");
  const [note, setNote] = useState("");

  const selected = peers.find((p) => p.id === peerId);
  const isSparkDream = selected?.type === PeerType.SPARK_DREAM;

  // known_content_types minus the two the keeper refuses to federate.
  const contentTypes = useMemo(
    () =>
      (params?.known_content_types || []).filter(
        (t) => !NEVER_FEDERATED.includes(t)
      ),
    [params]
  );

  useEffect(() => {
    let cancelled = false;
    listGroups()
      .then((res) => {
        if (cancelled) return;
        setCommittee(
          (res.group || []).find((g) => g.index === COMMITTEE_NAME) ?? null
        );
      })
      .catch(() => setCommittee(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getCouncilMembers(COMMITTEE_NAME)
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

  // MsgUpdatePeerPolicy replaces the whole policy, so seed the form from what
  // is on chain -- otherwise submitting would silently blank every field the
  // council did not retype.
  useEffect(() => {
    if (!peerId) return;
    let cancelled = false;
    getFederationPeerPolicy(peerId)
      .then((res) => {
        if (cancelled) return;
        const p: PeerPolicy | undefined = res.policy;
        setOutbound(p?.outbound_content_types || []);
        setInbound(p?.inbound_content_types || []);
        setMinTrust(p?.min_outbound_trust_level ?? 0);
        setInRate(p?.inbound_rate_limit_per_epoch || "0");
        setOutRate(p?.outbound_rate_limit_per_epoch || "0");
        setAllowRepQueries(p?.allow_reputation_queries ?? false);
        setAcceptRepAttest(p?.accept_reputation_attestations ?? false);
        setRequireReview(p?.require_review ?? false);
        setBlocked((p?.blocked_identities || []).join(", "));
        setLoadedFor(peerId);
      })
      .catch(() => {
        if (!cancelled) setLoadedFor(peerId);
      });
    return () => {
      cancelled = true;
    };
  }, [peerId]);

  const toggle = (list: string[], set: (v: string[]) => void, t: string) =>
    set(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !committee || !peerId) return;
    // See PeerProposalForm: direct mode signs as the Operations Committee
    // member instead of proposing to the committee policy.
    const authority = directCouncilSigning ? address : committee.policy_address;

    await run(
      "policy",
      async () => {
        if (!isSparkDream && (allowRepQueries || acceptRepAttest)) {
          throw new Error(
            "Reputation bridging is only supported for Spark Dream peers. Turn both reputation switches off."
          );
        }
        const { MsgUpdatePeerPolicy } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx"
        );
        // See PeerProposalForm: the proposal path needs encoded bytes, the
        // direct path needs the plain object. Sending the bytes directly
        // yields an all-empty message and "empty address string is not
        // allowed" on the authority.
        const policyFields = MsgUpdatePeerPolicy.fromPartial({
          authority,
          peerId,
          policy: {
            peerId,
            outboundContentTypes: outbound,
            inboundContentTypes: inbound,
            minOutboundTrustLevel: minTrust,
            // uint64: must be BigInt. The generated converter omits a zero
            // by testing `!== BigInt(0)`, and Number(0) !== BigInt(0) is
            // always true, which would sign a key the chain never emits.
            inboundRateLimitPerEpoch: BigInt(inRate || "0"),
            outboundRateLimitPerEpoch: BigInt(outRate || "0"),
            allowReputationQueries: allowRepQueries,
            acceptReputationAttestations: acceptRepAttest,
            requireReview,
            blockedIdentities: blocked
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          },
        });
        const inner = {
          typeUrl: FederationMsgTypeUrls.UpdatePeerPolicy,
          value: MsgUpdatePeerPolicy.encode(policyFields).finish(),
        };
        if (directCouncilSigning) {
          await signAndBroadcast([
            {
              typeUrl: FederationMsgTypeUrls.UpdatePeerPolicy,
              value: policyFields,
            },
          ]);
        } else {
          await signAndBroadcast([
            {
              typeUrl: CommonsMsgTypeUrls.SubmitProposal,
              value: {
                proposer: address,
                policyAddress: authority,
                messages: [inner],
                metadata: note.trim() || `Set federation policy for ${peerId}`,
              },
            },
          ]);
        }
        onSubmitted();
      },
      (raw) => `Could not submit the policy proposal: ${raw}`
    );
  };

  if (!address) {
    return (
      <div className="sd-positions-empty">
        Connect your wallet to set a peer policy. Only {COMMITTEE_NAME} members
        can submit one.
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  const typeGrid = (
    list: string[],
    set: (v: string[]) => void,
    name: string
  ) => (
    <div className="flex flex-wrap gap-2">
      {contentTypes.length === 0 && (
        <span className="text-xs text-zinc-500">
          No known content types on this chain.
        </span>
      )}
      {contentTypes.map((t) => (
        <button
          key={`${name}-${t}`}
          type="button"
          onClick={() => toggle(list, set, t)}
          className={`rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors ${
            list.includes(t)
              ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
              : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600"
          }`}
          aria-pressed={list.includes(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <form onSubmit={submit} className="sd-hull-tile space-y-4 rounded-xl p-5">
      {directCouncilSigning && (
        <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <span className="font-semibold">
            Direct signing enabled (development).
          </span>{" "}
          This submits the message immediately as your own account instead of
          opening a council vote. It succeeds only if you are on the Operations
          Committee. Turn off DIRECT_COUNCIL_SIGNING for any chain other than a
          devnet.
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Peer policy</h3>
        <button
          type="button"
          onClick={onCancel}
          className="sd-btn sd-btn-secondary"
        >
          Cancel
        </button>
      </div>

      <ActionBanner message={error} onDismiss={clearError} />

      {isMember === false && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Your address is not a member of the {COMMITTEE_NAME}, so the chain
          will reject this proposal. Peer policy is the committee&apos;s, not
          the council&apos;s.
        </div>
      )}

      <div>
        <label
          className="mb-1 block text-sm text-zinc-400"
          htmlFor="fed-pol-peer"
        >
          Peer
        </label>
        <select
          id="fed-pol-peer"
          value={peerId}
          onChange={(e) => setPeerId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a peer…</option>
          {peers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name || p.id}
            </option>
          ))}
        </select>
        {peerId && loadedFor === peerId && (
          <p className="mt-1 text-xs text-zinc-500">
            Loaded the policy currently on chain. This message replaces it
            whole, so anything you clear here is cleared on chain.
          </p>
        )}
      </div>

      {peerId && (
        <>
          <div>
            <label className="mb-1.5 block text-sm text-zinc-400">
              Inbound content types
            </label>
            {typeGrid(inbound, setInbound, "in")}
            <p className="mt-1 text-xs text-zinc-500">
              What this chain accepts from the peer. Empty means nothing
              arrives.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-zinc-400">
              Outbound content types
            </label>
            {typeGrid(outbound, setOutbound, "out")}
            <p className="mt-1 text-xs text-zinc-500">
              What this chain publishes to the peer. Empty means nothing leaves.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-pol-trust"
              >
                Min outbound trust
              </label>
              <select
                id="fed-pol-trust"
                value={minTrust}
                onChange={(e) => setMinTrust(Number(e.target.value))}
                className={inputClass}
              >
                {TRUST_LEVELS.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-pol-inrate"
              >
                Inbound rate / epoch
              </label>
              <input
                id="fed-pol-inrate"
                value={inRate}
                onChange={(e) => setInRate(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500">0 is unlimited.</p>
            </div>
            <div>
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-pol-outrate"
              >
                Outbound rate / epoch
              </label>
              <input
                id="fed-pol-outrate"
                value={outRate}
                onChange={(e) => setOutRate(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-zinc-500">0 is unlimited.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={requireReview}
                onChange={(e) => setRequireReview(e.target.checked)}
              />
              Require review on inbound content
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${
                isSparkDream ? "text-zinc-300" : "text-zinc-600"
              }`}
            >
              <input
                type="checkbox"
                checked={allowRepQueries}
                disabled={!isSparkDream}
                onChange={(e) => setAllowRepQueries(e.target.checked)}
              />
              Allow reputation queries from this peer
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${
                isSparkDream ? "text-zinc-300" : "text-zinc-600"
              }`}
            >
              <input
                type="checkbox"
                checked={acceptRepAttest}
                disabled={!isSparkDream}
                onChange={(e) => setAcceptRepAttest(e.target.checked)}
              />
              Accept reputation attestations from this peer
            </label>
            {!isSparkDream && (
              <p className="text-xs text-zinc-500">
                Reputation bridging is Spark Dream only. The keeper rejects a
                policy that turns either on for another transport.
              </p>
            )}
          </div>


          <div>
            <label
              className="mb-1 block text-sm text-zinc-400"
              htmlFor="fed-pol-blocked"
            >
              Blocked identities
            </label>
            <input
              id="fed-pol-blocked"
              value={blocked}
              onChange={(e) => setBlocked(e.target.value)}
              placeholder="Comma separated. Leave empty to block nobody."
              className={inputClass}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-sm text-zinc-400"
              htmlFor="fed-pol-note"
            >
              Proposal note
            </label>
            <input
              id="fed-pol-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Defaults to a summary."
              className={inputClass}
            />
          </div>
        </>
      )}

      <p className="text-xs text-zinc-500">
        {directCouncilSigning
          ? "This is submitted directly as your own account and takes effect immediately."
          : `This opens a ${COMMITTEE_NAME} vote. The policy changes only once the proposal passes and is executed.`}
      </p>

      <button
        type="submit"
        disabled={busy || !committee || !peerId}
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy
          ? "Submitting…"
          : directCouncilSigning
          ? "Set policy directly"
          : "Submit policy proposal"}
      </button>
    </form>
  );
}
