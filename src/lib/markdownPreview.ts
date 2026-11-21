// Markdown reduced to its words, for one-line previews of a body that
// MarkdownText renders formatted in full. A preview is a few clamped lines of
// plain text, so the markup is dropped rather than rendered. This is a
// best-effort strip of the common syntax, not a parser.

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;

function stripInline(line: string): string {
  return (
    line
      // Links keep their text, autolinks their address.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<((?:https?|ipfs|ar):\/\/[^\s<>]+)>/gi, "$1")
      .replace(/(`+)(.+?)\1/g, "$2")
      .replace(/(?<!\\)(\*\*|__)(?=\S)(.+?)(?<=[^\s\\])\1/g, "$2")
      .replace(/(?<!\\)\*(?=\S)([^*]+?)(?<=[^\s\\])\*/g, "$1")
      // Underscores only mark emphasis at word edges (snake_case stays).
      .replace(/(?<![\p{L}\p{N}_\\])_(?=\S)([^_]+?)(?<=[^\s\\])_(?![\p{L}\p{N}_])/gu, "$1")
      .replace(/\\([!-/:-@[-`{-~])/g, "$1")
  );
}

export function markdownPreviewText(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    if (RULE.test(raw) || SETEXT_UNDERLINE.test(raw)) continue;
    const line = raw
      .replace(/^ {0,3}(?:>[ \t]?)+/, "")
      .replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, "")
      .replace(/[ \t]+#+[ \t]*$/, "")
      .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/, "");
    out.push(stripInline(line));
  }
  return out.join("\n").trim();
}

const sameWords = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * A Markdown body without its opening heading, when that heading only repeats
 * the title shown above it. Anything else is returned as written.
 */
export function dropTitleHeading(text: string, title: string): string {
  const m = /^(?:[ \t]*\r?\n)*( {0,3}#{1,6}[ \t]+([^\r\n]*?)(?:[ \t]+#+)?[ \t]*)(?:\r?\n|$)/.exec(text);
  if (!m || !sameWords(title) || sameWords(stripInline(m[2])) !== sameWords(title)) return text;
  return text.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
