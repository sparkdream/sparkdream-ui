"use client";

/**
 * Inline panel chrome for the futarchy action flows (trade / redeem /
 * withdraw / cancel), replacing the overlay dialogs this page used to open.
 * Matches the Imaginarium pattern: clicking an action swaps the content pane
 * to the panel — with a Back affordance — instead of stacking a modal over
 * the board. Same prop contract as the old Modal so the action components
 * only swap their wrapper.
 */
export default function ActionPanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="sd-hull-tile rounded-xl p-5 sm:p-6">
      <button
        type="button"
        onClick={onClose}
        className="mb-5 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to markets
      </button>

      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">{subtitle}</p>
        )}
      </div>

      {children}

      {footer && <div className="mt-5 flex flex-wrap items-center gap-3">{footer}</div>}
    </div>
  );
}
