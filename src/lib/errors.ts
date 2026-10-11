// Error classification and user-facing copy for LCD reads.
//
// Every failed get() in lib/api.ts throws an ApiError carrying the status and
// path instead of a message with the raw response body pasted in. That matters
// most when the chain is down: a sentry behind Cloudflare answers with a full
// HTML error page, and dumping that into a <div> is what used to fill the
// screen with markup. The body never reaches the UI now — describeError()
// turns the class of failure into a short headline plus an optional technical
// line, and ErrorState renders it.

export type ErrorKind =
  | "offline" // node unreachable: network failure, timeout, gateway error
  | "not-found" // 404: the record genuinely isn't there
  | "unavailable" // 501 / missing archive endpoint: this node doesn't serve it
  | "removed" // 451: an upstream proxy withholds this record. Scanner removals are client-side (lib/contentScan)
  | "rejected" // 4xx: the request itself was refused
  | "server" // 5xx from the node's own app layer
  | "unknown";

// Cloudflare's 52x family (521 web server is down, 522 timeout, 523 origin
// unreachable, 524 timeout, 525/526 TLS) plus the standard gateway codes all
// mean the same thing to a reader: the node isn't answering.
const GATEWAY_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 for a network failure or timeout with no response. */
    readonly status: number,
    /** LCD path that failed, for the technical detail line. */
    readonly path: string,
    message: string,
    /** Short server-supplied explanation, if the body was JSON. Never HTML. */
    readonly detail?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorKind(err: unknown): ErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 0 || GATEWAY_STATUSES.has(err.status)) return "offline";
    if (err.status === 404) return "not-found";
    if (err.status === 501) return "unavailable";
    if (err.status === 451) return "removed";
    // grpc-gateway normally maps the gRPC code to a status, but some node
    // builds answer 400/500 with the gRPC status text in the body instead.
    // Those are still a miss, and callers treat a miss as an empty view.
    if (err.detail) {
      if (/unimplemented|unknown (query )?(path|method)/i.test(err.detail)) return "unavailable";
      if (/not ?found/i.test(err.detail)) return "not-found";
    }
    if (err.status >= 500) return "server";
    return "rejected";
  }
  // Archive mode's own miss, matched by name to keep lib/api.ts out of this
  // module's imports (api.ts imports from here).
  if (err instanceof Error && err.name === "ArchiveMissingEndpoint") return "unavailable";
  const msg = errorMessage(err);
  if (!msg) return "unknown";
  if (/failed to fetch|networkerror|load failed|ecconnrefused|econnrefused|fetch failed/i.test(msg)) {
    return "offline";
  }
  if (/not found|\b404\b/i.test(msg)) return "not-found";
  if (/\b501\b/.test(msg)) return "unavailable";
  return "unknown";
}

/**
 * True when the endpoint or record simply isn't served, so an empty view is the
 * honest answer. A 451 from a filtering proxy someone puts in front of the node
 * is deliberately not a miss: callers would render it as "doesn't exist", so it
 * falls through to ErrorState. (This UI's own removals come from scanner
 * verdicts, docs/content-scanning.md §10, and never reach here.)
 */
export function isMissingEndpoint(err: unknown): boolean {
  const kind = errorKind(err);
  return kind === "not-found" || kind === "unavailable";
}

/** True when nothing onchain can load right now, whatever the caller asked for. */
export function isNodeUnreachable(err: unknown): boolean {
  return errorKind(err) === "offline";
}

export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "";
}

export interface ErrorDescription {
  kind: ErrorKind;
  /** Headline. Short, sentence case. */
  title: string;
  /** One or two sentences a non-developer can act on. */
  message: string;
  /** Status, path, and any server text. Hidden behind a disclosure. */
  detail?: string;
}

const COPY: Record<ErrorKind, { title: string; message: string }> = {
  offline: {
    title: "Chain node unreachable",
    message:
      "The node serving onchain data isn't responding. This view will fill in once it's back.",
  },
  "not-found": {
    title: "Not found",
    message: "That record doesn't exist onchain, or it was removed.",
  },
  unavailable: {
    title: "Not available here",
    message: "This node doesn't serve that data yet.",
  },
  removed: {
    title: "Not available on this site",
    message: "This content was removed from this site by its operator. It may still exist onchain.",
  },
  rejected: {
    title: "Request refused",
    message: "The node refused the request.",
  },
  server: {
    title: "Node error",
    message: "The node hit an error handling the request. Retrying may work.",
  },
  unknown: {
    title: "Something went wrong",
    message: "That didn't load. Retrying may work.",
  },
};

