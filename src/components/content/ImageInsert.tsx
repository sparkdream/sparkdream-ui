"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { buildImageMarkdown } from "@/lib/contentScan/bodyImages";
import { loadUploadPolicy, uploadBlob, uploadImage, type UploadPolicy } from "@/lib/imageUpload/client";
import { sessionAllowsUpload } from "@/lib/imageUpload/policy";
import { fitImage, type PreparedImage, type ProfileType } from "@/lib/imagePrepare";
import { getStorageRequestByHash, invalidateStorage, quoteStorageFee } from "@/lib/storageApi";
import { requestCopyMsg } from "@/lib/storageMsgs";
import { backendType, formatBytes, sourceUrlProblem } from "@/lib/storageRules";
import { useStorageSetup } from "@/components/storage/shared";
import OperatorFunds from "@/components/storage/OperatorFunds";
import { errorMessage } from "@/lib/errors";
import { formatSpark } from "@/lib/utils";
import { requestId, type StorageQuote, type StorageRequest } from "@/types/storage";

const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const TAB = "rounded-md px-3 py-1 text-xs font-medium transition-colors";

type Source = "upload" | "link";

/**
 * Composer control that embeds an image in a body as a Markdown image link,
 * placed on its own line at the cursor. The image is either uploaded here (a
 * member perk: the site stores it once a content scanner has cleared it) or
 * linked from wherever it is already hosted. Either way the chain stores
 * only the address. An uploaded image can also get a permanent copy
 * (x/storage): the member signs the request with their wallet, a bonded
 * operator makes the copy in the background from the uploaded file, and the
 * dream shows the uploaded image straight away.
 */

/** What a permanent copy of the picked file would be and cost. */
interface CopyPlan {
  prepared: PreparedImage;
  /** A request that already exists for these exact bytes: nothing more to pay. */
  existing: StorageRequest | null;
  quote: StorageQuote | null;
}

