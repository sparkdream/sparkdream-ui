"use client";

import { useMemo, useState } from "react";
import { useMyUpload } from "@/hooks/useMyUpload";
import { useVerdict } from "@/hooks/useVerdict";
import { ImageLoadBar } from "@/components/content/ScannedMedia";
import MarkdownText from "@/components/content/MarkdownText";
import { splitBodyImages } from "@/lib/contentScan/bodyImages";

// A body that has already passed the scanner display policy (useScannedBody),
// with its embedded image links rendered as images. The text stays plain
// text. Each image is its own scanner subject: it is never fetched until its
// URI has a clean verdict, and then only as the bytes the scanners checked
// (docs/content-scanning.md §6). With `markdown`, the text between images is
// formatted as Markdown (MarkdownText), which fetches nothing either.

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

function PreviewImage({ uri, alt }: { uri: string; alt: string }) {
  const mine = useMyUpload(uri) !== "";
  const verdict = useVerdict({ uri });
  // Already judged (an image from an earlier version of the dream, or one
  // used elsewhere): shown, or refused, as any reader would see it.
  if (mine || verdict.state !== "unchecked") return <BodyImage uri={uri} alt={alt} />;
  // A newly linked image has no verdict until the dream is onchain, so there
  // is nothing to show yet, and fetching it here would skip the check.
  return (
    <p className="my-3 rounded-lg bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400 [overflow-wrap:anywhere]">
      Linked image: {uri}. It shows in the dream once content scanners have cleared it, usually a minute or two
      after you publish.
    </p>
  );
}

/**
 * The images a body being written embeds, shown under the composer. An image
 * this browser uploaded is shown as it will appear; a linked one is named.
 * Renders nothing when the body has no images.
 */
export function BodyImagePreviews({ text }: { text: string }) {
  const images = useMemo(
    () => splitBodyImages(text).filter((s): s is Extract<typeof s, { type: "image" }> => s.type === "image"),
    [text]
  );
  if (images.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-zinc-300">{images.length === 1 ? "Image in this dream" : "Images in this dream"}</p>
      {images.map((s, i) => (
        <PreviewImage key={`${i}|${s.uri}`} uri={s.uri} alt={s.alt} />
      ))}
    </div>
  );
}

export default function BodyWithImages({ text, markdown }: { text: string; markdown?: boolean }) {
  const segments = useMemo(() => splitBodyImages(text), [text]);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "text" ? (
          markdown ? <MarkdownText key={i} text={s.text} /> : <span key={i}>{s.text}</span>
        ) : (
          <BodyImage key={`${i}|${s.uri}`} uri={s.uri} alt={s.alt} />
        )
      )}
    </>
  );
}
