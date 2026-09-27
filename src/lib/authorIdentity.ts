// Author identities for a peer policy's curation gates.
//
// A TypeScript port of x/federation/types/author_identity.go (and the
// content_hosts rule from content_host.go), so the policy form can refuse
// what MsgUpdatePeerPolicy would refuse (ErrInvalidAllowedIdentity, 2388)
// before anyone signs, and so the curation panel can show which author an
// entry or a collection item actually admits.
//
// The chain compares normalized forms: an allow-list entry, a curation link
// item and the creator_identity a bridge submits all reduce to lowercase
// "user@host" before they are matched.

/** allowed_identities entry that admits any author. */
export const ALL_IDENTITIES = "*";

/** types.MaxAllowedIdentities: a larger list belongs in a curation collection. */
export const MAX_ALLOWED_IDENTITIES = 256;

/** types.MaxContentHosts. */
export const MAX_CONTENT_HOSTS = 8;

// Go's url.Parse rejects a host with characters outside this set, and a port
// that is not all digits. Anything it rejects the chain treats as "not an
// identity", so the port does the same.
const HOST_CHARS = /^[A-Za-z0-9.\-_~!$&'()*+,;=:[\]%]*$/;

/**
 * The parts of Go's url.Parse NormalizeAuthorIdentity depends on: the host
 * (with any port, as u.Host), the hostname (u.Hostname()) and the
 * percent-decoded path (u.Path). Null where url.Parse would return an error.
 */
function parseHttpUrl(s: string): { host: string; hostname: string; path: string } | null {
  // url.Parse fails on ASCII control characters anywhere in the input.
  if (/[\x00-\x1f\x7f]/.test(s)) return null;
  let rest = s.slice(s.indexOf("://") + 3);
  // Fragment first, then query, as url.Parse splits them.
  const hash = rest.indexOf("#");
  if (hash >= 0) rest = rest.slice(0, hash);
  const q = rest.indexOf("?");
  if (q >= 0) rest = rest.slice(0, q);
  const slash = rest.indexOf("/");
  let authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const rawPath = slash >= 0 ? rest.slice(slash) : "";
  // userinfo@host: the host is after the last '@'.
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  const host = authority;
  if (!HOST_CHARS.test(host)) return null;
  let hostname = host;
  let port = "";
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close < 0) return null;
    hostname = host.slice(1, close);
    port = host.slice(close + 1);
    if (port !== "" && !port.startsWith(":")) return null;
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0) {
      hostname = host.slice(0, colon);
      port = host.slice(colon);
    }
  }
  if (port !== "" && !/^:\d*$/.test(port)) return null;
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  return { host, hostname, path };
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}

/**
 * NormalizeAuthorIdentity: reduce the ways an author is written to one form,
 * "user@host" in lower case.
 *
 *   @user@host, user@host        a fediverse handle
 *   https://host/@user           a Mastodon profile URL
 *   https://host/users/user      an ActivityPub actor id
 *
 * Null for anything else (an empty string, a URL of another shape).
 */
export function normalizeAuthorIdentity(input: string): string | null {
  const s = input.trim();
  if (s === "") return null;
  if (s.startsWith("https://") || s.startsWith("http://")) {
    const u = parseHttpUrl(s);
    if (!u || u.host === "") return null;
    const host = u.hostname.toLowerCase();
    const path = trimSlashes(u.path);
    if (path.startsWith("@") && !path.includes("/")) {
      return path.slice(1).toLowerCase() + "@" + host;
    }
    if (path.startsWith("users/") && path.split("/").length - 1 === 1) {
      return path.slice("users/".length).toLowerCase() + "@" + host;
    }
    return null;
  }
  const h = s.startsWith("@") ? s.slice(1) : s;
  const cut = h.indexOf("@");
  if (cut < 0) return null;
  const user = h.slice(0, cut);
  const host = h.slice(cut + 1);
  if (user === "" || host === "" || /[@/ ]/.test(user + host)) return null;
  return user.toLowerCase() + "@" + host.toLowerCase();
}

/** Split a textarea of entries, one per line or comma separated. */
export function splitEntries(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * ValidateAllowedIdentities plus the MaxAllowedIdentities cap: the first
 * problem the chain would refuse the policy for, or null when it would pass.
 * "*" must be written exactly, as the chain compares it verbatim.
 */
export function allowedIdentitiesError(entries: string[]): string | null {
  if (entries.length > MAX_ALLOWED_IDENTITIES) {
    return `Allowed authors has ${entries.length} entries; the chain accepts at most ${MAX_ALLOWED_IDENTITIES}. Curate a larger list in a collection.`;
  }
  for (const e of entries) {
    if (e === ALL_IDENTITIES) continue;
    if (normalizeAuthorIdentity(e) === null) {
      return `"${e}" is not an author identity. Write @user@host, user@host, https://host/@user or https://host/users/user.`;
    }
  }
  return null;
}

// types.ValidatePeerID, which content_hosts entries must also satisfy.
const PEER_ID = /^[a-z0-9][a-z0-9.\-]{1,62}[a-z0-9]$/;

/** ValidateContentHosts: null when the chain would accept the list. */
export function contentHostsError(hosts: string[]): string | null {
  if (hosts.length > MAX_CONTENT_HOSTS) {
    return `Content hosts has ${hosts.length} entries; the chain accepts at most ${MAX_CONTENT_HOSTS}.`;
  }
  const seen = new Set<string>();
  for (const h of hosts) {
    if (!PEER_ID.test(h)) return `Content host "${h}" is not a lowercase hostname (no scheme, path or port).`;
    if (seen.has(h)) return `Content host "${h}" is listed twice.`;
    seen.add(h);
  }
  return null;
}
