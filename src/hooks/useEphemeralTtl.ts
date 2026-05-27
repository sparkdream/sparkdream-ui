"use client";

import { useEffect, useState } from "react";
import { getParams, getForumParams } from "@/lib/api";

/**
 * Fetches the ephemeral-content TTL (in seconds) for the given module:
 *
 * - `blog`  → `params.ephemeral_content_ttl` (default 7 days)
 * - `forum` → `params.ephemeral_ttl` (default 24 hours)
 *
 * Returns `null` while loading or if the param fetch fails. Callers should
 * skip the affordance / hint while null rather than guess a default.
 */
export function useEphemeralTtl(kind: "blog" | "forum"): number | null {
  const [ttl, setTtl] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetcher = kind === "blog" ? getParams() : getForumParams();
    fetcher
      .then((res) => {
        if (cancelled) return;
        const p = (res.params ?? {}) as unknown as Record<string, unknown>;
        const raw = kind === "blog" ? p.ephemeral_content_ttl : p.ephemeral_ttl;
        if (typeof raw === "string" && /^\d+$/.test(raw)) {
          setTtl(parseInt(raw, 10));
        } else if (typeof raw === "number") {
          setTtl(raw);
        }
      })
      .catch(() => {
        // Leave at null — caller hides the hint rather than showing a guess.
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);
  return ttl;
}

/**
 * Human-friendly TTL: "24 hours", "7 days", "3 hours", "5 minutes".
 * Picks the largest unit that yields a whole or near-whole number; falls
 * back to seconds for sub-minute values (shouldn't happen in practice).
 */
export function formatTtl(seconds: number): string {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
