"use client";

export type ActionBannerTone = "error" | "success";

const TONES: Record<ActionBannerTone, string> = {
  error: "border-red-800 bg-red-900/20 text-red-400",
  success: "border-emerald-800 bg-emerald-900/20 text-emerald-400",
};

const DISMISS_TONES: Record<ActionBannerTone, string> = {
  error: "text-red-300 hover:text-red-100",
  success: "text-emerald-300 hover:text-emerald-100",
};

/**
 * Dismissible inline banner reporting the outcome of an action the user just
 * took -- usually a broadcast transaction.
 *
 * This is the counterpart to `ErrorState`, which covers *fetch* failures and
 * offers a retry. An action outcome is different: the page's data is fine, and
 * the chain's own message is the useful part -- gates like "bonded 130 blocks
 * ago, need 300" or "appeal cooldown not elapsed" are the product working as
 * designed, so they need to stay on screen long enough to read. `alert()`
 * cannot do that: it is modal, unstyled, truncates long chain errors on some
 * browsers, and is gone before the user can copy anything out of it.
 *
 * Renders nothing when `message` is null, so callers can drop it in
 * unconditionally.
 */
export default function ActionBanner({
  message,
  tone = "error",
  onDismiss,
  className,
}: {
  message: string | null;
  tone?: ActionBannerTone;
  onDismiss: () => void;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${TONES[tone]} ${className || ""}`}
    >
      <span className="break-all">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className={`shrink-0 ${DISMISS_TONES[tone]}`}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
