"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDisplayName } from "@/hooks/useDisplayName";
import { isAnonymousAddress } from "@/lib/shield";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #6366f1, #f472b6)",
  "linear-gradient(135deg, #34d399, #6366f1)",
  "linear-gradient(135deg, #f59e0b, #f472b6)",
  "linear-gradient(135deg, #60a5fa, #34d399)",
  "linear-gradient(135deg, #f472b6, #f59e0b)",
  "linear-gradient(135deg, #7c7fff, #60a5fa)",
];

function gradientFor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function initialFor(name: string, addr: string): string {
  // Skip the shared bech32 prefix so unnamed members don't all read "S".
  const src = name || addr.slice(addr.indexOf("1") + 1);
  const match = src.match(/[A-Za-z]/);
  return (match ? match[0] : "•").toUpperCase();
}

export function memberHref(address: string): string {
  return `/member/${address}`;
}

interface MemberAvatarProps {
  address: string;
  size?: "sm" | "lg";
  /**
   * The avatar sits inside an interactive parent (a row that is itself a link
   * or button). A link cannot nest in one, so the avatar navigates from its
   * own click handler and leaves the parent's action alone.
   */
  nested?: boolean;
  /** Render the avatar without the link to the member page. */
  noLink?: boolean;
}

/**
 * A member's avatar: a gradient and initial derived from the address and
 * name, so the same member looks the same everywhere. Clicking it opens the
 * member page. Anonymous content has no member behind it and never links.
 */
export default function MemberAvatar({ address, size, nested = false, noLink = false }: MemberAvatarProps) {
  const router = useRouter();
  const { name } = useDisplayName(address);
  const cls = `sd-avatar${size ? ` ${size}` : ""}`;

  if (isAnonymousAddress(address)) {
    return (
      <div className={cls} style={{ background: "var(--panel-2)" }}>
        ?
      </div>
    );
  }

  const style = { background: gradientFor(address) };
  const initial = initialFor(name, address);

  if (noLink) {
    return (
      <div className={cls} style={style}>
        {initial}
      </div>
    );
  }

  if (nested) {
    return (
      <span
        className={`${cls} sd-avatar-link`}
        style={style}
        title="View profile"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          router.push(memberHref(address));
        }}
      >
        {initial}
      </span>
    );
  }

  return (
    <Link
      href={memberHref(address)}
      className={`${cls} sd-avatar-link`}
      style={style}
      title="View profile"
      aria-label="View profile"
    >
      {initial}
    </Link>
  );
}
