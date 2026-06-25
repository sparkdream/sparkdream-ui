"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import { MsgTypeUrls } from "@/lib/tx";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import { getRepParams, invalidatePostsLists } from "@/lib/api";
import { parseDreamToUdream } from "@/lib/utils";
import { ContentType, CONTENT_TYPE_INFO } from "@/types/blog";
import NumberInput from "@/components/NumberInput";
import TagPicker from "@/components/contribute/TagPicker";

interface CreatePostFormProps {
  onCreated?: () => void;
  onCancel?: () => void;
}

function formatMicroDream(amount: string): string {
  try {
    const n = BigInt(amount);
    const whole = n / BigInt(1_000_000);
    const frac = n % BigInt(1_000_000);
    if (frac === BigInt(0)) return whole.toLocaleString();
    return `${whole.toLocaleString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
  } catch {
    return amount;
  }
}

export default function CreatePostForm({ onCreated, onCancel }: CreatePostFormProps = {}) {
  const router = useRouter();
  const { address, connected, signAndBroadcast } = useWallet();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contentType, setContentType] = useState<number>(ContentType.TEXT);
  const [minReplyTrustLevel, setMinReplyTrustLevel] = useState(0);
  const [authorBond, setAuthorBond] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();
  const canCreateTags = useCanCreateTags(address);
  const [maxBond, setMaxBond] = useState<string | null>(null);

  useEffect(() => {
    getRepParams()
      .then((res) => {
        const raw = (res.params as Record<string, unknown>)?.max_author_bond_per_content;
        if (typeof raw === "string" && raw) setMaxBond(raw);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !title.trim() || !body.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const value: Record<string, unknown> = {
        creator: address,
        title: title.trim(),
        body: body.trim(),
        contentType,
        minReplyTrustLevel,
        // MsgCreatePost.initiative_id is uint64, so sparkdreamjs's amino
        // override compares `message.initiativeId !== BigInt(0)`. Passing the
        // JS number 0 made that ternary truthy (Number !== BigInt is always
        // true) and signed `"initiative_id":"0"` — but the chain's aminojson
        // omits uint64 zeros as proto3 defaults, so sigverify failed as
        // "unauthorized" on every Imaginarium post. Omit the field so the
        // override returns `undefined?.toString() = undefined` and aminojson
        // drops it on both sides; fromAmino still seeds initiativeId to
        // BigInt(0) via createBaseMsgCreatePost for the proto round-trip.
        tags,
      };
      const bondUdream = parseDreamToUdream(authorBond);
      if (bondUdream && bondUdream !== "0") {
        value.authorBond = bondUdream;
      }

      const tagMsgs = buildCreateTagMsgs(address!, tags, availableTags);
      await signAndBroadcast([
        ...tagMsgs,
        { typeUrl: MsgTypeUrls.CreatePost, value },
      ]);
      invalidatePostsLists(address!);
      if (tagMsgs.length > 0) refreshTags();
      if (onCreated) onCreated();
      else router.push("/imaginarium");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish dream");
    } finally {
      setSubmitting(false);
    }
  };

  if (!connected) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <p className="text-zinc-400">Connect your wallet to publish a dream</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Title
        </label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Dream title"
          maxLength={256}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label htmlFor="contentType" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Content type
        </label>
        <select
          id="contentType"
          value={contentType}
          onChange={(e) => setContentType(Number(e.target.value))}
          className="sd-select w-full"
        >
          {Object.entries(CONTENT_TYPE_INFO).map(([val, info]) => (
            <option key={val} value={val}>
              {info.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="body" className="mb-1.5 block text-sm font-medium text-zinc-300">
          Content
        </label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your dream..."
          rows={10}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-zinc-600">
          {body.length} characters
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Tags</label>
        <TagPicker
          options={availableTags}
          value={tags}
          onChange={setTags}
          placeholder={canCreateTags ? "Select or create tags..." : "Select tags..."}
          loading={loadingTags}
          allowCreate={canCreateTags}
        />
        {canCreateTags && (
          <p className="mt-1 text-xs text-zinc-600">
            New tags burn a small DREAM fee per tag and are added to the shared registry.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        {showAdvanced ? "Hide" : "Show"} advanced options
      </button>

      {showAdvanced && (
        <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
          <div>
            <label htmlFor="minReplyTrustLevel" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Minimum reply trust level
            </label>
            <select
              id="minReplyTrustLevel"
              value={minReplyTrustLevel}
              onChange={(e) => setMinReplyTrustLevel(Number(e.target.value))}
              className="sd-select w-full"
            >
              <option value={-1}>-1 (No restriction)</option>
              <option value={0}>0 (Default)</option>
              <option value={1}>1 (Basic)</option>
              <option value={2}>2 (Established)</option>
              <option value={3}>3 (Trusted)</option>
              <option value={4}>4 (Highly trusted)</option>
            </select>
            <p className="mt-1 text-xs text-zinc-600">
              Minimum trust level required to reply to this dream
            </p>
          </div>

          <div>
            <label htmlFor="authorBond" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Author bond (DREAM)
            </label>
            <NumberInput
              id="authorBond"
              min="0"
              value={authorBond}
              onChange={(e) => setAuthorBond(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Optional DREAM amount to lock as an author bond. No minimum
              {maxBond && `; up to ${formatMicroDream(maxBond)} DREAM`}.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !title.trim() || !body.trim()}
          className="sd-btn-gold px-6 py-2.5"
        >
          {submitting ? "Publishing..." : "Publish dream"}
        </button>
        <button
          type="button"
          onClick={() => (onCancel ? onCancel() : router.back())}
          className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
