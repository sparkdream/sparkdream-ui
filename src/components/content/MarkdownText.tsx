"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import { PROSE } from "@/components/content/proseStyles";
import { markdownTooDeep } from "@/lib/markdownPreview";

// Markdown formatting for a body that has already passed the scanner display
// policy (useScannedBody). Formatting only: headings, lists, emphasis, code,
// quotes. Nothing here makes the browser fetch or follow a URL
// (docs/content-scanning.md §6): a link is shown as its text and address, an
// image as its source text, and raw HTML as the text it is (react-markdown
// never parses it). Images that are scanner subjects are cut out before this
// by BodyWithImages.

const components: Components = {
  h1: ({ children }) => <h2 className={PROSE.h1}>{children}</h2>,
  h2: ({ children }) => <h3 className={PROSE.h2}>{children}</h3>,
  h3: ({ children }) => <h4 className={PROSE.h3}>{children}</h4>,
  h4: ({ children }) => <h5 className={PROSE.h4}>{children}</h5>,
  h5: ({ children }) => <h6 className={PROSE.h5}>{children}</h6>,
  h6: ({ children }) => <h6 className={PROSE.h6}>{children}</h6>,
  // A single line break in the source stays a line break, as it does in a
  // plain text body.
  p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
  ul: ({ children }) => <ul className={PROSE.ul}>{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className={PROSE.ol}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li className={PROSE.li}>{children}</li>,
  strong: ({ children }) => <strong className={PROSE.strong}>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className={PROSE.blockquote}>{children}</blockquote>
  ),
  hr: () => <hr className={PROSE.hr} />,
  code: ({ children }) => (
    <code className={PROSE.code}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className={PROSE.pre}>
      {children}
    </pre>
  ),
  // Never a clickable link: the text, then where it points.
  a: ({ children, href }) => {
    const label = typeof children === "string" ? children : null;
    return (
      <span className={PROSE.wrap}>
        {children}
        {href && href !== label ? ` (${href})` : null}
      </span>
    );
  },
  // Never an <img>: an image link that is not a scanner subject stays text.
  img: ({ alt, src }) => (
    <span className={PROSE.wrap}>{`![${alt ?? ""}](${typeof src === "string" ? src : ""})`}</span>
  ),
};

// Addresses are only ever printed, so they are shown as written.
const asWritten = (url: string) => url;

export default function MarkdownText({ text, className }: { text: string; className?: string }) {
  // Nested too deeply to render safely: shown as the text it is.
  if (markdownTooDeep(text)) return <div className={`whitespace-pre-wrap ${className ?? ""}`}>{text}</div>;
  return (
    // The inner element resets white-space, whatever `className` sets.
    <div className={className}>
      <div className={PROSE.root}>
        <ReactMarkdown components={components} urlTransform={asWritten}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}
