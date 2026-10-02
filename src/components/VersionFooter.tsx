"use client";

import { useEffect, useState } from "react";
import { getNodeAppVersion } from "@/lib/api";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "";
const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE ?? "";

// Showing the chain version beside the UI's makes a stale sentry image visible
// at a glance. The chain part is dropped when the node can't be reached.
export default function VersionFooter() {
  const [chainVersion, setChainVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    getNodeAppVersion().then((v) => {
      if (!cancelled) setChainVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const build = [GIT_SHA && `commit ${GIT_SHA}`, BUILD_DATE && `built ${BUILD_DATE}`]
    .filter(Boolean)
    .join(", ");

  return (
    <footer
      className="px-4 py-3 text-center font-mono text-[11px]"
      style={{ color: "var(--ink-dim)" }}
    >
      <span title={build || undefined}>sparkdream-ui v{APP_VERSION}</span>
      {chainVersion && (
        <>
          <span aria-hidden className="mx-2">·</span>
          <span>chain {chainVersion.startsWith("v") ? chainVersion : `v${chainVersion}`}</span>
        </>
      )}
    </footer>
  );
}
