"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import {
  getStorageRequest, getStorageRequestByHash, listStorageBackends, listStorageRequestsByRequester,
} from "@/lib/storageApi";
import { errorMessage, isMissingEndpoint } from "@/lib/errors";
import { formatBytes } from "@/lib/storageRules";
import { formatSpark } from "@/lib/utils";
import BlockTime from "@/components/BlockTime";
import ErrorState from "@/components/ErrorState";
import { INPUT_CLASS } from "@/components/permissions/fields";
import { requestId, type StorageRequest } from "@/types/storage";
import { CARD, StatusBadge, shortHash } from "./shared";

const PAGE = "25";

export default function RequestList({
  onOpen,
  onCreate,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  // The member's address: in session mode the connected key is not the requester.
  const { connected, address } = useWallet();
  const [requests, setRequests] = useState<StorageRequest[]>([]);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Bumped by every first-page load, so an answer for an earlier address
  // (or an earlier attempt) is dropped instead of overwriting the list.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    // Nothing of the previous address may stay on screen while this loads.
    setRequests([]);
    setNextKey(null);
    setError(null);
    if (!address) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Newest first: the index is ordered by request id.
      const res = await listStorageRequestsByRequester(address, { limit: PAGE, reverse: true });
      if (seq.current !== mySeq) return;
      setRequests(res.requests || []);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      if (seq.current === mySeq) setError(err);
    } finally {
      if (seq.current === mySeq) setLoading(false);
    }
  }, [address]);
  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (!address || !nextKey) return;
    const mySeq = seq.current;
    try {
      const res = await listStorageRequestsByRequester(address, { limit: PAGE, reverse: true, key: nextKey });
      if (seq.current !== mySeq) return;
      setRequests((r) => [...r, ...(res.requests || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      if (seq.current === mySeq) setError(err);
    }
  };

  return (
    <div className="space-y-6">
      <RequestLookup onOpen={onOpen} />

      {error ? <ErrorState error={error} onRetry={load} /> : null}

      {!connected ? null : loading ? (
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      ) : requests.length === 0 && !error ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-zinc-400">You haven&apos;t asked for a permanent copy yet</p>
          <button type="button" onClick={onCreate} className="sd-btn sd-btn-secondary mt-4">
            Request one
          </button>
        </div>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Your requests</h2>
          {requests.map((r) => (
            <RequestRow key={requestId(r)} request={r} onOpen={onOpen} />
          ))}
          {nextKey && (
            <button type="button" onClick={loadMore} className="sd-btn sd-btn-secondary">
              Show more
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function RequestRow({ request: r, onOpen }: { request: StorageRequest; onOpen: (id: string) => void }) {
  const { config: { displayDenom: DISPLAY } } = useChainConfig();
  return (
    <button
      type="button"
      onClick={() => onOpen(requestId(r))}
      className={`${CARD} block w-full text-left transition-colors hover:border-indigo-600`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-semibold text-white">Request #{requestId(r)}</span>
        <StatusBadge status={r.status} />
      </div>
      <div className="mt-1 font-mono text-xs text-zinc-400">{shortHash(r.sha256)}</div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        <span>{r.content_type}</span>
        <span>{formatBytes(Number(r.size_bytes))}</span>
        {r.copy_fee && r.copy_fee !== "0" && <span>{formatSpark(r.copy_fee)} {DISPLAY} held</span>}
        {r.created_at && (
          <span>
            <BlockTime height={r.created_at} relative fallback={`block ${r.created_at}`} />
          </span>
        )}
      </div>
    </button>
  );
}

/** Open any request by its id, or find the request for a file by its sha256. */
function RequestLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      if (/^\d+$/.test(q)) {
        const res = await getStorageRequest(q);
        onOpen(requestId(res.request));
      } else if (/^[0-9a-f]{64}$/.test(q)) {
        let found: string | null = null;
        // Read here, not from the page's state: that is empty until it loads
        // and after a failed load, which would read as "nobody asked".
        for (const b of await listStorageBackends()) {
          const res = await getStorageRequestByHash(b.name, q);
          if (res) {
            found = requestId(res.request);
            break;
          }
        }
        if (found !== null) onOpen(found);
        else setError("Nobody has asked for a copy of that file");
      } else {
        setError("Enter a request number or a sha256 (64 hex characters)");
      }
    } catch (err) {
      setError(isMissingEndpoint(err) ? "No request found" : errorMessage(err) || "The lookup failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a copy by request number or the file's sha256"
          aria-label="Request number or sha256"
          spellCheck={false}
          autoComplete="off"
          className={INPUT_CLASS}
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button type="submit" disabled={busy || !query.trim()} className="sd-btn sd-btn-secondary">
        Find
      </button>
    </form>
  );
}
