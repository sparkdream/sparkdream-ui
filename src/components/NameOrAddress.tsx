"use client";

import CopyableAddress from "@/components/CopyableAddress";

interface NameOrAddressProps {
  address: string;
  className?: string;
}

/**
 * Displays a resolved name if the address has a primary name, otherwise
 * falls back to a truncated address. The full address copies to the
 * clipboard on click — implemented as a thin wrapper around
 * `<CopyableAddress resolveName />`.
 *
 * Kept as a named component so existing callsites don't all need to
 * import the new component; new code should prefer `<CopyableAddress>`
 * directly (it also exposes the no-name-resolution path).
 */
export default function NameOrAddress({ address, className }: NameOrAddressProps) {
  return <CopyableAddress address={address} className={className} resolveName />;
}
