/**
 * Text that amino (Keplr+Ledger) signing cannot carry.
 *
 * The wallet signs the sign doc as JavaScript's JSON.stringify writes it; the
 * chain rebuilds it with Go's encoder. The two agree on every character but
 * two: Go escapes U+2028 (line separator) and U+2029 (paragraph separator)
 * as backslash-u escapes, JavaScript writes them raw. A message holding either
 * one therefore signs bytes the chain never rebuilds, and the signature
 * fails. Both are invisible and arrive only by paste (from some word
 * processors and chat apps), so they are replaced with the line breaks they
 * stand for before any message is signed.
 */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

export function normalizeSignText(text: string): string {
  if (!text.includes(LS) && !text.includes(PS)) return text;
  return text.split(LS).join("\n").split(PS).join("\n\n");
}

/**
 * Returns the message value with normalizeSignText applied to every string,
 * recursively through plain objects and arrays. Bytes, Dates, bigints and
 * class instances pass through untouched, and a value without either
 * character is returned as the same object.
 */
export function normalizeSignValue<T>(value: T): T {
  if (typeof value === "string") return normalizeSignText(value) as unknown as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const n = normalizeSignValue(v);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? (out as unknown as T) : value;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const n = normalizeSignValue(v);
      if (n !== v) changed = true;
      out[k] = n;
    }
    return changed ? (out as T) : value;
  }
  return value;
}
