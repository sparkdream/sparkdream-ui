"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactClass, getArtifactToken, listArtifactClassesByOwner } from "@/lib/artifactApi";
import { isMissingEndpoint } from "@/lib/errors";
import { formatTime } from "@/lib/utils";
import { TokenLock, type ArtifactClass, type ClassView } from "@/types/artifact";
import type { MsgRedeem } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  BackButton,
  Note,
  classTitle,
  fieldCls,
  isHidden,
  lockOf,
  parseIdList,
  shownToken,
  tokenTitle,
  useArtifactParams,
  useArtifactTx,
} from "./shared";

interface Props {
  classId: string | null;
  onBack: () => void;
  onOpenToken: (classId: string, tokenId: string) => void;
  /** Opens the scanner for a class picked here. */
  onPickClass: (classId: string) => void;
}

type Status = "checking" | "valid" | "redeemed" | "expired" | "pending" | "hidden" | "missing" | "error" | "done";

interface Ticket {
  id: string;
  status: Status;
  title?: string;
  holder?: string;
  redeemedAt?: string;
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  checking: { label: "Checking…", tone: "text-zinc-400" },
  valid: { label: "Valid", tone: "text-emerald-300" },
  done: { label: "Redeemed now", tone: "text-emerald-300" },
  redeemed: { label: "Already redeemed", tone: "text-red-400" },
  expired: { label: "Expired", tone: "text-red-400" },
  pending: { label: "Waiting in an inbox", tone: "text-amber-300" },
  hidden: { label: "Hidden by moderation", tone: "text-red-400" },
  missing: { label: "No such token", tone: "text-red-400" },
  error: { label: "Couldn't check", tone: "text-amber-300" },
};

