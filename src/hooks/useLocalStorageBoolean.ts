import { useCallback, useSyncExternalStore } from "react";

// Subscribe to cross-tab `storage` events. Returns a no-op on the server
// (no window) — `useSyncExternalStore` only ever calls `subscribe` on the
// client after hydration, so this branch exists only to keep TS happy.
function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

/**
 * A boolean state hook backed by localStorage. SSR-safe: the server snapshot
 * is `null` so the fallback is used until hydration. After mount, the value
 * comes from `useSyncExternalStore`, which means multiple instances with the
 * same key stay in sync within a tab (via a manual `storage` event dispatch
 * on write) and across tabs (via the native event).
 */
export function useLocalStorageBoolean(
  key: string,
  fallback: boolean
): [boolean, (v: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => getSnapshot(key),
    () => null
  );
  const value = stored === null ? fallback : stored === "1";

  const setValue = useCallback(
    (v: boolean) => {
      if (typeof window === "undefined") return;
      localStorage.setItem(key, v ? "1" : "0");
      // The browser fires `storage` only for changes in *other* tabs, so
      // same-tab subscribers wouldn't otherwise repaint. Re-dispatch with
      // the same key so every hook instance in this tab picks it up.
      window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    [key]
  );

  return [value, setValue];
}
