"use client";

import ContentNotice from "@/components/content/ContentNotice";
import { useScannedBody, type ScannedBodyInput } from "@/hooks/useScannedBody";

// A content body under the scanner display policy (docs/content-scanning.md
// §6), for render sites that can't call the hook themselves (render helpers
// inside a loop). The text is rendered as plain text, never as HTML or
// markdown, so URLs inside it are neither fetched nor clickable.

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
}

export default function ScannedText({ input, noun, className, noticeClassName, compact, format, as = "div" }: ScannedTextProps) {
  const scanned = useScannedBody(input);
  const Wrap = as;
  if (scanned.status === "show") {
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
