"use client";

import { describeMediaFlags } from "@/lib/mediaLabels";
import type { MediaGateState } from "@/hooks/useMediaGate";

/**
 * Pre-submit notice for a blog or forum write the chain will label as media
 * (docs/content-scanning.md §3, §9). Explains the hold for scanners, the
 * burned scan fee, and, when the author can't post media, why. Renders
 * nothing for plain text.
 */
export default function MediaWriteNotice({
  flags,
  gate,
  noun = "post",
}: {
  flags: number;
  gate: MediaGateState;
  /** What is being written, in copy ("dream", "reply", "spark"). */
  noun?: string;
}) {
  if (!gate.isMedia) return null;
  const why = describeMediaFlags(flags);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-xs text-zinc-400">
      <p className="text-sm font-medium text-zinc-200">This {noun} counts as media</p>
      <p className="mt-1">
        {why ? `${why}, so the` : "The"} chain holds the content back until content scanners check it.
        Readers see it once enough scanners have cleared it.
      </p>
      {gate.scanFeeLabel && (
        <p className="mt-1">
          Posting media burns a scan fee of{" "}
          <span className="font-medium text-zinc-200">{gate.scanFeeLabel}</span>.
        </p>
      )}
      {gate.needsBond && !gate.blockReason && gate.bondMinLabel && (
        <p className="mt-1" style={{ color: "var(--amber)" }}>
          Your author bond of at least {gate.bondMinLabel} lets you post media below the trust bar. A
          confirmed abuse verdict costs you the bond.
        </p>
      )}
      {gate.blockReason && <p className="mt-2 text-sm text-red-400">{gate.blockReason}</p>}
    </div>
  );
}
