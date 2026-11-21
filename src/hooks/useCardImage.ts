"use client";

import { useEffect, useState } from "react";
import { useAutoLoadImages } from "@/hooks/useAutoLoadImages";
import { useMyUpload } from "@/hooks/useMyUpload";
import { useVerdict } from "@/hooks/useVerdict";
import { loadVerifiedImage } from "@/lib/contentScan/media";

/**
 * A content image for a card's artwork: its verified blob URL once it may
 * load, else null. The rules are ImageLoadBar's (ScannedMedia.tsx): a clean
 * scanner verdict, or the reader's own upload with no verdict yet, and never
 * with images turned off or in an archived snapshot. Where the bar would
 * explain or offer a button, this stays silent: the card keeps its fallback
 * art, and the dream's own page says why. So a reader who asks before
 * loading images gets no image here. `uri` may be "" for no image.
 */
export function useCardImage(uri: string): string | null {
  const verdict = useVerdict(uri ? { uri } : null);
  const [auto] = useAutoLoadImages();
  const ownSha = useMyUpload(uri);
  const own =
    ownSha !== "" && !verdict.imagesDisabled && verdict.state === "unchecked" && verdict.reason !== "archive";
  const sha256 = own
    ? ownSha
    : auto && verdict.state === "clean" && !verdict.imagesDisabled
      ? verdict.sha256 || ""
      : "";
  const key = uri && sha256 ? `${uri}|${sha256}` : "";
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadVerifiedImage(uri, sha256)
      .then((res) => {
        if (!cancelled && res.ok) setLoaded({ key, url: res.url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, uri, sha256]);

  return loaded && loaded.key === key ? loaded.url : null;
}
