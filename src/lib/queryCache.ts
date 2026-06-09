// Shared in-memory cache for LCD reads: TTL freshness, in-flight request
// dedup, and optional stale-while-revalidate. Generalizes the pattern in
// repMember.ts / useResolveName.ts so list/detail endpoints stop re-hitting
// the chain on every navigation. Mutating flows call invalidate() with a key
// prefix right after broadcast so their follow-up refetch misses the cache.

interface Entry {
  value: unknown;
  ts: number;
}

interface CachedOptions {
  ttl: number; // freshness window in ms
  swr?: boolean; // when stale: return stale value now, revalidate in background
}

const MAX_ENTRIES = 300;

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function setEntry(key: string, value: unknown): void {
  // Delete+set keeps insertion order ≈ recency order for eviction.
  store.delete(key);
  store.set(key, { value, ts: Date.now() });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function startFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const p = fetcher()
    .then((value) => {
      // Only commit if this request wasn't invalidated mid-flight; otherwise
      // a pre-tx response could repopulate data the tx just changed.
      if (inflight.get(key) === p) setEntry(key, value);
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CachedOptions
): Promise<T> {
  if (typeof window === "undefined") return fetcher();

  const entry = store.get(key);
  if (entry && Date.now() - entry.ts <= opts.ttl) {
    return Promise.resolve(entry.value as T);
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  if (entry && opts.swr) {
    // Serve stale immediately; refresh in the background for the next read.
    startFetch(key, fetcher).catch(() => {});
    return Promise.resolve(entry.value as T);
  }

  return startFetch(key, fetcher);
}

export function peek<T>(key: string): T | undefined {
  return store.get(key)?.value as T | undefined;
}

export function invalidate(keyPrefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(keyPrefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(keyPrefix)) inflight.delete(key);
  }
}

export function invalidateAll(): void {
  store.clear();
  inflight.clear();
}