/** "7", "#7" or "3/7" (class 3) to a token id of this class, or null. */
function parseScan(raw: string, classId: string): string | null {
  const v = raw.trim().replace(/^#/, "");
  const m = /^(\d+)\/(\d+)$/.exec(v);
  if (m) return m[1] === classId ? m[2] : null;
  return /^\d+$/.test(v) ? v : null;
}

/**
 * Door scanner for a redeemable class: the owner or a minter checks ticket
 * ids and marks them redeemed. MsgRedeem works under a session key, so a
 * scanner device can run without the owner's wallet.
 */
export default function RedeemScanner({ classId, onBack, onOpenToken, onPickClass }: Props) {
  if (!classId) return <PickClass onBack={onBack} onPick={onPickClass} />;
  return <Scanner classId={classId} onBack={onBack} onOpenToken={onOpenToken} />;
}

function PickClass({ onBack, onPick: go }: { onBack: () => void; onPick: (classId: string) => void }) {
  const { address } = useWallet();
  const [classes, setClasses] = useState<ClassView[]>([]);
  const [id, setId] = useState("");

  useEffect(() => {
    if (!address) return;
    listArtifactClassesByOwner(address, { limit: "100" })
      .then((r) => setClasses((r.classes || []).filter((c) => c.class.flags?.redeemable)))
      .catch(() => setClasses([]));
  }, [address]);

  return (
    <div>
      <BackButton onClick={onBack} />
      <div className="sd-hull-tile space-y-3 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-white">Door scanner</h2>
        <p className="text-sm text-zinc-400">Pick a redeemable class you own or mint for.</p>
        {classes.map((c) => (
          <button key={c.class.id} onClick={() => go(c.class.id)} className="sd-hull-tile interactive block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200">
            {classTitle(c.class, c.withheld)} <span className="font-mono text-xs text-zinc-500">#{c.class.id}</span>
          </button>
        ))}
        <div className="flex gap-2">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Class id" inputMode="numeric" className={fieldCls} />
          <button onClick={() => /^\d+$/.test(id.trim()) && go(id.trim())} className="sd-btn sd-btn-verdigris">Open</button>
        </div>
      </div>
    </div>
  );
}

function Scanner({ classId, onBack, onOpenToken }: { classId: string; onBack: () => void; onOpenToken: Props["onOpenToken"] }) {
  const { address, sessionActive } = useWallet();
  const { isMine } = useMyAliases();
  const params = useArtifactParams();
  const [cls, setCls] = useState<ArtifactClass | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [scan, setScan] = useState("");
  const [bulk, setBulk] = useState("");
  const [auto, setAuto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, error, clearError, setError, send } = useArtifactTx();

  useEffect(() => {
    getArtifactClass(classId)
      .then((r) => setCls(r.class.class))
      .catch((err) => setLoadError(err));
  }, [classId]);

  const check = useCallback(
    async (id: string): Promise<Ticket> => {
      try {
        const r = await getArtifactToken(classId, id);
        const t = r.token.token;
        const base = { id, title: tokenTitle(shownToken(r.token), r.token.withheld), holder: t.owner, redeemedAt: t.redeemed_at };
        if (t.redeemed_at && t.redeemed_at !== "0") return { ...base, status: "redeemed" };
        if (r.token.expired) return { ...base, status: "expired" };
        if (r.token.withheld || isHidden(t.status) || isHidden(r.token.class_status)) return { ...base, status: "hidden" };
        if (lockOf(t) === TokenLock.PENDING_TRANSFER) return { ...base, status: "pending" };
        return { ...base, status: "valid" };
      } catch (err) {
        return { id, status: isMissingEndpoint(err) ? "missing" : "error" };
      }
    },
    [classId]
  );

  const setTicket = (t: Ticket) => setTickets((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);

  const redeem = async (ids: string[]) => {
    if (!address || ids.length === 0) return;
    const value: MsgRedeem = { signer: address, classId: BigInt(classId), tokenIds: ids.map((i) => BigInt(i)) };
    const hash = await send("redeem", { typeUrl: ArtifactMsgTypeUrls.Redeem, value }, ids.length === 1 ? `Couldn't redeem #${ids[0]}` : "Redeem failed");
    if (hash) setTickets((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, status: "done" } : t)));
  };

  const onScan = async () => {
    const id = parseScan(scan, classId);
    setScan("");
    inputRef.current?.focus();
    if (!id) return setError(`That isn't a token of class #${classId}.`);
    clearError();
    setTicket({ id, status: "checking" });
    const t = await check(id);
    setTicket(t);
    if (auto && t.status === "valid") await redeem([id]);
  };

  const checkBulk = async () => {
    const ids = parseIdList(bulk);
    if (!ids || ids.length === 0) return setError("Enter token ids, separated by commas or new lines.");
    clearError();
    setBulk("");
    ids.forEach((id) => setTicket({ id, status: "checking" }));
    const results = await Promise.all(ids.map(check));
    setTickets((prev) => [...results, ...prev.filter((x) => !ids.includes(x.id))]);
  };

  if (loadError) {
    return (
      <div>
        <BackButton onClick={onBack} />
        <ErrorState error={loadError} fallback="Class not found" />
      </div>
    );
  }
  if (!cls) return <div className="sd-hull-tile h-40 animate-pulse rounded-xl" />;

  const allowed = isMine(cls.owner) || (cls.minters || []).some((m) => isMine(m));
  const maxBatch = params?.max_batch_size || 50;
  const valid = tickets.filter((t) => t.status === "valid").map((t) => t.id).slice(0, maxBatch);
  const busy = pending !== null;
  const last = tickets[0];

  return (
    <div>
      <BackButton onClick={onBack} />
      <div className="sd-hull-tile space-y-4 rounded-xl p-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Door scanner</h2>
          <p className="text-sm text-zinc-400">
            {classTitle(cls)} <span className="font-mono text-xs text-zinc-500">#{cls.id}</span>
          </p>
        </div>
        {!cls.flags?.redeemable && <Note tone="warn">This class isn&apos;t redeemable.</Note>}
        {!allowed && <Note tone="warn">Only the class owner or a listed minter can redeem tickets.</Note>}
        {allowed && !sessionActive && (
          <Note>Each redeem asks your wallet to sign. To scan without prompts, use a session key that allows redeeming.</Note>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onScan()}
              placeholder="Scan or type a ticket id, then Enter"
              inputMode="numeric"
              autoFocus
              className={`${fieldCls} text-base`}
            />
            <button onClick={onScan} disabled={!scan.trim()} className="sd-btn sd-btn-secondary shrink-0">Check</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!allowed} />
            Redeem valid tickets as soon as they&apos;re scanned
          </label>
        </div>

        {last && (
          <div className={`rounded-xl border px-4 py-3 ${last.status === "valid" || last.status === "done" ? "border-emerald-700/60 bg-emerald-900/15" : last.status === "checking" ? "border-zinc-800" : "border-red-800/60 bg-red-900/15"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={`text-xl font-semibold ${STATUS[last.status].tone}`}>{STATUS[last.status].label}</span>
              <span className="font-mono text-sm text-zinc-400">#{last.id}</span>
            </div>
            {last.title && <p className="text-sm text-zinc-200">{last.title}</p>}
            {last.holder && (
              <p className="text-xs text-zinc-500">
                Held by <CopyableAddress address={last.holder} resolveName className="text-zinc-300" />
              </p>
            )}
            {last.status === "redeemed" && last.redeemedAt && <p className="text-xs text-zinc-400">Redeemed {formatTime(last.redeemedAt)}</p>}
            {last.status === "valid" && allowed && !auto && (
              <button onClick={() => redeem([last.id])} disabled={busy} className="sd-btn sd-btn-verdigris mt-2">
                {pending === "redeem" ? "Redeeming…" : "Redeem"}
              </button>
            )}
          </div>
        )}

        <details className="text-sm text-zinc-400">
          <summary className="cursor-pointer select-none text-zinc-300">Check a list</summary>
          <div className="mt-2 space-y-2">
            <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={3} placeholder="Ticket ids, e.g. 3, 7, 12" className={fieldCls} />
            <button onClick={checkBulk} disabled={!bulk.trim()} className="sd-btn sd-btn-secondary">Check all</button>
          </div>
        </details>

        <ActionBanner message={error} onDismiss={clearError} />

        {tickets.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-zinc-400">Checked ({tickets.length})</span>
              {allowed && valid.length > 1 && (
                <button onClick={() => redeem(valid)} disabled={busy} className="sd-btn sd-btn-verdigris">
                  {pending === "redeem" ? "Redeeming…" : `Redeem ${valid.length} valid`}
                </button>
              )}
            </div>
            {tickets.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs">
                <button type="button" onClick={() => onOpenToken(classId, t.id)} className="sd-artifact-link font-mono">
                  #{t.id}
                </button>
                <span className="min-w-0 flex-1 truncate text-zinc-400">{t.title}</span>
                <span className={STATUS[t.status].tone}>{STATUS[t.status].label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
