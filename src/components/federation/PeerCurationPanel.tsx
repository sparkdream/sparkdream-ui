"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  getBankBalance,
  getCollectParams,
  getCollaborators,
  getCollection,
  getCollectionsByOwner,
  getFederationPeerPolicy,
  listCollectionItems,
} from "@/lib/api";
import { CollectMsgTypeUrls } from "@/lib/tx";
import { formatSpark } from "@/lib/utils";
import { usePeerAuthRoute, COMMITTEE_NAME } from "@/hooks/usePeerAuthRoute";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import { useTxAction } from "@/hooks/useTxAction";
import { ALL_IDENTITIES, normalizeAuthorIdentity } from "@/lib/authorIdentity";
import {
  committeeProposal,
  curationId,
  peerPolicyUpdateMsgs,
  policyFromChain,
  type EncodeObject,
} from "@/lib/peerPolicy";
import type { Peer, PeerPolicy } from "@/types/federation";
import {
  COLLABORATOR_ROLE_LABELS,
  COLLECTION_STATUS_LABELS,
  CollaboratorRole,
  CollectionStatus,
  ItemStatus,
  ReferenceType,
  type Collaborator,
  type Collection,
  type CollectionItem,
} from "@/types/collect";

// Who does what here follows the chain, not a UI role:
//
//  - The policy (allowed_identities, and which collection `curation` names)
//    is MsgUpdatePeerPolicy: an Operations Committee member signs it directly
//    or opens a committee vote, the same routing as PeerPolicyForm.
//  - The curation collection is meant to be OWNED BY THE COMMITTEE'S POLICY
//    ADDRESS, so it is ACTIVE and permanent and no single member holds it.
//    Anything the owner does -- create it, add or remove a curator -- is
//    therefore a committee proposal whose inner message has
//    creator = committee policy. There is no direct route for these: a member
//    signing MsgCreateCollection themselves would own the list personally.
//  - Curators are the collection's collaborators. They add and remove authors
//    (link items) by signing themselves, no proposal per author. A committee
//    member who is not a curator can still do it through a proposal.

// x/collect caps items per collection at 500 (max_items_per_collection).
const ITEM_PAGE = "500";

