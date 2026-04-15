"use client";

import { useState, useRef, useEffect } from "react";

interface TagPickerProps {
  /** All available tags to choose from */
  options: string[];
  /** Currently selected tags */
  value: string[];
  /** Called when selection changes */
  onChange: (tags: string[]) => void;
  placeholder?: string;
  loading?: boolean;
  /** Allow typing new tags that don't exist in options */
  allowCreate?: boolean;
}

export default function TagPicker({
  options,
  value,
  onChange,
  placeholder = "Select tags...",
  loading = false,
  allowCreate = false,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? options.filter(
        (t) => t.toLowerCase().includes(query.toLowerCase()) && !value.includes(t)
      )
    : options.filter((t) => !value.includes(t));

  const trimmedQuery = query.trim();
  const showCreate =
    allowCreate &&
    trimmedQuery.length > 0 &&
    !value.includes(trimmedQuery) &&
    !options.some((t) => t.toLowerCase() === trimmedQuery.toLowerCase());

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const addTag = (tag: string) => {
    onChange([...value, tag]);
    setQuery("");
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-sm transition-colors hover:border-zinc-600 focus-within:border-indigo-500"
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-0.5 text-xs font-medium text-indigo-400"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              className="ml-0.5 text-indigo-400/60 hover:text-indigo-300"
            >
              &times;
            </button>
          </span>
        ))}
        {loading ? (
          <span className="text-xs text-zinc-500">Loading tags...</span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && showCreate) {
                e.preventDefault();
                addTag(trimmedQuery);
              }
            }}
            onFocus={() => setOpen(true)}
            placeholder={value.length === 0 ? placeholder : ""}
            className="min-w-[80px] flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none"
          />
        )}
      </div>

      {open && !loading && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <ul className="max-h-48 overflow-y-auto py-1">
            {showCreate && (
              <li>
                <button
                  type="button"
                  onClick={() => addTag(trimmedQuery)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-indigo-400 transition-colors hover:bg-zinc-800"
                >
                  Create &ldquo;{trimmedQuery}&rdquo;
                </button>
              </li>
            )}
            {filtered.length === 0 && !showCreate ? (
              <li className="px-3 py-2 text-sm text-zinc-500">
                {options.length === 0 && !allowCreate ? "No tags available" : "No matches"}
              </li>
            ) : (
              filtered.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => addTag(tag)}
                    className="flex w-full items-center px-3 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    {tag}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
