"use client";

import { useState } from "react";
import Modal from "@/components/futarchy/Modal";
import { useWallet } from "@/contexts/WalletContext";
import { RepMsgTypeUrls } from "@/lib/tx";

interface CreateTagFormProps {
  /** Existing tag names, lowercased, used to block duplicates client-side. */
  existing: string[];
  onClose: () => void;
  onCreated?: (name: string) => void;
}

/**
 * Standalone "create a tag" flow that broadcasts a single MsgCreateTag, with no
 * post attached. The chain treats tags as first-class objects in the x/rep
 * registry, so the same message the post form prepends via buildCreateTagMsgs
 * works on its own. Callers gate the entry point on useCanCreateTags +
 * useSessionPermits, so this form assumes the signer is allowed to create tags.
 */
export default function CreateTagForm({ existing, onClose, onCreated }: CreateTagFormProps) {
  const { address, signAndBroadcast } = useWallet();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tags are stored lowercased in the registry; normalize so the dup check and
  // the broadcast value agree with what the chain will persist.
  const normalized = name.trim().toLowerCase();
  const duplicate = existing.includes(normalized);
  const canSubmit = !!normalized && !duplicate && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !address) return;
    setSubmitting(true);
    setError(null);
    try {
      await signAndBroadcast([
        { typeUrl: RepMsgTypeUrls.CreateTag, value: { creator: address, name: normalized } },
      ]);
      onCreated?.(normalized);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tag");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Create a tag"
      subtitle="Adds a tag to the shared registry"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="create-tag-form"
            disabled={!canSubmit}
            className="sd-btn-gold px-6 py-2.5"
          >
            {submitting ? "Creating..." : "Create tag"}
          </button>
        </div>
      }
    >
      <form id="create-tag-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="tag-name" className="mb-1.5 block text-sm font-medium text-zinc-300">
            Tag name
          </label>
          <input
            id="tag-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. worldbuilding"
            maxLength={64}
            autoFocus
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {duplicate ? (
            <p className="mt-1 text-xs text-amber-500">#{normalized} already exists.</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-600">
              Burns a small DREAM fee and is added to the shared registry.
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
