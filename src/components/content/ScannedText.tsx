"use client";

import ContentNotice from "@/components/content/ContentNotice";
import RichBody from "@/components/content/RichBody";
import type { BodyFormat } from "@/lib/contentScan/bodyFormat";
import { useScannedBody, type ScannedBodyInput } from "@/hooks/useScannedBody";

// A content body under the scanner display policy (docs/content-scanning.md
// §6), for render sites that can't call the hook themselves (render helpers
// inside a loop). The text is rendered as plain text, or with `rich` as
// formatted Markdown or HTML (RichBody), never handed to the browser as HTML,
// so URLs inside it are neither fetched nor clickable.

interface ScannedTextProps {
  input: ScannedBodyInput;
  /** "dream", "reply", "spark", "post". */
  noun: string;
  /** Wrapper classes for the shown text. */
  className?: string;
  /** Classes for the placeholder (spacing, mostly). */
  noticeClassName?: string;
  /** One-line placeholders, for list rows. */
  compact?: boolean;
  /** Text transform for previews (e.g. stripping HTML). */
  format?: (text: string) => string;
  /** Wrapper element; "span" inside phrasing content. */
  as?: "div" | "span";
  /** Render the text formatted (bodyFormat). For full bodies, not previews. */
  rich?: BodyFormat | null;
  /** With `rich`: the title shown above, so a heading repeating it is left out. */
  title?: string;
}

export default function ScannedText({ input, noun, className, noticeClassName, compact, format, as = "div", rich, title }: ScannedTextProps) {
  const scanned = useScannedBody(input);
  const Wrap = as;
  if (scanned.status === "show") {
    if (rich) return <RichBody text={scanned.text} format={rich} title={title} className={className} />;
    return <Wrap className={className}>{format ? format(scanned.text) : scanned.text}</Wrap>;
  }
  return compact ? (
    <Wrap className={noticeClassName ?? className}>
      <ContentNotice status={scanned.status} reason={scanned.reason} noun={noun} compact />
    </Wrap>
  ) : (
    <ContentNotice status={scanned.status} reason={scanned.reason} noun={noun} className={noticeClassName} />
  );
}
