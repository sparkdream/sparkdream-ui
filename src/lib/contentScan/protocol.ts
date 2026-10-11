// Content-scanner verdict protocol: the client half of the chain's
// docs/content-scanning.md §4. A port of the reference implementation in
// sparkdream/tools/contentscan (attestation.go, combine.go). Pure functions
// plus WebCrypto; no network. Used in the browser and on the server (the
// verdict index behind /api/content-scan, the RSS feed).
//
// The cross-implementation contract is the canonical JSON a verdict is signed
// over. signingBytes() must reproduce Go's bytes exactly, including Go's
// struct omitempty rules, time formatting and string escaping; the vector in
// the chain's contentscan_test.go (TestSigningBytesAreCanonical) pins them.

export const ATTESTATION_VERSION = 1;

export type SignedVerdict = "clean" | "held" | "removed";
export type VerdictState = SignedVerdict | "unchecked";

export const CATEGORIES = ["csam", "illegal", "sexual", "violence", "spam", "test", "none"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Subject {
  chain_id?: string;
  /** module/type/id, e.g. "blog/post/123". Absent on URI verdicts. */
  record?: string;
  /** Lowercase hex sha256 of the exact bytes checked. */
  sha256: string;
  cid?: string;
  uri?: string;
  pdq?: string;
}

export interface Ruleset {
  version: string;
  models?: Record<string, string>;
  thresholds?: Record<string, number>;
}

export interface Attestation {
  v: number;
  worker: string;
  subject: Subject;
  verdict: string;
  category: string;
  ruleset: Ruleset;
  scanned_height: number;
  /** RFC 3339 UTC. */
  issued_at: string;
  expires_at?: string;
  /** base64 ed25519 over signingBytes(). */
  sig?: string;
}

// ---- Canonical JSON ---------------------------------------------------------

const GO_ZERO_TIME = "0001-01-01T00:00:00Z";

/**
 * Format a timestamp the way Go's time.Time marshals after a round trip:
 * RFC 3339 with trailing fractional zeros dropped and a zero offset written
 * as "Z". Returns null for anything that isn't RFC 3339.
 */
export function goTime(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return null;
  let frac = (m[2] || "").replace(/0+$/, "");
  if (frac === ".") frac = "";
  const zone = m[3] === "+00:00" || m[3] === "-00:00" ? "Z" : m[3];
  return `${m[1]}${frac}${zone}`;
}

// Go's json.Unmarshal turns an unpaired surrogate escape into U+FFFD.
function wellFormed(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
        continue;
      }
      out += "\uFFFD";
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else {
      out += s[i];
    }
  }
  return out;
}

/** A JSON string literal escaped as Go's encoder does with SetEscapeHTML(false). */
function goString(s: string): string {
  // JSON.stringify already matches Go for quotes, backslashes and control
  // characters (\b \f \n \r \t, others as lowercase \u00xx). Go additionally
  // escapes U+2028 and U+2029 even with HTML escaping off.
  return JSON.stringify(wellFormed(s)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function goNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error("contentscan: non-finite number");
  // ES number-to-string is the shortest round-trip form with exponents below
  // 1e-6 and from 1e21, exactly where Go's float encoder switches to 'e'
  // (and Go trims "e-07" to "e-7" to match).
  return Object.is(n, -0) ? "-0" : String(n);
}

const utf8 = new TextEncoder();

/** Go sorts map keys by their UTF-8 bytes. */
function byteCompare(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** Canonical JSON: sorted keys, no insignificant whitespace, no HTML escaping. */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return goString(value);
  if (typeof value === "number") return goNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => byteCompare(a, b));
    return `{${entries.map(([k, v]) => `${goString(k)}:${canonicalJSON(v)}`).join(",")}}`;
  }
  throw new Error(`contentscan: cannot encode ${typeof value}`);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function nonEmptyMap<T>(v: unknown, keep: (x: unknown) => x is T): Record<string, T> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (keep(x)) out[k] = x;
  return Object.keys(out).length ? out : undefined;
}

const isString = (x: unknown): x is string => typeof x === "string";
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Normalise a parsed feed line into the shape Go's struct round trip gives:
 * unknown fields dropped, omitempty fields dropped when empty. Returns null
 * for a line that is not an attestation at all.
 */
