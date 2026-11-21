"use client";

import { Component, type ReactNode } from "react";
import BodyWithImages from "@/components/content/BodyWithImages";
import HtmlText from "@/components/content/HtmlText";
import MarkdownText from "@/components/content/MarkdownText";
import { MAX_FORMATTED_CHARS, type BodyFormat } from "@/lib/contentScan/bodyFormat";
import { dropTitleHeading } from "@/lib/markdownPreview";

// A formatted body (Markdown or HTML) that has already passed the scanner
// display policy (useScannedBody). `images` draws embedded images as scanner
// subjects; without it they stay text. `title` is the title shown above the
// body, so an opening heading that only repeats it is left out.
//
// A body is chain data, written by anyone. Formatting it must never be able
// to take the page down, so a body that is too large, or whose rendering
// throws for any reason, is shown as the plain text it is.

function PlainBody({ text, className }: { text: string; className?: string }) {
  return <div className={`whitespace-pre-wrap ${className ?? ""}`}>{text}</div>;
}

class RenderGuard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function RichBody({
  text,
  format,
  title,
  images = false,
  className,
}: {
  text: string;
  format: BodyFormat;
  title?: string;
  images?: boolean;
  className?: string;
}) {
  const plain = <PlainBody text={text} className={className} />;
  if (text.length > MAX_FORMATTED_CHARS) return plain;
  let body: ReactNode;
  if (format === "html") {
    body = <HtmlText text={text} title={title} images={images} className={className} />;
  } else {
    const md = title ? dropTitleHeading(text, title) : text;
    body = images ? (
      <div className={className}>
        <BodyWithImages text={md} markdown />
      </div>
    ) : (
      <MarkdownText text={md} className={className} />
    );
  }
  // Keyed by the body, so a failure on one body doesn't stick to the next.
  return (
    <RenderGuard key={`${format}|${text}`} fallback={plain}>
      {body}
    </RenderGuard>
  );
}
