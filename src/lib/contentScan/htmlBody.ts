import { fromHtml } from "hast-util-from-html";
import type { Element, ElementContent, RootContent } from "hast";
import { splitBodyImages } from "@/lib/contentScan/bodyImages";

// An HTML body reduced to the formatting this site renders
// (docs/content-scanning.md §6). The body is parsed as a browser would parse
// it, then rebuilt from an allowlist: known formatting elements are kept
// under a fixed tag, unknown ones give way to their children, and active or
// embedding ones (script, style, iframe, form controls, svg, ...) are dropped
// with everything inside them. No attribute survives except a link's address
// (printed, never followed), a list's start and a cell's span. Nothing built
// here can make a browser fetch or run anything.
//
// Images are the one thing fetched, by the renderer, and only as scanner
// subjects: the address must be one the scanner workers found in the raw
// body, byte for byte, since that string is what their verdict names.

export type HtmlNode =
  | { type: "text"; text: string }
  | { type: "image"; uri: string; alt: string }
  | { type: "element"; tag: HtmlTag; children: HtmlNode[]; href?: string; start?: number; colSpan?: number; rowSpan?: number };

export type HtmlTag =
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "p" | "div" | "ul" | "ol" | "li" | "dl" | "dt" | "dd" | "blockquote" | "pre" | "hr" | "br"
  | "table" | "caption" | "thead" | "tbody" | "tfoot" | "tr" | "th" | "td"
  | "strong" | "em" | "u" | "s" | "code" | "sub" | "sup" | "mark" | "small" | "a";

// Source tag -> rendered tag.
const KEEP: Record<string, HtmlTag> = {
  h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6",
  p: "p", ul: "ul", ol: "ol", li: "li", dl: "dl", dt: "dt", dd: "dd",
  blockquote: "blockquote", pre: "pre", hr: "hr", br: "br",
  table: "table", caption: "caption", thead: "thead", tbody: "tbody", tfoot: "tfoot", tr: "tr", th: "th", td: "td",
  div: "div", section: "div", article: "div", header: "div", footer: "div", main: "div", aside: "div",
  nav: "div", address: "div", figure: "div", figcaption: "div", details: "div", summary: "div", center: "div",
  strong: "strong", b: "strong", em: "em", i: "em", var: "em", cite: "em", dfn: "em",
  u: "u", ins: "u", s: "s", del: "s", strike: "s",
  code: "code", kbd: "code", samp: "code", tt: "code",
  sub: "sub", sup: "sup", mark: "mark", small: "small", a: "a",
};

// Dropped with their contents: nothing inside is prose.
const DROP = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "noembed", "noframes",
  "template", "svg", "math", "head", "title", "link", "meta", "base", "textarea", "select", "option", "optgroup",
  "datalist", "button", "input", "video", "audio", "canvas", "source", "track", "map", "area", "dialog", "slot",
  "plaintext", "xmp",
]);

const BLOCK = new Set<HtmlTag>([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "pre", "hr",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
]);

// Elements nested deeper than this give way to their children. A body is
// chain data: a few kilobytes of "<div><div><div>..." must not be able to
// exhaust the stack of the parser, this walk or React (a thrown render takes
// the whole page down with it).
const MAX_DEPTH = 32;

// Source nesting past this is not walked at all (its text is dropped).
const MAX_SOURCE_DEPTH = 512;

// React refuses whitespace text directly inside these.
const NO_TEXT = new Set<HtmlTag>(["table", "thead", "tbody", "tfoot", "tr"]);

// The scanner's urlRe (tools/contentscan detect.go), both halves:
//   (?i)(?:\b(?:src|poster|srcset|href)\s*=\s*["']?|!\[[^\]]*\]\()\s*((?:https?|ipfs|ar)://[^\s"'()<>]+)
// As in bodyImages.ts and mediaLabels.ts: RE2's \s and \b are ASCII-only, so
// they are spelled out, and the `u` flag gives (?i) the same case folding.
const URL_SOURCE =
  "(?:(?<![0-9A-Za-z_])(?:src|poster|srcset|href)[\\t\\n\\f\\r ]*=[\\t\\n\\f\\r ]*[\"']?|!\\[[^\\]]*\\]\\()" +
  "[\\t\\n\\f\\r ]*((?:https?|ipfs|ar)://[^\\t\\n\\f\\r \"'()<>]+)";

/** The external addresses the scanner workers find in a raw body. */
export function scannerUris(raw: string): Set<string> {
  const out = new Set<string>();
  for (const m of raw.matchAll(new RegExp(URL_SOURCE, "giu"))) out.add(m[1]);
  return out;
}

const sameWords = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function nodeText(nodes: HtmlNode[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text : n.type === "element" ? nodeText(n.children) : "")).join("");
}

function spanOf(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n > 1 && n <= 100 ? n : undefined;
}

/**
 * Parse an HTML body into the tree that is rendered. With `title`, an opening
 * heading that only repeats it is left out, as it is shown above the body.
 */