export function normalizeAttestation(raw: unknown): Attestation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const subj = (r.subject && typeof r.subject === "object" ? r.subject : {}) as Record<string, unknown>;
  const rs = (r.ruleset && typeof r.ruleset === "object" ? r.ruleset : {}) as Record<string, unknown>;
  if (!Number.isInteger(r.v) || !Number.isInteger(r.scanned_height)) return null;
  const issued = goTime(str(r.issued_at) || GO_ZERO_TIME);
  if (!issued) return null;
  const expiresRaw = str(r.expires_at);
  const expires = expiresRaw ? goTime(expiresRaw) : null;
  if (expiresRaw && !expires) return null;

  const subject: Subject = { sha256: str(subj.sha256) };
  for (const k of ["chain_id", "record", "cid", "uri", "pdq"] as const) {
    const v = str(subj[k]);
    if (v) subject[k] = v;
  }
  const ruleset: Ruleset = { version: str(rs.version) };
  const models = nonEmptyMap(rs.models, isString);
  const thresholds = nonEmptyMap(rs.thresholds, isNumber);
  if (models) ruleset.models = models;
  if (thresholds) ruleset.thresholds = thresholds;

  const a: Attestation = {
    v: r.v as number,
    worker: str(r.worker),
    subject,
    verdict: str(r.verdict),
    category: str(r.category),
    ruleset,
    scanned_height: r.scanned_height as number,
    issued_at: issued,
  };
  if (expires && expires !== GO_ZERO_TIME) a.expires_at = expires;
  const sig = str(r.sig);
  if (sig) a.sig = sig;
  return a;
}

/** The bytes a verdict's signature covers: canonical JSON without `sig`. */
export function signingBytes(a: Attestation): Uint8Array {
  const rest: Attestation = { ...a };
  delete rest.sig;
  return utf8.encode(canonicalJSON(rest));
}

/** Shape check, as Go's Attestation.Validate (not the signature). */
export function validAttestation(a: Attestation): boolean {
  if (a.v !== ATTESTATION_VERSION || !a.worker) return false;
  if (a.subject.sha256.length !== 64) return false;
  if (a.verdict !== "clean" && a.verdict !== "held" && a.verdict !== "removed") return false;
  if (!(CATEGORIES as readonly string[]).includes(a.category)) return false;
  // Plain-URI content can change under the same URL, so its verdict expires.
  if (a.subject.uri && !a.subject.record && !a.expires_at) return false;
  return true;
}

/** Parse a segment or merged file: one attestation per non-empty line. Bad lines are skipped. */
export function parseJSONL(text: string): Attestation[] {
  const out: Attestation[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const a = normalizeAttestation(JSON.parse(t));
      if (a) out.push(a);
    } catch {
      // A torn last line (feed mid-write) or junk in a merged file.
    }
  }
  return out;
}

// ---- Bytes and crypto --------------------------------------------------------

export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/** Lowercase hex of a base64 hash as the LCD returns bytes fields; "" if absent or malformed. */
export function base64HashToHex(b64: string | undefined | null): string {
  if (!b64) return "";
  const b = base64ToBytes(b64);
  return b && b.length === 32 ? bytesToHex(b) : "";
}

function subtle(): SubtleCrypto | null {
  // crypto.subtle only exists in secure contexts (https, localhost) and Node 19+.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && c.subtle ? c.subtle : null;
}

