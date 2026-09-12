"use client";

import { useEffect, useState } from "react";
import { getBlockClock, type BlockClock } from "@/lib/api";
import { formatDurationApprox } from "@/lib/utils";

// The clock drives countdowns rendered in minutes, so a slow poll is enough to
// keep them honest. getBlockClock's own cache collapses whatever overlaps
// across the components mounted at once.
const POLL_MS = 30_000;

/**
 * Latest height plus the recent block interval, refreshed on a timer. Null
 * until the first sample lands, and stays null while the chain is unreachable
 * — callers should degrade to showing the raw block height.
 */
export function useBlockClock(): BlockClock | null {
  const [clock, setClock] = useState<BlockClock | null>(null);

  useEffect(() => {
    let active = true;
    const tick = () => {
      getBlockClock()
        .then((c) => {
          // A failed sample leaves the previous one in place: a stale height is
          // a better countdown than no countdown, and the next tick corrects it.
          if (active && c) setClock(c);
        })
        .catch(() => { /* leave the last good sample */ });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return clock;
}

/**
 * How long until the chain reaches `height`, as "in ~4h 30m". Returns "" when
 * there is no clock to extrapolate from, and when the block has already been
 * committed — a committed block has a real time, so ask BlockTime for it
 * instead of estimating one.
 */
export function formatBlockEta(clock: BlockClock | null, height: string | undefined): string {
  if (!clock || !height || height === "0" || !/^\d+$/.test(height)) return "";
  const target = BigInt(height);
  if (target <= clock.height) return "";
  const blocks = Number(target - clock.height);
  const seconds = Math.round(blocks * clock.secondsPerBlock);
  // Sub-minute spans floor to "0m" in formatDurationApprox; at one block every
  // few seconds that window is a handful of blocks and reads as stuck.
  if (seconds < 60) return "in under a minute";
  return `in ~${formatDurationApprox(seconds)}`;
}
