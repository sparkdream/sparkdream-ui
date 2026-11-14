"use client";

import { useMemo, useState } from "react";
import { ImageLoadBar } from "@/components/content/ScannedMedia";
import { splitBodyImages } from "@/lib/contentScan/bodyImages";

// A body that has already passed the scanner display policy (useScannedBody),
// with its embedded image links rendered as images. The text stays plain
// text. Each image is its own scanner subject: it is never fetched until its
// URI has a clean verdict, and then only as the bytes the scanners checked
// (docs/content-scanning.md §6).

function BodyImage({ uri, alt }: { uri: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  return (
    <figure className="my-3">
      {src ? (
        // A verified blob URL, so next/image has nothing to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="max-h-[80vh] max-w-full rounded-lg" />
      ) : (
        <ImageLoadBar uri={uri} onLoaded={setSrc} />
      )}
      {alt && <figcaption className="text-xs text-zinc-500">{alt}</figcaption>}
    </figure>
  );
}

export default function BodyWithImages({ text }: { text: string }) {
  const segments = useMemo(() => splitBodyImages(text), [text]);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "text" ? <span key={i}>{s.text}</span> : <BodyImage key={`${i}|${s.uri}`} uri={s.uri} alt={s.alt} />
      )}
    </>
  );
}
