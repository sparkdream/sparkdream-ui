"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import {
  getCollection,
  getCollectionsByOwner,
  getFederationPeerPolicy,
} from "@/lib/api";
import { usePeerAuthRoute, COMMITTEE_NAME } from "@/hooks/usePeerAuthRoute";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import {
  ALL_IDENTITIES,
  MAX_ALLOWED_IDENTITIES,
  MAX_CONTENT_HOSTS,
  allowedIdentitiesError,
  contentHostsError,
  normalizeAuthorIdentity,
  splitEntries,
} from "@/lib/authorIdentity";
import {
  curationId,
  peerPolicyUpdateMsgs,
  policyFromChain,
} from "@/lib/peerPolicy";
import {
  PeerType,
  type Peer,
  type PeerPolicy,
  type FederationParams,
} from "@/types/federation";
import {
  COLLECTION_STATUS_LABELS,
  CollectionStatus,
  type Collection,
} from "@/types/collect";

// Peer policy is the Operations Committee's, not the Council's: x/federation
// gates MsgUpdatePeerPolicy on IsCouncilAuthorized(..., "commons", "operations")
// and the Council policy's allowed_messages does not list it.

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
 *
 * Every PeerPolicy field is seeded and submitted. The submitted policy is the
 * on-chain one with the form's edits applied on top (lib/peerPolicy), so a
 * field the form has no control for still round-trips instead of being
 * blanked -- which for allowed_identities, default-deny, would stop every
 * bridged author.
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
  const { busy, error, clearError, run } = useTxAction();

  // Direct vs vote follows who is connected, not a deployment flag.
  // MsgUpdatePeerPolicy is accepted from an individual Operations Committee
  // member AND carried by the committee policy, so both routes are real.
  const [preferVote, setPreferVote] = useState(false);
  const { route, committee } = usePeerAuthRoute("policy", address, preferVote);
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
  const [contentHosts, setContentHosts] = useState("");
  // allowed_identities is edited as the "*" switch plus the specific entries.
  // Entries survive the switch being on; they just have no effect then.
  const [allowAny, setAllowAny] = useState(false);
  const [allowedText, setAllowedText] = useState("");
  // Curation collection id as typed. Empty is unset; "0" is collection 0.
  const [curationInput, setCurationInput] = useState("");
  const [note, setNote] = useState("");
  // The policy as loaded, the base the edits are applied to on submit.
  const [chainPolicy, setChainPolicy] = useState<PeerPolicy | null>(null);
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null);

  const selected = peers.find((p) => p.id === peerId);
  const isSparkDream = selected?.type === PeerType.SPARK_DREAM;
  const isActivityPub = selected?.type === PeerType.ACTIVITYPUB;

  const allowedEntries = useMemo(() => splitEntries(allowedText), [allowedText]);
  const allowedList = useMemo(
    () => (allowAny ? [ALL_IDENTITIES, ...allowedEntries] : allowedEntries),
    [allowAny, allowedEntries]
  );
  const allowedProblem = allowedIdentitiesError(allowedList);
  const hostList = useMemo(() => splitEntries(contentHosts), [contentHosts]);
  const hostsProblem = contentHostsError(hostList);
  const curationTrim = curationInput.trim();

  // The curation collection as it stands on chain, so the committee sees what
  // it is pointing at. The keeper refuses anything but an ACTIVE collection.
  const [curationLookup, setCurationLookup] = useState<{
    id: string;
    collection: Collection | null;
  } | null>(null);
  useEffect(() => {
    if (!curationTrim || isSparkDream) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getCollection(curationTrim)
        .then((res) => {
          if (!cancelled) setCurationLookup({ id: curationTrim, collection: res.collection ?? null });
        })
        .catch(() => {
          if (!cancelled) setCurationLookup({ id: curationTrim, collection: null });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [curationTrim, isSparkDream]);
  const curationColl =
    curationLookup && curationLookup.id === curationTrim ? curationLookup.collection : undefined;

  // Collections the committee's policy owns: the intended curation lists.
  const opsPolicy = committee?.policy_address ?? "";
  const [opsCollections, setOpsCollections] = useState<Collection[]>([]);
  useEffect(() => {
    if (!opsPolicy) return;
    let cancelled = false;
    getCollectionsByOwner(opsPolicy)
      .then((res) => {
        if (!cancelled) setOpsCollections(res.collections || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [opsPolicy]);

  // known_content_types minus the two the keeper refuses to federate.
  const contentTypes = useMemo(
    () =>
      (params?.known_content_types || []).filter(
        (t) => !NEVER_FEDERATED.includes(t)
      ),
    [params]
  );

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
        setContentHosts((p?.content_hosts || []).join("\n"));
        const allowed = p?.allowed_identities || [];
        setAllowAny(allowed.includes(ALL_IDENTITIES));
        setAllowedText(allowed.filter((x) => x !== ALL_IDENTITIES).join("\n"));
        setCurationInput(curationId(p) ?? "");
        setChainPolicy(p ?? null);
        setLoadFailedFor(null);
        setLoadedFor(peerId);
      })
      .catch(() => {
        // Nothing to carry over: submitting starts from the empty default.
        if (!cancelled) {
          setChainPolicy(null);
          setLoadFailedFor(peerId);
          setLoadedFor(peerId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [peerId]);

  const toggle = (list: string[], set: (v: string[]) => void, t: string) =>
    set(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !peerId) return;
    if (route.kind !== "direct" && route.kind !== "vote") return;
    const useDirect = route.kind === "direct";
    const authority = useDirect ? address : route.policyAddress;

    await run(
      "policy",
      async () => {
        if (!isSparkDream && (allowRepQueries || acceptRepAttest)) {
          throw new Error(
            "Reputation bridging is only supported for Spark Dream peers. Turn both reputation switches off."
          );
        }
        if (allowedProblem) throw new Error(allowedProblem);
        if (hostsProblem) throw new Error(hostsProblem);
        if (curationTrim && !/^\d+$/.test(curationTrim)) {
          throw new Error("The curation collection id must be a whole number, or empty for none.");
        }
        if (curationTrim && isSparkDream) {
          throw new Error("Curation applies only to bridged peers. Clear the collection for a Spark Dream peer.");
        }
        // Start from the policy as loaded, so a field this form does not
        // show is carried over rather than cleared.
        const base = await policyFromChain(peerId, chainPolicy);
        const policy = {
          ...base,
          outboundContentTypes: outbound,
          inboundContentTypes: inbound,
          minOutboundTrustLevel: minTrust,
          // uint64: must be BigInt. The amino converter omits a zero by
          // testing `!== BigInt(0)`, and Number(0) !== BigInt(0) is always
          // true, which would sign a key the chain never emits.
          inboundRateLimitPerEpoch: BigInt(inRate || "0"),
          outboundRateLimitPerEpoch: BigInt(outRate || "0"),
          allowReputationQueries: allowRepQueries,
          acceptReputationAttestations: acceptRepAttest,
          requireReview,
          blockedIdentities: splitEntries(blocked),
          // Only ActivityPub peers may carry content hosts; the field is
          // hidden for the rest and whatever the chain holds is kept.
          contentHosts: isActivityPub ? hostList : base.contentHosts,
          allowedIdentities: allowedList,
          // undefined, not a zero id, is "no collection".
          curation: curationTrim
            ? { collectionId: BigInt(curationTrim) }
            : undefined,
        };
        const msgs = await peerPolicyUpdateMsgs({
          address,
          route: useDirect ? { kind: "direct" } : { kind: "vote", policyAddress: authority },
          peerId,
          policy,
          metadata: note.trim() || `Set federation policy for ${peerId}`,
        });
        await signAndBroadcast(msgs);
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
      {route.kind === "direct" && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3 py-2 text-xs text-zinc-300">
          You are on the {COMMITTEE_NAME}, so the chain accepts your signature
          for peer policy directly — no vote required.
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

      {(route.kind === "blocked" ||
        (route.kind === "vote" && !route.isMemberOfBody)) && (
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
        {peerId && loadedFor === peerId && loadFailedFor === peerId && (
          <p className="mt-1 text-xs text-amber-400">
            Could not read the policy currently on chain. Submitting replaces
            it with exactly what is shown here, starting from empty -- including
            an empty allowed-authors list, which admits nobody.
          </p>
        )}
        {peerId && loadedFor === peerId && loadFailedFor !== peerId && (
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

          {!isSparkDream && (
            <div>
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-pol-allowed"
              >
                Allowed authors
              </label>
              <label className="mb-2 flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={allowAny}
                  onChange={(e) => setAllowAny(e.target.checked)}
                />
                Any author (<span className="font-mono">*</span>)
              </label>
              <textarea
                id="fed-pol-allowed"
                value={allowedText}
                onChange={(e) => setAllowedText(e.target.value)}
                rows={4}
                placeholder={"One per line or comma separated, e.g.\n@phoenix@aurora.example\nhttps://aurora.example/@zenith"}
                className={`${inputClass} font-mono`}
              />
              <p className="mt-1 text-xs text-zinc-500">
                {allowAny
                  ? "Any author of this peer passes this gate, so the entries above have no effect while it is on."
                  : allowedList.length === 0
                  ? "Empty means nobody: no bridged post from this peer is anchored until someone is listed or Any author is on."
                  : `${allowedList.length} of at most ${MAX_ALLOWED_IDENTITIES} authors pass this gate.`}{" "}
                Write @user@host, user@host, https://host/@user or
                https://host/users/user. With a curation collection set below,
                an author must pass both.
              </p>
              {allowedEntries.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {allowedEntries.slice(0, 12).map((e, i) => {
                    const n = normalizeAuthorIdentity(e);
                    return (
                      <li
                        key={`${i}-${e}`}
                        className={n ? "font-mono text-zinc-500" : "font-mono text-amber-400"}
                      >
                        {n ? `${e} -> ${n}` : `${e}: not an author identity`}
                      </li>
                    );
                  })}
                  {allowedEntries.length > 12 && (
                    <li className="text-zinc-600">
                      and {allowedEntries.length - 12} more
                    </li>
                  )}
                </ul>
              )}
              {allowedProblem && allowedList.length > MAX_ALLOWED_IDENTITIES && (
                <p className="mt-1 text-xs text-amber-400">{allowedProblem}</p>
              )}
            </div>
          )}

          {!isSparkDream && (
            <div>
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-pol-curation"
              >
                Curation collection
              </label>
              <div className="flex gap-2">
                <input
                  id="fed-pol-curation"
                  value={curationInput}
                  onChange={(e) => setCurationInput(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  placeholder="Collection id. Empty for none."
                  className={inputClass}
                />
                {curationTrim && (
                  <button
                    type="button"
                    onClick={() => setCurationInput("")}
                    className="sd-btn sd-btn-secondary"
                  >
                    Clear
                  </button>
                )}
              </div>
              {curationTrim && curationColl === undefined && (
                <p className="mt-1 text-xs text-zinc-500">Looking up collection {curationTrim}…</p>
              )}
              {curationTrim && curationColl === null && (
                <p className="mt-1 text-xs text-amber-400">
                  Collection {curationTrim} was not found. The chain refuses a
                  policy that names a missing collection.
                </p>
              )}
              {curationTrim && curationColl && (
                <p
                  className={`mt-1 text-xs ${
                    curationColl.status === CollectionStatus.ACTIVE ? "text-zinc-400" : "text-amber-400"
                  }`}
                >
                  #{curationColl.id ?? "0"} {curationColl.name || "(unnamed)"} ·{" "}
                  {COLLECTION_STATUS_LABELS[curationColl.status] || curationColl.status}
                  {curationColl.owner === opsPolicy && opsPolicy ? ` · owned by the ${COMMITTEE_NAME}` : ""}
                  {curationColl.status !== CollectionStatus.ACTIVE &&
                    ". Only an active collection can be named; the chain refuses this one."}
                </p>
              )}
              {opsCollections.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {opsCollections.map((c) => {
                    const id = c.id ?? "0";
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setCurationInput(id)}
                        className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                          curationTrim === id
                            ? "border-indigo-500/50 bg-indigo-600/15 text-indigo-400"
                            : "border-zinc-700 bg-zinc-800/30 text-zinc-400 hover:border-zinc-600"
                        }`}
                        aria-pressed={curationTrim === id}
                      >
                        #{id} {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-1 text-xs text-zinc-500">
                Optional. When set, an author must also be an active link item
                of this collection. Its owner and collaborators curate it
                without a proposal per author.
              </p>
            </div>
          )}

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
            {!isSparkDream && (
              <p className="mt-1 text-xs text-zinc-500">
                A blocked author is refused even when allowed and curated.
              </p>
            )}
          </div>

          {isActivityPub && (
            <div>
              <label
                className="mb-1 block text-sm text-zinc-400"
                htmlFor="fed-pol-hosts"
              >
                Content hosts
              </label>
              <textarea
                id="fed-pol-hosts"
                value={contentHosts}
                onChange={(e) => setContentHosts(e.target.value)}
                rows={2}
                placeholder="One per line, e.g. media.aurora.example"
                className={`${inputClass} font-mono`}
              />
              <p className={`mt-1 text-xs ${hostsProblem ? "text-amber-400" : "text-zinc-500"}`}>
                {hostsProblem ??
                  `Hostnames besides ${peerId} that inbound post URLs may live on, for an instance whose posts are served from another domain. Usually empty. At most ${MAX_CONTENT_HOSTS}.`}
              </p>
            </div>
          )}

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
          ? `This opens a ${COMMITTEE_NAME} vote. The policy changes only once the proposal passes and is executed.`
          : ""}
      </p>

      <button
        type="submit"
        disabled={
          busy ||
          (route.kind !== "direct" && route.kind !== "vote") ||
          !peerId
        }
        className="sd-btn sd-btn-primary disabled:opacity-50"
      >
        {busy
          ? "Submitting…"
          : route.kind === "direct"
          ? "Set policy directly"
          : "Submit policy proposal"}
      </button>
    </form>
  );
}
