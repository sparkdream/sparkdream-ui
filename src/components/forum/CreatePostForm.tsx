"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { useEphemeralTtl, formatTtl } from "@/hooks/useEphemeralTtl";
import { ForumMsgTypeUrls } from "@/lib/tx";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import { parseDreamToUdream } from "@/lib/utils";
import TagPicker from "@/components/contribute/TagPicker";
import NumberInput from "@/components/NumberInput";
import ActionBanner from "@/components/ActionBanner";
import { useTxAction } from "@/hooks/useTxAction";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import AnonymousToggle from "@/components/AnonymousToggle";
import { SHIELD_PHASE_LABELS, useAnonymousSubmit } from "@/hooks/useShieldIdentity";

interface CreatePostFormProps {
  mode: "thread" | "reply";
  categoryId: string;
  parentId?: string;
  rootId?: string;
  onCreated: () => void;
  onCancel: () => void;
}

export default function CreatePostForm({
  mode,
  categoryId,
  parentId,
  onCreated,
  onCancel,
}: CreatePostFormProps) {
  const dream = useDreamDenom();
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const { ttl: ephemeralTtl } = useEphemeralTtl("forum");
  const showEphemeralHint = isMember === false && ephemeralTtl !== null;

  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [authorBond, setAuthorBond] = useState("");
  const { busy: submitting, error: submitError, clearError, run } = useTxAction();
  const [anonymous, setAnonymous] = useState(false);
  const { submit: submitAnonymously, phase: anonPhase, shield } = useAnonymousSubmit();

  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();
  const canCreateTags = useCanCreateTags(address);

  const handleSubmit = async () => {
    if (!address || !content.trim()) return;
    await run("submit", async () => {
      const value: Record<string, unknown> = {
        creator: address,
        categoryId: BigInt(categoryId),
        content: content.trim(),
        parentId: mode === "reply" ? BigInt(parentId || "0") : BigInt(0),
        tags,
        contentType: 1, // CONTENT_TYPE_STANDARD
      };
      // Bonds lock the member's DREAM, so gate on confirmed membership like
      // the blog ReplyForm does (a stale value typed while isMember was
      // loading must not tank the whole tx).
      const bondUdream = parseDreamToUdream(authorBond);
      if (isMember === true && bondUdream && bondUdream !== "0") {
        value.authorBond = bondUdream;
      }
      const tagMsgs =
        mode === "thread" ? buildCreateTagMsgs(address, tags, availableTags) : [];
      if (anonymous) {
        // One message, signed by the shield module: no new tags alongside it,
        // and no bond (it would lock the shield's DREAM).
        if (tagMsgs.length > 0) {
          throw new Error("New tags can't be created anonymously. Pick existing tags or send without them.");
        }
        delete value.authorBond;
        await submitAnonymously(ForumMsgTypeUrls.CreatePost, (shieldAddress) => ({ ...value, creator: shieldAddress }));
      } else {
        await signAndBroadcast([
          ...tagMsgs,
          { typeUrl: ForumMsgTypeUrls.CreatePost, value },
        ]);
      }
      if (tagMsgs.length > 0) refreshTags();
      setContent("");
      setTags([]);
      setAuthorBond("");
      onCreated();
    }, "Failed to send spark");
  };

  return (
    <div className="sd-hull-tile rounded-xl p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">
        {mode === "thread" ? "New ´spark" : "Reply"}
      </h3>
      <div className="space-y-3">
        {showEphemeralHint && ephemeralTtl !== null && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
            Heads up: as a non-member, your {mode === "thread" ? "spark" : "reply"} is ephemeral and expires in {formatTtl(ephemeralTtl)}. Once a member replies in the thread, it becomes permanent.
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={mode === "thread" ? "What's on your mind?" : "Write a reply..."}
          rows={mode === "thread" ? 5 : 3}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        {mode === "thread" && (
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
            {canCreateTags && (
              <p className="mt-1 text-xs text-zinc-600">
                New tags burn a small {dream} fee per tag and are added to the shared registry.
              </p>
            )}
          </div>
        )}
        {isMember === true && !anonymous && (
          <div>
            <label htmlFor="forumAuthorBond" className="mb-1 block text-sm text-zinc-400">
              Author bond ({dream})
            </label>
            <NumberInput
              id="forumAuthorBond"
              min="0"
              value={authorBond}
              onChange={(e) => setAuthorBond(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Optional {dream} to lock behind this {mode === "thread" ? "spark" : "reply"}. It signals
              conviction, is slashed if the content is moderated, and makes it challengeable.
            </p>
          </div>
        )}
        <AnonymousToggle
          typeUrl={ForumMsgTypeUrls.CreatePost}
          checked={anonymous}
          onChange={setAnonymous}
          shield={shield}
          label={mode === "thread" ? "Send anonymously" : "Reply anonymously"}
          note="Anonymous posts can't create new tags or carry an author bond. You can send one anonymous spark or reply per epoch (a few minutes)."
        />
        <ActionBanner message={submitError} onDismiss={clearError} />
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
            className="sd-btn-ember px-4 py-2"
          >
            {anonPhase
              ? SHIELD_PHASE_LABELS[anonPhase]
              : submitting
                ? "Sending..."
                : `${mode === "thread" ? "Send spark" : "Send reply"}${anonymous ? " anonymously" : ""}`}
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
