"use client";

import CopyableAddress from "@/components/CopyableAddress";

interface NameOrAddressProps {
  address: string;
  className?: string;
  /** When the surrounding layout has room, render the full bech32 instead of the
   *  11+...+4 truncation. The resolved name (if any) is shown either way. */
  full?: boolean;
}

/**
 * Displays a resolved name if the address has a primary name, otherwise
 * falls back to a truncated address. An address the member migrated away
 * from shows as their current identity (see useDisplayName). The full
 * address as stored copies to the
 * clipboard on click — implemented as a thin wrapper around
 * `<CopyableAddress resolveName />`.
 *
 * Kept as a named component so existing callsites don't all need to
 * import the new component; new code should prefer `<CopyableAddress>`
 * directly (it also exposes the no-name-resolution path).
 */
export default function NameOrAddress({ address, className, full }: NameOrAddressProps) {
  return <CopyableAddress address={address} className={className} resolveName full={full} />;
}
