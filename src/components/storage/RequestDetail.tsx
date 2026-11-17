"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import { useBlockClock } from "@/hooks/useBlockClock";
import { useTxAction } from "@/hooks/useTxAction";
import { addSourceMsg, cancelRequestMsg, disputeCompletionMsg, type StorageMsg } from "@/lib/storageMsgs";
import { getStorageRequest, invalidateStorage } from "@/lib/storageApi";
import { sha256Hex } from "@/lib/imagePrepare";
import { formatBytes, locatorTarget, sourceUrlProblem } from "@/lib/storageRules";
import { formatSpark } from "@/lib/utils";
import ActionBanner from "@/components/ActionBanner";
import BlockEta from "@/components/BlockEta";
import BlockTime from "@/components/BlockTime";
import ErrorState from "@/components/ErrorState";
import NameOrAddress from "@/components/NameOrAddress";
import { INPUT_CLASS } from "@/components/permissions/fields";
import {
  CLOSED_REASON_LABELS, ClosedReason, DECLINE_REASON_LABELS, RequestStatus, requestId, type StorageRequest,
} from "@/types/storage";
import { CARD, SessionNotice, StatusBadge, useStorageSetup } from "./shared";
import StoredImage from "./StoredImage";
import { arweaveGateway } from "@/lib/contentScan/media";

type CopyCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "match" }
  | { state: "mismatch"; detail: string }
  | { state: "unknown"; detail: string };

/** Fetches the copy through a gateway and compares it with the request's hash. */
async function checkCopy(url: string, r: StorageRequest): Promise<CopyCheck> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    return { state: "unknown", detail: "The gateway could not be reached from this page. Try again later before deciding." };
  }
  if (!res.ok) {
    return { state: "mismatch", detail: `The gateway answered with status ${res.status}. A fresh copy can take a while to appear.` };
  }
  try {
    const body = new Uint8Array(await res.arrayBuffer());
    if (String(body.length) !== r.size_bytes || (await sha256Hex(body)) !== r.sha256) {
      return { state: "mismatch", detail: "The gateway serves a different file from the one requested." };
    }
    return { state: "match" };
  } catch {
    // The headers arrived but the body did not (a dropped connection).
    return { state: "unknown", detail: "The download from the gateway was interrupted. Try again before deciding." };
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
      <dt className="w-40 shrink-0 text-zinc-500">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-zinc-200">{children}</dd>
    </div>
  );
}

