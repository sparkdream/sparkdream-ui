"use client";

import { useEffect, useState } from "react";
import type { ReactNode, Ref } from "react";
import Image from "next/image";

/**
 * Standard 3-column shell for content pages (Imaginarium, Swarm, Wonders).
 * The same `sidebar` JSX is rendered both in the desktop left aside and inside
 * the rail's `sd-rail-filters` so mobile users see the filters with the rail
 * cards. For the duplicated state to stay in sync, callers should hold sidebar
 * collapse/filter state in the parent and pass it down (e.g. via
 * `useLocalStorageBoolean`).
 */
export function ContentPageLayout({
  title,
  subtitle,
  sidebar,
  toolbar,
  railCards,
  children,
}: {
  /** Page title banner. Pass `null` to suppress the entire `sd-page-header`
      block — useful when the page renders its own breadcrumb instead. */
  title: ReactNode;
  subtitle?: ReactNode;
  sidebar: ReactNode;
  toolbar?: ReactNode;
  railCards?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sd-page">
      {title !== null && (
        <header className="sd-page-header">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      <div className="sd-page-grid with-rail">
        <aside className="sd-side">{sidebar}</aside>
        <section>
          {toolbar}
          {children}
        </section>
        <aside className="sd-rail">
          <div className="sd-rail-filters">{sidebar}</div>
          {railCards}
        </aside>
      </div>
    </div>
  );
}

export interface PrimaryAction {
  label: string;
  glyph?: string;
  onClick: () => void;
  /** "spark" swaps the CTA to a warm ember gradient with a flame glyph — use
      only for spark-creation actions. "dream" swaps to a gold gradient with a
      telescope/vision glyph — use only for dream-creation actions. "collection"
      swaps to a crystal (cyan/teal) gradient with a tome glyph — use only for
      Wonders collection-creation actions. */
  variant?: "default" | "spark" | "dream" | "collection";
  disabled?: boolean;
  title?: string;
}

/**
 * Standard toolbar: optional segmented filter (`sd-seg`), search input with
 * ⌘K hint, sort dropdown, and an optional primary action button. RSS lives in
 * the global header.
 */
export function ContentToolbar({
  segments,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  searchRef,
  sort,
  onSortChange,
  extraFilters,
  primaryAction,
}: {
  segments?: ReactNode;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchRef?: Ref<HTMLInputElement>;
  sort: "newest" | "oldest";
  onSortChange: (v: "newest" | "oldest") => void;
  /** Additional controls (e.g. type filter dropdown) rendered next to the sort. */
  extraFilters?: ReactNode;
  primaryAction?: PrimaryAction | null;
}) {
  return (
    <div className="sd-blog-toolbar">
      {segments && <div className="sd-seg">{segments}</div>}
      <label className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--ink-mute)" }}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={searchRef}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
        />
        <span className="k">⌘K</span>
      </label>
      <select
        className="sd-select"
        value={sort}
        onChange={(e) => onSortChange(e.target.value as "newest" | "oldest")}
      >
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
      {extraFilters}
      {primaryAction && (
        <div className="sd-toolbar-actions">
          <PrimaryActionButton action={primaryAction} />
        </div>
      )}
    </div>
  );
}

// Primary action buttons frequently encode wallet/member state in their
// `disabled` and `title` props. That state isn't available during SSR (no
// window/localStorage/Keplr), so the server renders the unconnected version
// while the client's first paint may already have the connected version,
// producing a hydration mismatch. Defer the prop-driven version until after
// Small embers that rise off the New spark button's lava lake (spark variant
// only). Movement mirrors the background SparkField — rise with a zigzag sway —
// but scaled to button height. Authored (not random) so SSR/client match.
const BTN_SPARKS = [
  { left: 18, size: 4, dur: 2.6, delay: 0.0, sway: 3 },
  { left: 30, size: 3, dur: 3.2, delay: 1.1, sway: 4 },
  { left: 40, size: 5, dur: 2.4, delay: 2.0, sway: 2 },
  { left: 50, size: 3, dur: 3.6, delay: 0.6, sway: 4 },
  { left: 58, size: 4, dur: 2.8, delay: 1.7, sway: 3 },
  { left: 68, size: 3, dur: 3.0, delay: 2.6, sway: 5 },
  { left: 76, size: 5, dur: 2.5, delay: 0.9, sway: 3 },
  { left: 85, size: 3, dur: 3.4, delay: 1.9, sway: 4 },
  { left: 24, size: 3, dur: 2.9, delay: 3.0, sway: 4 },
] as const;

// hydration: render disabled-with-no-tooltip on first paint (matching SSR),
// then swap in the real values via a post-mount effect. `suppressHydration
// Warning` covers a residual React 19 diff that reports `disabled` as
// null-vs-true even though the SSR HTML carries `disabled=""`.
function PrimaryActionButton({ action }: { action: PrimaryAction }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const effectiveDisabled = hydrated ? !!action.disabled : true;
  const effectiveTitle = hydrated ? action.title : undefined;
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={effectiveDisabled}
      title={effectiveTitle}
      suppressHydrationWarning
      className={`sd-btn ${
        action.variant === "spark"
          ? "sd-btn-spark"
          : action.variant === "dream"
            ? "sd-btn-dream"
            : action.variant === "collection"
              ? "sd-btn-collection"
              : "sd-btn-primary"
      }`}
    >
      {action.variant === "spark" && (
        <span className="sd-btn-sparks" aria-hidden="true">
          {BTN_SPARKS.map((s, i) => (
            <span
              key={i}
              className="sd-btn-spark-bit"
              style={{
                left: `${s.left}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDuration: `${s.dur}s`,
                animationDelay: `-${s.delay}s`,
                ["--bspark-sway" as string]: `${s.sway}px`,
              }}
            />
          ))}
        </span>
      )}
      {action.variant === "spark" ? (
        <svg
          className="flame"
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 2s4 4.5 4 8.5a4 4 0 01-8 0c0-1.2.4-2.2.9-3-.2 1.6-1.4 2.5-1.4 4.2A5.5 5.5 0 0013 17.5c3 0 5.5-2.5 5.5-5.8 0-4-2-6.5-3.5-8.2C13.8 2.3 12 2 12 2zm-1.1 13.2c-.9.6-1.4 1.4-1.4 2.4a2.5 2.5 0 005 0c0-1.6-1.6-2.2-1.6-3.6 0 .9-.7 1.6-1 2-.4-.2-.7-.5-1-.8z" />
        </svg>
      ) : action.variant === "dream" ? (
        <Image
          src="/vision.svg"
          alt=""
          aria-hidden="true"
          width={15}
          height={15}
          className="telescope"
        />
      ) : action.variant === "collection" ? (
        <svg
          className="collection-stars"
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M8 3 L9 11 L14 12 L9 13 L8 21 L7 13 L2 12 L7 11 Z" />
          <path d="M17 2.5 L17.82 4.87 L20.33 4.92 L18.33 6.43 L19.06 8.83 L17 7.4 L14.94 8.83 L15.67 6.43 L13.67 4.92 L16.18 4.87 Z" />
          <path d="M18 14.5 L18.5 16.5 L20.5 17 L18.5 17.5 L18 19.5 L17.5 17.5 L15.5 17 L17.5 16.5 Z" />
        </svg>
      ) : (
        action.glyph && <span aria-hidden="true">{action.glyph}</span>
      )}
      {action.label}
    </button>
  );
}

/**
 * Collapsible sidebar section with chevron header. Controlled — caller owns
 * `open` state (typically via `useLocalStorageBoolean`) so duplicated mounts
 * (left aside + rail) stay in sync.
 */
export function SidebarSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`sd-side-group${!open ? " collapsed" : ""}`}>
      <button
        type="button"
        className="sd-side-group-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && children}
    </div>
  );
}
