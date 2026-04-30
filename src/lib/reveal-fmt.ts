// Format a micro-DREAM (uspark) integer string as a DREAM amount.
// Matches the convention used elsewhere in the UI (1 DREAM = 1,000,000 udream).
export function formatDream(amount: string | undefined | null): string {
  if (!amount || amount === "0") return "0";
  let n: bigint;
  try {
    n = BigInt(amount);
  } catch {
    return amount;
  }
  const divisor = BigInt(1_000_000);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === BigInt(0)) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")}`;
}

// DREAM (decimal string) → micro-DREAM (uspark) integer string.
// Returns null on invalid input.
export function dreamToMicro(dream: string): string | null {
  const trimmed = dream.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  if (!isFinite(n) || n < 0) return null;
  return BigInt(Math.floor(n * 1_000_000)).toString();
}

// Format a Cosmos LegacyDec string ("0.600000000000000000") as a percentage.
// LegacyDec stores up to 18 fractional digits as a fixed-point string.
export function formatDecPercent(value: string | undefined | null, fractionDigits = 1): string {
  if (!value) return "—";
  const n = parseFloat(value);
  if (!isFinite(n)) return value;
  const pct = n * 100;
  return `${pct.toFixed(fractionDigits).replace(/\.?0+$/, "")}%`;
}
