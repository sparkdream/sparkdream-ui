// Pure rules of x/storage that the forms check before signing, so a member
// gets a plain sentence instead of a chain error. Each mirrors the chain
// (x/storage/types/validate.go, docs/x-storage-spec.md §3.2).

import type { BackendType, StorageBackend } from "@/types/storage";

// The characters RFC 3986 allows in a URI, as the chain lists them.
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

/** Why the chain would refuse `raw` as a source address, or null. */
export function sourceUrlProblem(raw: string, maxBytes: number): string | null {
  if (!raw) return "Enter the address the file can be fetched from";
  // The allowed characters are all one byte, so length is the byte length
  // whenever the next check passes.
  if (raw.length > maxBytes) return `The address is longer than ${maxBytes} characters`;
  if (!URL_CHARS.test(raw)) return "The address has a character that is not allowed in a URL (spaces and quotes are not)";
  if (raw.includes("#")) return "The address cannot have a # part";
  // The chain parses with Go's net/url, which differs from the browser's
  // parser, so the parts Go is particular about are read by hand. Go accepts
  // the scheme in any case.
  const m = /^https:\/\/([^/?]*)([^?]*)/i.exec(raw);
  if (!m) {
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https:/i.test(raw) ? "The address must start with https://" : "The address needs https:// and a host";
  }
  const [, authority, path] = m;
  // Go counts a bare "@" as a user part ("https://@host/"); the browser does not.
  if (authority.includes("@")) return "The address cannot carry a user name or password";
  if (!authority) return "The address needs a host";
  // Go refuses most % escapes in a host. The few it lets through never name
  // a real host, so all are refused here.
  if (authority.includes("%")) return "The host cannot have a % escape";
  // Go checks escapes in the path only, never in the query.
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) return "The address has a broken % escape";
  // What is left for the browser's parser: a malformed host or port.
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "That is not a URL";
  }
  if (!u.hostname) return "The address needs a host";
  return null;
}

/** The backend's entry for a content type, if it lists it. */
export function backendType(backend: StorageBackend | null | undefined, contentType: string): BackendType | null {
  return backend?.types?.find((t) => t.content_type === contentType) ?? null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

const ARWEAVE_ID = /^[A-Za-z0-9_-]{43}$/;

/** Where Arweave data is read from unless the site names another gateway. */
export const DEFAULT_ARWEAVE_GATEWAY = "https://arweave.net/{id}";

/**
 * Where a locator's data can be fetched, or null when the format is not one
 * this app can open. `arweaveGateway` is a template holding {id}.
 */
export function locatorTarget(
  locatorFormat: string | undefined,
  locator: string | undefined,
  arweaveGateway: string = DEFAULT_ARWEAVE_GATEWAY
): string | null {
  if (!locator) return null;
  if (locatorFormat === "LOCATOR_FORMAT_ARWEAVE_TX" && ARWEAVE_ID.test(locator)) return arweaveGateway.replace("{id}", locator);
  return null;
}
