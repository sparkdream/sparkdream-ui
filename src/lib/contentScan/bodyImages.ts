// Images inside a text body (docs/content-scanning.md §5.1, §6 "external URL
// inside a rendered body"). An author embeds an image as a Markdown image
// link, `![description](https://host/file.png)`. The chain does not label
// these; scanner workers find them with ExtractURLs (tools/contentscan
// detect.go) and publish a verdict per URI. The renderer shows each one as an
// unloaded image that the reader can load once its URI has a clean verdict.

export type BodySegment =
  | { type: "text"; text: string }
  | { type: "image"; uri: string; alt: string };

// The Markdown half of the scanner's urlRe:
//   (?i)!\[[^\]]*\]\(\s*((?:https?|ipfs|ar)://[^\s"'()<>]+)
// The URI captured here must be byte-for-byte the one the workers signed, or
// its verdict is never found (the image then just stays unloaded). As in
// mediaLabels.ts: RE2's \s is ASCII-only, so the class is spelled out, and
// the `u` flag gives (?i) the same Unicode case folding.
const IMAGE_SOURCE = "!\\[([^\\]]*)\\]\\([\\t\\n\\f\\r ]*((?:https?|ipfs|ar)://[^\\t\\n\\f\\r \"'()<>]+)";

// What may follow the URI before the link closes: an optional "title".
const IMAGE_TAIL = /^[\t\n\f\r ]*(?:"[^"\n]*"[\t\n\f\r ]*)?\)/;

/**
 * Split a body into text and image segments. Only a complete image link
 * becomes an image; anything else stays text. One line break on each side of
 * an image is dropped, since the image renders as its own block.
 */
export function splitBodyImages(text: string): BodySegment[] {
  const out: BodySegment[] = [];
  const re = new RegExp(IMAGE_SOURCE, "giu");
  let last = 0;
  let afterImage = false;
  const pushText = (raw: string, beforeImage: boolean) => {
    let t = raw;
    if (afterImage) t = t.replace(/^\r?\n/, "");
    if (beforeImage) t = t.replace(/\r?\n$/, "");
    if (t) out.push({ type: "text", text: t });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tail = IMAGE_TAIL.exec(text.slice(re.lastIndex));
    if (!tail) continue;
    pushText(text.slice(last, m.index), true);
    out.push({ type: "image", uri: m[2], alt: m[1].trim() });
    last = re.lastIndex + tail[0].length;
    re.lastIndex = last;
    afterImage = true;
  }
  pushText(text.slice(last), false);
  return out;
}

/** Whether a body embeds at least one image. */
export function hasBodyImages(text: string): boolean {
  return splitBodyImages(text).some((s) => s.type === "image");
}

/** The first image a body embeds, or null. */
export function firstBodyImage(text: string): { uri: string; alt: string } | null {
  for (const s of splitBodyImages(text)) if (s.type === "image") return { uri: s.uri, alt: s.alt };
  return null;
}

/**
 * A body for one-line previews: each image becomes "[image: description]".
 * `skipFirstImage` leaves the first one out, for a card that shows it as a
 * picture.
 */
export function bodyPreviewText(text: string, opts: { skipFirstImage?: boolean } = {}): string {
  let skip = !!opts.skipFirstImage;
  const parts: string[] = [];
  for (const s of splitBodyImages(text)) {
    if (s.type === "text") parts.push(s.text);
    else if (skip) skip = false;
    else parts.push(s.alt ? `[image: ${s.alt}]` : "[image]");
  }
  return parts.join(" ").trim();
}

/**
 * Build the image link for a composer. Returns null if the address can't be
 * embedded: only http(s) addresses load in a browser. Parentheses in the
 * address are percent-encoded so they don't end the link early.
 */
export function buildImageMarkdown(url: string, description: string): string | null {
  const uri = url.trim().replace(/\(/g, "%28").replace(/\)/g, "%29");
  if (!/^https?:\/\/[^\t\n\f\r "'()<>]+$/i.test(uri)) return null;
  try {
    if (!new URL(uri).hostname) return null;
  } catch {
    return null;
  }
  const alt = description.replace(/[\[\]\s]+/g, " ").trim();
  return `![${alt}](${uri})`;
}
