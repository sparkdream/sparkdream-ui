// Helpers for gifting DREAM to a member you invited (MsgTransferDream with
// purpose GIFT).

const MICRO = BigInt(1_000_000);
const DEC_SCALE = BigInt(10) ** BigInt(18);

/**
 * DREAM typed by a person ("15", "0.5") to a micro-DREAM bigint. Exact (no
 * float rounding). Returns null for anything that is not a positive amount
 * with at most six decimals.
 */
export function parseDreamAmount(input: string): bigint | null {
  const m = /^(\d*)(?:\.(\d{0,6}))?$/.exec(input.trim());
  if (!m || (m[1] === "" && !m[2])) return null;
  const micro = BigInt(m[1] || "0") * MICRO + BigInt((m[2] || "").padEnd(6, "0"));
  return micro > BigInt(0) ? micro : null;
}

/** A LegacyDec string ("0.030000000000000000") scaled by 1e18, or 0 if unreadable. */
function decToScaled(dec: unknown): bigint {
  if (typeof dec !== "string") return BigInt(0);
  const m = /^(\d+)(?:\.(\d{0,18}))?$/.exec(dec.trim());
  if (!m) return BigInt(0);
  return BigInt(m[1]) * DEC_SCALE + BigInt((m[2] || "").padEnd(18, "0"));
}

/** The transfer tax the chain burns from a gift: amount × rate, truncated. */
export function giftTax(amountMicro: bigint, taxRate: unknown): bigint {
  return (amountMicro * decToScaled(taxRate)) / DEC_SCALE;
}

/** A params value that should be a non-negative integer string, or null. */
export function microParam(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}
