"use client";

import { forwardRef } from "react";

/**
 * Search input matching the Swarm/Imaginarium toolbar search: magnifier glyph,
 * a ⌘K affordance (swapped for a clear button once there's text), and the
 * zinc-palette styling the Contribute page uses. Pair the forwarded ref with
 * `useSearchShortcut` to wire ⌘K / Ctrl-K focus.
 */
interface SearchFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, placeholder = "Search..." },
  ref,
) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 transition-colors focus-within:border-indigo-500">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="shrink-0 text-zinc-500"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 text-zinc-500 transition-colors hover:text-zinc-300"
          aria-label="Clear search"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : (
        <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] leading-none text-zinc-500">
          ⌘K
        </span>
      )}
    </label>
  );
});

export default SearchField;
