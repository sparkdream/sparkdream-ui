"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy arbitrary text to the clipboard with brief "just copied" state.
 * `copied` flips to true on success and back to false after `resetMs`,
 * so callers can render a transient tooltip / icon swap without
 * managing their own timer.
 *
 * Falls back to a temporary off-screen <textarea> + `document.execCommand("copy")`
 * when `navigator.clipboard` is unavailable — insecure contexts (file://, plain
 * http on a LAN IP), older Safari, or embedded webviews that gate the async
 * clipboard API behind permissions we don't ask for.
 */
export function useCopy(resetMs = 1000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;
      let ok = false;
      try {
        if (
          typeof navigator !== "undefined" &&
          navigator.clipboard &&
          typeof window !== "undefined" &&
          window.isSecureContext
        ) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else if (typeof document !== "undefined") {
          const el = document.createElement("textarea");
          el.value = text;
          el.setAttribute("readonly", "");
          el.style.position = "fixed";
          el.style.top = "-1000px";
          el.style.opacity = "0";
          document.body.appendChild(el);
          el.select();
          ok = document.execCommand("copy");
          document.body.removeChild(el);
        }
      } catch {
        ok = false;
      }
      if (ok) {
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, resetMs);
      }
      return ok;
    },
    [resetMs]
  );

  return { copied, copy };
}
