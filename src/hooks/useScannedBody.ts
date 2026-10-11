"use client";

import { useEffect, useState } from "react";
import { useVerdict } from "@/hooks/useVerdict";
import { loadVerifiedBody, recordKey, type BodyKind } from "@/lib/contentScan/body";
import type { VerdictReason } from "@/lib/contentScan/client";
import { base64HashToHex, mediaFlags as parseFlags } from "@/lib/contentScan/protocol";
import { MediaFlag } from "@/lib/mediaLabels";

// Display policy for one content body (docs/content-scanning.md §6):
//
//   plain text (media_flags == 0)  shown at once; hidden if a verdict says held/removed
//   flagged body                   "Being checked" until a clean verdict; then fetched
//                                  through the body query and shown only if its sha256
//                                  matches body_hash (federated: the agreed hash)
//   held                           placeholder
//   removed                        "Not available on this site"

export type BodyStatus = "show" | "checking" | "held" | "removed";
export type BodyReason = VerdictReason | "fetching" | "mismatch" | "error";

export interface ScannedBody {
  status: BodyStatus;
  /** The text to render when status is "show". */
  text: string;
  reason?: BodyReason;
  /** The chain labelled this record as media. */
  flagged: boolean;
}

export interface ScannedBodyInput {
  kind: BodyKind;
  id: string;
  /** Body as the list/show query returned it ("" when withheld). */
  body: string | undefined;
  media_flags?: number | string;
  /** base64 sha256, as the LCD returns body_hash. */
  body_hash?: string;
  /** Author address, for the elevated quorum on low-trust media. */
  author?: string;
}

/** Null input skips everything (e.g. the record isn't loaded yet). */
export function useScannedBody(input: ScannedBodyInput | null): ScannedBody {
  const flags = input ? parseFlags(input.media_flags) : 0;
  const flagged = flags !== 0;
  const bodyHash = input ? base64HashToHex(input.body_hash) : "";
  const federated = input?.kind === "federated";
  // Off-chain references are judged on the bytes the id points at, so their
  // verdict hash is not body_hash; federated records have no body_hash.
  const offchain = (flags & MediaFlag.OFFCHAIN_REF) !== 0;
  const verdict = useVerdict(
    input
      ? {
          record: recordKey(input.kind, input.id),
          sha256: !federated && !offchain && bodyHash ? bodyHash : undefined,
          author: federated ? undefined : input.author,
          lowTrust: federated || undefined,
        }
      : null
  );

  const clean = flagged && verdict.state === "clean";
  const expected = federated ? verdict.sha256 || "" : bodyHash;
  const fetchKey = clean && input ? `${input.kind}|${input.id}|${expected}|${verdict.cid || ""}` : "";
  const [fetched, setFetched] = useState<{ key: string; text?: string; reason?: BodyReason }>({ key: "" });

  useEffect(() => {
    if (!fetchKey || !input) return;
    let cancelled = false;
    loadVerifiedBody(input.kind, input.id, expected).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setFetched({ key: fetchKey, reason: res.reason === "no-crypto" ? "no-crypto" : res.reason });
      // An off-chain record's body is the id the scanners resolved.
      if (offchain && verdict.cid && res.body.trim() !== verdict.cid) {
        return setFetched({ key: fetchKey, reason: "mismatch" });
      }
      setFetched({ key: fetchKey, text: res.body });
    });
    return () => {
      cancelled = true;
    };
    // fetchKey captures every input the fetch depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  if (!input) return { status: "checking", text: "", reason: "loading", flagged: false };
  if (verdict.state === "removed") return { status: "removed", text: "", flagged };
  if (verdict.state === "held") return { status: "held", text: "", flagged };
  if (!flagged) return { status: "show", text: input.body ?? "", flagged };
  if (!clean) return { status: "checking", text: "", reason: verdict.reason, flagged };
  if (fetched.key !== fetchKey) return { status: "checking", text: "", reason: "fetching", flagged };
  if (fetched.text === undefined) return { status: "checking", text: "", reason: fetched.reason, flagged };
  return { status: "show", text: fetched.text, flagged };
}

/**
 * The full stored body of the viewer's own media-labelled record, for its edit
 * form. List and show queries return "" for these, and an editor seeded with
 * "" would wipe the body on save. The author's own text is loaded without
 * waiting for scanner verdicts: they wrote it, and the editor shows it only to
 * them. It is still checked against body_hash, so the form edits exactly what
 * is stored. `ready` is false while loading; `error` is set if it could not
 * be loaded or verified, and the caller should then not offer the editor.
 */
export function useOwnBody(input: {
  kind: BodyKind;
  id: string;
  body: string | undefined;
  media_flags?: number | string;
  body_hash?: string;
} | null): { ready: boolean; body: string; error?: string } {
  const flagged = !!input && parseFlags(input.media_flags) !== 0;
  const hash = input ? base64HashToHex(input.body_hash) : "";
  const key = flagged && input ? `${input.kind}|${input.id}|${hash}` : "";
  const [state, setState] = useState<{ key: string; body?: string; error?: string }>({ key: "" });

  useEffect(() => {
    if (!key || !input) return;
    let cancelled = false;
    loadVerifiedBody(input.kind, input.id, hash).then((res) => {
      if (cancelled) return;
      setState(
        res.ok
          ? { key, body: res.body }
          : {
              key,
              error:
                res.reason === "mismatch"
                  ? "The stored text didn't match its hash, so it can't be edited here."
                  : res.reason === "no-crypto"
                    ? "This browser can't verify the stored text, so it can't be edited here."
                    : "The stored text didn't load. Try again.",
            }
      );
    });
    return () => {
      cancelled = true;
    };
    // key captures every input the fetch depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!input) return { ready: false, body: "" };
  if (!flagged) return { ready: true, body: input.body ?? "" };
  if (state.key !== key) return { ready: false, body: "" };
  return state.error ? { ready: false, body: "", error: state.error } : { ready: true, body: state.body ?? "" };
}
