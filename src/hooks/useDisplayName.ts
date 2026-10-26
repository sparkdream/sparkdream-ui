"use client";

import { useWallet } from "@/contexts/WalletContext";
import { useResolveName } from "@/hooks/useResolveName";
import { ANONYMOUS_LABEL, isAnonymousAddress } from "@/lib/shield";
import { truncateAddress } from "@/lib/utils";
import { useCanonicalAddress } from "@/hooks/useCanonicalAddress";

/**
 * Resolves an address to its best display name. Precedence:
 *   0. "Anonymous" for the x/shield module account (anonymous content)
 *   1. Onchain-registered name (via reverse resolution from the name module)
 *   2. An address that migrated away (x/rep tombstone) shows as the member's
 *      current identity: its name, else its truncated current address. Only
 *      looked up for addresses with no name, since names move with the member.
 *   3. Keplr wallet name — only if the address is the connected user's
 *   4. "" — caller should fall back to `truncateAddress(address)`
 *
 * Use this everywhere a human-readable name is shown for any address, current
 * user or otherwise. It keeps display consistent: others see you by your
 * onchain name, and so do you.
 */
export function useDisplayName(address: string | undefined | null): {
  name: string;
  loading: boolean;
} {
  const { address: currentAddress, name: keplrName } = useWallet();
  const anonymous = isAnonymousAddress(address);
  const { name: onchainName, loading } = useResolveName(anonymous ? null : address);
  const canonical = useCanonicalAddress(!anonymous && !loading && !onchainName ? address : null);
  const moved = canonical && address && canonical !== address ? canonical : null;
  const { name: movedName, loading: movedLoading } = useResolveName(moved);

  if (anonymous) return { name: ANONYMOUS_LABEL, loading: false };

  if (onchainName) return { name: onchainName, loading };

  if (moved) return { name: movedName || truncateAddress(moved), loading: movedLoading };

  const isCurrentUser =
    !!address && !!currentAddress && address === currentAddress;
  if (isCurrentUser && keplrName) {
    return { name: keplrName, loading: false };
  }

  return { name: "", loading };
}
