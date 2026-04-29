import { useEffect, useState } from "react";

/**
 * A boolean state hook backed by localStorage. Reads the persisted value on
 * mount; writes on subsequent changes. Returns `[value, setValue]` like
 * `useState`. Multiple instances with the same `key` will diverge in a single
 * tab until remounted — for shared state across components, lift to a parent
 * and pass `[value, setValue]` down.
 */
export function useLocalStorageBoolean(
  key: string,
  fallback: boolean
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(fallback);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored !== null) setValue(stored === "1");
    setRestored(true);
  }, [key]);

  useEffect(() => {
    if (restored) localStorage.setItem(key, value ? "1" : "0");
  }, [key, value, restored]);

  return [value, setValue];
}
