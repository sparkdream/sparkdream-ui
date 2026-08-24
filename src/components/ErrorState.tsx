"use client";

import { describeError, type ErrorKind } from "@/lib/errors";

interface ErrorStateProps {
  /** The thrown value. Strings are accepted for callers that keep a message in state. */
  error: unknown;
  /** Renders a retry control when the caller can refetch. */
  onRetry?: () => void;
  /** Better noun for a missing record, e.g. "Spark not found". */
  fallback?: string;
  /** Single line, for rails and inline panels where a full card is too heavy. */
  compact?: boolean;
  className?: string;
}

// Offline is the common case and isn't the reader's fault, so it stays muted
// rather than shouting in red. A refused or failed request is a real fault and
// keeps the red treatment.
const ACCENT: Record<ErrorKind, { color: string; border: string; bg: string }> = {
  offline: { color: "var(--amber)", border: "rgba(245, 158, 11, 0.35)", bg: "var(--amber-soft)" },
  "not-found": { color: "var(--ink-soft)", border: "var(--rule-strong)", bg: "var(--panel-2)" },
  unavailable: { color: "var(--ink-soft)", border: "var(--rule-strong)", bg: "var(--panel-2)" },
  rejected: { color: "#f87171", border: "rgba(248, 113, 113, 0.35)", bg: "rgba(248, 113, 113, 0.10)" },
  server: { color: "#f87171", border: "rgba(248, 113, 113, 0.35)", bg: "rgba(248, 113, 113, 0.10)" },
  unknown: { color: "#f87171", border: "rgba(248, 113, 113, 0.35)", bg: "rgba(248, 113, 113, 0.10)" },
};

function Icon({ kind, color }: { kind: ErrorKind; color: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "offline") {
    // Severed link: the data path is broken, not the data.
    return (
      <svg {...common}>
        <path d="M9.5 14.5 6.8 17.2a3.8 3.8 0 0 1-5.4-5.4l2.7-2.7" />
        <path d="M14.5 9.5l2.7-2.7a3.8 3.8 0 0 1 5.4 5.4l-2.7 2.7" />
        <path d="m2 2 20 20" />
      </svg>
    );
  }
  if (kind === "not-found" || kind === "unavailable") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17.2v.1" />
    </svg>
  );
}

export default function ErrorState({
  error,
  onRetry,
  fallback,
  compact,
  className,
}: ErrorStateProps) {
  const { kind, title, message, detail } = describeError(error, fallback);
  const accent = ACCENT[kind];

  if (compact) {
    return (
      <div
        className={`flex items-start gap-2 text-xs leading-relaxed ${className || ""}`}
        style={{ color: "var(--ink-soft)" }}
        role="status"
      >
        <span className="mt-px shrink-0" style={{ display: "inline-flex" }}>
          <Icon kind={kind} color={accent.color} />
        </span>
        <span>
          {message}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1.5 underline underline-offset-2 hover:opacity-80"
              style={{ color: accent.color }}
            >
              Retry
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl px-4 py-4 ${className || ""}`}
      style={{ background: accent.bg, border: `1px solid ${accent.border}` }}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" style={{ display: "inline-flex" }}>
          <Icon kind={kind} color={accent.color} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
            {title}
          </p>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--ink-soft)" }}>
            {message}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {onRetry && (
              <button type="button" onClick={onRetry} className="sd-btn-ghost">
                Retry
              </button>
            )}
            {detail && (
              <details className="text-xs">
                <summary
                  className="cursor-pointer select-none"
                  style={{ color: "var(--ink-mute)" }}
                >
                  Technical details
                </summary>
                <p
                  className="mt-2 break-words font-mono text-[11px] leading-relaxed"
                  style={{ color: "var(--ink-mute)" }}
                >
                  {detail}
                </p>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
