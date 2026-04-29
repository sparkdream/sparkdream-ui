import { useEffect, type RefObject } from "react";

/**
 * Wires ⌘K / Ctrl-K to focus the given input ref. Used by the standard
 * search field in `<ContentToolbar>`.
 */
export function useSearchShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);
}
