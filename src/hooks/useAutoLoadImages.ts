import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";

const KEY = "content-images-auto-load";

/**
 * The reader's choice between loading cleared content images straight away
 * (the default) and loading each one on request. Loading an image tells its
 * host the reader's IP address. Kept in this browser only; set on the
 * Settings page.
 */
export function useAutoLoadImages(): [boolean, (v: boolean) => void] {
  return useLocalStorageBoolean(KEY, true);
}
