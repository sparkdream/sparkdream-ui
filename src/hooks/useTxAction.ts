"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/errors";

export interface TxActionState {
  /** Key of the action currently in flight, or null when idle. */
  pending: string | null;
  /** True while any action is in flight. */
  busy: boolean;
  /** Message from the most recent failure, or null. Feed this to `ActionBanner`. */
  error: string | null;
  /** Dismiss the banner. */
  clearError: () => void;
  /** Set the banner directly, for client-side validation that never reaches the chain. */
  setError: (message: string | null) => void;
  /**
   * Run `fn` under `key`, routing any throw to `error` instead of `alert()`.
   * Resolves true when `fn` completed, false when it threw -- so callers can
   * skip their success side effects without a second try/catch.
   *
   * `describe` is either a plain fallback used when the thrown value carries
   * no message, or a function that receives the raw chain message and returns
   * the text to show -- for callers that need to say *which* item failed, e.g.
   * `(raw) => \`Unhide of post #\${id} failed: \${raw}\``.
   */
  run: (
    key: string,
    fn: () => Promise<void>,
    describe?: string | ((rawMessage: string) => string)
  ) => Promise<boolean>;
}

/**
 * Loading-key + error-surface plumbing shared by every panel that broadcasts
 * transactions.
 *
 * Panels used to hand-roll `setActionLoading(key)` / `try` / `catch { alert(...) }`
 * / `finally`, which is how the alert-vs-error-box inconsistency crept in: the
 * error box is a render-time decision, so a component with no error state had
 * nowhere to put the message and reached for `alert()`. Owning both pieces
 * here makes the in-page banner the path of least resistance.
 */
export function useTxAction(): TxActionState {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const run = useCallback(
    async (
      key: string,
      fn: () => Promise<void>,
      describe: string | ((rawMessage: string) => string) = "Transaction failed"
    ) => {
      setPending(key);
      // Clear the previous failure up front: leaving a stale message next to a
      // spinner reads as though the new attempt has already failed.
      setError(null);
      try {
        await fn();
        return true;
      } catch (err) {
        const raw = errorMessage(err);
        setError(
          typeof describe === "function"
            ? describe(raw || "transaction failed")
            : raw || describe
        );
        return false;
      } finally {
        setPending(null);
      }
    },
    []
  );

  return { pending, busy: pending !== null, error, clearError, setError, run };
}
