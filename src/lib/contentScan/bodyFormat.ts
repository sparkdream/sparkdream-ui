import { bodyPreviewText, splitBodyImages } from "@/lib/contentScan/bodyImages";
import { htmlBodyImages, htmlPreviewText } from "@/lib/contentScan/htmlBody";
import { ContentType, contentTypeNumber } from "@/types/blog";

// How a text body is rendered, from its content type: formatted Markdown
// (MarkdownText), formatted HTML (HtmlText), or null for plain text. These
// helpers answer the same questions for each, so a card or composer need not
// know which it has.

export type BodyFormat = "markdown" | "html";

/** How a stored post, reply or spark is rendered, from its content type. */
export function bodyFormat(contentType: string | number | undefined | null): BodyFormat | null {
  const n = contentTypeNumber(contentType);
  return n === ContentType.MARKDOWN ? "markdown" : n === ContentType.HTML ? "html" : null;
}

const PREVIEW_SOURCE_CHARS = 4000;

/**
 * Past this a body is shown as plain text rather than formatted. The chain
 * caps bodies near 10,000 bytes (blog max_body_length, forum
 * max_content_size); Markdown parsing is quadratic on some inputs, a tenth of
 * a second at that size but seconds at ten times it.
 */
export const MAX_FORMATTED_CHARS = 20_000;

/** The images a body embeds, in order. */
export function bodyImages(text: string, format?: BodyFormat | null): { uri: string; alt: string }[] {
  if (format === "html") return htmlBodyImages(text);
  const out: { uri: string; alt: string }[] = [];
  for (const s of splitBodyImages(text)) if (s.type === "image") out.push({ uri: s.uri, alt: s.alt });
  return out;
}

/** The first image a body embeds, or null. */
export function firstImage(text: string, format?: BodyFormat | null): { uri: string; alt: string } | null {
  return bodyImages(text, format)[0] ?? null;
}

/**
 * A body for one-line previews: its words without the markup, each image as
 * "[image: description]". `skipFirstImage` leaves the first one out, for a
 * card that shows it as a picture. `title` drops an opening heading that
 * repeats it.
 */
export function previewText(
  body: string,
  opts: { format?: BodyFormat | null; skipFirstImage?: boolean; title?: string } = {}
): string {
  // A preview shows a few lines, and runs for every card on a page, so only
  // the start of a formatted body is worked on.
  const text = opts.format && body.length > PREVIEW_SOURCE_CHARS ? body.slice(0, PREVIEW_SOURCE_CHARS) : body;
  if (opts.format === "html") return htmlPreviewText(text, { skipFirstImage: opts.skipFirstImage, title: opts.title });
  return bodyPreviewText(text, {
    skipFirstImage: opts.skipFirstImage,
    markdown: opts.format === "markdown",
    title: opts.title,
  });
}
