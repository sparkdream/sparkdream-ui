"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import {
  getCollection,
  listCollectionItems,
  getCollaborators,
  getCurationSummary,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useTrustRank } from "@/hooks/useTrustRank";
import { CollectMsgTypeUrls } from "@/lib/tx";
import { timeAgo, formatTime } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import type {
  Collection,
  CollectionItem,
  Collaborator,
  CurationSummary,
} from "@/types/collect";
import { referenceTypeFromJSON, collaboratorRoleFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/types";
import {
  COLLECTION_TYPE_LABELS,
  COLLECTION_STATUS_LABELS,
  VISIBILITY_LABELS,
  REFERENCE_TYPE_LABELS,
  COLLABORATOR_ROLE_LABELS,
  CollaboratorRole,
  ReferenceType,
  CollectionStatus,
} from "@/types/collect";

interface CollectionDetailProps {
  collectionId: string;
  onBack: () => void;
}

function formatDeposit(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

function linkHostname(uri: string): string | null {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function CollectionDetail({ collectionId, onBack }: CollectionDetailProps) {
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const cannotUpvote = address ? isMember === false : false;
  const rank = useTrustRank(address);
  // Default trust gates (chain enforces the real param). Pin: collect
  // pin_min_trust_level default ESTABLISHED. Make permanent:
  // make_permanent_min_trust_level default PROVISIONAL.
  const canPin = rank !== null && rank >= 2;
  const canMakePermanent = rank !== null && rank >= 1;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [curation, setCuration] = useState<CurationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"items" | "collaborators" | "curation">("items");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Add item form
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemImageUri, setNewItemImageUri] = useState("");
  const [newItemRefType, setNewItemRefType] = useState<string>(ReferenceType.LINK);
  const [newItemLinkUri, setNewItemLinkUri] = useState("");
  // NFT reference
  const [newItemNftChainId, setNewItemNftChainId] = useState("");
  const [newItemNftContract, setNewItemNftContract] = useState("");
  const [newItemNftTokenId, setNewItemNftTokenId] = useState("");
  const [newItemNftStandard, setNewItemNftStandard] = useState("");
  const [newItemNftTokenUri, setNewItemNftTokenUri] = useState("");
  // On-chain reference
  const [newItemOnChainModule, setNewItemOnChainModule] = useState("");
  const [newItemOnChainEntityType, setNewItemOnChainEntityType] = useState("");
  const [newItemOnChainEntityId, setNewItemOnChainEntityId] = useState("");
  // Custom reference
  const [newItemCustomLabel, setNewItemCustomLabel] = useState("");
  const [newItemCustomValue, setNewItemCustomValue] = useState("");

  // Add collaborator form
  const [showAddCollab, setShowAddCollab] = useState(false);
  const [newCollabAddress, setNewCollabAddress] = useState("");
  const [newCollabRole, setNewCollabRole] = useState<string>(CollaboratorRole.EDITOR);

  const refFieldCls =
    "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none";

  const isOwner = collection?.owner === address;
  const isEphemeral = Boolean(collection?.expires_at && collection.expires_at !== "0");
  const isCollectionActive = collection?.status === CollectionStatus.ACTIVE;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [colRes, itemsRes, collabRes] = await Promise.all([
        getCollection(collectionId),
        listCollectionItems(collectionId, { limit: "50" }),
        getCollaborators(collectionId).catch(() => ({ collaborators: [] })),
      ]);
      setCollection(colRes.collection);
      setItems(itemsRes.items || []);
      setCollaborators(collabRes.collaborators || []);

      getCurationSummary(collectionId)
        .then((r) => setCuration(r.summary))
        .catch(() => setCuration(null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection");
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // The chain requires the reference object matching the selected type to be
  // present (ErrInvalidReference / "reference type/data mismatch" otherwise),
  // so we require each type's identifying fields before allowing submit.
  const isRefReady = () => {
    switch (newItemRefType) {
      case ReferenceType.LINK:
        return newItemLinkUri.trim() !== "";
      case ReferenceType.NFT:
        return (
          newItemNftChainId.trim() !== "" &&
          newItemNftContract.trim() !== "" &&
          newItemNftTokenId.trim() !== ""
        );
      case ReferenceType.ON_CHAIN:
        return (
          newItemOnChainModule.trim() !== "" &&
          newItemOnChainEntityType.trim() !== "" &&
          newItemOnChainEntityId.trim() !== ""
        );
      case ReferenceType.CUSTOM:
        return newItemCustomLabel.trim() !== "" && newItemCustomValue.trim() !== "";
      default:
        return false;
    }
  };

  const resetItemForm = () => {
    setNewItemTitle("");
    setNewItemDesc("");
    setNewItemImageUri("");
    setNewItemRefType(ReferenceType.LINK);
    setNewItemLinkUri("");
    setNewItemNftChainId("");
    setNewItemNftContract("");
    setNewItemNftTokenId("");
    setNewItemNftStandard("");
    setNewItemNftTokenUri("");
    setNewItemOnChainModule("");
    setNewItemOnChainEntityType("");
    setNewItemOnChainEntityId("");
    setNewItemCustomLabel("");
    setNewItemCustomValue("");
  };

  const handleAddItem = async () => {
    if (!address || !newItemTitle.trim() || !isRefReady()) return;
    setActionLoading("add-item");
    try {
      const value: Record<string, unknown> = {
        creator: address,
        // collection_id is uint64; pass BigInt so sparkdreamjs's amino
        // override `!== BigInt(0)` survives strict equality. String values
        // happen to fail-open the check (any non-zero string is unequal to
        // BigInt(0)), but for robustness we normalize at the call site.
        collectionId: BigInt(collectionId),
        title: newItemTitle.trim(),
        description: newItemDesc.trim(),
        imageUri: newItemImageUri.trim(),
        // ReferenceType is a proto3 int32 enum; the form holds the enum-string
        // key (e.g. "REFERENCE_TYPE_LINK") for the <select>. Convert to int
        // before broadcast so the proto encoder doesn't NaN-coerce it to 0
        // and amino sigverify doesn't fail on the string vs reconstructed
        // int mismatch (same pattern as ProjectList.tsx).
        referenceType: referenceTypeFromJSON(newItemRefType),
      };
      // Attach the reference payload matching the selected type. The proto
      // message fields are camelCase in the generated registry (nft, link,
      // onChain, custom); empty optional strings are dropped by amino
      // omitempty on both signer and verifier, so they stay sigverify-safe.
      switch (newItemRefType) {
        case ReferenceType.LINK:
          value.link = { uri: newItemLinkUri.trim(), contentHash: "", contentType: "" };
          break;
        case ReferenceType.NFT:
          value.nft = {
            chainId: newItemNftChainId.trim(),
            contractAddress: newItemNftContract.trim(),
            tokenId: newItemNftTokenId.trim(),
            tokenStandard: newItemNftStandard.trim(),
            tokenUri: newItemNftTokenUri.trim(),
          };
          break;
        case ReferenceType.ON_CHAIN:
          value.onChain = {
            module: newItemOnChainModule.trim(),
            entityType: newItemOnChainEntityType.trim(),
            entityId: newItemOnChainEntityId.trim(),
          };
          break;
        case ReferenceType.CUSTOM:
          value.custom = {
            typeLabel: newItemCustomLabel.trim(),
            value: newItemCustomValue.trim(),
            extra: [],
          };
          break;
      }
      await signAndBroadcast([{ typeUrl: CollectMsgTypeUrls.AddItem, value }]);
      resetItemForm();
      setShowAddItem(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!address) return;
    setActionLoading(`remove-${itemId}`);
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.RemoveItem,
        // item id is uint64; same Number-vs-BigInt normalization rationale
        // as the other uint64 ids in this file — see handleAddItem above.
        value: { creator: address, id: BigInt(itemId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove item");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddCollaborator = async () => {
    if (!address || !newCollabAddress.trim()) return;
    setActionLoading("add-collab");
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.AddCollaborator,
        value: {
          creator: address,
          collectionId: BigInt(collectionId),
          address: newCollabAddress.trim(),
          // Same int32-enum-as-string fix as referenceType above.
          role: collaboratorRoleFromJSON(newCollabRole),
        },
      }]);
      setNewCollabAddress("");
      setShowAddCollab(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add collaborator");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveCollaborator = async (collabAddress: string) => {
    if (!address) return;
    setActionLoading(`remove-collab-${collabAddress}`);
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.RemoveCollaborator,
        value: { creator: address, collectionId: BigInt(collectionId), address: collabAddress },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove collaborator");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpvote = async () => {
    if (!address) return;
    setActionLoading("upvote");
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.UpvoteContent,
        // target_id is uint64; pass BigInt. target_type is int32 enum (1 =
        // COLLECTION) — Number stays a Number, the override uses `=== 0`.
        value: { creator: address, targetId: BigInt(collectionId), targetType: 1 },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to upvote");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteCollection = async () => {
    if (!address || !confirm("Delete this collection? This cannot be undone.")) return;
    setActionLoading("delete");
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.DeleteCollection,
        value: { creator: address, id: BigInt(collectionId) },
      }]);
      onBack();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete collection");
    } finally {
      setActionLoading(null);
    }
  };

  // Pin/Unpin are display-only "feature" markers requiring a permanent
  // collection; the chain rejects pinning an ephemeral one (ErrCannotPinEphemeral).
  const handlePin = async (pin: boolean) => {
    if (!address) return;
    setActionLoading("pin");
    try {
      await signAndBroadcast([{
        typeUrl: pin ? CollectMsgTypeUrls.PinCollection : CollectMsgTypeUrls.UnpinCollection,
        value: { creator: address, collectionId: BigInt(collectionId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : pin ? "Failed to pin" : "Failed to unpin");
    } finally {
      setActionLoading(null);
    }
  };

  // Promote an ephemeral collection to permanent (burns the deposit). Separate
  // lifecycle action from pinning, on the lower make_permanent_min_trust_level.
  const handleMakePermanent = async () => {
    if (!address || !confirm("Make this collection permanent? Its deposit is burned and it will no longer expire.")) return;
    setActionLoading("permanent");
    try {
      await signAndBroadcast([{
        typeUrl: CollectMsgTypeUrls.MakeCollectionPermanent,
        value: { creator: address, collectionId: BigInt(collectionId) },
      }]);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to make permanent");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="h-32 animate-pulse sd-hull-tile rounded-xl" />
        <div className="h-48 animate-pulse sd-hull-tile rounded-xl" />
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div>
        <button onClick={onBack} className="mb-4 text-sm text-zinc-400 hover:text-zinc-200">
          &larr; Back
        </button>
        <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error || "Collection not found"}
          <button onClick={fetchData} className="ml-2 underline hover:text-red-300">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Back button */}
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {/* Collection header */}
      <div className="sd-hull-tile rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-white">{collection.name || `Collection #${collection.id}`}</h2>
            {collection.description && (
              <p className="mt-1 text-sm text-zinc-400">{collection.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleUpvote}
              disabled={actionLoading === "upvote" || cannotUpvote}
              title={cannotUpvote ? "Only existing members can upvote" : undefined}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-emerald-400 disabled:opacity-50"
            >
              {actionLoading === "upvote" ? "..." : `+${collection.upvote_count || 0}`}
            </button>
            {isCollectionActive && isEphemeral && (
              <button
                onClick={handleMakePermanent}
                disabled={actionLoading === "permanent" || !canMakePermanent}
                title={canMakePermanent ? "Preserve this collection so it no longer expires (burns its deposit)" : "Requires Provisional trust level or higher"}
                className="rounded-lg border border-emerald-700/50 px-3 py-1.5 text-xs text-emerald-400 transition-colors hover:bg-emerald-900/20 disabled:opacity-50"
              >
                {actionLoading === "permanent" ? "..." : "Make permanent"}
              </button>
            )}
            {isCollectionActive && !isEphemeral && !collection.pinned && (
              <button
                onClick={() => handlePin(true)}
                disabled={actionLoading === "pin" || !canPin}
                title={canPin ? "Feature this collection" : "Pinning requires Established trust level or higher"}
                className="rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs text-amber-400 transition-colors hover:bg-amber-900/20 disabled:opacity-50"
              >
                {actionLoading === "pin" ? "..." : "Pin"}
              </button>
            )}
            {isCollectionActive && !isEphemeral && collection.pinned && (
              <button
                onClick={() => handlePin(false)}
                disabled={actionLoading === "pin" || !canPin}
                title={canPin ? undefined : "Unpinning requires Established trust level or higher"}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
              >
                {actionLoading === "pin" ? "..." : "Unpin"}
              </button>
            )}
            {isOwner && (
              <button
                onClick={handleDeleteCollection}
                disabled={actionLoading === "delete"}
                className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 hover:bg-red-900/20 disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-zinc-500">Type</dt>
            <dd className="text-zinc-300">{COLLECTION_TYPE_LABELS[collection.type] || collection.type}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Visibility</dt>
            <dd className="text-zinc-300">{VISIBILITY_LABELS[collection.visibility] || collection.visibility}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Status</dt>
            <dd className="text-zinc-300">
              {COLLECTION_STATUS_LABELS[collection.status] || collection.status}
              {collection.pinned && <span className="ml-1.5 text-amber-400">· Pinned</span>}
              {isEphemeral && <span className="ml-1.5 text-yellow-500">· Ephemeral</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Items</dt>
            <dd className="text-zinc-300">{collection.item_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Owner</dt>
            <dd className="font-mono text-xs text-zinc-300"><CopyableAddress address={collection.owner} /></dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Deposit</dt>
            <dd className="text-zinc-300">{formatDeposit(collection.deposit_amount)}</dd>
          </div>
          {collection.created_at && (
            <div>
              <dt className="text-xs text-zinc-500">Created</dt>
              <dd className="text-zinc-300">{formatTime(collection.created_at)}</dd>
            </div>
          )}
          {collection.sponsored_by && (
            <div>
              <dt className="text-xs text-zinc-500">Sponsor</dt>
              <dd className="font-mono text-xs text-zinc-300"><CopyableAddress address={collection.sponsored_by} /></dd>
            </div>
          )}
        </dl>

        {collection.tags?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {collection.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">{tag}</span>
            ))}
          </div>
        )}

        {curation && (curation.up_count > 0 || curation.down_count > 0) && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <p className="text-xs font-medium text-zinc-500">Curation</p>
            <div className="mt-1 flex items-center gap-4 text-xs">
              <span className="text-emerald-400">{curation.up_count} up</span>
              <span className="text-red-400">{curation.down_count} down</span>
              {curation.top_tags?.length > 0 && (
                <span className="text-zinc-500">
                  Tags: {curation.top_tags.map((t) => t.tag).join(", ")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-zinc-800">
        {(["items", "collaborators", "curation"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors ${
              tab === t
                ? "border-b-2 border-indigo-500 text-indigo-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
            {t === "items" && ` (${items.length})`}
            {t === "collaborators" && ` (${collaborators.length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {/* Items tab */}
        {tab === "items" && (
          <div>
            {isOwner && (
              <div className="mb-4">
                {!showAddItem ? (
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="sd-btn-crystal px-4 py-2"
                  >
                    Add item
                  </button>
                ) : (
                  <div className="sd-hull-tile rounded-xl p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">Add item</h3>
                      <button
                        type="button"
                        onClick={() => {
                          resetItemForm();
                          setShowAddItem(false);
                        }}
                        className="sd-btn sd-btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-3">
                      <input
                        value={newItemTitle}
                        onChange={(e) => setNewItemTitle(e.target.value)}
                        placeholder="Title"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                      />
                      <textarea
                        value={newItemDesc}
                        onChange={(e) => setNewItemDesc(e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                      />
                      <input
                        value={newItemImageUri}
                        onChange={(e) => setNewItemImageUri(e.target.value)}
                        placeholder="Image URI (optional)"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                      />
                      <div className="space-y-3">
                        <select
                          value={newItemRefType}
                          onChange={(e) => setNewItemRefType(e.target.value)}
                          className="sd-select"
                        >
                          <option value={ReferenceType.LINK}>Link</option>
                          <option value={ReferenceType.NFT}>NFT</option>
                          <option value={ReferenceType.ON_CHAIN}>Onchain</option>
                          <option value={ReferenceType.CUSTOM}>Custom</option>
                        </select>
                        {newItemRefType === ReferenceType.LINK && (
                          <input
                            value={newItemLinkUri}
                            onChange={(e) => setNewItemLinkUri(e.target.value)}
                            placeholder="Link URL"
                            className={refFieldCls}
                          />
                        )}
                        {newItemRefType === ReferenceType.NFT && (
                          <>
                            <input
                              value={newItemNftChainId}
                              onChange={(e) => setNewItemNftChainId(e.target.value)}
                              placeholder="Chain ID (e.g. eip155:1)"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemNftContract}
                              onChange={(e) => setNewItemNftContract(e.target.value)}
                              placeholder="Contract address"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemNftTokenId}
                              onChange={(e) => setNewItemNftTokenId(e.target.value)}
                              placeholder="Token ID"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemNftStandard}
                              onChange={(e) => setNewItemNftStandard(e.target.value)}
                              placeholder="Token standard (optional, e.g. ERC721)"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemNftTokenUri}
                              onChange={(e) => setNewItemNftTokenUri(e.target.value)}
                              placeholder="Token URI (optional)"
                              className={refFieldCls}
                            />
                          </>
                        )}
                        {newItemRefType === ReferenceType.ON_CHAIN && (
                          <>
                            <input
                              value={newItemOnChainModule}
                              onChange={(e) => setNewItemOnChainModule(e.target.value)}
                              placeholder="Module (e.g. blog)"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemOnChainEntityType}
                              onChange={(e) => setNewItemOnChainEntityType(e.target.value)}
                              placeholder="Entity type (e.g. post)"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemOnChainEntityId}
                              onChange={(e) => setNewItemOnChainEntityId(e.target.value)}
                              placeholder="Entity ID"
                              className={refFieldCls}
                            />
                          </>
                        )}
                        {newItemRefType === ReferenceType.CUSTOM && (
                          <>
                            <input
                              value={newItemCustomLabel}
                              onChange={(e) => setNewItemCustomLabel(e.target.value)}
                              placeholder="Type label"
                              className={refFieldCls}
                            />
                            <input
                              value={newItemCustomValue}
                              onChange={(e) => setNewItemCustomValue(e.target.value)}
                              placeholder="Value"
                              className={refFieldCls}
                            />
                          </>
                        )}
                      </div>
                      <button
                        onClick={handleAddItem}
                        disabled={!newItemTitle.trim() || !isRefReady() || actionLoading === "add-item"}
                        className="sd-btn-crystal w-full px-4 py-2.5"
                      >
                        {actionLoading === "add-item" ? "Adding..." : "Add"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {items.length === 0 ? (
              <div className="sd-hull-tile rounded-xl p-8 text-center">
                <p className="text-zinc-400">No items in this collection</p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="sd-hull-tile rounded-xl">
                    <button
                      onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {item.image_uri && (
                          <div className="relative h-10 w-10 shrink-0 rounded-lg bg-zinc-800 overflow-hidden">
                            {/* `unoptimized` skips Next's image optimizer (which would */}
                            {/* require allow-listing every remote host the collection */}
                            {/* item URI might come from in next.config.js). */}
                            <Image
                              src={item.image_uri}
                              alt=""
                              fill
                              sizes="40px"
                              unoptimized
                              className="object-cover"
                            />
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-medium text-zinc-200">{item.title || `Item #${item.id}`}</span>
                          {item.description && (
                            <span className="block truncate text-xs text-zinc-500">{item.description}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.reference_type === ReferenceType.LINK && item.link?.uri && linkHostname(item.link.uri) && (
                          <span className="hidden sm:inline rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-indigo-400">
                            {linkHostname(item.link.uri)}
                          </span>
                        )}
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                          {REFERENCE_TYPE_LABELS[item.reference_type] || item.reference_type}
                        </span>
                        <svg
                          className={`h-4 w-4 text-zinc-500 transition-transform ${expandedItem === item.id ? "rotate-180" : ""}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {expandedItem === item.id && (
                      <div className="border-t border-zinc-800 px-4 py-3">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                          <div>
                            <dt className="text-xs text-zinc-500">Added by</dt>
                            <dd className="font-mono text-xs text-zinc-300"><CopyableAddress address={item.added_by} /></dd>
                          </div>
                          {item.added_at && (
                            <div>
                              <dt className="text-xs text-zinc-500">Added</dt>
                              <dd className="text-zinc-300">{timeAgo(item.added_at)}</dd>
                            </div>
                          )}
                          <div>
                            <dt className="text-xs text-zinc-500">Position</dt>
                            <dd className="text-zinc-300">{item.position}</dd>
                          </div>
                          {item.link?.uri && (
                            <div className="col-span-2">
                              <dt className="text-xs text-zinc-500">Link</dt>
                              <dd className="truncate text-xs">
                                <a
                                  href={item.link.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-indigo-400 hover:text-indigo-300 hover:underline"
                                >
                                  {item.link.uri}
                                </a>
                              </dd>
                            </div>
                          )}
                        </dl>
                        {item.attributes?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.attributes.map((attr, i) => (
                              <span key={i} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                                {attr.key}: {attr.value}
                              </span>
                            ))}
                          </div>
                        )}
                        {isOwner && (
                          <div className="mt-3 border-t border-zinc-800 pt-3">
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              disabled={actionLoading === `remove-${item.id}`}
                              className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 hover:bg-red-900/20 disabled:opacity-50"
                            >
                              {actionLoading === `remove-${item.id}` ? "Removing..." : "Remove item"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Collaborators tab */}
        {tab === "collaborators" && (
          <div>
            {isOwner && (
              <div className="mb-4">
                {!showAddCollab ? (
                  <button
                    onClick={() => setShowAddCollab(true)}
                    className="sd-btn-crystal px-4 py-2"
                  >
                    Add collaborator
                  </button>
                ) : (
                  <div className="sd-hull-tile rounded-xl p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">Add collaborator</h3>
                      <button
                        type="button"
                        onClick={() => setShowAddCollab(false)}
                        className="sd-btn sd-btn-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="space-y-3">
                      <input
                        value={newCollabAddress}
                        onChange={(e) => setNewCollabAddress(e.target.value)}
                        placeholder="Address (sprkdrm1...)"
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                      />
                      <select
                        value={newCollabRole}
                        onChange={(e) => setNewCollabRole(e.target.value)}
                        className="sd-select"
                      >
                        <option value={CollaboratorRole.EDITOR}>Editor</option>
                        <option value={CollaboratorRole.ADMIN}>Admin</option>
                      </select>
                      <button
                        onClick={handleAddCollaborator}
                        disabled={!newCollabAddress.trim() || actionLoading === "add-collab"}
                        className="sd-btn-crystal w-full px-4 py-2.5"
                      >
                        {actionLoading === "add-collab" ? "Adding..." : "Add"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {collaborators.length === 0 ? (
              <div className="sd-hull-tile rounded-xl p-8 text-center">
                <p className="text-zinc-400">No collaborators</p>
              </div>
            ) : (
              <div className="space-y-2">
                {collaborators.map((c) => (
                  <div key={c.address} className="flex items-center justify-between sd-hull-tile rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CopyableAddress className="font-mono text-sm text-zinc-300" address={c.address} />
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.role === CollaboratorRole.ADMIN ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400"
                      }`}>
                        {COLLABORATOR_ROLE_LABELS[c.role] || c.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {c.added_at && <span className="text-xs text-zinc-500">{timeAgo(c.added_at)}</span>}
                      {isOwner && (
                        <button
                          onClick={() => handleRemoveCollaborator(c.address)}
                          disabled={actionLoading === `remove-collab-${c.address}`}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          {actionLoading === `remove-collab-${c.address}` ? "..." : "Remove"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Curation tab */}
        {tab === "curation" && (
          <div>
            {curation ? (
              <div className="sd-hull-tile rounded-xl p-5">
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-zinc-500">Up reviews</p>
                    <p className="text-lg font-semibold text-emerald-400">{curation.up_count}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Down reviews</p>
                    <p className="text-lg font-semibold text-red-400">{curation.down_count}</p>
                  </div>
                  {curation.last_reviewed_at && (
                    <div>
                      <p className="text-xs text-zinc-500">Last review</p>
                      <p className="text-zinc-300">{timeAgo(curation.last_reviewed_at)}</p>
                    </div>
                  )}
                </div>
                {curation.top_tags?.length > 0 && (
                  <div className="mt-3 border-t border-zinc-800 pt-3">
                    <p className="text-xs font-medium text-zinc-500">Top tags</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {curation.top_tags.map((t) => (
                        <span key={t.tag} className="rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs text-indigo-400">
                          {t.tag}: {t.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="sd-hull-tile rounded-xl p-8 text-center">
                <p className="text-zinc-400">No curation data yet</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
