"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { requestCopyMsg } from "@/lib/storageMsgs";
import { getTxMsgResponses } from "@/lib/api";
import { getStorageRequestByHash, invalidateStorage, quoteStorageFee } from "@/lib/storageApi";
import { fitImage, prepareImage, sha256Hex, type PreparedImage, type ProfileType } from "@/lib/imagePrepare";
import { loadUploadPolicy, uploadBlob, type UploadPolicy } from "@/lib/imageUpload/client";
import { backendType, formatBytes, sourceUrlProblem } from "@/lib/storageRules";
import { errorMessage } from "@/lib/errors";
import { formatSpark } from "@/lib/utils";
import ErrorState from "@/components/ErrorState";
import { Field, FormActions, FormShell, INPUT_CLASS, Preview } from "@/components/permissions/fields";
import { requestId, type StorageQuote, type StorageRequest } from "@/types/storage";
import { SessionNotice, useStorageSetup } from "./shared";
import OperatorFunds from "./OperatorFunds";

/** Reads the new request's id from the tx's response, or null. */
async function createdRequestId(hash: string): Promise<string | null> {
  try {
    const { MsgRequestPermanentCopyResponse } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/storage/v1/tx");
    for (const r of await getTxMsgResponses(hash)) {
      if (r.typeUrl === "/sparkdream.storage.v1.MsgRequestPermanentCopyResponse") {
        return MsgRequestPermanentCopyResponse.decode(r.value).requestId.toString();
      }
    }
  } catch {
    // the tx landed; the caller falls back to the list
  }
  return null;
}

type SourceCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "match" }
  | { state: "mismatch"; detail: string }
  | { state: "unknown"; detail: string };

/**
 * Fetches `url` from the browser and compares it with the prepared file.
 * Many hosts do not let another site's page read their files, so "unknown"
 * is an ordinary answer and never blocks the request.
 */
async function checkSource(url: string, want: PreparedImage): Promise<SourceCheck> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    return { state: "unknown", detail: "This page is not allowed to read that address, so it could not be checked from here." };
  }
  if (!res.ok) return { state: "mismatch", detail: `The address answered with status ${res.status}.` };
  try {
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.length !== want.bytes.length) {
      return { state: "mismatch", detail: `The address serves ${formatBytes(body.length)}, the prepared file is ${formatBytes(want.bytes.length)}.` };
    }
    if ((await sha256Hex(body)) !== want.sha256) {
      return { state: "mismatch", detail: "The address serves a different file (the hash differs)." };
    }
    return { state: "match" };
  } catch {
    // The headers arrived but the body did not (a dropped connection).
    return { state: "unknown", detail: "The download from that address was interrupted, so it could not be checked." };
  }
}

