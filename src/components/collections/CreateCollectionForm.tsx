"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { CollectMsgTypeUrls } from "@/lib/tx";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import { CollectionType, CollectionVisibility } from "@/types/collect";
import { collectionTypeFromJSON, visibilityFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/types";
import TagPicker from "@/components/contribute/TagPicker";

interface CreateCollectionFormProps {
  onCreated: () => void;
  onCancel?: () => void;
}

export default function CreateCollectionForm({ onCreated, onCancel }: CreateCollectionFormProps) {
  const { address, signAndBroadcast } = useWallet();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverUri, setCoverUri] = useState("");
  const [collectionType, setCollectionType] = useState<string>(CollectionType.MIXED);
  const [visibility, setVisibility] = useState<string>(CollectionVisibility.PUBLIC);
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const canCreateTags = useCanCreateTags(address);
  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !name.trim()) return;

    setLoading(true);
    try {
      // x/collect rejects MsgCreateCollection with ErrTagNotFound for any tag
      // not in the x/rep registry, so prepend MsgCreateTag for everything the
      // user typed that doesn't already exist — same pattern as ProjectList /
      // InitiativeList / CreatePostForm.
      const tagMsgs = buildCreateTagMsgs(address, tags, availableTags);
      await signAndBroadcast([
        ...tagMsgs,
        {
          typeUrl: CollectMsgTypeUrls.CreateCollection,
          value: {
            creator: address,
            name: name.trim(),
            description: description.trim(),
            coverUri: coverUri.trim(),
            // CollectionType / Visibility are proto3 int32 enums; the UI keeps
            // them as their enum-string keys for the <select>, so route through
            // fromJSON before broadcast — otherwise the proto encoder
            // NaN-coerces the string to 0 and amino emits the string, which
            // mismatches the chain's reconstructed sign bytes (sigverify fails
            // as "unauthorized"). Same fix shape as ProjectList.tsx.
            type: collectionTypeFromJSON(collectionType),
            visibility: visibilityFromJSON(visibility),
            tags,
            encrypted: false,
          },
        },
      ]);
      if (tagMsgs.length > 0) refreshTags();

      setName("");
      setDescription("");
      setCoverUri("");
      setTags([]);
      onCreated();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create collection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">New collection</h2>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="sd-btn sd-btn-secondary"
          >
            Cancel
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My collection"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-400">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this collection about?"
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-400">Cover image URI</label>
          <input
            value={coverUri}
            onChange={(e) => setCoverUri(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Type</label>
            <select
              value={collectionType}
              onChange={(e) => setCollectionType(e.target.value)}
              className="sd-select w-full"
            >
              <option value={CollectionType.MIXED}>Mixed</option>
              <option value={CollectionType.NFT}>NFT</option>
              <option value={CollectionType.LINK}>Link</option>
              <option value={CollectionType.ONCHAIN}>Onchain</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Visibility</label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="sd-select w-full"
            >
              <option value={CollectionVisibility.PUBLIC}>Public</option>
              <option value={CollectionVisibility.PRIVATE}>Private</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm text-zinc-400">Tags</label>
          <TagPicker
            options={availableTags}
            value={tags}
            onChange={setTags}
            placeholder={canCreateTags ? "Select or create tags..." : "Select tags..."}
            loading={loadingTags}
            allowCreate={canCreateTags}
          />
        </div>

        <button
          type="submit"
          disabled={!name.trim() || loading}
          className="sd-btn-crystal w-full px-4 py-2.5"
        >
          {loading ? "Creating..." : "Create collection"}
        </button>
      </form>
    </div>
  );
}
