import { useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";

/**
 * Returns a predicate reporting whether the current signing context may execute
 * a given message type. In session mode only the session's allowed_msg_types
 * can be signed; with the full wallet everything is allowed.
 *
 * Use this to hide (or disable) action affordances the user can't actually
 * invoke, rather than letting the tx fail at broadcast with a "message type not
 * in session's allowed list" error.
 */
export function useSessionPermits() {
  const { sessionActive, activeSession } = useWallet();
  return useCallback(
    (typeUrl: string) =>
      !sessionActive || !!activeSession?.allowed_msg_types?.includes(typeUrl),
    [sessionActive, activeSession]
  );
}
