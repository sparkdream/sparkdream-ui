import type { ArchiveSource } from "./api";
import { archiveKey } from "./api";

export interface ManifestEntry {
  id: string;
  chainId: string;
  capturedAtIso: string;
  capturedHeight: string;
  label?: string;
  location: "local" | "remote";
  remoteBase?: string;
}

export interface ManifestFile {
  snapshots: ManifestEntry[];
}

export class LocalArchiveSource implements ArchiveSource {
  constructor(private id: string) {}
  fetch(path: string, qs: string | null): Promise<Response> {
    return fetch(`/archive/${this.id}/lcd/${archiveKey(path, qs)}`);
  }
}

export class RemoteArchiveSource implements ArchiveSource {
  constructor(private id: string, private base: string) {}
  fetch(path: string, qs: string | null): Promise<Response> {
    const trimmed = this.base.replace(/\/$/, "");
    return fetch(`${trimmed}/${this.id}/lcd/${archiveKey(path, qs)}`);
  }
}

export function sourceFor(entry: ManifestEntry): ArchiveSource {
  if (entry.location === "remote") {
    if (!entry.remoteBase) {
      throw new Error(`Snapshot ${entry.id} is remote but has no remoteBase`);
    }
    return new RemoteArchiveSource(entry.id, entry.remoteBase);
  }
  return new LocalArchiveSource(entry.id);
}

export async function loadManifest(remoteUrl: string): Promise<ManifestFile> {
  // Production deploys (e.g. Akash) point REMOTE_MANIFEST_URL at a manifests.json
  // in object storage so new snapshots can be added by uploading a file — no
  // redeploy. The URL arrives via /api/config (see ChainConfig.remoteManifestUrl)
  // so it can be changed at runtime without rebuilding the image.
  if (remoteUrl) {
    try {
      const res = await fetch(remoteUrl);
      if (res.ok) return res.json();
    } catch {
      // fall through to local sources
    }
  }
  // Local dev: the API reconciles against the filesystem so manually-deleted
  // snapshot dirs disappear from the picker.
  try {
    const api = await fetch("/api/archive/manifests");
    if (api.ok) return api.json();
  } catch {
    // ignore; fall through to static
  }
  const res = await fetch("/archive/manifests.json");
  if (!res.ok) return { snapshots: [] };
  return res.json();
}