export function parseHtmlBody(raw: string, opts: { title?: string } = {}): HtmlNode[] {
  const subjects = scannerUris(raw);

  const image = (uri: string, alt: string): HtmlNode =>
    subjects.has(uri)
      ? { type: "image", uri, alt: alt.trim() }
      : { type: "text", text: alt.trim() ? `[image: ${alt.trim()}]` : "[image]" };

  // `kept` counts the kept elements above; `seen` every source element, so
  // the walk itself stays shallow whatever the parser produced.
  const walk = (nodes: (RootContent | ElementContent)[], inPre: boolean, kept: number, seen: number): HtmlNode[] => {
    const out: HtmlNode[] = [];
    if (seen > MAX_SOURCE_DEPTH) return out;
    for (const n of nodes) {
      if (n.type === "text") {
        // An image written as a Markdown link (what the composer inserts).
        if (inPre) out.push({ type: "text", text: n.value });
        else for (const s of splitBodyImages(n.value)) out.push(s.type === "text" ? s : image(s.uri, s.alt));
        continue;
      }
      if (n.type !== "element") continue;
      const el = n as Element;
      const name = el.tagName.toLowerCase();
      if (DROP.has(name)) continue;
      if (name === "img") {
        const src = typeof el.properties?.src === "string" ? el.properties.src.trim() : "";
        const alt = typeof el.properties?.alt === "string" ? el.properties.alt : "";
        out.push(image(src, alt));
        continue;
      }
      const tag = kept < MAX_DEPTH ? KEEP[name] : undefined;
      let children = walk(el.children, inPre || name === "pre", tag ? kept + 1 : kept, seen + 1);
      if (!tag) {
        out.push(...children);
        continue;
      }
      if (NO_TEXT.has(tag)) children = children.filter((c) => c.type !== "text" || c.text.trim() !== "");
      const node: HtmlNode = { type: "element", tag, children };
      if (tag === "a" && typeof el.properties?.href === "string") node.href = el.properties.href.trim();
      if (tag === "ol") {
        const start = parseInt(String(el.properties?.start ?? ""), 10);
        if (Number.isInteger(start) && Math.abs(start) < 1e9) node.start = start;
      }
      if (tag === "td" || tag === "th") {
        node.colSpan = spanOf(el.properties?.colSpan);
        node.rowSpan = spanOf(el.properties?.rowSpan);
      }
      out.push(node);
    }
    return out;
  };

  let tree: HtmlNode[];
  try {
    tree = walk(fromHtml(raw, { fragment: true }).children, false, 0, 0);
  } catch {
    // Too deep for the parser (a stack overflow): shown as the text it is.
    return raw ? [{ type: "text", text: raw }] : [];
  }

  if (opts.title && sameWords(opts.title)) {
    const first = tree.findIndex((n) => n.type !== "text" || n.text.trim() !== "");
    const head = tree[first];
    if (head?.type === "element" && /^h[1-6]$/.test(head.tag) && sameWords(nodeText(head.children)) === sameWords(opts.title)) {
      tree.splice(0, first + 1);
    }
  }
  return tree;
}

/** Whether a rendered tree holds an image somewhere inside. */
export function hasHtmlImage(nodes: HtmlNode[]): boolean {
  return nodes.some((n) => n.type === "image" || (n.type === "element" && hasHtmlImage(n.children)));
}

/** The images an HTML body embeds, in order. */
export function htmlBodyImages(raw: string): { uri: string; alt: string }[] {
  const out: { uri: string; alt: string }[] = [];
  const walk = (nodes: HtmlNode[]) => {
    for (const n of nodes) {
      if (n.type === "image") out.push({ uri: n.uri, alt: n.alt });
      else if (n.type === "element") walk(n.children);
    }
  };
  walk(parseHtmlBody(raw));
  return out;
}

/**
 * An HTML body as plain text, for one-line previews: the words, one line per
 * block, each image as "[image: description]". `skipFirstImage` leaves the
 * first one out, for a card that shows it as a picture.
 */
export function htmlPreviewText(raw: string, opts: { skipFirstImage?: boolean; title?: string } = {}): string {
  let skip = !!opts.skipFirstImage;
  let out = "";
  const walk = (nodes: HtmlNode[], inPre: boolean) => {
    for (const n of nodes) {
      if (n.type === "text") out += inPre ? n.text : n.text.replace(/[\t\n\f\r ]+/g, " ");
      else if (n.type === "image") {
        if (skip) skip = false;
        else out += n.alt ? `[image: ${n.alt}]` : "[image]";
      } else if (n.tag === "br") out += "\n";
      else if (n.tag === "a") {
        walk(n.children, inPre);
      } else {
        const block = BLOCK.has(n.tag);
        if (block) out += "\n";
        walk(n.children, inPre || n.tag === "pre");
        if (block) out += "\n";
      }
    }
  };
  walk(parseHtmlBody(raw, { title: opts.title }), false);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}
