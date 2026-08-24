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

/** True when the endpoint or record simply isn't served, so an empty view is the honest answer. */
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
