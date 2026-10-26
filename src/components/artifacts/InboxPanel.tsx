"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import {
  getArtifactClass,
  getArtifactInbox,
  getArtifactOutbox,
  getArtifactParams,
  getArtifactReceivePolicy,
  invalidateArtifacts,
} from "@/lib/artifactApi";
import { timeRemaining } from "@/lib/utils";
import {
  BurnAuthorization,
  InboxKind,
  RECEIVE_POLICY_LABELS,
  ReceivePolicy,
  type ArtifactClass,
  isUnitInboxKind,
  type InboxItem,
} from "@/types/artifact";
import { receivePolicyFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/types";
import type {
  MsgAcceptIncoming,
  MsgCancelOutgoing,
  MsgRejectIncoming,
  MsgSetReceivePolicy,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import { ArtifactMedia, AttributeList, burnAuth, classTitle, tokenRef, txFailure } from "./shared";

const POLICY_HELP: Record<string, string> = {
  [ReceivePolicy.OPEN]: "Every incoming token lands in your wallet right away.",
  [ReceivePolicy.MEMBERS]: "Tokens from members and councils land right away. Everything else waits here for you.",
  [ReceivePolicy.INBOX]: "Every incoming token waits here until you accept it.",
  [ReceivePolicy.UNSPECIFIED]: "Use the network default.",
};

// Edition units arrive with class_id 0 and the pending id as token_id; the
// edition's class is unit_class_id.
const key = (i: InboxItem) => (isUnitInboxKind(i.kind) ? `units/${i.token_id}` : tokenRef(i.class_id, i.token_id));
const classOf = (i: InboxItem) => (isUnitInboxKind(i.kind) ? i.unit_class_id || "0" : i.class_id);

function itemTitle(i: InboxItem): string {
  if (isUnitInboxKind(i.kind)) return `${i.amount || "0"} units of edition #${i.edition_id || "0"}`;
  return i.withheld ? `Token #${i.token_id}` : i.metadata?.name || `Token #${i.token_id}`;
}

const KIND_LABEL: Record<string, string> = {
  [InboxKind.MINT]: "New mint",
  [InboxKind.TRANSFER]: "Transfer",
  [InboxKind.UNIT_MINT]: "New units",
  [InboxKind.UNIT_TRANSFER]: "Units transfer",
};

interface Props {
  onSelectClass: (classId: string) => void;
  onSelectToken: (classId: string, tokenId: string) => void;
}

export default function InboxPanel({ onSelectClass, onSelectToken }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { pending, error: txError, clearError, run } = useTxAction();

  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [outbox, setOutbox] = useState<InboxItem[]>([]);
  const [policy, setPolicy] = useState<string>(ReceivePolicy.UNSPECIFIED);
  const [isDefault, setIsDefault] = useState(true);
  const [defaultPolicy, setDefaultPolicy] = useState<string | null>(null);
  const [classes, setClasses] = useState<Record<string, ArtifactClass>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      const [ib, ob, rp] = await Promise.all([
        getArtifactInbox(address, { limit: "100" }),
        getArtifactOutbox(address, { limit: "100" }),
        getArtifactReceivePolicy(address),
      ]);
      setInbox(ib.items || []);
      setInboxCount(ib.inbox_count ?? (ib.items || []).length);
      setOutbox(ob.items || []);
      setPolicy(rp.policy || ReceivePolicy.UNSPECIFIED);
      setIsDefault(rp.is_default !== false);
      setSelected(new Set());
      getArtifactParams()
        .then((r) => setDefaultPolicy(r.params.default_receive_policy || null))
        .catch(() => setDefaultPolicy(null));
      // Class flags matter here: an issuer-only class's token can never be discarded once accepted.
      const ids = Array.from(new Set([...(ib.items || []), ...(ob.items || [])].map(classOf))).filter((id) => id !== "0");
      Promise.all(ids.map((id) => getArtifactClass(id).then((r) => r.class.class).catch(() => null))).then((list) => {
        const map: Record<string, ArtifactClass> = {};
        for (const c of list) if (c) map[c.id] = c;
        setClasses(map);
      });
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  if (!address) return null;
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState error={error} onRetry={load} />;

  const after = async () => {
    invalidateArtifacts();
    await load();
  };

  const accept = (items: InboxItem[]) =>
    run(`accept-${items.length === 1 ? key(items[0]) : "many"}`, async () => {
      const value: MsgAcceptIncoming = {
        recipient: address,
        entries: items.map((i) => ({
          classId: BigInt(i.class_id),
          tokenId: BigInt(i.token_id),
          // Pin the metadata shown here, so a swap in the meantime fails instead of delivering something else.
          expectedMetadataHash: i.metadata_hash || "",
        })),
      };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.AcceptIncoming, value }]);
      await after();
    }, txFailure("Couldn't accept"));

  const reject = (items: InboxItem[]) =>
    run(`reject-${items.length === 1 ? key(items[0]) : "many"}`, async () => {
      const value: MsgRejectIncoming = {
        recipient: address,
        refs: items.map((i) => ({ classId: BigInt(i.class_id), tokenId: BigInt(i.token_id) })),
      };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.RejectIncoming, value }]);
      await after();
    }, txFailure("Couldn't reject"));

  const cancel = (item: InboxItem) =>
    run(`cancel-${key(item)}`, async () => {
      const value: MsgCancelOutgoing = {
        signer: address,
        refs: [{ classId: BigInt(item.class_id), tokenId: BigInt(item.token_id) }],
      };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.CancelOutgoing, value }]);
      await after();
    }, txFailure("Couldn't cancel"));

  const savePolicy = (next: string) =>
    run("policy", async () => {
      const value: MsgSetReceivePolicy = { owner: address, policy: receivePolicyFromJSON(next) };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.SetReceivePolicy, value }]);
      await after();
    }, txFailure("Couldn't save the setting"));

  const chosen = inbox.filter((i) => selected.has(key(i)));
  const busy = pending !== null;
  const effective = policy;
  const shownChoice = isDefault ? ReceivePolicy.UNSPECIFIED : policy;

  return (
    <div className="space-y-6">
      <section className="sd-hull-tile space-y-2 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white">Who can send you tokens</h3>
        <p className="text-xs text-zinc-400">
          {RECEIVE_POLICY_LABELS[effective] || effective}
          {isDefault ? " (network default)" : ""}. {POLICY_HELP[effective] || ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {[ReceivePolicy.OPEN, ReceivePolicy.MEMBERS, ReceivePolicy.INBOX, ReceivePolicy.UNSPECIFIED].map((p) => (
            <button
              key={p}
              onClick={() => (p === shownChoice ? undefined : savePolicy(p))}
              disabled={busy}
              title={POLICY_HELP[p]}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                p === shownChoice ? "border-[var(--verdigris-ring)] bg-[var(--verdigris-soft)] text-[var(--verdigris-hi)]" : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p === ReceivePolicy.UNSPECIFIED
                ? `Network default${defaultPolicy ? ` (${(RECEIVE_POLICY_LABELS[defaultPolicy] || defaultPolicy).toLowerCase()})` : ""}`
                : RECEIVE_POLICY_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">Purchases and public mints always arrive directly, since you asked for them.</p>
      </section>

      <ActionBanner message={txError} onDismiss={clearError} />

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">Inbox ({inboxCount})</h3>
          {chosen.length > 0 && (
            <div className="flex gap-2">
              <button onClick={() => accept(chosen)} disabled={busy} className="sd-btn sd-btn-verdigris">
                {pending === "accept-many" ? "Accepting…" : `Accept ${chosen.length}`}
              </button>
              <button onClick={() => reject(chosen)} disabled={busy} className="sd-btn sd-btn-secondary">
                {pending === "reject-many" ? "Rejecting…" : `Reject ${chosen.length}`}
              </button>
            </div>
          )}
        </div>
        {inbox.length === 0 ? (
          <div className="sd-hull-tile rounded-xl p-8 text-center text-sm text-zinc-400">Nothing waiting for you.</div>
        ) : (
          <div className="space-y-2">
            {inbox.map((i) => {
              const k = key(i);
              const cls = classes[classOf(i)];
              const stuck = cls && (burnAuth(cls) === BurnAuthorization.ISSUER || burnAuth(cls) === BurnAuthorization.NEITHER);
              const md = i.metadata;
              return (
                <div key={k} className="sd-hull-tile rounded-xl p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(k)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(k);
                        else next.delete(k);
                        setSelected(next);
                      }}
                      aria-label={`Select ${k}`}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-medium text-zinc-100">
                          {itemTitle(i)}
                        </span>
                        <span className="font-mono text-xs text-zinc-500">{k}</span>
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                          {KIND_LABEL[i.kind ?? ""] ?? "Transfer"}
                        </span>
                        {i.withheld && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-400">Hidden</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                        <span>From</span>
                        {i.from && <CopyableAddress address={i.from} resolveName className="text-zinc-300" />}
                        <span>· in</span>
                        <button onClick={() => onSelectClass(classOf(i))} className="sd-artifact-link">
                          {cls ? classTitle(cls) : `Class #${classOf(i)}`}
                        </button>
                        {i.expires_at && <span>· {timeRemaining(i.expires_at)}</span>}
                      </div>
                      {!i.withheld && md?.description && <p className="text-sm text-zinc-300">{md.description}</p>}
                      {!i.withheld && md?.uri && <ArtifactMedia key={md.uri} uri={md.uri} />}
                      {!i.withheld && <AttributeList attributes={md?.attributes} />}
                      {stuck && (
                        <p className="text-xs text-amber-300">
                          Only the issuer can remove tokens of this class. If you accept, you can&apos;t burn it yourself.
                        </p>
                      )}
                      {i.kind === InboxKind.TRANSFER && (
                        <button onClick={() => onSelectToken(i.class_id, i.token_id)} className="text-xs text-zinc-400 hover:text-zinc-200">
                          View token
                        </button>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button onClick={() => accept([i])} disabled={busy} className="sd-btn sd-btn-verdigris">
                        {pending === `accept-${k}` ? "…" : "Accept"}
                      </button>
                      <button onClick={() => reject([i])} disabled={busy} className="sd-btn sd-btn-secondary">
                        {pending === `reject-${k}` ? "…" : "Reject"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {inbox.length > 1 && (
              <button
                onClick={() =>
                  selected.size === inbox.length ? setSelected(new Set()) : setSelected(new Set(inbox.map(key)))
                }
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                {selected.size === inbox.length ? "Clear selection" : "Select all"}
              </button>
            )}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-200">Sent, waiting for acceptance ({outbox.length})</h3>
        {outbox.length === 0 ? (
          <p className="text-xs text-zinc-500">Nothing pending.</p>
        ) : (
          <div className="space-y-2">
            {outbox.map((i) => {
              const k = key(i);
              const cls = classes[classOf(i)];
              return (
                <div key={k} className="sd-hull-tile flex items-center justify-between gap-3 rounded-xl px-3 py-2">
                  <div className="min-w-0 text-xs text-zinc-400">
                    <span className="font-mono text-zinc-300">{k}</span>
                    {cls && <span className="ml-2">{classTitle(cls)}</span>}
                    <span className="ml-2">{KIND_LABEL[i.kind ?? ""] ?? "Transfer"} to</span>{" "}
                    {i.to && <CopyableAddress address={i.to} resolveName className="text-zinc-300" />}
                    {i.expires_at && <span className="ml-2">{timeRemaining(i.expires_at)}</span>}
                  </div>
                  <button onClick={() => cancel(i)} disabled={busy} className="sd-btn sd-btn-secondary shrink-0">
                    {pending === `cancel-${k}` ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          Cancelling returns a transfer to you, or refunds a mint&apos;s deposit. The inbox fee isn&apos;t refunded.
        </p>
      </section>

    </div>
  );
}
