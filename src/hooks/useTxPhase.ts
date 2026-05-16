import { useCallback, useEffect, useState } from "react";
import type { TxPhase } from "@/contexts/WalletContext";

export interface TxPhaseTracker {
  /** Current phase, or `null` when idle / between txs. */
  phase: TxPhase | null;
  /** Pass this as the `onPhase` callback to `signAndBroadcast`. */
  setPhase: (p: TxPhase | null) => void;
  /** Seconds elapsed in the current "confirming" phase. Resets on every phase change. */
  elapsed: number;
  /**
   * Map an idle button label (e.g. "Delegate", "Claim Rewards") through to a
   * phase-appropriate label like "Signing..." / "Confirming (12s)...".
   */
  buttonLabel: (idleLabel: string) => string;
  /** Inline hint to show below the action during `confirming`; `null` otherwise. */
  hint: string | null;
}

/**
 * Shared phase-tracking + elapsed-counter for any caller of
 * `signAndBroadcast(msgs, memo, onPhase)`. Chain inclusion on this network
 * typically takes ~90s, so without per-phase feedback the button looks frozen
 * on "Signing..." long after the user has actually finished signing.
 */
export function useTxPhase(): TxPhaseTracker {
  const [phase, setPhaseRaw] = useState<TxPhase | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Reset elapsed atomically when the caller advances the phase. Doing this
  // here (in an event-handler-style setter) rather than in an effect keeps us
  // clear of the react-hooks/set-state-in-effect lint and the purity rule
  // that blocks Date.now() at render time.
  const setPhase = useCallback((p: TxPhase | null) => {
    setPhaseRaw(p);
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (phase !== "confirming") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const buttonLabel = (idleLabel: string): string => {
    if (phase === "signing") return "Signing...";
    if (phase === "broadcasting") return "Broadcasting...";
    if (phase === "confirming") return `Confirming (${elapsed}s)...`;
    return idleLabel;
  };

  const hint =
    phase === "confirming"
      ? `Waiting for chain inclusion (${elapsed}s) — typically takes around 90s on this network, occasionally longer.`
      : null;

  return { phase, setPhase, elapsed, buttonLabel, hint };
}
