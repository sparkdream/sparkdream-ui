// Client mirror of the chain's media labelling, rules version 1
// (x/common/types/media_labels.go, docs/content-scanning.md §3 and §9).
//
// Composers use it to tell an author, before they sign, that the chain will
// label their write as media: the body is then withheld from list and show
// queries until off-chain scanners check it, and the media posting rules
// (trust level or author bond, no anonymous media, a burned scan fee) apply.
// Collect forms use containsDataURI to reject inline bytes the way the
// chain's message handlers do.

/** MediaFlag bits (sparkdream.common.v1.MediaFlag), OR-ed into media_flags. */
export const MediaFlag = {
  NONE: 0,
  INLINE_DATA: 1,
  COMPRESSED: 2,
  OFFCHAIN_REF: 4,
  EXTERNAL_URI: 8,
} as const;

// The chain's pattern is `(?i)(^|[^a-z0-9+.-])data:[^\s,]{0,256},` under Go's
// RE2. Two details keep this JS copy byte-for-byte equivalent:
//  - the `u` flag, so `{0,256}` counts code points (RE2 counts runes, not
//    UTF-16 units) and `i` applies Unicode simple case folding the way RE2's
//    (?i) does (so ſ and K fold into [a-z] on both sides);
//  - RE2's `\s` is ASCII-only `[\t\n\f\r ]`, while JS `\s` also covers \v,
//    NBSP and other Unicode spaces, so the class is spelled out.
const DATA_URI_PATTERN = /(^|[^a-z0-9+.\-])data:[^\t\n\f\r ,]{0,256},/iu;

/** Whether `s` contains a data URI under rules version 1. */
export function containsDataURI(s: string | null | undefined): boolean {
  return !!s && DATA_URI_PATTERN.test(s);
}

// Blog / forum content_type values (sparkdream.common.v1.ContentType).
const COMPRESSED_TYPES = new Set([10, 11]); // GZIP, ZSTD
const OFFCHAIN_TYPES = new Set([20, 21, 22, 23]); // IPFS, ARWEAVE, FILECOIN, JACKAL

/**
 * The media_flags the chain will compute for a blog post / reply or forum post
 * with this content type and body (LabelBody). Pass the body exactly as it
 * will be sent (after any trim). An empty body is never media.
 */
export function labelBody(contentType: number, body: string): number {
  if (!body) return MediaFlag.NONE;
  if (COMPRESSED_TYPES.has(contentType)) return MediaFlag.COMPRESSED;
  if (OFFCHAIN_TYPES.has(contentType)) return MediaFlag.OFFCHAIN_REF;
  return containsDataURI(body) ? MediaFlag.INLINE_DATA : MediaFlag.NONE;
}

/** Short reason the write counts as media, for the composer notice. */
export function describeMediaFlags(flags: number): string {
  if (flags & MediaFlag.INLINE_DATA) return "It contains a data URI (inline media)";
  if (flags & MediaFlag.COMPRESSED) return "Its content type is compressed";
  if (flags & MediaFlag.OFFCHAIN_REF) return "Its content type points to off-chain storage";
  if (flags & MediaFlag.EXTERNAL_URI) return "It links to external media";
  return "";
}

/** Field-level message for a collect field that holds a data URI. */
export const DATA_URI_FIELD_ERROR =
  "Data URIs aren't allowed here. Link to the file where it's hosted instead of embedding it.";

/** The chain's media rules for one module, read from its params. */
export interface MediaRules {
  /** False when the chain predates content scanning (no media params). */
  enabled: boolean;
  /** media_min_trust_level (0-4). */
  minTrust: number;
  /** media_author_bond_min, micro-DREAM. "0" disables the bond path. */
  bondMin: string;
  /** media_scan_fee, bond-denom (uspark) micro-units, burned. */
  scanFee: string;
}

export const NO_MEDIA_RULES: MediaRules = { enabled: false, minTrust: 0, bondMin: "0", scanFee: "0" };

