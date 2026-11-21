// Images this browser uploaded, by address, with the sha256 of their bytes.
//
// Readers see an image only once content scanners have published a signed
// verdict for its address, which happens a minute or two after the dream is
// onchain. The member who uploaded it doesn't need to wait: the bytes came
// from their own device and the site's scanner pre-check cleared them before
// they were stored. So their browser shows the image at once, in the composer
// and in the published dream, still as bytes that hash to what was uploaded.
// A verdict of held or removed, once there is one, wins over this.
//
// Kept in localStorage, so it holds across tabs and reloads on this device
// only. Nothing here is trusted by anyone else's browser.

const KEY = "my-image-uploads";
const MAX_ENTRIES = 300;

type Entries = Record<string, string>;

const listeners = new Set<() => void>();
let cache: { raw: string | null; entries: Entries } | null = null;

function read(): Entries {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: nothing is remembered.
  }
  if (cache && cache.raw === raw) return cache.entries;
  let entries: Entries = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [url, sha] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha)) entries[url] = sha;
      }
    }
  } catch {
    entries = {};
  }
  cache = { raw, entries };
  return entries;
}

/** Remember an image this browser has just uploaded. */
export function rememberUpload(url: string, sha256: string): void {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return;
  const entries = { ...read() };
  // Re-inserted so the newest stay when the oldest are dropped.
  delete entries[url];
  entries[url] = sha256;
  const urls = Object.keys(entries);
  for (const old of urls.slice(0, Math.max(0, urls.length - MAX_ENTRIES))) delete entries[old];
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage blocked or full: the image just waits for the scanners like any other.
  }
  cache = null;
  for (const l of listeners) l();
}

/** The sha256 of an image this browser uploaded to `url`, or "" if it didn't. */
export function myUploadSha(url: string): string {
  if (typeof window === "undefined") return "";
  return read()[url] || "";
}

/** For useSyncExternalStore: told when an upload is remembered, here or in another tab. */
export function subscribeMyUploads(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}
