"use client";

import type { BodyReason, BodyStatus } from "@/hooks/useScannedBody";

// Placeholder copy for content the display policy keeps back
// (docs/content-scanning.md §6). "Not available on this site" is the same
// wording the old content gateway used for removals.

function checkingDetail(reason: BodyReason | undefined, noun: string): string {
  switch (reason) {
    case "loading":
    case "fetching":
      return "Loading.";
    case "no-scanners":
      return `This ${noun} contains media. No content scanners are running on this network yet, so media stays hidden for now.`;
    case "stale":
      return `This ${noun} contains media. The content scanners are behind, so it stays hidden until they catch up.`;
    case "no-crypto":
      return `This ${noun} contains media. This browser can't verify scanner results, so it stays hidden here.`;
    case "unreachable":
      return `This ${noun} contains media. Scanner results didn't load, so it stays hidden for now.`;
    case "mismatch":
      return `This ${noun} contains media, and what the chain returned doesn't match what was scanned, so it stays hidden.`;
    case "error":
      return `This ${noun} contains media. It was cleared, but it didn't load. Try again later.`;
    case "archive":
      return `This ${noun} contains media, which isn't shown in archived snapshots.`;
    default:
      return `This ${noun} contains media. It shows once content scanners clear it.`;
  }
}

export function noticeText(status: BodyStatus, reason: BodyReason | undefined, noun: string): { title: string; detail?: string } {
  switch (status) {
    case "removed":
      return { title: "Not available on this site." };
    case "held":
      return { title: "Held for review.", detail: `This ${noun} is hidden until a reviewer looks at it.` };
    default:
      return reason === "loading" || reason === "fetching"
        ? { title: "Loading." }
        : { title: "Being checked.", detail: checkingDetail(reason, noun) };
  }
}

interface ContentNoticeProps {
  status: BodyStatus;
  reason?: BodyReason;
  /** "dream", "reply", "spark", "post". */
  noun: string;
  /** One line, for list rows and excerpts. */
  compact?: boolean;
  className?: string;
}

export default function ContentNotice({ status, reason, noun, compact, className }: ContentNoticeProps) {
  if (status === "show") return null;
  const { title, detail } = noticeText(status, reason, noun);
  if (compact) {
    return (
      <span className={`italic text-zinc-500 ${className ?? ""}`} title={detail}>
        {title}
      </span>
    );
  }
  return (
    <span className={`block text-sm italic text-zinc-500 ${className ?? ""}`}>
      {title}
      {detail && detail !== title && (
        <>
          {" "}
          <span className="not-italic text-zinc-600">{detail}</span>
        </>
      )}
    </span>
  );
}
