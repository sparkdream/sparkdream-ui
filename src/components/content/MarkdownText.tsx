"use client";

import ReactMarkdown, { type Components } from "react-markdown";

// Markdown formatting for a body that has already passed the scanner display
// policy (useScannedBody). Formatting only: headings, lists, emphasis, code,
// quotes. Nothing here makes the browser fetch or follow a URL
// (docs/content-scanning.md §6): a link is shown as its text and address, an
// image as its source text, and raw HTML as the text it is (react-markdown
// never parses it). Images that are scanner subjects are cut out before this
// by BodyWithImages.

const components: Components = {
  h1: ({ children }) => <h2 className="text-xl font-bold text-white">{children}</h2>,
  h2: ({ children }) => <h3 className="text-lg font-semibold text-white">{children}</h3>,
  h3: ({ children }) => <h4 className="text-base font-semibold text-white">{children}</h4>,
  h4: ({ children }) => <h5 className="font-semibold text-zinc-100">{children}</h5>,
  h5: ({ children }) => <h6 className="font-semibold text-zinc-200">{children}</h6>,
  h6: ({ children }) => <h6 className="font-medium text-zinc-300">{children}</h6>,
  // A single line break in the source stays a line break, as it does in a
  // plain text body.
  p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="list-decimal space-y-1 pl-6">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="space-y-2">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="space-y-3 border-l-2 border-zinc-700 pl-4 text-zinc-400">{children}</blockquote>
  ),
  hr: () => <hr className="border-zinc-800" />,
  code: ({ children }) => (
    <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[0.9em] text-zinc-200">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto whitespace-pre rounded-lg bg-zinc-900/80 p-3 text-sm [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  // Never a clickable link: the text, then where it points.
  a: ({ children, href }) => {
    const label = typeof children === "string" ? children : null;
    return (
      <span className="[overflow-wrap:anywhere]">
        {children}
        {href && href !== label ? ` (${href})` : null}
      </span>
    );
  },
  // Never an <img>: an image link that is not a scanner subject stays text.
  img: ({ alt, src }) => (
    <span className="[overflow-wrap:anywhere]">{`![${alt ?? ""}](${typeof src === "string" ? src : ""})`}</span>
  ),
};

// Addresses are only ever printed, so they are shown as written.
const asWritten = (url: string) => url;

export default function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    // The inner element resets white-space, whatever `className` sets.
    <div className={className}>
      <div className="space-y-3 whitespace-normal">
        <ReactMarkdown components={components} urlTransform={asWritten}>
          {text}
        </ReactMarkdown>
      </div>
    </div>
  );
}
