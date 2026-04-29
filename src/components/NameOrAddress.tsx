"use client";

import { useDisplayName } from "@/hooks/useDisplayName";
import { truncateAddress } from "@/lib/utils";

interface NameOrAddressProps {
  address: string;
  className?: string;
}

/**
 * Displays a resolved name if the address has a primary name,
 * otherwise falls back to a truncated address.
 * Shows the full address as a tooltip on hover.
 */
export default function NameOrAddress({ address, className }: NameOrAddressProps) {
  const { name, loading } = useDisplayName(address);

  if (loading) {
    return (
      <span className={className} title={address}>
        {truncateAddress(address)}
      </span>
    );
  }

  if (name) {
    return (
      <span className={className} title={address}>
        {name}
      </span>
    );
  }

  return (
    <span className={className} title={address}>
      {truncateAddress(address)}
    </span>
  );
}
