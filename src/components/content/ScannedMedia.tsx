"use client";

import { useEffect, useRef, useState } from "react";
import { useAutoLoadImages } from "@/hooks/useAutoLoadImages";
import { useVerdict } from "@/hooks/useVerdict";
import type { Verdict } from "@/lib/contentScan/client";
import { loadVerifiedImage, type ImageLoad } from "@/lib/contentScan/media";

// External URIs under the scanner display policy (docs/content-scanning.md §6):
//
//   image URI   never fetched until a clean verdict; then loaded (straight
//               away, or on request if the reader prefers to be asked), as
//               bytes that must hash to what the scanners checked
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
 * The "image not loaded" bar for an external image. Nothing is fetched until
 * the URI has a clean verdict; then the image loads straight away, or, if
 * the reader has chosen to be asked (Settings, Privacy), on "Load image".
 * Either way the verified blob URL is handed back. When the site operator
 * has turned images off (CONTENT_IMAGES_DISABLED) nothing loads.
 */
export function ImageLoadBar({ uri, onLoaded }: { uri: string; onLoaded: (blobUrl: string) => void }) {
  const verdict = useVerdict({ uri });
  const [auto] = useAutoLoadImages();
  const [busy, setBusy] = useState(false);
  // The failed attempt, remembered with what it was for, so a new verdict
  // (the scanners re-checked a changed file) gets a fresh automatic try.
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const host = hostOf(uri);

  const sha256 = verdict.state === "clean" && !verdict.imagesDisabled ? verdict.sha256 || "" : "";
  const canLoad = sha256 !== "";
  const key = `${uri}|${sha256}`;
  const failure = failed && failed.key === key ? failed.message : null;
  const autoLoading = canLoad && auto && !failure;

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    if (!autoLoading) return;
    let cancelled = false;
    void loadVerifiedImage(uri, sha256).then((res) => {
      if (cancelled) return;
      if (res.ok) onLoadedRef.current(res.url);
      else setFailed({ key: `${uri}|${sha256}`, message: LOAD_ERRORS[res.reason] });
    });
    return () => {
      cancelled = true;
    };
  }, [autoLoading, uri, sha256]);

  let line: string;
  if (verdict.state === "removed") line = "Image not available on this site.";
  else if (verdict.imagesDisabled) line = "Image not loaded. Images are turned off on this site for now.";
  else if (verdict.state === "held") line = "Image held for review.";
  else if (verdict.state === "unchecked") line = `Image not loaded. ${uncheckedLine(verdict)}`;
  else if (autoLoading) line = host ? `Loading image from ${host}…` : "Loading image…";
  else if (auto) line = "Image not loaded.";
  else {
    line = host
      ? `Image not loaded. It's hosted on ${host}, and loading it shares your IP address with that site.`
      : "Image not loaded. It only loads if you ask.";
  }

  const load = async () => {
    if (!canLoad) return;
    setBusy(true);
    setFailed(null);
    const res = await loadVerifiedImage(uri, sha256);
    setBusy(false);
    if (res.ok) onLoaded(res.url);
    else setFailed({ key, message: LOAD_ERRORS[res.reason] });
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {line}
        {failure && (
          <>
            {" "}
            <span className="text-amber-400">{failure}</span>
          </>
        )}
      </span>
      {canLoad && !autoLoading && (
        <button type="button" onClick={load} disabled={busy} className="sd-btn sd-btn-secondary shrink-0">
          {busy ? "Checking…" : failure ? "Try again" : "Load image"}
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
