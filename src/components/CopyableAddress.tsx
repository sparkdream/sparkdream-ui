"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useCopy } from "@/hooks/useCopy";
import { useDisplayName } from "@/hooks/useDisplayName";
import { truncateAddress } from "@/lib/utils";

interface CopyableAddressProps {
  address: string | undefined | null;
  className?: string;
  style?: CSSProperties;
  /**
   * Resolve to onchain/Keplr name (same precedence as the legacy
   * `<NameOrAddress>`) and fall back to the truncated bech32. Default false
   * — most callsites want to show the raw address explicitly (Owner:,
   * granter pills, council policy addresses, …) and bypass name resolution.
   */
  resolveName?: boolean;
  /** Override prefix length passed to `truncateAddress`. */
  prefixLen?: number;
  /** Override suffix length passed to `truncateAddress`. */
  suffixLen?: number;
  /** Render full bech32 instead of truncating. The copied value is still the full address either way. */
  full?: boolean;
  /**
   * When this address sits inside an interactive parent (clickable card,
   * accordion-row `<button>`, link, …), skip the `role="button" tabIndex=0`
   * — nesting two button roles is invalid HTML and confuses screen readers.
   * Mouse click-to-copy still works (the onClick + stopPropagation stay).
   */
  nested?: boolean;
  /** Override the visible content entirely. The copied value is still the full address. */
  children?: ReactNode;
}

/**
 * Renders a bech32 address as inline text and copies the *full* address
 * when clicked. Visible text is the truncated form by default; pass
 * `resolveName` to fall through `useDisplayName` (onchain name → Keplr
 * name → truncated) like the old `<NameOrAddress>`.
 *
 * UX: cursor flips to pointer on hover, title tooltip shows the full
 * address, click swaps the tooltip to "Copied ✓" for ~1s. Keyboard
 * activatable via Enter/Space.
 */
export default function CopyableAddress({
  address,
  className,
  style,
  resolveName = false,
  prefixLen,
  suffixLen,
  full = false,
  nested = false,
  children,
}: CopyableAddressProps) {
  const { copied, copy } = useCopy();
  // Always invoke the hook (rules-of-hooks); the hook itself short-circuits
  // when passed null, so this stays a no-op when name resolution is off.
  const { name } = useDisplayName(resolveName ? address : null);

  if (!address) return null;

  const visible = copied
    ? "Copied ✓"
    : children ??
      (resolveName && name
        ? name
        : full
        ? address
        : truncateAddress(address, prefixLen ?? 11, suffixLen ?? 4));

  const title = copied ? `Copied ✓ ${address}` : address;

  const interactiveProps = nested
    ? {}
    : {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `Copy address ${address}`,
        onKeyDown: (e: ReactKeyboardEvent<HTMLSpanElement>) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            void copy(address);
          }
        },
      };

  return (
    <span
      {...interactiveProps}
      title={title}
      onClick={(e) => {
        // Don't trigger the parent's onClick (post row → detail, link card, …)
        // when the user just wants the address on their clipboard.
        e.stopPropagation();
        void copy(address);
      }}
      className={className}
      style={{ cursor: "pointer", ...style }}
    >
      {visible}
    </span>
  );
}
