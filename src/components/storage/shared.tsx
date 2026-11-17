"use client";

import { useCallback, useEffect, useState } from "react";
import { getStorageParams, listStorageBackends } from "@/lib/storageApi";
import { REQUEST_STATUS_LABELS, RequestStatus, type StorageBackend, type StorageParams } from "@/types/storage";

export const CARD = "rounded-xl border border-zinc-800 bg-zinc-900/50 p-5";

const STATUS_TONES: Record<string, string> = {
  [RequestStatus.PENDING]: "border-amber-800/70 text-amber-300",
  [RequestStatus.CLAIMED]: "border-amber-800/70 text-amber-300",
  [RequestStatus.COMPLETED]: "border-indigo-700 text-indigo-300",
  [RequestStatus.SETTLED]: "border-emerald-800 text-emerald-300",
  [RequestStatus.REJECTED]: "border-red-900 text-red-300",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${STATUS_TONES[status] ?? "border-zinc-700 text-zinc-400"}`}>
      {REQUEST_STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Storage messages cannot be signed by a session key (SESSION_FORBIDDEN_TYPES). */
export function SessionNotice() {
  return (
    <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
      Permanent copies can&apos;t be requested or changed with a session key. Switch off session mode to sign with your
      main wallet.
    </div>
  );
}

export interface StorageSetup {
  params: StorageParams | null;
  backends: StorageBackend[];
  error: unknown;
  reload: () => void;
}

/** The module's params and backends, which every storage view needs. */
export function useStorageSetup(): StorageSetup {
  const [params, setParams] = useState<StorageParams | null>(null);
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(() => {
    Promise.all([getStorageParams(), listStorageBackends()])
      .then(([p, b]) => {
        setParams(p);
        setBackends(b);
        setError(null);
      })
      .catch(setError);
  }, []);
  useEffect(reload, [reload]);

  return { params, backends, error, reload };
}

export function shortHash(sha256: string): string {
  return sha256.length > 20 ? `${sha256.slice(0, 10)}...${sha256.slice(-8)}` : sha256;
}