const MAX_DETAIL = 240;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL)}…` : flat;
}

/**
 * Turn any thrown value into presentable copy.
 *
 * `fallback` covers the "record not found" case where the caller has a better
 * noun than we do ("Spark not found"), and is used when there is no error at
 * all or the error is a bare not-found.
 */
export function describeError(err: unknown, fallback?: string): ErrorDescription {
  // A caller with no error but nothing to show ("Spark not found") is telling
  // us the record is missing, not that something broke.
  if (err == null && fallback) {
    return { kind: "not-found", title: COPY["not-found"].title, message: fallback };
  }
  const kind = errorKind(err);
  const base = COPY[kind];

  if (err instanceof ApiError) {
    const detailParts = [`${err.status || "no response"} · ${err.path}`];
    if (err.detail) detailParts.push(truncate(err.detail));
    return {
      kind,
      title: base.title,
      // A node-supplied reason for a refused request says more than our copy.
      message:
        kind === "not-found" && fallback
          ? fallback
          : kind === "rejected" && err.detail
            ? truncate(err.detail)
            : base.message,
      detail: detailParts.join(" · "),
    };
  }

  // Anything that isn't an ApiError carries a message we wrote for that spot
  // ("Name not found", "Vote failed"), so it reads better than the generic
  // line. The exception is a raw network failure, whose message is noise.
  const raw = errorMessage(err);
  if (!raw) return { kind, title: base.title, message: fallback || base.message };
  if (kind === "offline") {
    return { kind, title: base.title, message: base.message, detail: truncate(raw) };
  }
  return { kind, title: base.title, message: truncate(raw) };
}

// ── Transaction failures ─────────────────────────────────────────────
//
// A rejected tx reaches the UI as an Error whose message is one of:
//   - CheckTx (cosmjs BroadcastTxError):
//     "Broadcasting transaction failed with code 1232 (codespace: blog). Log: …"
//   - DeliverTx (WalletContext): "Transaction failed: failed to execute
//     message; message index: 0: <wrapped reason>: <registered message>"
//   - the anonymous (shield) path: the raw log on its own.
// Only the first carries the numeric code, so each entry also matches the
// error's registered message, which the chain appends to every wrap.

interface TxErrorEntry {
  codespace: string;
  code: number;
  /** The chain's registered error message (errors.Register). */
  registered: string;
  /** Readable copy. Receives the wrapped reason (text before the registered
   *  message), if any, and the caller's options. */
  describe: (reason: string, opts: TxErrorOptions) => string;
}

export interface TxErrorOptions {
  /** DREAM ticker for this chain (useDreamDenom), for bond amounts. */
  dreamDenom?: string;
}

// Integer micro-units to a display amount, without importing lib/utils
// (which would make this module's import graph heavier for every reader).
function microToDisplay(raw: string): string {
  try {
    const n = BigInt(raw);
    const whole = n / BigInt(1_000_000);
    const frac = (n % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
    return frac ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
  } catch {
    return raw;
  }
}

// Reasons CheckMediaPermitted (x/common/types/media_labels.go) wraps into
// ErrMediaNotPermitted, turned into author-facing copy.
function describeMediaReason(reason: string, opts: TxErrorOptions): string {
  if (/anonymous content cannot carry media/i.test(reason)) {
    return "Anonymous posts can't carry media. Post it under your own name, or remove the media.";
  }
  if (/only active members can post media/i.test(reason)) {
    return "Only active members can post media.";
  }
  const m = reason.match(/media needs trust level (\d+)(?: or an author bond of at least (\d+))?/i);
  if (m) {
    const bond = m[2] ? `, or an author bond of at least ${microToDisplay(m[2])} ${opts.dreamDenom || "DREAM"} when you create it` : "";
    return `Posting media needs trust level ${m[1]} or higher${bond}.`;
  }
  return "You can't post media yet. It needs a higher trust level or an author bond.";
}

const TX_ERRORS: TxErrorEntry[] = [
  {
    codespace: "blog",
    code: 1232,
    registered: "media not permitted for this author",
    describe: describeMediaReason,
  },
  {
    codespace: "forum",
    code: 2500,
    registered: "media not permitted for this author",
    describe: describeMediaReason,
  },
  {
    codespace: "collect",
    code: 1271,
    registered: "data URIs are not allowed in collect fields",
    describe: () =>
      "Data URIs aren't allowed in collections. Link to the file where it's hosted instead of embedding it.",
  },
  {
    codespace: "service",
    code: 45,
    registered: "invalid checkpoint",
    describe: (reason) =>
      `The checkpoint was rejected${reason ? `: ${reason}` : ""}. Its height must be above the previous checkpoint and not past the current block, and its root must be 32 bytes.`,
  },
  {
    codespace: "service",
    code: 46,
    registered: "checkpoint not found",
    describe: () => "This operator hasn't submitted a checkpoint yet.",
  },
  {
    codespace: "rep",
    code: 1112,
    registered: "recipient has reached their transfer receive limit",
    describe: () => "The recipient can't receive more DREAM this epoch or season. Try again later.",
  },
  {
    codespace: "rep",
    code: 1113,
    registered: "exceeds initiative bounty limit",
    describe: () =>
      "This would go past a bounty limit: the initiative's cap, your funding allowance this epoch, or the number of contributions.",
  },
  // x/artifact (x/artifact/types/errors.go). Only codes whose registered
  // message is distinctive enough to match by text are listed.
  ...([
    [1106, "creator is not a member at the required trust level nor a council body", "Creating a class needs a member at the required trust level, or a council."],
    [1107, "maximum classes per creator reached", "You've reached the maximum number of classes one creator can make."],
    [1109, "max supply exceeded", "This would mint past the class's max supply."],
    [1110, "max supply can only be lowered", "Max supply can only be lowered, never raised or removed."],
    [1111, "minting is closed for this class", "Minting is closed for this class."],
    [1112, "public mint is not open", "Public minting isn't open for this class right now."],
    [1113, "per-address public mint limit reached", "You've reached this class's public mint limit."],
    [1114, "current price exceeds max price", "The mint price went up. Check the new price and try again."],
    [1116, "class is not transferable", "Tokens in this class can't be transferred or sold."],
    [1117, "token is locked", "This token is listed or waiting on a transfer. Delist it or cancel the transfer first."],
    [1121, "recipient inbox is full", "The recipient's inbox is full. Try again later."],
    [1123, "listing expired", "This listing has expired."],
    [1124, "listing price or nonce changed", "The listing changed since you loaded it. Reload and check the new terms."],
    [1125, "metadata hash mismatch", "The token's metadata changed since you loaded it. Reload and review it again."],
    [1126, "market is disabled", "The market is turned off right now."],
    [1128, "royalty can only be lowered", "The royalty can only be lowered."],
    [1130, "DREAM is not accepted", "Prices must be in SPARK, not DREAM."],
    [1132, "data URIs are not allowed", "Data URIs aren't allowed. Link to the file where it's hosted instead."],
    [1133, "content license must be accepted", "You need to dedicate the content to the public domain (CC0) first."],
    [1134, "content is hidden", "This content is hidden by moderation, so that action isn't allowed."],
    [1135, "class still has live or reserved tokens", "A class can only be deleted once it has no live or pending tokens."],
    [1136, "class does not let the issuer burn tokens", "This class doesn't let the issuer revoke tokens."],
    [1141, "target already has an open hide record", "This is already hidden."],
    [1142, "sentinel daily hide limit reached", "You've reached today's hide limit."],
    [1143, "signer may not appeal this hide", "Only the token holder or class owner can appeal this hide."],
    [1144, "appeal is not possible in the current state", "This hide can't be appealed or unhidden in its current state."],
    [1150, "class does not let the holder burn tokens", "Only the issuer can remove tokens of this class."],
    [1151, "invalid royalty split", "Royalty shares must name 1 to 10 different addresses with weights adding up to 100%."],
  ] as const).map(
    ([code, registered, copy]): TxErrorEntry => ({
      codespace: "artifact",
      code,
      registered,
      describe: () => copy,
    })
  ),
];

/**
 * Readable copy for a failed transaction when the chain error is one we know,
 * otherwise the original message. Safe to call on any thrown value.
 */
export function describeTxError(err: unknown, opts: TxErrorOptions = {}): string {
  const raw = errorMessage(err);
  if (!raw) return raw;

  const coded = raw.match(/code (\d+) \(codespace: ([a-z0-9_-]+)\)/i);
  for (const e of TX_ERRORS) {
    const byCode = coded && Number(coded[1]) === e.code && coded[2] === e.codespace;
    const at = raw.toLowerCase().lastIndexOf(e.registered.toLowerCase());
    if (!byCode && at < 0) continue;
    // The wrapped reason sits between the last "message index: N:" preamble
    // (or "Log:") and the registered message.
    let reason = at >= 0 ? raw.slice(0, at) : raw;
    reason = reason
      .replace(/^[\s\S]*(?:message index: \d+:|Log:)/i, "")
      .replace(/:\s*$/, "")
      .trim();
    return e.describe(reason, opts);
  }
  return raw;
}
