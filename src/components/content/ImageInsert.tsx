"use client";

import { useState, type RefObject } from "react";
import { buildImageMarkdown } from "@/lib/contentScan/bodyImages";

const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

/**
 * Composer control that embeds a hosted image in a body as a Markdown image
 * link, placed on its own line at the cursor. The image itself stays where it
 * is hosted: the chain stores only the address.
 */
export default function ImageInsert({
  body,
  onChange,
  textareaRef,
}: {
  body: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const insert = () => {
    const md = buildImageMarkdown(url, description);
    if (!md) {
      setError("Enter the full address of the image, starting with https://.");
      return;
    }
    const el = textareaRef.current;
    const at = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    const before = body.slice(0, at);
    const after = body.slice(end);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const trail = after && !after.startsWith("\n") ? "\n" : "";
    onChange(`${before}${lead}${md}${trail}${after}`);
    const caret = before.length + lead.length + md.length + trail.length;
    setUrl("");
    setDescription("");
    setError(null);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  // The control sits inside the post form, so Enter must not publish.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    insert();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-400 transition-colors hover:text-white"
      >
        + Add image
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      <div>
        <label htmlFor="imageUrl" className="mb-1 block text-xs font-medium text-zinc-300">
          Image address
        </label>
        <input
          id="imageUrl"
          type="url"
          inputMode="url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="https://example.com/picture.png"
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label htmlFor="imageDescription" className="mb-1 block text-xs font-medium text-zinc-300">
          Description (optional)
        </label>
        <input
          id="imageDescription"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What the image shows"
          maxLength={200}
          className={INPUT_CLASS}
        />
      </div>
      <p className="text-xs text-zinc-500">
        The image stays where it is hosted, and the dream stores only its address. Readers see it
        once content scanners have cleared it. The host has to allow
        other sites to read the file, or it can&apos;t be checked and won&apos;t load.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={insert} disabled={!url.trim()} className="sd-btn sd-btn-secondary">
          Insert image
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-xs text-zinc-400 transition-colors hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
