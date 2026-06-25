"use client";

import { useEffect, useState } from "react";
import { getBlockTime } from "@/lib/api";
import { formatTime, timeAgo } from "@/lib/utils";

interface BlockTimeProps {
  // Block height (decimal string). The collect module stores created_at/
  // added_at/updated_at as block heights, not unix timestamps, so they must be
  // resolved to the block's committed wall-clock time before display.
  height?: string;
  // Render relative ("2h ago") instead of an absolute date.
  relative?: boolean;
}

// Resolves a block height to its committed time and renders it as plain text
// (no wrapping element, so it drops into any existing dd/span/p). Renders
// nothing until the lookup resolves, or if the height is unset / unresolvable
// — which avoids the Dec 31 1969 artifact from treating a small block height
// as unix seconds.
export default function BlockTime({ height, relative }: BlockTimeProps) {
  // Keyed by height so a stale resolution from a previous height never shows.
  const [resolved, setResolved] = useState<{ height: string; time: string } | null>(null);

  useEffect(() => {
    if (!height || height === "0") return;
    let active = true;
    getBlockTime(height).then((t) => {
      if (active) setResolved({ height, time: t });
    });
    return () => {
      active = false;
    };
  }, [height]);

  if (!height || height === "0") return null;
  const time = resolved?.height === height ? resolved.time : "";
  if (!time) return null;
  const label = relative ? timeAgo(time) : formatTime(time);
  if (!label) return null;
  return <>{label}</>;
}
