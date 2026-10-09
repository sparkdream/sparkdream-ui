"use client";

import { useEffect, useState } from "react";
import { getContentLicense } from "@/lib/api";
import { FALLBACK_CONTENT_LICENSE } from "@/lib/contentLicense";
import type { ContentLicense } from "@/types/contentLicense";

/** The chain's content license. Starts from the compiled constants, so the
 *  dedication renders immediately, then takes the chain's own text. */
export function useContentLicense(): ContentLicense {
  const [license, setLicense] = useState<ContentLicense>(FALLBACK_CONTENT_LICENSE);
  useEffect(() => {
    let live = true;
    getContentLicense().then((l) => live && setLicense(l));
    return () => {
      live = false;
    };
  }, []);
  return license;
}