export default function RequestForm({
  onCreated,
  onOpenExisting,
  onCancel,
}: {
  /** Called with the new request's id, or null when it couldn't be read back. */
  onCreated: (id: string | null) => void;
  onOpenExisting: (id: string) => void;
  onCancel: () => void;
}) {
  const { address, signerAddress, signAndBroadcast, sessionActive } = useWallet();
  const { config: { displayDenom: DISPLAY, chainId } } = useChainConfig();
  // The member, not the key that signs: in session mode those differ, and
  // the chain refuses storage messages from a session key anyway.
  const isMember = useIsRepMember(address);
  const { params, backends, error: setupError, reload } = useStorageSetup();

  const [backendName, setBackendName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState<ProfileType>("image/png");
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [existing, setExisting] = useState<StorageRequest | null>(null);
  const [quote, setQuote] = useState<StorageQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<SourceCheck>({ state: "idle" });
  const [understood, setUnderstood] = useState(false);
  // This site's own image storage, when it has one (lib/imageUpload).
  const [policy, setPolicy] = useState<UploadPolicy | null>(null);
  const [uploading, setUploading] = useState<"upload" | "fit" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadUploadPolicy().then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledBackends = useMemo(() => backends.filter((b) => b.enabled), [backends]);
  const backend = enabledBackends.find((b) => b.name === backendName) ?? enabledBackends[0] ?? null;
  const listed = (ct: ProfileType) => backendType(backend, ct) !== null;
  // Bumped whenever a running address check stops applying (new file, new
  // target type, edited address), so its late answer is dropped.
  const checkSeq = useRef(0);

  // Prepare the picked file whenever it or the target type changes.
  useEffect(() => {
    setPrepared(null);
    setPrepareError(null);
    setExisting(null);
    setQuote(null);
    checkSeq.current++;
    setCheck({ state: "idle" });
    // A prepare that was still running is abandoned by the cleanup below and
    // never reports back, so the flag is reset here.
    setPreparing(false);
    setUploadError(null);
    if (!file) return;
    let live = true;
    setPreparing(true);
    prepareImage(file, { target })
      .then((p) => live && setPrepared(p))
      .catch((err) => live && setPrepareError(errorMessage(err) || "The image could not be prepared"))
      .finally(() => live && setPreparing(false));
    return () => {
      live = false;
    };
  }, [file, target]);

  const type = prepared ? backendType(backend, prepared.contentType) : null;
  const tooLarge = !!prepared && !!type && prepared.bytes.length > Number(type.max_size);
  const notListed = !!prepared && !!backend && !type;

  // Once prepared: is this file already requested, and what does it cost?
  useEffect(() => {
    // Whatever was read for another backend or file no longer applies.
    setExisting(null);
    setQuote(null);
    setQuoteError(null);
    if (!prepared || !backend || !type || tooLarge) return;
    let live = true;
    getStorageRequestByHash(backend.name, prepared.sha256)
      .then((r) => live && setExisting(r?.request ?? null))
      .catch(() => live && setExisting(null));
    quoteStorageFee(backend.name, prepared.contentType, prepared.bytes.length)
      .then((q) => live && setQuote(q))
      .catch((err) => live && setQuoteError(errorMessage(err) || "The fee could not be read"));
    return () => {
      live = false;
    };
  }, [prepared, backend, type, tooLarge]);

  // A link the member saves the prepared file from, to host it.
  const downloadUrl = useMemo(
    () => (prepared ? URL.createObjectURL(new Blob([prepared.bytes as BlobPart], { type: prepared.contentType })) : null),
    [prepared]
  );
  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  const trimmedUrl = url.trim();
  const urlProblem = trimmedUrl ? sourceUrlProblem(trimmedUrl, params?.max_url_bytes ?? 512) : null;
  const runCheck = async () => {
    if (!prepared || !trimmedUrl || urlProblem) return;
    const seq = ++checkSeq.current;
    setCheck({ state: "checking" });
    const res = await checkSource(trimmedUrl, prepared);
    if (checkSeq.current === seq) setCheck(res);
  };

  // Uploading is signed by the member's own wallet, like the request.
  const siteStores = !!policy?.enabled && !!address && isMember === true && !sessionActive && signerAddress === address;
  // The site keeps the file a copy is made from at its full size in pixels,
  // up to its own size limit, until the copy exists.
  const siteKeeps = policy?.copy_max_bytes ?? 0;
  const fitsSite = !!prepared && prepared.bytes.length <= siteKeeps;

  const uploadHere = async () => {
    if (!prepared || !address || uploading) return;
    setUploading("upload");
    setUploadError(null);
    try {
      const done = await uploadBlob(new Blob([prepared.bytes as BlobPart], { type: prepared.contentType }), { chainId, address, kind: "copy" });
      if (done.sha256 !== prepared.sha256) throw new Error("The site stored a different file than the one prepared.");
      checkSeq.current++;
      setUrl(done.url);
      // The site stored these exact bytes, so there is nothing left to check.
      setCheck({ state: "match" });
    } catch (err) {
      setUploadError(errorMessage(err) || "The upload didn't go through.");
    } finally {
      setUploading(null);
    }
  };

  // Re-prepare the picked file small enough for this site to store.
  const fitToSite = async () => {
    if (!file || !policy || !backend || uploading) return;
    setUploading("fit");
    setUploadError(null);
    try {
      const types = (["image/png", "image/jpeg"] as const).filter((t) => backendType(backend, t));
      const kept = Math.min(siteKeeps, ...types.map((t) => Number(backendType(backend, t)!.max_size)));
      const fitted = await fitImage(file, { maxBytes: kept, maxSide: Infinity, types: [...types] });
      checkSeq.current++;
      setCheck({ state: "idle" });
      setUrl("");
      setPrepared(fitted);
    } catch (err) {
      setUploadError(errorMessage(err) || "The image could not be made smaller.");
    } finally {
      setUploading(null);
    }
  };

  const problem =
    !backend ? "No storage backend is taking requests"
    : !prepared ? "Choose an image"
    : notListed ? `${backend.name} does not keep ${prepared.contentType} files`
    : tooLarge ? "The prepared file is too large"
    : existing ? "This file already has a request"
    : !trimmedUrl ? "Enter the address the file can be fetched from"
    : urlProblem ? urlProblem
    : check.state === "mismatch" ? "The address does not serve the prepared file"
    : !quote ? "Waiting for the fee"
    : !understood ? "Confirm that you understand the copy is public and permanent"
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !prepared || !backend || !quote) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const hash = await signAndBroadcast([
        requestCopyMsg({
          requester: signerAddress!,
          backend: backend.name,
          sha256: prepared.sha256,
          sizeBytes: prepared.bytes.length,
          contentType: prepared.contentType,
          url: trimmedUrl,
          // The quote is the ceiling: if the price rose since, the chain
          // refuses instead of charging more.
          maxFee: quote.total,
        }),
      ]);
      invalidateStorage();
      onCreated(await createdRequestId(hash));
    } catch (err) {
      setError(errorMessage(err) || "The request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const off = params !== null && params.enabled === false;
  // The site's operator can stop offering new requests (ARWEAVE_UPLOADS_DISABLED).
  const siteOff = policy?.permanent_copies === false;

  return (
    <FormShell
      title="Request a permanent copy"
      intro="Pay once to have an image copied to a storage network where nothing can be deleted. The chain never holds the file: it records your request, and a bonded operator fetches the file from an address you give and makes the copy."
      onSubmit={handleSubmit}
    >
      {setupError ? <ErrorState error={setupError} onRetry={reload} compact /> : null}
      {off && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
          Permanent copies are switched off on this chain right now.
        </div>
      )}
      {siteOff && !off && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
          New permanent copies are switched off on this site right now.
        </div>
      )}
      {sessionActive && <SessionNotice />}
      {isMember === false && (
        <div className="rounded-lg border border-amber-800 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
          Only members can request a permanent copy. You need an invitation to join.
        </div>
      )}

      {enabledBackends.length > 1 && (
        <Field id="sr-backend" label="Storage network">
          <select id="sr-backend" value={backend?.name ?? ""} onChange={(e) => setBackendName(e.target.value)} className={INPUT_CLASS}>
            {enabledBackends.map((b) => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
          </select>
        </Field>
      )}

      <Field
        id="sr-file"
        label="1. Choose the image"
        help="It stays on your device. It is checked here and, if needed, re-encoded so that it carries no metadata, no colour profile and no transparency."
      >
        <input
          id="sr-file"
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-sm file:text-zinc-200"
        />
      </Field>

      {file && (
        <Field label="Keep it as" help="PNG keeps every pixel exactly. JPEG is much smaller for photographs but loses some fine detail.">
          <div className="flex gap-2">
            {(["image/png", "image/jpeg"] as const).map((ct) => (
              <button
                key={ct}
                type="button"
                disabled={!listed(ct)}
                onClick={() => setTarget(ct)}
                className={`sd-btn ${(prepared?.contentType ?? target) === ct ? "sd-btn-primary" : "sd-btn-secondary"}`}
              >
                {ct === "image/png" ? "PNG" : "JPEG"}
              </button>
            ))}
          </div>
        </Field>
      )}

      {preparing && <p className="text-sm text-zinc-400">Preparing the image...</p>}
      {prepareError && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">{prepareError}</div>
      )}

      {prepared && (
        <Preview>
          <div className="space-y-2">
            <div>
              <strong>{prepared.contentType === "image/png" ? "PNG" : "JPEG"}</strong>, {prepared.width} x {prepared.height},{" "}
              {formatBytes(prepared.bytes.length)}
              {type && <span className="text-zinc-500"> (limit {formatBytes(Number(type.max_size))})</span>}
            </div>
            <div className="break-all font-mono text-xs text-zinc-400">sha256 {prepared.sha256}</div>
            {prepared.changes.length === 0 ? (
              <div className="text-zinc-400">The file already fits and is used exactly as it is.</div>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5 text-zinc-400">
                {prepared.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            {tooLarge && (
              <div className="text-red-400">
                Too large to store. {prepared.contentType === "image/png" ? "Try JPEG, or a smaller image." : "Try a smaller image."}
              </div>
            )}
            {notListed && <div className="text-red-400">This storage network does not keep {prepared.contentType} files.</div>}
          </div>
        </Preview>
      )}

      {existing && (
        <div className="rounded-lg border border-indigo-800 bg-indigo-900/20 px-4 py-3 text-sm text-indigo-200">
          This exact file already has a request (#{requestId(existing)}). A file is copied once, so there is nothing more
          to pay for. If its copy is still waiting, you can add your address as another place to fetch it from.{" "}
          <button type="button" onClick={() => onOpenExisting(requestId(existing))} className="underline">
            Open the request
          </button>
        </div>
      )}

      {prepared && !existing && !tooLarge && !notListed && (
        <>
          <Field
            id="sr-url"
            label={siteStores ? "2. Upload the prepared file, or give an address that serves it" : "2. Host the prepared file and give its address"}
            help={
              <>
                The operator fetches the file from this address, so it must serve these exact bytes over https until the
                copy is made. The address is public and stays in the chain&apos;s history for good.
              </>
            }
          >
            {siteStores && siteKeeps > 0 && (
              <div className="mb-3 space-y-1">
                {fitsSite ? (
                  <button type="button" onClick={uploadHere} disabled={!!uploading} className="sd-btn sd-btn-secondary">
                    {uploading === "upload" ? "Checking and uploading..." : "Upload it to this site"}
                  </button>
                ) : (
                  <>
                    <p className="text-sm text-zinc-400">
                      This site keeps files for permanent copies up to {formatBytes(siteKeeps)}, and this one is
                      larger. Make it smaller to upload it here, or host it yourself to keep it as it is.
                    </p>
                    <button type="button" onClick={fitToSite} disabled={!!uploading} className="sd-btn sd-btn-secondary">
                      {uploading === "fit" ? "Making it smaller..." : "Make it small enough"}
                    </button>
                  </>
                )}
                <p className="text-xs text-zinc-500">
                  A content scanner checks the file before this site stores it. The site keeps it only until the copy
                  is made, and it counts toward your weekly uploads for permanent copies. Your wallet asks you to sign once per session; that is not a transaction.
                </p>
                {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}
              </div>
            )}
            {prepared.changes.length > 0 && downloadUrl && (
              <p className="mb-2 text-sm text-zinc-400">
                The file was changed, so if you host it yourself, host the prepared one, not your original:{" "}
                <a
                  href={downloadUrl}
                  download={`prepared-${prepared.sha256.slice(0, 12)}.${prepared.contentType === "image/png" ? "png" : "jpg"}`}
                  className="text-indigo-300 underline"
                >
                  save the prepared file
                </a>
                .
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                id="sr-url"
                type="url"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  checkSeq.current++;
                  setCheck({ state: "idle" });
                }}
                placeholder="https://files.example/picture.png"
                className={`${INPUT_CLASS} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={runCheck}
                disabled={!trimmedUrl || !!urlProblem || check.state === "checking"}
                className="sd-btn sd-btn-secondary"
              >
                {check.state === "checking" ? "Checking..." : "Check"}
              </button>
            </div>
            {urlProblem && <p className="mt-1 text-xs text-red-400">{urlProblem}</p>}
            {check.state === "match" && <p className="mt-1 text-xs text-emerald-400">The address serves the prepared file.</p>}
            {check.state === "mismatch" && <p className="mt-1 text-xs text-red-400">{check.detail}</p>}
            {check.state === "unknown" && (
              <p className="mt-1 text-xs text-amber-300">
                {check.detail} You can still send the request: operators fetch the file themselves and refuse it if it
                does not match.
              </p>
            )}
          </Field>

          {quoteError && <p className="text-sm text-red-400">{quoteError}</p>}
          {quote && (
            <p className="text-sm text-zinc-300">
              3. Cost: <strong className="text-white">{formatSpark(quote.total)} {DISPLAY}</strong>
              <span className="text-zinc-500">
                {" "}
                ({formatSpark(quote.copy_fee)} for the copy, held until it is made and returned if it is not;{" "}
                {formatSpark(quote.request_fee)} request fee, burned now and never returned)
              </span>
            </p>
          )}

          {backend && <OperatorFunds backend={backend} sizeBytes={prepared.bytes.length} />}

          <label className="flex items-start gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1" />
            <span>
              I understand that the copy and the address I gave are public, and that the copy can never be deleted or
              changed, by me or by anyone.
            </span>
          </label>
        </>
      )}

      <FormActions
        submitting={submitting}
        disabled={!!problem || off || siteOff || isMember === false || sessionActive}
        label="Request the copy"
        onCancel={onCancel}
        error={error}
      />
    </FormShell>
  );
}
