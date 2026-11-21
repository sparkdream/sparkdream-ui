"use client";

import { useEffect, useRef, useState } from "react";
import { useAutoLoadImages } from "@/hooks/useAutoLoadImages";
import { useMyUpload } from "@/hooks/useMyUpload";
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
  // An ar:// address names data, not a site; it is read through a gateway.
  if (/^ar:\/\//i.test(uri)) return "Arweave";
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// A new image is checked once its address is onchain, which takes a minute
// or two. The card looks again by itself (useVerdict), so say so: it is a
// wait, not a failure.
const PENDING_LINE = "Image being checked. This usually takes a minute or two, and it appears here on its own once it is cleared.";

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
      return PENDING_LINE;
  }
}

const LOAD_ERRORS: Record<Exclude<ImageLoad, { ok: true }>["reason"], string> = {
  unsupported: "Its address can't be loaded in a browser.",
  blocked: "Its host doesn't let the browser check the file, so it can't load here.",
  timeout: "Its host took too long to send it.",
  mismatch: "The host now serves a different file than the one that was checked, so it won't load.",
  "no-crypto": "This browser can't check the file, so it won't load.",
  error: "It didn't load. Try again later.",
};

// Failures that may pass by themselves: a slow host, a dropped connection, a
// gateway error. ("blocked" covers a network failure as well as a host that
// refuses cross-origin reads; the browser doesn't say which.) A different
// file, an unloadable address or a browser without WebCrypto won't change.
const RETRYABLE = new Set<Exclude<ImageLoad, { ok: true }>["reason"]>(["timeout", "error", "blocked"]);
// Waits before the automatic retries; after the last one the bar gives up.
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000];

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

  // An image this browser uploaded shows to its uploader without waiting for
  // the scanners' verdict (lib/imageUpload/myUploads.ts). It loads by itself
  // whatever the reader's setting: it is their own picture, from this site's
  // storage. A verdict of held or removed still wins, as do archived
  // snapshots and the operator's switch.
  const ownSha = useMyUpload(uri);
  const own =
    ownSha !== "" && !verdict.imagesDisabled && verdict.state === "unchecked" && verdict.reason !== "archive";
  const sha256 = own ? ownSha : verdict.state === "clean" && !verdict.imagesDisabled ? verdict.sha256 || "" : "";
  const canLoad = sha256 !== "";
  const key = `${uri}|${sha256}`;
  const failure = failed && failed.key === key ? failed.message : null;
  const autoLoading = canLoad && (auto || own) && !failure;

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    if (!autoLoading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A slow or briefly unreachable host is tried again quietly, with the
    // bar still saying "loading". Only when the retries run out, or the
    // failure is one that waiting can't fix, does the reader see it.
    const attempt = (n: number) => {
      loadVerifiedImage(uri, sha256)
        .catch((): ImageLoad => ({ ok: false, reason: "error" }))
        .then((res) => {
          if (cancelled) return;
          if (res.ok) onLoadedRef.current(res.url);
          else if (RETRYABLE.has(res.reason) && n < RETRY_DELAYS_MS.length) {
            timer = setTimeout(() => attempt(n + 1), RETRY_DELAYS_MS[n]);
          } else setFailed({ key: `${uri}|${sha256}`, message: LOAD_ERRORS[res.reason] });
        });
    };
    attempt(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [autoLoading, uri, sha256]);

  let line: string;
  if (verdict.state === "removed") line = "Image not available on this site.";
  else if (verdict.imagesDisabled) line = "Image not loaded. Images are turned off on this site for now.";
  else if (verdict.state === "held") line = "Image held for review.";
  else if (own) line = failure ? "Image not loaded." : "Loading your image…";
  else if (verdict.state === "unchecked") {
    const detail = uncheckedLine(verdict);
    line = detail === PENDING_LINE ? detail : `Image not loaded. ${detail}`;
  }
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
    const res = await loadVerifiedImage(uri, sha256).catch((): ImageLoad => ({ ok: false, reason: "error" }));
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
