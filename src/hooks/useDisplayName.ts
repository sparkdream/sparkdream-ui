"use client";

import { useWallet } from "@/contexts/WalletContext";
import { useResolveName } from "@/hooks/useResolveName";

/**
 * Resolves an address to its best display name. Precedence:
 *   1. Onchain-registered name (via reverse resolution from the name module)
 *   2. Keplr wallet name — only if the address is the connected user's
 *   3. "" — caller should fall back to `truncateAddress(address)`
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
  const { name: onchainName, loading } = useResolveName(address);

  if (onchainName) return { name: onchainName, loading };

  const isCurrentUser =
    !!address && !!currentAddress && address === currentAddress;
  if (isCurrentUser && keplrName) {
    return { name: keplrName, loading: false };
  }

  return { name: "", loading };
}
