"use client";

import ContentNotice from "@/components/content/ContentNotice";
import MarkdownText from "@/components/content/MarkdownText";
import { useScannedBody, type ScannedBodyInput } from "@/hooks/useScannedBody";

// A content body under the scanner display policy (docs/content-scanning.md
// §6), for render sites that can't call the hook themselves (render helpers
// inside a loop). The text is rendered as plain text, or with `markdown` as
// formatted Markdown (MarkdownText), never as HTML, so URLs inside it are
// neither fetched nor clickable.

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
  /** Format the text as Markdown. For full bodies, not previews. */
  markdown?: boolean;
}

export default function ScannedText({ input, noun, className, noticeClassName, compact, format, as = "div", markdown }: ScannedTextProps) {
  const scanned = useScannedBody(input);
  const Wrap = as;
  if (scanned.status === "show") {
    const text = format ? format(scanned.text) : scanned.text;
    if (markdown) return <MarkdownText text={text} className={className} />;
    return <Wrap className={className}>{text}</Wrap>;
  }
  return compact ? (
    <Wrap className={noticeClassName ?? className}>
      <ContentNotice status={scanned.status} reason={scanned.reason} noun={noun} compact />
    </Wrap>
  ) : (
    <ContentNotice status={scanned.status} reason={scanned.reason} noun={noun} className={noticeClassName} />
  );
}