// Copy into a fresh ArrayBuffer: WebCrypto's typings reject views over a
// possibly shared buffer.
function buf(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string | null> {
  const s = subtle();
  if (!s) return null;
  const bytes = typeof data === "string" ? utf8.encode(data) : data;
  return bytesToHex(new Uint8Array(await s.digest("SHA-256", buf(bytes))));
}

const PROBE_KEY = "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=";
let ed25519Support: Promise<boolean> | null = null;

/**
 * Whether this runtime verifies Ed25519 through WebCrypto (current browsers,
 * Node 20+). Without it no verdict can be checked, so everything flagged stays
 * unchecked: the safe failure.
 */
export function ed25519Available(): Promise<boolean> {
  if (!ed25519Support) {
    const s = subtle();
    ed25519Support = !s
      ? Promise.resolve(false)
      : s
          // A valid point (the public key of seed 0x01 x 32), so a browser
          // that validates keys on import doesn't read as unsupported.
          .importKey("raw", buf(base64ToBytes(PROBE_KEY)!), { name: "Ed25519" }, false, ["verify"])
          .then(() => true, () => false);
  }
  return ed25519Support;
}

/** Import a base64 ed25519 public key (the operator metadata verdict_key). */
export async function importVerdictKey(b64: string): Promise<CryptoKey | null> {
  const s = subtle();
  const raw = base64ToBytes(b64);
  if (!s || !raw || raw.length !== 32 || !(await ed25519Available())) return null;
  try {
    return await s.importKey("raw", buf(raw), { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return null;
  }
}

/** Shape plus signature, as Go's Verify. */
export async function verifyAttestation(a: Attestation, key: CryptoKey): Promise<boolean> {
  const s = subtle();
  if (!s || !a.sig || !validAttestation(a)) return false;
  const sig = base64ToBytes(a.sig);
  if (!sig || sig.length !== 64) return false;
  try {
    return await s.verify({ name: "Ed25519" }, key, buf(sig), buf(signingBytes(a)));
  } catch {
    return false;
  }
}

// ---- Combining (§4.4) --------------------------------------------------------

export interface CombineOptions {
  /** Lowercase hex the verdicts must be about. Omit when the hash is only
   *  known after a fetch (federated bodies, off-chain references, URIs):
   *  clean then needs `quorum` workers agreeing on one hash, which is
   *  returned for the fetched bytes to be checked against. */
  sha256?: string;
  quorum: number;
  now: Date;
  /** Verdicts naming another chain are ignored. */
  chainId?: string;
}

export interface Combined {
  verdict: VerdictState;
  /** Category of the deciding verdict; absent when clean or unchecked. */
  category?: string;
  /** Trusted workers disagree (removed or held against clean). */
  conflict: boolean;
  /** Most distinct workers saying clean for one hash. */
  cleanVotes: number;
  /** The hash the clean quorum agreed on. */
  sha256?: string;
  /** The off-chain id the clean quorum agreed on, when the subject has one. */
  cid?: string;
}

/**
 * The §4.4 rule over attestations whose signatures are already verified and
 * whose workers are trusted (verification is async, so it happens first):
 *
 *  1. removed if any trusted worker says removed;
 *  2. otherwise held if any trusted worker says held;
 *  3. otherwise clean if at least `quorum` distinct workers say clean for the
 *     same hash;
 *  4. otherwise unchecked.
 *
 * Expired verdicts and verdicts about another hash are ignored, and only each
 * worker's latest verdict (by issued_at) counts. quorum < 1 is treated as 1.
 */
export function combine(verified: Attestation[], opts: CombineOptions): Combined {
  const quorum = Math.max(1, opts.quorum);
  const now = opts.now.getTime();
  const latest = new Map<string, Attestation>();
  for (const a of verified) {
    if (opts.sha256 !== undefined && a.subject.sha256 !== opts.sha256) continue;
    if (opts.chainId && a.subject.chain_id && a.subject.chain_id !== opts.chainId) continue;
    if (a.expires_at && !(now < Date.parse(a.expires_at))) continue;
    const prev = latest.get(a.worker);
    if (prev && !(Date.parse(a.issued_at) > Date.parse(prev.issued_at))) continue;
    latest.set(a.worker, a);
  }

  let removed: Attestation | undefined;
  let held: Attestation | undefined;
  const cleanGroups = new Map<string, { n: number; a: Attestation }>();
  for (const w of [...latest.keys()].sort(byteCompare)) {
    const a = latest.get(w)!;
    if (a.verdict === "removed") removed ??= a;
    else if (a.verdict === "held") held ??= a;
    else if (a.verdict === "clean") {
      const k = `${a.subject.sha256}|${a.subject.cid || ""}`;
      const g = cleanGroups.get(k);
      if (g) g.n++;
      else cleanGroups.set(k, { n: 1, a });
    }
  }
  let best: { n: number; a: Attestation } | undefined;
  for (const g of cleanGroups.values()) if (!best || g.n > best.n) best = g;
  const cleanVotes = best?.n ?? 0;

  if (removed) return { verdict: "removed", category: removed.category, conflict: cleanVotes > 0, cleanVotes };
  if (held) return { verdict: "held", category: held.category, conflict: cleanVotes > 0, cleanVotes };
  if (best && cleanVotes >= quorum) {
    return {
      verdict: "clean",
      conflict: false,
      cleanVotes,
      sha256: best.a.subject.sha256,
      cid: best.a.subject.cid,
    };
  }
  return { verdict: "unchecked", conflict: false, cleanVotes };
}

/**
 * The lowest scanned height among the `quorum` most advanced workers (§4.4).
 * 0 when fewer than `quorum` workers report.
 */
export function effectiveScannedHeight(heights: number[], quorum: number): number {
  const q = Math.max(1, quorum);
  if (heights.length < q) return 0;
  return [...heights].sort((a, b) => b - a)[q - 1];
}

/** The quorum for one subject: elevated for media by low-trust authors (§9). */
export function quorumFor(attestationQuorum: number, elevatedQuorum: number, lowTrustAuthor: boolean): number {
  return lowTrustAuthor && elevatedQuorum > attestationQuorum ? elevatedQuorum : attestationQuorum;
}

// ---- Media labels -------------------------------------------------------------
// The MediaFlag bits live in lib/mediaLabels.ts.

/** media_flags as the LCD returns it: a number, a numeric string, or absent when zero. */
export function mediaFlags(v: number | string | undefined | null): number {
  const n = typeof v === "string" ? parseInt(v, 10) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}
