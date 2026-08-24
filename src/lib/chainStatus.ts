// Live reachability of the LCD node, shared between lib/api.ts and the UI.
//
// Individual views already render their own failure, but when the node is down
// every card on the page falls back to its empty state ("No sparks yet"),
// which reads as "there is nothing here" rather than "nothing could load".
// One banner at the top of the app says which of the two it is; the per-view
// ErrorStates stay for the views that can retry.

type Listener = () => void;

let down = false;
const listeners = new Set<Listener>();

function set(next: boolean): void {
  if (down === next) return;
  down = next;
  for (const l of listeners) l();
}

/** A read reached the node, whatever it answered. */
export function reportChainReachable(): void {
  set(false);
}

/** A read failed with no usable response: network error, timeout, or gateway error. */
export function reportChainUnreachable(): void {
  set(true);
}

export function isChainDown(): boolean {
  return down;
}

export function subscribeChainStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
