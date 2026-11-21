"use client";

import { useMemo, type ReactNode } from "react";
import { BodyImage } from "@/components/content/BodyWithImages";
import { PROSE } from "@/components/content/proseStyles";
import { hasHtmlImage, parseHtmlBody, type HtmlNode, type HtmlTag } from "@/lib/contentScan/htmlBody";

// HTML formatting for a body that has already passed the scanner display
// policy (useScannedBody). The body is never handed to the browser as HTML:
// parseHtmlBody reduces it to an allowlisted tree and this draws that tree
// with the site's own elements and classes, so no tag, attribute, style or
// script of the author's reaches the page. A link is shown as its text and
// address, never clickable (docs/content-scanning.md §6). With `images`, an
// image that is a scanner subject is drawn by BodyImage, which fetches it
// only once its address has a clean verdict; without, it is named in text.

// A body's top heading sits under the title, so headings start one step down.
const HEADING: Partial<Record<HtmlTag, { as: "h2" | "h3" | "h4" | "h5" | "h6"; className: string }>> = {
  h1: { as: "h2", className: PROSE.h1 },
  h2: { as: "h3", className: PROSE.h2 },
  h3: { as: "h4", className: PROSE.h3 },
  h4: { as: "h5", className: PROSE.h4 },
  h5: { as: "h6", className: PROSE.h5 },
  h6: { as: "h6", className: PROSE.h6 },
};

const CLASS: Partial<Record<HtmlTag, string>> = {
  ul: PROSE.ul,
  ol: PROSE.ol,
  li: PROSE.li,
  strong: PROSE.strong,
  blockquote: PROSE.blockquote,
  code: PROSE.code,
  pre: PROSE.pre,
  caption: PROSE.caption,
  th: PROSE.th,
  td: PROSE.td,
  dt: PROSE.dt,
  dd: PROSE.dd,
  mark: PROSE.mark,
  div: "space-y-3",
  dl: "space-y-1",
};

function draw(nodes: HtmlNode[], images: boolean): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === "text") return n.text;
    if (n.type === "image") {
      return images ? (
        <BodyImage key={`${i}|${n.uri}`} uri={n.uri} alt={n.alt} />
      ) : (
        <span key={i}>{n.alt ? `[image: ${n.alt}]` : "[image]"}</span>
      );
    }
    const kids = draw(n.children, images);
    // An image is drawn as a block, which a paragraph or a phrase can't hold.
    const holdsBlock = images && hasHtmlImage(n.children);
    switch (n.tag) {
      case "br":
        return <br key={i} />;
      case "hr":
        return <hr key={i} className={PROSE.hr} />;
      case "a": {
        const label = n.children.length === 1 && n.children[0].type === "text" ? n.children[0].text.trim() : null;
        const Wrap = holdsBlock ? "div" : "span";
        return (
          <Wrap key={i} className={PROSE.wrap}>
            {kids}
            {n.href && n.href !== label ? ` (${n.href})` : null}
          </Wrap>
        );
      }
      case "p": {
        const Wrap = holdsBlock ? "div" : "p";
        return <Wrap key={i}>{kids}</Wrap>;
      }
      case "ol":
        return (
          <ol key={i} start={n.start} className={PROSE.ol}>
            {kids}
          </ol>
        );
      case "table":
        return (
          <div key={i} className={PROSE.tableWrap}>
            <table className={PROSE.table}>{kids}</table>
          </div>
        );
      case "td":
      case "th": {
        const Cell = n.tag;
        return (
          <Cell key={i} colSpan={n.colSpan} rowSpan={n.rowSpan} className={CLASS[n.tag]}>
            {kids}
          </Cell>
        );
      }
      default: {
        const heading = HEADING[n.tag];
        if (heading) {
          const H = heading.as;
          return (
            <H key={i} className={heading.className}>
              {kids}
            </H>
          );
        }
        const Tag = n.tag;
        return (
          <Tag key={i} className={CLASS[n.tag]}>
            {kids}
          </Tag>
        );
      }
    }
  });
}

export default function HtmlText({
  text,
  title,
  images = false,
  className,
}: {
  text: string;
  /** The title shown above the body: an opening heading repeating it is left out. */
  title?: string;
  /** Draw embedded images (as scanner subjects) instead of naming them. */
  images?: boolean;
  className?: string;
}) {
  const tree = useMemo(() => parseHtmlBody(text, { title }), [text, title]);
  return (
    // The inner element resets white-space, whatever `className` sets.
    <div className={className}>
      <div className={PROSE.root}>{draw(tree, images)}</div>
    </div>
  );
}
