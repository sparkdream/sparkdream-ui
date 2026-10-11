"use client";

import { useEffect, useState } from "react";
import { LOADING, resolveVerdict, type Verdict, type VerdictQuery } from "@/lib/contentScan/client";

// Re-check while a subject is unchecked, so "Being checked" clears without a
// reload once the scanners catch up. The relay caches for a minute anyway.
const RECHECK_MS = 60_000;

/**
 * The combined scanner verdict for one subject (docs/content-scanning.md §6).
 * Pass null to skip. Starts as unchecked/loading.
 */
export function useVerdict(query: VerdictQuery | null): Verdict {
  const key = query ? JSON.stringify(query) : "";
  const [state, setState] = useState<{ key: string; verdict: Verdict }>({ key, verdict: LOADING });

  useEffect(() => {
    if (!key) return;
    const q = JSON.parse(key) as VerdictQuery;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      resolveVerdict(q)
        .then((verdict) => {
          if (cancelled) return;
          setState({ key, verdict });
          if (verdict.state === "unchecked" && verdict.reason !== "archive") {
            timer = setTimeout(run, RECHECK_MS);
          }
        })
        .catch(() => {
          if (!cancelled) setState({ key, verdict: { state: "unchecked", reason: "unreachable" } });
        });
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  // A changed query shows loading until its own verdict arrives.
  return state.key === key ? state.verdict : LOADING;
}
