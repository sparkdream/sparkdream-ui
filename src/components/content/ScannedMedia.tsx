"use client";

import { useState } from "react";
import { useVerdict } from "@/hooks/useVerdict";
import type { Verdict } from "@/lib/contentScan/client";
import { loadVerifiedImage, type ImageLoad } from "@/lib/contentScan/media";

// External URIs under the scanner display policy (docs/content-scanning.md §6):
//
//   image URI   never fetched until a clean verdict; then loaded on request,
//               as bytes that must hash to what the scanners checked
//   link        URL text shown but not clickable until clean; hidden if removed

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function uncheckedLine(v: Verdict): string {
  switch (v.reason) {
    case "loading":
      return "Checking whether it has been cleared.";
    case "no-scanners":
      return "No content scanners are running on this network yet, so images stay unloaded for now.";
    case "stale":
      return "The content scanners are behind, so it stays unloaded until they catch up.";
    case "no-crypto":
      return "This browser can't verify scanner results, so it stays unloaded here.";
    case "unreachable":
      return "Scanner results didn't load, so it stays unloaded for now.";
    case "archive":
      return "Images aren't loaded in archived snapshots.";
    default:
      return "Content scanners haven't cleared it yet, so it doesn't load.";
  }
}

const LOAD_ERRORS: Record<Exclude<ImageLoad, { ok: true }>["reason"], string> = {
  unsupported: "Its address can't be loaded in a browser.",
  blocked: "Its host doesn't let the browser check the file, so it can't load here.",
  mismatch: "The host now serves a different file than the one that was checked, so it won't load.",
  "no-crypto": "This browser can't check the file, so it won't load.",
  error: "It didn't load. Try again later.",
};

/**
 * The "image not loaded" bar for an external image. Offers "Load image" only
 * once the URI has a clean verdict, and hands the verified blob URL back.
 * Loading still shares the viewer's IP with the image host, so it stays a
 * click rather than automatic.
 */
export function ImageLoadBar({ uri, onLoaded }: { uri: string; onLoaded: (blobUrl: string) => void }) {
  const verdict = useVerdict({ uri });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const host = hostOf(uri);

  let line: string;
  let canLoad = false;
  if (verdict.state === "removed") line = "Image not available on this site.";
  else if (verdict.state === "held") line = "Image held for review.";
  else if (verdict.state === "unchecked") line = `Image not loaded. ${uncheckedLine(verdict)}`;
  else {
    canLoad = true;
    line = host
      ? `Image not loaded. It's hosted on ${host}, and loading it shares your IP address with that site.`
      : "Image not loaded. It only loads if you ask.";
  }

  const load = async () => {
    if (verdict.state !== "clean" || !verdict.sha256) return;
    setBusy(true);
    setFailure(null);
    const res = await loadVerifiedImage(uri, verdict.sha256);
    setBusy(false);
    if (res.ok) onLoaded(res.url);
    else setFailure(LOAD_ERRORS[res.reason]);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
      <span className="min-w-0 flex-1">
        {line}
        {failure && (
          <>
            {" "}
            <span className="text-amber-400">{failure}</span>
          </>
        )}
      </span>
      {canLoad && (
        <button type="button" onClick={load} disabled={busy} className="sd-btn sd-btn-secondary shrink-0">
          {busy ? "Checking…" : "Load image"}
        </button>
      )}
    </div>
  );
}

/**
 * An external link: clickable only once its URI has a clean verdict (and, if
 * the record pins a content hash, that hash is the one checked). Before that
 * the URL shows as plain text; a removed link isn't shown.
 */
export function ScannedLink({
  uri,
  contentHash,
  className,
}: {
  uri: string;
  /** The record's own content_hash for the linked file, if it has one (hex). */
  contentHash?: string;
  className?: string;
}) {
  const verdict = useVerdict({ uri });
  if (verdict.state === "removed") {
    return <span className="italic text-zinc-500">Link not available on this site.</span>;
  }
  const pinned = (contentHash || "").trim().toLowerCase();
  const hashOk = !/^[0-9a-f]{64}$/.test(pinned) || pinned === verdict.sha256;
  if (verdict.state === "clean" && hashOk && /^https?:\/\//i.test(uri)) {
    return (
      <a
        href={uri}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
        className={className}
      >
        {uri}
      </a>
    );
  }
  return (
    <span
      className="select-all text-zinc-400"
      title={verdict.state === "held" ? "Held for review" : "Not clickable until content scanners clear it"}
    >
      {uri}
    </span>
  );
}
