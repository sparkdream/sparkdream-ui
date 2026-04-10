// Truncate a bech32 address for display: sprkdrm1abc...xyz
export function truncateAddress(address: string, prefixLen = 10, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen + 3) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// Format a unix timestamp (seconds as string) to a readable date
export function formatTime(timestampStr: string): string {
  const ts = parseInt(timestampStr, 10);
  if (!ts || ts === 0) return "";
  const date = new Date(ts * 1000);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Relative time (e.g., "2 hours ago")
export function timeAgo(timestampStr: string): string {
  const ts = parseInt(timestampStr, 10);
  if (!ts || ts === 0) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return formatTime(timestampStr);
}

// Parse a count string to number, defaulting to 0
export function countToNum(count: string | undefined): number {
  if (!count) return 0;
  return parseInt(count, 10) || 0;
}