/** Read the three media params off a blog or forum params object. */
export function mediaRulesFromParams(params: {
  media_min_trust_level?: number | string;
  media_author_bond_min?: string;
  media_scan_fee?: string;
} | null | undefined): MediaRules {
  if (!params) return NO_MEDIA_RULES;
  const has =
    params.media_min_trust_level !== undefined ||
    params.media_author_bond_min !== undefined ||
    params.media_scan_fee !== undefined;
  // Proto3 JSON omits zero values, so on a chain that has the params a
  // missing field is 0; a chain with none of them has no media gate at all.
  if (!has) return NO_MEDIA_RULES;
  return {
    enabled: true,
    minTrust: Number(params.media_min_trust_level ?? 0) || 0,
    bondMin: params.media_author_bond_min || "0",
    scanFee: params.media_scan_fee || "0",
  };
}

function toBig(v: string | null | undefined): bigint {
  try {
    return BigInt(v || "0");
  } catch {
    return BigInt(0);
  }
}

export interface MediaGateInput {
  flags: number;
  rules: MediaRules;
  anonymous: boolean;
  /** Author is an active x/rep member. null while unknown. */
  member: boolean | null;
  /** Author's trust level 0-4 (meaningful only for members). null while unknown. */
  trustLevel: number | null;
  /** Author bond attached to this write, micro-DREAM. Omit on edits (no bond path). */
  authorBond?: string | null;
  /** Whether this write can carry a bond (creates only). */
  bondAllowed: boolean;
  /** media_author_bond_min formatted for display, e.g. "100 DREAM". */
  bondLabel?: string;
}

export interface MediaGateResult {
  /** The write will be labelled as media and the chain's rules apply. */
  isMedia: boolean;
  /** Reason the chain would refuse it, or null if it should pass. */
  blockReason: string | null;
  /** The bond path is what lets this write through (author below the trust bar). */
  needsBond: boolean;
}

/**
 * Client copy of CheckMediaPermitted. Returns the reason the chain would
 * reject the write with ErrMediaNotPermitted, phrased for the author, or null.
 * Unknown membership / trust (still loading) never blocks.
 */
export function checkMediaPermitted(g: MediaGateInput): MediaGateResult {
  if (g.flags === 0 || !g.rules.enabled) return { isMedia: false, blockReason: null, needsBond: false };
  if (g.anonymous) {
    return {
      isMedia: true,
      blockReason: "Anonymous posts can't carry media. Turn off anonymous posting or remove the media.",
      needsBond: false,
    };
  }
  if (g.member === null) return { isMedia: true, blockReason: null, needsBond: false };
  if (!g.member) {
    return { isMedia: true, blockReason: "Only active members can post media.", needsBond: false };
  }
  if (g.trustLevel === null || g.trustLevel >= g.rules.minTrust) {
    return { isMedia: true, blockReason: null, needsBond: false };
  }
  const bondMin = toBig(g.rules.bondMin);
  const bondPath = bondMin > BigInt(0);
  if (bondPath && g.bondAllowed && toBig(g.authorBond) >= bondMin) {
    return { isMedia: true, blockReason: null, needsBond: true };
  }
  const trustName = TRUST_NAMES[g.rules.minTrust] ?? String(g.rules.minTrust);
  const trustBar = `trust level ${g.rules.minTrust} (${trustName}) or higher`;
  let reason: string;
  if (bondPath && g.bondAllowed) {
    reason = `Posting media needs ${trustBar}, or an author bond of at least ${g.bondLabel ?? g.rules.bondMin}.`;
  } else if (bondPath) {
    reason = `Posting media needs ${trustBar}. Edits can't use the author bond path, so remove the media to save.`;
  } else {
    reason = `Posting media needs ${trustBar}.`;
  }
  return { isMedia: true, blockReason: reason, needsBond: bondPath && g.bondAllowed };
}

const TRUST_NAMES = ["New", "Provisional", "Established", "Trusted", "Core"];
