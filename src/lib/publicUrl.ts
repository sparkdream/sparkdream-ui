// Deciding whether an address someone else wrote (on chain, in metadata) is
// safe for this server to contact: a public https origin, not something on
// the server's own network. Server only (node:dns).
//
// The name is resolved once. The request then connects to the address that
// was checked (headPinned), not to whatever the name resolves to a moment
// later, so a name that changes its answer cannot point the request inward.
// TLS still verifies the certificate against the host name.

import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export type Resolve = (host: string) => Promise<string[]>;

const resolveAll: Resolve = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Whether an IP literal is outside every private, loopback, link-local and reserved range. */
export function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (version === 6) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicIp(mapped[1]);
    // Global unicast is 2000::/3; everything else (loopback, unique local,
    // link-local, mapped in hex form, unspecified) is refused.
    return /^[23]/.test(v);
  }
  return false;
}

/** A host this server may contact, with the one address to reach it at. */
export interface PublicTarget {
  host: string;
  address: string;
}

/**
 * Where to reach `url`'s origin if this server may contact it: https on the
 * default port, a host name (not an IP literal) that resolves only to public
 * addresses. Null otherwise, or when the name doesn't resolve.
 */
export async function publicHttpsTarget(url: string, resolve: Resolve = resolveAll): Promise<PublicTarget | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  const host = u.hostname;
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /\.(local|internal|localhost)$/i.test(host)) return null;
  try {
    const addresses = await resolve(host);
    if (addresses.length === 0 || !addresses.every(isPublicIp)) return null;
    return { host, address: addresses[0] };
  } catch {
    return null;
  }
}

/** A DNS lookup that answers every name with the one address already checked. */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address);
  return (_host, options, callback) => {
    // Node asks for a list when it tries address families in turn.
    if (typeof options === "object" && options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * Send `HEAD /` to the target at its checked address and return the status,
 * or null when no answer came (refused, timed out, certificate not valid for
 * the host). No redirect is followed and the body, if any, is discarded.
 */
export function headPinned(target: PublicTarget, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const req = request(
      // A fresh connection each time: a pooled one would skip the lookup.
      { host: target.host, method: "HEAD", path: "/", agent: false, lookup: pinnedLookup(target.address) },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? null);
      }
    );
    const timer = setTimeout(() => req.destroy(new Error("timed out")), timeoutMs);
    req.on("error", () => resolve(null));
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}
