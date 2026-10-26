import { fromHex, toBech32 } from "@cosmjs/encoding";

// sha256("artifact")[:20]: the x/artifact module account's address bytes
// (authtypes.NewModuleAddress("artifact")). Harberger tax grants must name it
// as grantee, and escrowed offers and bids sit in it.
const ARTIFACT_MODULE_ADDRESS_BYTES = fromHex("c7c5c1d70c5dec4416ab6158afd0b223ef40c29b");

/** The artifact module account's bech32 address. */
export function artifactModuleAddress(prefix: string): string {
  return toBech32(prefix, ARTIFACT_MODULE_ADDRESS_BYTES);
}

/**
 * The chain's HarbergerPolicy.TaxPerPeriod: tax on price for one period,
 * rounded up so a priced token never pays zero.
 */
export function harbergerTaxPerPeriod(price: bigint, taxBpsPerYear: number, taxPeriodSeconds: bigint): bigint {
  if (price <= BigInt(0) || taxBpsPerYear <= 0) return BigInt(0);
  const num = price * BigInt(taxBpsPerYear) * taxPeriodSeconds;
  const den = BigInt(10000) * BigInt(365 * 24 * 3600);
  const q = num / den;
  return num % den === BigInt(0) ? q : q + BigInt(1);
}
