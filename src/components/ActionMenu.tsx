"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// Shared 16px line icons (lucide-style) for action rows and overflow menus.
// Kept at module scope so they aren't re-created per render.
const svgProps = {
  className: "h-4 w-4 shrink-0",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const ACTION_ICONS = {
  reply: (
    <svg {...svgProps}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  edit: (
    <svg {...svgProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  trash: (
    <svg {...svgProps}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  eye: (
    <svg {...svgProps}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  lock: (
    <svg {...svgProps}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  pin: (
    <svg {...svgProps}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  ),
};

export interface ActionMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  // Accent color classes for the row (e.g. "text-red-400").
  className?: string;
  // Provide one of onClick (button) or href (link).
  onClick?: () => void;
  href?: string;
}

// The ⋯ overflow menu shared by post and reply action rows. Renders the
// trigger only when there are items; closes on outside click. Styled to match
// the add-reaction button.
export default function ActionMenu({
  items,
  disabled,
  label = "Actions",
}: {
  items: ActionMenuItem[];
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (items.length === 0) return null;

  const itemClass = (accent?: string) =>
    `flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-zinc-800 disabled:opacity-50 ${
      accent ?? "text-zinc-300"
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className={`flex items-center rounded-lg border px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-zinc-600 bg-zinc-700" : "border-transparent bg-zinc-800"
        }`}
      >
        <svg
          className={`h-4 w-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 min-w-36 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setOpen(false)}
                className={itemClass(item.className)}
              >
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                disabled={disabled}
                className={itemClass(item.className)}
              >
                {item.icon}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
