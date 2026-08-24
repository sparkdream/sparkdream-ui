"use client";

import { useSyncExternalStore } from "react";
import { isChainDown, subscribeChainStatus } from "@/lib/chainStatus";

// Server render and first client render must agree, so the banner starts
// hidden and appears only after a read actually fails.
function serverSnapshot(): boolean {
  return false;
}

export default function ChainStatusBanner() {
  const down = useSyncExternalStore(subscribeChainStatus, isChainDown, serverSnapshot);
  if (!down) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="px-4 py-2 text-center text-xs"
      style={{
        background: "var(--amber-soft)",
        borderBottom: "1px solid rgba(245, 158, 11, 0.3)",
        color: "var(--ink-soft)",
      }}
    >
      <span
        aria-hidden
        className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle"
        style={{ background: "var(--amber)" }}
      />
      Chain node unreachable. Onchain data can&apos;t load right now, so counts and lists on this
      page may be empty or out of date.
    </div>
  );
}
