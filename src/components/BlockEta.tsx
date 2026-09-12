"use client";

import BlockTime from "@/components/BlockTime";
import { useBlockClock, formatBlockEta } from "@/hooks/useBlockClock";

interface BlockEtaProps {
  // Block height (decimal string). Unlike BlockTime this accepts heights the
  // chain has not reached yet — a review deadline, the end of a challenge
  // window — and estimates when it will.
  height?: string;
  // Rendered once the height is reached but before its block resolves, and
  // whenever the chain is unreachable. Empty by default, matching BlockTime.
  fallback?: string;
}

/**
 * A block height as a time: the block's committed time once it exists, an
 * estimate ("in ~4h 30m") while it is still ahead. Renders plain text with no
 * wrapping element, so it drops into a sentence the way BlockTime does.
 *
 * Deadlines are the reason this exists. BlockTime alone renders nothing for a
 * height in the future, which is exactly the case a reader cares about: the
 * question is never when a window opened, it is how long is left.
 */
export default function BlockEta({ height, fallback }: BlockEtaProps) {
  const clock = useBlockClock();
  if (!height || height === "0") return null;

  const eta = formatBlockEta(clock, height);
  if (eta) return <>{eta}</>;

  return <BlockTime height={height} fallback={fallback} />;
}