const PROFILE: ProfileType[] = ["image/png", "image/jpeg"];
export default function ImageInsert({
  body,
  onChange,
  textareaRef,
  anonymous = false,
  onPermanentCopy,
  onPendingChange,
}: {
  body: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The dream is being posted anonymously: a request for a permanent copy
   *  names its requester on chain, which would tie the member's address to
   *  the image, so it isn't offered. */
  anonymous?: boolean;
  /** Called with an image's address once a permanent-copy request by this
   *  member names it, so the form can keep it out of an anonymous dream. */
  onPermanentCopy?: (url: string) => void;
  /** Called when an image is picked or typed here but not yet in the body
   *  (or no longer so). Publishing then would leave the image out without a
   *  word, so the form holds its publish button until it is added or cancelled. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const { address, signerAddress, sessionActive, activeSession, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const isMember = useIsRepMember(address);
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<UploadPolicy | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaLine, setQuotaLine] = useState<string | null>(null);
  // Shown after the panel closes: the image went in, the copy request didn't.
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const { params: storageParams, backends } = useStorageSetup();

  useEffect(() => {
    if (!open || policy) return;
    let cancelled = false;
    void loadUploadPolicy().then((p) => {
      if (!cancelled) setPolicy(p);
    });
    return () => {
      cancelled = true;
    };
  }, [open, policy]);

  const pending = open && (busy || !!file || !!url.trim());
  const reportPending = useRef(onPendingChange);
  reportPending.current = onPendingChange;
  useEffect(() => {
    reportPending.current?.(pending);
    return () => reportPending.current?.(false);
  }, [pending]);

  // An upload is signed for by the member's own wallet, or by a session key
  // the member lets publish dreams: it sends nothing onchain, so the key's
  // signature and the session onchain are enough. It isn't offered to
  // someone who isn't a member.
  const uploadsOn = !!policy?.enabled;
  const ownWallet = !sessionActive && !!signerAddress && signerAddress === address;
  const viaSession = sessionActive && !!signerAddress && sessionAllowsUpload(activeSession?.allowed_msg_types);
  const canUpload = uploadsOn && !!address && isMember === true && (ownWallet || viaSession);
  // Whether uploading is on offer isn't known until the policy and the
  // membership have been read. Until then neither form is shown, so the one
  // being typed in is never swapped for the other.
  const resolving = policy === null || (policy.enabled && !!address && isMember === null);
  const active: Source = source ?? (canUpload ? "upload" : "link");
  // The storage network a copy would go to: the first one taking requests
  // that keeps a still image type.
  const backend = backends.find((b) => b.enabled && PROFILE.some((t) => backendType(b, t))) ?? null;
  // The copy is made from the picture at its full size, which this site
  // keeps only until the copy exists; the dream shows the usual small image.
  const copyMaxBytes = policy?.copy_max_bytes ?? 0;
  const copiesOn = !!backend && storageParams?.enabled !== false && policy?.permanent_copies !== false && copyMaxBytes > 0;
  // The request for a permanent copy pays a fee, which a session key can
  // never sign (x/session forbids it), so copies need the member's own wallet.
  const permanentOffered = canUpload && ownWallet && copiesOn && !anonymous;
  const keepForever = permanent && permanentOffered;

  // With "keep a permanent copy" ticked, the picked file is prepared for the
  // storage profile here, at its full size unless that is more than the
  // storage network or this site takes, so its size, and so its price, is
  // known before anything is uploaded or signed.
  useEffect(() => {
    setPlan(null);
    setPlanError(null);
    if (!keepForever || !file || !backend || !copyMaxBytes) return;
    let live = true;
    (async () => {
      const types = PROFILE.filter((t) => backendType(backend, t));
      const kept = Math.min(copyMaxBytes, ...types.map((t) => Number(backendType(backend, t)!.max_size)));
      const prepared = await fitImage(file, { maxBytes: kept, maxSide: Infinity, types });
      const existing = (await getStorageRequestByHash(backend.name, prepared.sha256))?.request ?? null;
      const quote = existing
        ? null
        : await quoteStorageFee(backend.name, prepared.contentType, prepared.bytes.length);
      if (live) setPlan({ prepared, existing, quote });
    })().catch((err) => live && setPlanError(errorMessage(err) || "The permanent copy could not be prepared."));
    return () => {
      live = false;
    };
  }, [keepForever, file, backend, copyMaxBytes]);

  // Fees are in micro units of the display denom, like every amount here.
  const feeLabel = plan?.quote ? `${formatSpark(plan.quote.total)} ${config.displayDenom}` : "";

  let uploadNote: string | null = null;
  if (uploadsOn && !canUpload) {
    if (!address) uploadNote = "Connect your wallet to upload images.";
    else if (!ownWallet && !viaSession) {
      uploadNote = "This session key can't publish dreams, so it can't upload images for them.";
    } else if (isMember === false) uploadNote = "Uploading images is for members. You can still link to one.";
  }

  const close = () => {
    setOpen(false);
    setError(null);
    setFile(null);
    setUrl("");
    setSource(null);
  };

  const place = (md: string) => {
    const el = textareaRef.current;
    const at = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    const before = body.slice(0, at);
    const after = body.slice(end);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    const trail = after && !after.startsWith("\n") ? "\n" : "";
    onChange(`${before}${lead}${md}${trail}${after}`);
    const caret = before.length + lead.length + md.length + trail.length;
    setUrl("");
    setDescription("");
    close();
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const insertLink = () => {
    const md = buildImageMarkdown(url, description);
    if (!md) {
      setError("Enter the full address of the image, starting with https://.");
      return;
    }
    place(md);
  };

  const upload = async () => {
    // The same conditions that disable the button: Enter reaches here too.
    if (!file || !address || busy || !canUpload || (keepForever && !plan)) return;
    setBusy(true);
    setError(null);
    let copyNote: string | null = null;
    const who = { chainId: config.chainId, address, signer: signerAddress ?? undefined };
    try {
      setStep("Checking and uploading…");
      // The dream always shows the small image, so it loads quickly for
      // readers. It is uploaded first: whatever happens to the permanent
      // copy after this, the image is inserted and nothing is thrown away.
      const done = await uploadImage(file, who);
      if (keepForever) {
        if (!plan || !backend) throw new Error("The permanent copy is still being prepared. Try again in a moment.");
        const { prepared, existing, quote } = plan;
        const later = "You can still request the copy from the Storage page.";
        if (existing) {
          if (existing.requester === address) onPermanentCopy?.(done.url);
        } else if (!quote) {
          copyNote = `The image was added, but the fee for its permanent copy could not be read. ${later}`;
        } else {
          try {
            // The full-size file the operator copies from. The site keeps it
            // only until the copy is made.
            setStep("Uploading the full-size picture…");
            const full = await uploadBlob(new Blob([prepared.bytes as BlobPart], { type: prepared.contentType }), {
              ...who,
              kind: "copy",
            });
            if (full.sha256 !== prepared.sha256) throw new Error("the site stored a different file than the one prepared");
            const bad = sourceUrlProblem(full.url, storageParams?.max_url_bytes ?? 512);
            if (bad) throw new Error(`the file's address can't be used. ${bad}`);
            setStep("Waiting for your signature…");
            await signAndBroadcast([
              requestCopyMsg({
                requester: address,
                backend: backend.name,
                sha256: prepared.sha256,
                sizeBytes: prepared.bytes.length,
                contentType: prepared.contentType,
                url: full.url,
                // The quote is the ceiling: if the price rose since, the
                // chain refuses instead of charging more.
                maxFee: quote.total,
              }),
            ]);
            invalidateStorage();
            // The request shows the same picture next to this address.
            onPermanentCopy?.(done.url);
          } catch (err) {
            copyNote = `The image was added, but the permanent copy wasn't requested: ${errorMessage(err) || "the request failed"}. ${later}`;
          }
        }
      }
      setQuotaLine(`${done.used} of ${done.quota} uploads used this week.`);
      const md = buildImageMarkdown(done.url, description);
      if (!md) throw new Error("The uploaded image's address can't be used here.");
      place(md);
      setNotice(copyNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload didn't go through.");
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  // The control sits inside the post form, so Enter must not publish.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (active === "link") insertLink();
    else void upload();
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
          className="text-xs text-zinc-400 transition-colors hover:text-white"
        >
          + Add image
        </button>
        {quotaLine && <span className="text-xs text-zinc-500">{quotaLine}</span>}
        {notice && <p className="w-full text-xs text-amber-300">{notice}</p>}
      </div>
    );
  }

  if (resolving && source === null) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <p className="text-xs text-zinc-500">Checking whether you can upload here...</p>
        <button type="button" onClick={close} className="text-xs text-zinc-400 transition-colors hover:text-white">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
      {uploadsOn && (
        <div className="flex w-fit items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
          <button
            type="button"
            disabled={!canUpload || busy}
            onClick={() => {
              setSource("upload");
              setError(null);
            }}
            className={`${TAB} ${active === "upload" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-300"} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Upload
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSource("link");
              setError(null);
            }}
            className={`${TAB} ${active === "link" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-300"}`}
          >
            Link
          </button>
        </div>
      )}
      {uploadNote && <p className="text-xs text-zinc-500">{uploadNote}</p>}

      {active === "upload" ? (
        <div>
          <label htmlFor="imageFile" className="mb-1 block text-xs font-medium text-zinc-300">
            Image file
          </label>
          <input
            id="imageFile"
            ref={fileRef}
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200 hover:file:bg-zinc-700"
          />
        </div>
      ) : (
        <div>
          <label htmlFor="imageUrl" className="mb-1 block text-xs font-medium text-zinc-300">
            Image address
          </label>
          <input
            id="imageUrl"
            type="url"
            inputMode="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="https://example.com/picture.png"
            className={INPUT_CLASS}
          />
        </div>
      )}

      <div>
        <label htmlFor="imageDescription" className="mb-1 block text-xs font-medium text-zinc-300">
          Description (optional)
        </label>
        <input
          id="imageDescription"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What the image shows"
          maxLength={200}
          disabled={busy}
          className={INPUT_CLASS}
        />
      </div>

      {active === "upload" && canUpload && backend && copiesOn && (
        <div className="space-y-1">
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={keepForever}
              disabled={busy || !permanentOffered}
              onChange={(e) => setPermanent(e.target.checked)}
            />
            <span>
              Keep a permanent copy on {backend.name === "arweave" ? "Arweave" : backend.name}.{" "}
              <span className="text-zinc-500">
                {!ownWallet
                  ? "Not available with a session key: the request pays a fee, which needs your own wallet."
                  : anonymous
                  ? "Not available for anonymous dreams: the request would show your address."
                  : "The copy keeps the picture at its full size, while your dream shows a smaller version right away. A bonded operator makes the copy in the background. You sign the request with your wallet, which is public. A permanent copy can never be deleted or changed, by you or anyone else."}
              </span>
            </span>
          </label>
          {keepForever && file && !plan && !planError && <p className="pl-5 text-xs text-zinc-500">Preparing the copy…</p>}
          {keepForever && planError && <p className="pl-5 text-xs text-red-400">{planError}</p>}
          {keepForever && plan && (
            <p className="pl-5 text-xs text-zinc-400">
              The copy is kept as {plan.prepared.contentType === "image/png" ? "PNG" : "JPEG"}, {plan.prepared.width} x{" "}
              {plan.prepared.height}, {formatBytes(plan.prepared.bytes.length)}, with no metadata or transparency.{" "}
              {plan.existing ? (
                <>This exact image already has a permanent copy request (#{requestId(plan.existing)}), so there is nothing to pay.</>
              ) : plan.quote ? (
                <>
                  Costs {feeLabel}: {formatSpark(plan.quote.copy_fee)} for the copy, returned if it is not made, and{" "}
                  {formatSpark(plan.quote.request_fee)} request fee, burned now.
                </>
              ) : null}
            </p>
          )}
          {keepForever && plan && !plan.existing && backend && (
            <div className="pl-5 pt-1">
              <OperatorFunds backend={backend} sizeBytes={plan.prepared.bytes.length} compact />
            </div>
          )}
        </div>
      )}

      {active === "upload" ? (
        <p className="text-xs text-zinc-500">
          The picture is made smaller in your browser, which also removes its location and camera details, and
          saved as a still image. A content scanner checks it before it is stored, which can take a few
          seconds.{keepForever ? " The full-size picture for the permanent copy is checked the same way and kept here only until the copy is made." : ""} Your wallet asks you to sign once per session. Nothing is sent onchain until you publish.
        </p>
      ) : (
        <>
          {/* What both the scanners' image model and the loader accept
              (docs/content-scanning.md §5.2, lib/contentScan/media.ts). */}
          <p className="text-xs text-zinc-400">
            Supported formats: PNG, JPEG, GIF, WebP and BMP, up to 16 MB. SVG, AVIF, HEIC, animated WebP and
            animated PNG images won&apos;t load.
          </p>
          <p className="text-xs text-zinc-500">
            The image stays where it is hosted, and the dream stores only its address. Readers see it once
            content scanners have cleared it. The host has to allow other sites to read the file, or it
            can&apos;t be checked and won&apos;t load.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {pending && !busy && (
        <p className="text-xs text-amber-300">
          This image is not in your dream yet. Choose {active === "upload" ? "Upload and insert" : "Insert image"} to
          add it, or Cancel to leave it out.
        </p>
      )}
      <div className="flex items-center gap-3">
        {active === "upload" ? (
          <button
            type="button"
            onClick={() => void upload()}
            disabled={!file || busy || !canUpload || (keepForever && !plan)}
            className="sd-btn sd-btn-secondary"
          >
            {busy ? step || "Working…" : keepForever && feeLabel ? `Upload, pay ${feeLabel} and insert` : "Upload and insert"}
          </button>
        ) : (
          <button type="button" onClick={insertLink} disabled={!url.trim()} className="sd-btn sd-btn-secondary">
            Insert image
          </button>
        )}
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="text-xs text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
