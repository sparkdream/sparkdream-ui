"use client";

import { useEffect, useState } from "react";
import { useAutoLoadImages } from "@/hooks/useAutoLoadImages";
import { useVerdict } from "@/hooks/useVerdict";
import { loadVerifiedImage } from "@/lib/contentScan/media";
import { CARD } from "./shared";

/** The first target whose bytes hash to `sha256`, as a blob URL, or null. */
async function loadFirst(targets: string[], sha256: string): Promise<string | null> {
  for (const target of targets) {
    // The copy, when there is one, is already among the targets, so the
    // loader's own look for a permanent copy is skipped.
    const res = await loadVerifiedImage(target, sha256, { fallback: false }).catch(() => null);
    if (res?.ok) return res.url;
  }
  return null;
}

/**
 * The image a storage request is about, under the scanner display policy
 * (docs/content-scanning.md): nothing is fetched until content scanners have
 * cleared the request's file, and what is shown is the bytes that hash to
 * the request's sha256, from the copy when there is one and otherwise from
 * an address the file was requested from.
 */
export default function StoredImage({
  requestId,
  sha256,
  targets,
}: {
  requestId: string;
  sha256: string;
  /** Where the file may be fetched from, best first. */
  targets: string[];
}) {
  // Scanners sign a storage request as the record storage/request/<id>.
  const verdict = useVerdict({ record: `storage/request/${requestId}`, sha256 });
  const [auto] = useAutoLoadImages();
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = `${sha256}|${targets.join(" ")}`;
  const cleared = verdict.state === "clean" && !verdict.imagesDisabled && targets.length > 0;
  const url = shown && shown.key === key ? shown.url : null;

  const load = async () => {
    setBusy(true);
    setFailed(null);
    const got = await loadFirst(targets, sha256);
    if (got) setShown({ key, url: got });
    else setFailed(key);
    setBusy(false);
  };

  useEffect(() => {
    if (!cleared || !auto || url || failed === key) return;
    let live = true;
    void loadFirst(targets, sha256).then((got) => {
      if (!live) return;
      if (got) setShown({ key, url: got });
      else setFailed(key);
    });
    return () => {
      live = false;
    };
    // `key` stands for sha256 and targets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleared, auto, url, failed, key]);

  let line: string | null = null;
  if (verdict.state === "removed") line = "This image is not available on this site.";
  else if (verdict.imagesDisabled) line = "Images are turned off on this site for now.";
  else if (verdict.state === "held") line = "The image is held for review.";
  else if (verdict.state === "unchecked") {
    line =
      verdict.reason === "loading"
        ? "Checking whether the image has been cleared."
        : verdict.reason === "no-scanners"
          ? "No content scanners are running on this network yet, so the image stays unloaded."
          : "The image is being checked. This usually takes a minute or two, and it appears here on its own once it is cleared.";
  } else if (targets.length === 0) line = "There is no address to load the image from.";
  else if (failed === key) line = "The image didn't load from the copy or from the addresses it was requested from.";
  else if (!url && auto) line = "Loading the image...";
  else if (!url) line = "The image is not loaded. Loading it shares your IP address with the site that serves it.";

  return (
    <section className={`${CARD} space-y-3`}>
      <h3 className="text-sm font-semibold text-white">The image</h3>
      {url ? (
        // A blob URL of hash-checked bytes; next/image cannot optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="The stored file" className="max-h-[32rem] max-w-full rounded-lg border border-zinc-800" />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-zinc-400">{line}</p>
          {cleared && (!auto || failed === key) && (
            <button type="button" onClick={load} disabled={busy} className="sd-btn sd-btn-secondary shrink-0">
              {busy ? "Loading..." : failed === key ? "Try again" : "Show image"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
