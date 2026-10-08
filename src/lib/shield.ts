import { fromBech32, fromHex, toBech32 } from "@cosmjs/encoding";

// sha256("shield")[:20]: the x/shield module account's address bytes. Content
// created anonymously through x/shield carries this account as its creator,
// so it is the one signal the UI has that an author is anonymous.
const SHIELD_MODULE_ADDRESS_BYTES = fromHex("072a626ed2d6cc7d5da0fcc388f3067b49c93bcd");

/** The shield module account's bech32 address: the signer x/shield puts on
 *  every inner message, so anonymous inner messages carry it as creator. */
export function shieldModuleAddress(prefix: string): string {
  return toBech32(prefix, SHIELD_MODULE_ADDRESS_BYTES);
}

const cache = new Map<string, boolean>();

/** True when `address` is the shield module account, whatever its bech32 prefix. */
export function isAnonymousAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const hit = cache.get(address);
  if (hit !== undefined) return hit;
  let anon = false;
  try {
    const { data } = fromBech32(address);
    anon =
      data.length === SHIELD_MODULE_ADDRESS_BYTES.length &&
      data.every((b, i) => b === SHIELD_MODULE_ADDRESS_BYTES[i]);
  } catch {
    anon = false;
  }
  cache.set(address, anon);
  return anon;
}

export const ANONYMOUS_LABEL = "Anonymous";
export const ANONYMOUS_TITLE =
  "Posted anonymously. A zero-knowledge proof showed the author is a member without revealing who.";
