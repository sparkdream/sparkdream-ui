"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { loadManifest } from "@/lib/archive";
import { useChainConfig } from "@/contexts/ChainConfigContext";

export default function ArchiveSectionRedirect({ section }: { section: string }) {
  const router = useRouter();
  const { config, ready: configReady } = useChainConfig();
  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    loadManifest(config.remoteManifestUrl).then((m) => {
      if (cancelled) return;
      const latest = m.snapshots[0]; // manifests.json is sorted newest-first
      if (!latest) {
        router.replace("/archive");
        return;
      }
      const suffix = section ? `/${section}` : "";
      router.replace(`/archive/${latest.id}${suffix}`);
    });
    return () => {
      cancelled = true;
    };
  }, [router, section, configReady, config.remoteManifestUrl]);
  return <div className="p-6 opacity-70">Opening archive…</div>;
}
