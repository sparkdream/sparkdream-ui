"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setArchiveSource } from "@/lib/api";
import {
  loadManifest,
  sourceFor,
  type ManifestEntry,
  type ManifestFile,
} from "@/lib/archive";
import { useChainConfig } from "@/contexts/ChainConfigContext";

interface ArchiveState {
  entry: ManifestEntry | null;
  manifest: ManifestFile;
  manifestReady: boolean;
}

const ArchiveContext = createContext<ArchiveState>({
  entry: null,
  manifest: { snapshots: [] },
  manifestReady: false,
});

export function useArchive() {
  return useContext(ArchiveContext);
}

export function useIsReadOnly() {
  return useArchive().entry !== null;
}

export function ArchiveProvider({
  snapshotId,
  children,
}: {
  snapshotId: string | null;
  children: React.ReactNode;
}) {
  const [manifest, setManifest] = useState<ManifestFile>({ snapshots: [] });
  const [manifestReady, setManifestReady] = useState(false);
  const { config, ready: configReady } = useChainConfig();

  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    loadManifest(config.remoteManifestUrl).then((m) => {
      if (cancelled) return;
      setManifest(m);
      setManifestReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [configReady, config.remoteManifestUrl]);

  const entry = useMemo(() => {
    if (!snapshotId) return null;
    return manifest.snapshots.find((s) => s.id === snapshotId) ?? null;
  }, [manifest, snapshotId]);

  useEffect(() => {
    if (!entry) {
      setArchiveSource(null);
      return;
    }
    setArchiveSource(sourceFor(entry));
    return () => {
      setArchiveSource(null);
    };
  }, [entry]);

  return (
    <ArchiveContext.Provider value={{ entry, manifest, manifestReady }}>
      {children}
    </ArchiveContext.Provider>
  );
}
