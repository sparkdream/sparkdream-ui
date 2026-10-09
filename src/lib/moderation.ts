// Operator moderation applied by the content gateway.
//
// Chain reads go through a separate filtering gateway that sits in front of
// the LCD. When a record fails its abuse checks, the gateway does one of two
// things:
//
// - A single-record endpoint answers 451. lib/errors.ts classifies that as
//   "removed" and ErrorState says so.
// - In a list, the record stays in place as a stub: its user-written text is
//   emptied and a `_moderation` marker is added. Structural fields (ids,
//   addresses, status, timestamps) are kept.
//
// lib/api.ts drops stubs from lists before any component sees them, except on
// the threaded endpoints below. There a removed post still anchors its replies,
// so the stub is kept and the thread renders a placeholder in its place.

export interface ModerationMarker {
  state: "removed";
  /** Short operator-facing reason, if the gateway gives one. Not shown verbatim. */
  reason?: string;
}

export interface Moderated {
  _moderation?: ModerationMarker;
}

export function isRemoved(record: unknown): boolean {
  return (
    !!record &&
    typeof record === "object" &&
    (record as Moderated)._moderation?.state === "removed"
  );
}

// Threaded reads keep their stubs (see above).
const KEEP_STUBS = [
  /^\/sparkdream\/blog\/v1\/list_replies\//,
  /^\/sparkdream\/forum\/v1\/thread\//,
];

export function keepsStubs(path: string): boolean {
  return KEEP_STUBS.some((re) => re.test(path));
}

/** Remove gateway stubs from every array in a response, at any depth. */
export function dropRemoved<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((v) => !isRemoved(v)).map(dropRemoved) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = dropRemoved(v);
    return out as T;
  }
  return value;
}

// The gateway sets this header on every response it checked. With
// REQUIRE_CONTENT_GATEWAY=true (server env), the LCD proxy and server-side
// reads refuse unmarked responses, so a deployment whose LCD_ENDPOINT points
// straight at a node fails closed instead of serving unchecked content.
export const POLICY_HEADER = "X-Content-Policy-Version";

export function gatewayRequired(): boolean {
  return /^(1|true)$/i.test(process.env.REQUIRE_CONTENT_GATEWAY || "");
}
