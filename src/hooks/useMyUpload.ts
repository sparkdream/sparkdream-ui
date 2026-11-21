"use client";

import { useSyncExternalStore } from "react";
import { myUploadSha, subscribeMyUploads } from "@/lib/imageUpload/myUploads";

/** The sha256 of the image at `url` if this browser uploaded it, else "". */
export function useMyUpload(url: string): string {
  return useSyncExternalStore(
    subscribeMyUploads,
    () => myUploadSha(url),
    () => ""
  );
}