/** "1.5" (display units) to micro units; null when it is not a number. */
function sparkToMicro(input: string): bigint | null {
  const m = /^\s*(\d+)(?:\.(\d{1,6}))?\s*$/.exec(input);
  if (!m) return null;
  return BigInt(m[1]!) * BigInt(1_000_000) + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

function isLinkAuthor(it: CollectionItem): boolean {
  return (
    it.reference_type === ReferenceType.LINK &&
    it.status === ItemStatus.ACTIVE &&
    !!it.link?.uri
  );
}

/**
 * Author curation for one bridged (non-Spark-Dream) peer: the two gates on
 * MsgSubmitFederatedContent, the curation collection behind the second one,
 * its curators, and its authors.
 */
export default function PeerCurationPanel({
  peer,
  onEditPolicy,
  onChanged,
  onClose,
}: {
  peer: Peer;
  onEditPolicy: () => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { busy, pending, error, clearError, setError, run } = useTxAction();
  const [preferVote, setPreferVote] = useState(false);
  const { route, committee, onCommittee } = usePeerAuthRoute("policy", address, preferVote);
  const opsPolicy = committee?.policy_address ?? "";

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // The policy is re-read here rather than taken from the page, because a
  // policy update is built on top of it and must not replay a stale copy.
  const [policy, setPolicy] = useState<PeerPolicy | null>(null);
  const [policyState, setPolicyState] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    getFederationPeerPolicy(peer.id)
      .then((res) => {
        if (cancelled) return;
        setPolicy(res.policy ?? null);
        setPolicyState("ok");
      })
      .catch(() => {
        if (!cancelled) setPolicyState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [peer.id, reloadKey]);

  const collId = curationId(policy);
  const [coll, setColl] = useState<{
    id: string;
    collection: Collection | null;
    items: CollectionItem[];
    collaborators: Collaborator[];
  } | null>(null);
  useEffect(() => {
    if (collId === null) return;
    let cancelled = false;
    Promise.all([
      getCollection(collId).then((r) => r.collection ?? null).catch(() => null),
      listCollectionItems(collId, { limit: ITEM_PAGE })
        .then((r) => r.items || [])
        .catch(() => [] as CollectionItem[]),
      getCollaborators(collId)
        .then((r) => r.collaborators || [])
        .catch(() => [] as Collaborator[]),
    ]).then(([collection, items, collaborators]) => {
      if (!cancelled) setColl({ id: collId, collection, items, collaborators });
    });
    return () => {
      cancelled = true;
    };
  }, [collId, reloadKey]);
  const current = coll && coll.id === collId ? coll : null;

  // The committee's own collections, offered as curation lists.
  const [opsCollections, setOpsCollections] = useState<Collection[] | null>(null);
  useEffect(() => {
    if (!opsPolicy) return;
    let cancelled = false;
    getCollectionsByOwner(opsPolicy)
      .then((res) => {
        if (!cancelled) setOpsCollections(res.collections || []);
      })
      .catch(() => {
        if (!cancelled) setOpsCollections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [opsPolicy, reloadKey]);

  // What creating a collection costs the committee, and what it holds: the
  // deposit is burned from the committee's own account, and a proposal the
  // account cannot pay for fails only when it is executed.
  const { config } = useChainConfig();
  const [committeeFunds, setCommitteeFunds] = useState<{ balance: bigint; deposit: bigint | null } | null>(null);
  useEffect(() => {
    if (!opsPolicy) return;
    let cancelled = false;
    Promise.all([
      getBankBalance(opsPolicy, config.denom)
        .then((r) => BigInt(r.balance?.amount ?? "0"))
        .catch(() => null),
      getCollectParams()
        .then((r) => BigInt(String(r.params?.base_collection_deposit ?? "")))
        .catch(() => null),
    ]).then(([balance, deposit]) => {
      if (!cancelled && balance !== null) setCommitteeFunds({ balance, deposit });
    });
    return () => {
      cancelled = true;
    };
  }, [opsPolicy, config.denom, reloadKey]);
  const committeeShort =
    !!committeeFunds && committeeFunds.deposit !== null && committeeFunds.balance < committeeFunds.deposit;

  // Anyone may fund the committee's account: a plain send from the wallet.
  const [fundAmount, setFundAmount] = useState("");
  const fundCommittee = async () => {
    if (!address || !opsPolicy) return;
    await run(
      "fund-committee",
      async () => {
        const micro = sparkToMicro(fundAmount);
        if (micro === null || micro <= BigInt(0)) throw new Error(`Enter an amount of ${config.displayDenom}.`);
        await signAndBroadcast([
          {
            typeUrl: "/cosmos.bank.v1beta1.MsgSend",
            value: {
              fromAddress: address,
              toAddress: opsPolicy,
              amount: [{ denom: config.denom, amount: micro.toString() }],
            },
          },
        ]);
        setFundAmount("");
        reload();
      },
      (raw) => `Could not fund the ${COMMITTEE_NAME}: ${raw}`
    );
  };

  const allowed = policy?.allowed_identities || [];
  const allowAny = allowed.includes(ALL_IDENTITIES);
  const authors = useMemo(() => (current?.items || []).filter(isLinkAuthor), [current]);
  const committeeOwned = !!current?.collection && !!opsPolicy && current.collection.owner === opsPolicy;
  const isCurator =
    !!address &&
    !!current?.collection &&
    (current.collection.owner === address ||
      current.collaborators.some((c) => c.address === address));
  const canProposeAsCommittee = onCommittee === true && !!opsPolicy;

  // ── Policy: which collection curates this peer ──

  const setCuration = async (id: string | null) => {
    if (!address) return;
    if (route.kind !== "direct" && route.kind !== "vote") return;
    if (
      id === null &&
      !confirm(
        route.kind === "direct"
          ? `Stop curating ${peer.id} authors by collection? This takes effect as soon as it is signed: ` +
              "from then on only the allowed-authors list decides who is anchored."
          : `Propose to stop curating ${peer.id} authors by collection? If the vote passes, only the ` +
              "allowed-authors list decides who is anchored."
      )
    ) {
      return;
    }
    await run(
      id === null ? "curation-clear" : `curation-${id}`,
      async () => {
        // Built on the policy as just read. If the read failed there is no
        // base, and submitting the empty default would clear every list.
        if (policyState !== "ok") {
          throw new Error("The current policy could not be read, so it cannot be updated safely. Reload and try again.");
        }
        const base = await policyFromChain(peer.id, policy);
        const msgs = await peerPolicyUpdateMsgs({
          address,
          route: route.kind === "direct" ? { kind: "direct" } : { kind: "vote", policyAddress: route.policyAddress },
          peerId: peer.id,
          policy: {
            ...base,
            curation: id === null ? undefined : { collectionId: BigInt(id) },
          },
          metadata:
            id === null
              ? `Stop curating ${peer.id} authors by collection`
              : `Curate ${peer.id} authors with collection ${id}`,
        });
        await signAndBroadcast(msgs);
        reload();
        onChanged();
      },
      (raw) => `Could not update the curation collection: ${raw}`
    );
  };

  // ── Committee-owned collection: proposals with creator = committee policy ──

  const propose = async (
    key: string,
    build: (policyAddr: string) => Promise<{ typeUrl: string; value: Uint8Array }>,
    metadata: string,
    describe: string
  ) => {
    if (!address) return;
    await run(
      key,
      async () => {
        if (!opsPolicy) throw new Error(`The ${COMMITTEE_NAME} policy address could not be read.`);
        const inner = await build(opsPolicy);
        await signAndBroadcast([committeeProposal(address, opsPolicy, [inner], metadata)]);
        reload();
      },
      (raw) => `${describe}: ${raw}`
    );
  };

  const [newName, setNewName] = useState(`${peer.id} authors`.slice(0, 128));
  const [newDesc, setNewDesc] = useState(
    `Authors whose ${peer.id} posts may be anchored on this chain.`
  );
  const createCollection = () =>
    propose(
      "create-collection",
      async (policyAddr) => {
        const { MsgCreateCollection } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx"
        );
        const { collectionTypeFromJSON, visibilityFromJSON } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/types"
        );
        if (!newName.trim()) throw new Error("Give the collection a name.");
        return {
          typeUrl: CollectMsgTypeUrls.CreateCollection,
          value: MsgCreateCollection.encode(
            MsgCreateCollection.fromPartial({
              creator: policyAddr,
              // Enums as ints: the proto encoder NaN-coerces a string to 0.
              type: collectionTypeFromJSON("COLLECTION_TYPE_LINK"),
              visibility: visibilityFromJSON("VISIBILITY_PUBLIC"),
              name: newName.trim(),
              description: newDesc.trim(),
            })
          ).finish(),
        };
      },
      `Create the ${peer.id} author curation collection`,
      "Could not propose the collection"
    );

  const [newCurator, setNewCurator] = useState("");
  const addCurator = (collectionId: string) =>
    propose(
      "add-curator",
      async (policyAddr) => {
        const { MsgAddCollaborator } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx"
        );
        const { collaboratorRoleFromJSON } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/types"
        );
        const who = newCurator.trim();
        if (!who) throw new Error("Enter the curator's address.");
        return {
          typeUrl: CollectMsgTypeUrls.AddCollaborator,
          value: MsgAddCollaborator.encode(
            MsgAddCollaborator.fromPartial({
              creator: policyAddr,
              collectionId: BigInt(collectionId),
              address: who,
              role: collaboratorRoleFromJSON(CollaboratorRole.EDITOR),
            })
          ).finish(),
        };
      },
      `Add ${newCurator.trim()} as a ${peer.id} author curator`,
      "Could not propose the curator"
    );

  const removeCurator = (collectionId: string, who: string) =>
    propose(
      `remove-curator-${who}`,
      async (policyAddr) => {
        const { MsgRemoveCollaborator } = await import(
          "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx"
        );
        return {
          typeUrl: CollectMsgTypeUrls.RemoveCollaborator,
          value: MsgRemoveCollaborator.encode(
            MsgRemoveCollaborator.fromPartial({
              creator: policyAddr,
              collectionId: BigInt(collectionId),
              address: who,
            })
          ).finish(),
        };
      },
      `Remove ${who} as a ${peer.id} author curator`,
      "Could not propose the removal"
    );

  // ── Authors: link items, added by a curator directly ──

  const [newAuthor, setNewAuthor] = useState("");
  const newAuthorNorm = normalizeAuthorIdentity(newAuthor);
  const alreadyListed =
    !!newAuthorNorm && authors.some((a) => normalizeAuthorIdentity(a.link?.uri || "") === newAuthorNorm);

  // A curator signs as themselves; a committee member who is not one goes
  // through a proposal, where the committee acts as the owner.
  const authorMsgs = async (
    kind: "add" | "remove",
    collectionId: string,
    arg: string
  ): Promise<EncodeObject[]> => {
    const viaCommittee = !isCurator;
    const creator = viaCommittee ? opsPolicy : address!;
    if (kind === "add") {
      const { referenceTypeFromJSON } = await import(
        "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/types"
      );
      // Plain object, as CollectionDetail builds it: fromPartial would add an
      // empty encrypted_data that the direct amino path must not sign.
      const value = {
        creator,
        collectionId: BigInt(collectionId),
        title: `@${newAuthorNorm}`.slice(0, 128),
        description: "",
        imageUri: "",
        referenceType: referenceTypeFromJSON(ReferenceType.LINK),
        link: { uri: arg, contentHash: "", contentType: "" },
      };
      if (!viaCommittee) return [{ typeUrl: CollectMsgTypeUrls.AddItem, value }];
      const { MsgAddItem } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx");
      return [
        committeeProposal(
          address!,
          opsPolicy,
          [{ typeUrl: CollectMsgTypeUrls.AddItem, value: MsgAddItem.encode(MsgAddItem.fromPartial(value)).finish() }],
          `Curate ${arg} for ${peer.id}`
        ),
      ];
    }
    const value = { creator, id: BigInt(arg) };
    if (!viaCommittee) return [{ typeUrl: CollectMsgTypeUrls.RemoveItem, value }];
    const { MsgRemoveItem } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx");
    return [
      committeeProposal(
        address!,
        opsPolicy,
        [{ typeUrl: CollectMsgTypeUrls.RemoveItem, value: MsgRemoveItem.encode(MsgRemoveItem.fromPartial(value)).finish() }],
        `Stop curating item ${arg} for ${peer.id}`
      ),
    ];
  };

  const addAuthor = async (collectionId: string) => {
    if (!address) return;
    const uri = newAuthor.trim();
    if (!newAuthorNorm) {
      setError(`"${uri}" is not an author identity. Write @user@host, https://host/@user or https://host/users/user.`);
      return;
    }
    await run(
      "add-author",
      async () => {
        await signAndBroadcast(await authorMsgs("add", collectionId, uri));
        setNewAuthor("");
        reload();
      },
      (raw) => `Could not add ${uri}: ${raw}`
    );
  };

  const removeAuthor = async (collectionId: string, item: CollectionItem) => {
    if (!address) return;
    await run(
      `remove-author-${item.id}`,
      async () => {
        await signAndBroadcast(await authorMsgs("remove", collectionId, item.id ?? "0"));
        reload();
      },
      (raw) => `Could not remove ${item.link?.uri}: ${raw}`
    );
  };

  const inputClass =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";
  const canSetPolicy = route.kind === "direct" || route.kind === "vote";
  const policyVerb = route.kind === "direct" ? "" : " (opens a vote)";

  return (
    <div className="sd-hull-tile space-y-4 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          Author curation · {peer.display_name || peer.id}
        </h3>
        <button type="button" onClick={onClose} className="sd-btn sd-btn-secondary">
          Close
        </button>
      </div>

      <ActionBanner message={error} onDismiss={clearError} />

      <p className="text-xs text-zinc-500">
        A bridged post is anchored only when its author passes both gates:
        the allowed-authors list on the peer policy, and, when one is set,
        the curation collection. A blocked identity is refused either way.
      </p>

      {policyState === "error" && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-400">
          Could not read this peer&apos;s policy from the node.
        </div>
      )}

      {/* Gate 1 */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm text-zinc-400">Allowed authors</span>
          <button type="button" onClick={onEditPolicy} className="text-xs text-indigo-400 hover:underline">
            Edit in policy
          </button>
        </div>
        {policyState === "loading" ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : allowAny ? (
          <p className="text-sm text-zinc-300">
            Any author (<span className="font-mono">*</span>)
            {collId !== null ? ": the collection alone decides." : "."}
          </p>
        ) : allowed.length === 0 ? (
          <p className="text-sm text-amber-400">
            Nobody. No post from this peer is anchored until the policy lists
            authors or allows any author.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {allowed.map((a) => (
              <li
                key={a}
                className="rounded border border-zinc-700 bg-zinc-800/40 px-2 py-0.5 font-mono text-xs text-zinc-300"
              >
                {normalizeAuthorIdentity(a) ?? a}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Gate 2 */}
      <div className="space-y-3">
        <span className="block text-sm text-zinc-400">Curation collection</span>

        {collId === null && policyState === "ok" && (
          <>
            <p className="text-sm text-zinc-300">
              None. The allowed-authors list alone decides.
            </p>
            {opsCollections && opsCollections.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-zinc-500">
                  Collections the {COMMITTEE_NAME} owns:
                </p>
                {opsCollections.map((c) => {
                  const id = c.id ?? "0";
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-sm"
                    >
                      <span className="text-zinc-300">
                        #{id} {c.name}{" "}
                        <span className="text-xs text-zinc-500">
                          · {COLLECTION_STATUS_LABELS[c.status] || c.status} · {c.item_count ?? 0} items
                        </span>
                      </span>
                      {canSetPolicy && (
                        <button
                          type="button"
                          disabled={busy || c.status !== CollectionStatus.ACTIVE}
                          onClick={() => setCuration(id)}
                          className="sd-btn sd-btn-secondary text-xs disabled:opacity-50"
                        >
                          {pending === `curation-${id}` ? "Submitting…" : `Use for this peer${policyVerb}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {canProposeAsCommittee ? (
              <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
                <p className="text-sm text-zinc-300">Create a curation collection</p>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={128}
                  placeholder="Name"
                  className={inputClass}
                  aria-label="Collection name"
                />
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Description"
                  className={inputClass}
                  aria-label="Collection description"
                />
                <p className="text-xs text-zinc-500">
                  Opens a {COMMITTEE_NAME} vote. Once it passes and is
                  executed the committee owns a public link collection, active
                  and permanent. Its deposit is burned from the committee&apos;s
                  own account. Then set it here as this peer&apos;s curation
                  collection.
                </p>
                {committeeFunds && (
                  <p className={`text-xs ${committeeShort ? "text-amber-400" : "text-zinc-500"}`}>
                    The committee&apos;s account holds {formatSpark(committeeFunds.balance)} {config.displayDenom}
                    {committeeFunds.deposit !== null &&
                      `; a collection's deposit is ${formatSpark(committeeFunds.deposit)} ${config.displayDenom}`}
                    .
                    {committeeShort &&
                      " That is not enough: fund it below first, or the proposal will fail when it is executed."}
                  </p>
                )}
                {address && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={fundAmount}
                      onChange={(e) => setFundAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder={`${config.displayDenom} to send`}
                      className={`${inputClass} max-w-[12rem]`}
                      aria-label={`${config.displayDenom} to send to the ${COMMITTEE_NAME}`}
                    />
                    <button
                      type="button"
                      disabled={busy || !fundAmount.trim()}
                      onClick={fundCommittee}
                      className="sd-btn sd-btn-secondary text-xs disabled:opacity-50"
                    >
                      {pending === "fund-committee" ? "Sending…" : "Fund the committee"}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy || !newName.trim()}
                  onClick={createCollection}
                  className="sd-btn sd-btn-primary disabled:opacity-50"
                >
                  {pending === "create-collection" ? "Submitting…" : "Propose collection"}
                </button>
              </div>
            ) : (
              address && (
                <p className="text-xs text-zinc-500">
                  {COMMITTEE_NAME} members can propose a curation collection
                  here.
                </p>
              )
            )}
          </>
        )}

        {collId !== null && (
          <>
            {!current ? (
              <p className="text-xs text-zinc-500">Loading collection {collId}…</p>
            ) : !current.collection ? (
              <p className="text-sm text-amber-400">
                Collection {collId} was not found. While the policy names a
                missing or inactive collection, no author from this peer is
                anchored.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-zinc-200">
                  #{collId} {current.collection.name || "(unnamed)"}
                </span>
                <span
                  className={`text-xs ${
                    current.collection.status === CollectionStatus.ACTIVE ? "text-zinc-500" : "text-amber-400"
                  }`}
                >
                  {COLLECTION_STATUS_LABELS[current.collection.status] || current.collection.status}
                  {current.collection.status !== CollectionStatus.ACTIVE &&
                    " -- an inactive collection admits nobody"}
                </span>
                <span className="text-xs text-zinc-500">
                  owner{" "}
                  {committeeOwned ? (
                    COMMITTEE_NAME
                  ) : (
                    <CopyableAddress address={current.collection.owner} />
                  )}
                </span>
              </div>
            )}
            {canSetPolicy && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setCuration(null)}
                className="sd-btn sd-btn-secondary text-xs disabled:opacity-50"
              >
                {pending === "curation-clear" ? "Submitting…" : `Stop using this collection${policyVerb}`}
              </button>
            )}

            {current?.collection && (
              <>
                {/* Curators */}
                <div>
                  <span className="mb-1 block text-sm text-zinc-400">Curators</span>
                  {current.collaborators.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No curators yet{committeeOwned ? "; the committee alone can change the list, by proposal." : "."}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {current.collaborators.map((c) => (
                        <li key={c.address} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            <CopyableAddress address={c.address} />
                            <span className="text-xs text-zinc-500">
                              {COLLABORATOR_ROLE_LABELS[c.role] || c.role}
                            </span>
                          </span>
                          {committeeOwned && canProposeAsCommittee && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => removeCurator(collId, c.address)}
                              className="text-xs text-red-400 hover:underline disabled:opacity-50"
                            >
                              {pending === `remove-curator-${c.address}` ? "Submitting…" : "Propose removal"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {committeeOwned && canProposeAsCommittee && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={newCurator}
                        onChange={(e) => setNewCurator(e.target.value)}
                        placeholder="Member address to add as a curator"
                        className={`${inputClass} font-mono`}
                        aria-label="Curator address"
                      />
                      <button
                        type="button"
                        disabled={busy || !newCurator.trim()}
                        onClick={() => addCurator(collId)}
                        className="sd-btn sd-btn-secondary whitespace-nowrap disabled:opacity-50"
                      >
                        {pending === "add-curator" ? "Submitting…" : "Propose curator"}
                      </button>
                    </div>
                  )}
                  {!committeeOwned && (
                    <p className="mt-1 text-xs text-zinc-500">
                      This collection is not owned by the {COMMITTEE_NAME}, so
                      its owner manages curators from the collection itself.
                    </p>
                  )}
                </div>

                {/* Authors */}
                <div>
                  <span className="mb-1 block text-sm text-zinc-400">
                    Authors ({authors.length})
                  </span>
                  {authors.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No authors yet: this gate admits nobody.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {authors.map((it) => {
                        const uri = it.link?.uri || "";
                        const norm = normalizeAuthorIdentity(uri);
                        return (
                          <li key={it.id ?? "0"} className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate font-mono text-xs">
                              {norm ? (
                                <span className="text-zinc-300">{norm}</span>
                              ) : (
                                <span className="text-amber-400" title="Not an author identity; the chain ignores this item">
                                  {uri} (not an author)
                                </span>
                              )}
                              {norm && uri !== norm && uri !== `@${norm}` && (
                                <span className="text-zinc-600"> · {uri}</span>
                              )}
                            </span>
                            {(isCurator || (committeeOwned && canProposeAsCommittee)) && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => removeAuthor(collId, it)}
                                className="shrink-0 text-xs text-red-400 hover:underline disabled:opacity-50"
                              >
                                {pending === `remove-author-${it.id}`
                                  ? "Submitting…"
                                  : isCurator
                                  ? "Remove"
                                  : "Propose removal"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(isCurator || (committeeOwned && canProposeAsCommittee)) && (
                    <div className="mt-2 space-y-1">
                      <div className="flex gap-2">
                        <input
                          value={newAuthor}
                          onChange={(e) => setNewAuthor(e.target.value)}
                          placeholder="@phoenix@aurora.example or https://aurora.example/@phoenix"
                          className={`${inputClass} font-mono`}
                          aria-label="Author handle or profile URL"
                        />
                        <button
                          type="button"
                          disabled={busy || !newAuthorNorm || alreadyListed}
                          onClick={() => addAuthor(collId)}
                          className="sd-btn sd-btn-secondary whitespace-nowrap disabled:opacity-50"
                        >
                          {pending === "add-author" ? "Submitting…" : isCurator ? "Add author" : "Propose author"}
                        </button>
                      </div>
                      <p className={`text-xs ${newAuthor.trim() && !newAuthorNorm ? "text-amber-400" : "text-zinc-500"}`}>
                        {!newAuthor.trim()
                          ? isCurator
                            ? "You curate this collection, so you add authors directly. Each item costs the per-item deposit."
                            : "You are not a curator of this collection, so this opens a committee vote."
                          : !newAuthorNorm
                          ? "Not an author identity. Write @user@host, https://host/@user or https://host/users/user."
                          : alreadyListed
                          ? `${newAuthorNorm} is already listed.`
                          : `Admits ${newAuthorNorm}.`}
                      </p>
                    </div>
                  )}
                  {!allowAny && authors.length > 0 && (
                    <p className="mt-1 text-xs text-amber-400">
                      The allowed-authors list is not open, so a curated author
                      must also be listed there. Allow any author in the policy
                      to let this collection decide alone.
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {(route.kind === "direct" || (preferVote && route.kind === "vote")) && (
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={preferVote}
            onChange={(e) => setPreferVote(e.target.checked)}
            className="accent-zinc-500"
          />
          Open a vote for policy changes instead of signing directly
        </label>
      )}
      {address && (route.kind === "blocked" || (route.kind === "vote" && !route.isMemberOfBody)) && (
        <p className="text-xs text-zinc-500">
          Changing the policy or the collection&apos;s curators takes a{" "}
          {COMMITTEE_NAME} member.
        </p>
      )}
      {!address && (
        <p className="text-xs text-zinc-500">Connect your wallet to curate.</p>
      )}
    </div>
  );
}
