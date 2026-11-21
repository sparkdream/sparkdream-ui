// Classes for formatted bodies, shared by MarkdownText and HtmlText so a
// dream reads the same whichever way it was written. A body's top heading
// sits under the title, so headings start one step down from it.
export const PROSE = {
  root: "space-y-3 whitespace-normal",
  h1: "text-xl font-bold text-white",
  h2: "text-lg font-semibold text-white",
  h3: "text-base font-semibold text-white",
  h4: "font-semibold text-zinc-100",
  h5: "font-semibold text-zinc-200",
  h6: "font-medium text-zinc-300",
  ul: "list-disc space-y-1 pl-6",
  ol: "list-decimal space-y-1 pl-6",
  li: "space-y-2",
  strong: "font-semibold text-zinc-100",
  blockquote: "space-y-3 border-l-2 border-zinc-700 pl-4 text-zinc-400",
  hr: "border-zinc-800",
  code: "rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[0.9em] text-zinc-200",
  pre: "overflow-x-auto whitespace-pre rounded-lg bg-zinc-900/80 p-3 text-sm [&>code]:bg-transparent [&>code]:p-0",
  wrap: "[overflow-wrap:anywhere]",
  tableWrap: "overflow-x-auto",
  table: "border-collapse text-sm",
  caption: "mb-1 text-left text-xs text-zinc-500",
  th: "border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-left font-semibold text-zinc-100",
  td: "border border-zinc-800 px-3 py-1.5 align-top",
  dt: "font-semibold text-zinc-100",
  dd: "pl-6",
  mark: "rounded bg-amber-400/20 px-0.5 text-amber-100",
} as const;