export default function RequestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { connected, signerAddress, signAndBroadcast, sessionActive } = useWallet();
  const { config: { displayDenom: DISPLAY } } = useChainConfig();
  const { isMine } = useMyAliases();
  const { params, backends, error: setupError, reload: reloadSetup } = useStorageSetup();
  const clock = useBlockClock();
  const tx = useTxAction();

  const [request, setRequest] = useState<StorageRequest | null>(null);
  const [withheld, setWithheld] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [newUrl, setNewUrl] = useState("");
  const [check, setCheck] = useState<CopyCheck>({ state: "idle" });
  const [gateway, setGateway] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void arweaveGateway().then((g) => live && setGateway(g));
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(() => {
    getStorageRequest(id)
      .then((res) => {
        setRequest(res.request);
        setWithheld(!!res.withheld);
        setError(null);
      })
      .catch(setError);
  }, [id]);
  useEffect(load, [load]);

  const act = (key: string, msg: StorageMsg) =>
    tx.run(key, async () => {
      await signAndBroadcast([msg]);
      invalidateStorage();
      load();
    });

  if (error) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="sd-btn sd-btn-secondary">Back</button>
        <ErrorState error={error} onRetry={load} fallback="No such request" />
      </div>
    );
  }
  if (!request) return <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />;

  const r = request;
  const mine = isMine(r.requester);
  const backend = backends.find((b) => b.name === r.backend);
  // Read through the site's own gateway, like every other Arweave image
  // here. Until the gateway is known there is no address to offer.
  const copyUrl = gateway ? locatorTarget(backend?.locator_format, r.locator, gateway) : null;
  // Until the params load the fee is unknown, and "0" must not be sent as
  // the ceiling: the chain would refuse it. A loaded fee of zero is omitted.
  const feeKnown = params !== null;
  const requestFee = params?.request_fee || "0";
  const settled = r.status === RequestStatus.SETTLED;
  const held = !!r.copy_fee && r.copy_fee !== "0";
  // A withheld request's sources come back with empty addresses.
  const sources = (r.sources || []).filter((s) => s.url);

  const pending = r.status === RequestStatus.PENDING;
  const claimed = r.status === RequestStatus.CLAIMED;
  const completed = r.status === RequestStatus.COMPLETED;
  // settle_at is a block height; once the chain passes it the dispute window is over.
  const settleDue = !!clock && !!r.settle_at && clock.height >= BigInt(r.settle_at);
  const canDispute = connected && !sessionActive && completed && !r.disputed && !settleDue;
  const iAddedASource = sources.some((s) => isMine(s.added_by));
  const sourcesFull = sources.length >= (params?.max_sources_per_request ?? Infinity);
  const canAddSource = connected && !sessionActive && (pending || claimed) && !iAddedASource && !sourcesFull && !withheld;
  const canCancel = connected && !sessionActive && mine && pending;
  // An action exists that only session mode is hiding.
  const sessionBlocks =
    connected && sessionActive &&
    ((completed && !r.disputed && !settleDue) || ((pending || claimed) && !sourcesFull && !withheld));
  const trimmed = newUrl.trim();
  const urlProblem = trimmed ? sourceUrlProblem(trimmed, params?.max_url_bytes ?? 512) : null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="sd-btn sd-btn-secondary">Back</button>
      <ActionBanner message={tx.error} onDismiss={tx.clearError} />
      {setupError ? <ErrorState error={setupError} onRetry={reloadSetup} compact /> : null}
      {sessionBlocks && <SessionNotice />}

      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Copy request #{requestId(r)}</h2>
          <StatusBadge status={r.status} />
        </div>

        {withheld && (
          <div className="rounded-lg border border-red-900 bg-red-900/20 px-4 py-3 text-sm text-red-300">
            A content scanner flagged this file as removed content, so its addresses are not shown.
          </div>
        )}
        {r.closed_reason && CLOSED_REASON_LABELS[r.closed_reason] && (
          <p className="text-sm text-zinc-300">{CLOSED_REASON_LABELS[r.closed_reason]}.</p>
        )}

        <dl className="space-y-1.5">
          <Row label="File">
            {r.content_type}, {formatBytes(Number(r.size_bytes))}
          </Row>
          <Row label="sha256"><span className="font-mono text-xs">{r.sha256}</span></Row>
          <Row label="Requested by"><NameOrAddress address={r.requester} /></Row>
          <Row label="Stored on">{r.backend}</Row>
          <Row label="Copy fee">
            {/* copy_fee is what the chain still holds: zero once paid out, returned or burned. */}
            {settled ? (
              <>
                {formatSpark(r.paid_amount || "0")} {DISPLAY}
                {r.paid_to ? " (paid to the operator's council)" : " (paid to the community pool)"}
              </>
            ) : held ? (
              <>
                {formatSpark(r.copy_fee)} {DISPLAY} (held by the chain)
              </>
            ) : r.closed_reason === ClosedReason.FLAGGED ? (
              "No longer held"
            ) : (
              "Returned to the requester"
            )}
          </Row>
          {r.created_at && <Row label="Requested"><BlockTime height={r.created_at} fallback={`block ${r.created_at}`} /></Row>}
          {pending && r.deadline && (
            <Row label="Expires">
              <BlockEta height={r.deadline} fallback={`block ${r.deadline}`} /> if no operator copies it; the copy fee is then returned
            </Row>
          )}
          {r.operator && <Row label="Operator"><NameOrAddress address={r.operator} /></Row>}
          {claimed && r.claim_expires_at && (
            <Row label="Claim ends"><BlockEta height={r.claim_expires_at} fallback={`block ${r.claim_expires_at}`} /></Row>
          )}
          {completed && r.settle_at && (
            <Row label="Settles">
              <BlockEta height={r.settle_at} fallback={`block ${r.settle_at}`} />
              {r.disputed && " (disputed: the window was extended)"}
            </Row>
          )}
          {r.forfeit_at && r.forfeit_at !== "0" && (
            <Row label="Fee burned"><BlockEta height={r.forfeit_at} fallback={`block ${r.forfeit_at}`} /> unless the flag is lifted</Row>
          )}
          {r.locator && (
            <Row label="Copy">
              {copyUrl ? (
                <a href={copyUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-mono text-xs text-indigo-300 underline">
                  {r.locator}
                </a>
              ) : (
                <span className="break-all font-mono text-xs">{r.locator}</span>
              )}
            </Row>
          )}
        </dl>

        {sources.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-zinc-300">Where the file can be fetched from</h3>
            <ul className="space-y-1 text-sm">
              {sources.map((s) => (
                <li key={s.url} className="break-all text-zinc-400">
                  <span className="font-mono text-xs">{s.url}</span>{" "}
                  <span className="text-zinc-500">
                    (added by <NameOrAddress address={s.added_by} />)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(r.declined_by?.length ?? 0) > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-zinc-300">Operators that declined</h3>
            <ul className="space-y-1 text-sm text-zinc-400">
              {r.declined_by!.map((d) => (
                <li key={d.operator}>
                  <NameOrAddress address={d.operator} />: {DECLINE_REASON_LABELS[d.reason] ?? d.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {r.sha256 && r.content_type?.startsWith("image/") && (
        <StoredImage
          requestId={requestId(r)}
          sha256={r.sha256}
          targets={[...(copyUrl && (completed || settled) ? [copyUrl] : []), ...sources.map((src) => src.url)]}
        />
      )}

      {copyUrl && (completed || settled) && (
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-semibold text-white">Check the copy</h3>
          <p className="text-sm text-zinc-400">
            The chain records where the operator says the copy is. It does not prove it. This fetches the copy and
            compares it with the file that was requested.
          </p>
          <button
            type="button"
            disabled={check.state === "checking"}
            onClick={async () => {
              setCheck({ state: "checking" });
              setCheck(await checkCopy(copyUrl, r));
            }}
            className="sd-btn sd-btn-secondary"
          >
            {check.state === "checking" ? "Checking..." : "Fetch and compare"}
          </button>
          {check.state === "match" && <p className="text-sm text-emerald-400">The copy matches the requested file.</p>}
          {check.state === "mismatch" && <p className="text-sm text-red-400">{check.detail}</p>}
          {check.state === "unknown" && <p className="text-sm text-amber-300">{check.detail}</p>}
        </section>
      )}

      {canDispute && (
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-semibold text-white">Dispute this copy</h3>
          <p className="text-sm text-zinc-400">
            If the copy does not serve the requested file, a dispute holds the payment for longer so that the
            operator&apos;s council or governance can void it. It can be done once per copy, and it decides nothing by
            itself.{" "}
            {mine
              ? "As the requester you pay nothing."
              : `It costs the request fee${feeKnown ? ` (${formatSpark(requestFee)} ${DISPLAY})` : ""}, which is burned.`}
          </p>
          <button
            type="button"
            disabled={tx.busy || (!mine && !feeKnown)}
            onClick={() =>
              act("dispute", disputeCompletionMsg(signerAddress!, requestId(r), mine ? "0" : requestFee))
            }
            className="sd-btn sd-btn-secondary"
          >
            {tx.pending === "dispute" ? "Signing..." : "Dispute"}
          </button>
        </section>
      )}

      {canAddSource && (
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-semibold text-white">Add another address for this file</h3>
          <p className="text-sm text-zinc-400">
            If you host the same file, operators can fetch it from you as well. The hash decides what is copied, so an
            address can never change the copy. It costs the request fee
            {feeKnown ? ` (${formatSpark(requestFee)} ${DISPLAY})` : ""}, which is burned, and each member can add one.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              aria-label="Address of the file"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://files.example/picture.png"
              className={`${INPUT_CLASS} min-w-0 flex-1`}
            />
            <button
              type="button"
              disabled={tx.busy || !feeKnown || !trimmed || !!urlProblem}
              onClick={async () => {
                const ok = await act("source", addSourceMsg(signerAddress!, requestId(r), trimmed, requestFee));
                if (ok) setNewUrl("");
              }}
              className="sd-btn sd-btn-secondary"
            >
              {tx.pending === "source" ? "Signing..." : "Add address"}
            </button>
          </div>
          {urlProblem && <p className="text-xs text-red-400">{urlProblem}</p>}
        </section>
      )}

      {canCancel && (
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-semibold text-white">Cancel the request</h3>
          <p className="text-sm text-zinc-400">
            While no operator has claimed it, you can cancel and get the copy fee back. The request fee was burned and
            is not returned.
          </p>
          <button
            type="button"
            disabled={tx.busy}
            onClick={() =>
              act("cancel", cancelRequestMsg(signerAddress!, requestId(r)))
            }
            className="sd-btn sd-btn-secondary"
          >
            {tx.pending === "cancel" ? "Signing..." : "Cancel request"}
          </button>
        </section>
      )}
    </div>
  );
}
