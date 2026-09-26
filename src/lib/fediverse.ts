// Text of an ActivityPub post for display.
//
// A bridged post's body is the AS2 object's `content`, anchored exactly as the
// source instance served it: HTML (Mastodon wraps paragraphs in <p>, writes
// line breaks as <br>, escapes an apostrophe as &#39; and splits long links
// into invisible spans). The chain keeps it verbatim; this turns it into
// plain text for the UI. The result is text, never markup, so React escapes
// it and nothing a remote instance sent is rendered as HTML.
//
// String-based rather than DOMParser, so it gives the same result when the
// page renders on the server.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Plain text of an AS2 `content`/`summary` HTML fragment: tags dropped,
 *  paragraphs and line breaks as newlines, entities decoded. */
export function fediverseText(html: string | undefined | null): string {
  if (!html) return "";
  const text = html
    // a body cut at the bridge's size limit can end inside a tag
    .replace(/<[^>]*$/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One line of it, for a card or a list row. */
export function fediversePreview(html: string | undefined | null): string {
  return fediverseText(html).replace(/\s+/g, " ");
}
