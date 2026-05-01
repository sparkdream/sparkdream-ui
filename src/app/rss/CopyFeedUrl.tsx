"use client";

import { useState } from "react";

export default function CopyFeedUrl({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Older browsers / blocked clipboard — fall back to selecting the input.
      const el = document.getElementById("rss-url-input") as HTMLInputElement | null;
      el?.select();
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
      <input
        id="rss-url-input"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          flex: "1 1 320px",
          minWidth: 0,
          padding: "8px 12px",
          border: "1px solid var(--line)",
          borderRadius: 8,
          background: "var(--panel-2)",
          color: "var(--ink)",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 13,
        }}
      />
      <button
        type="button"
        onClick={copy}
        className="sd-btn-primary"
        style={{ minWidth: 96 }}
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
      <a href={path} className="sd-btn-ghost" style={{ minWidth: 96, textAlign: "center" }}>
        Open
      </a>
    </div>
  );
}
