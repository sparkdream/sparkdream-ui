"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import {
  getArtifactBalance,
  getArtifactClass,
  getArtifactEdition,
  getArtifactHideRecords,
  listArtifactEditionHolders,
  listArtifactUnitListings,
} from "@/lib/artifactApi";
import { formatSpark, formatTime, timeRemaining } from "@/lib/utils";
import type { ArtifactClass, BalanceView, EditionView, HideRecord, UnitListing } from "@/types/artifact";
import type {
  MsgBurnUnits,
  MsgBuyUnits,
  MsgClaimEditionRewards,
  MsgDelistUnits,
  MsgFreezeTokenMetadata,
  MsgFundEdition,
  MsgListUnits,
  MsgMintUnits,
  MsgRevokeUnits,
  MsgSetMaxSupply,
  MsgTransferUnits,
  MsgUpdateToken,
  MsgUpdateUnitListing,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import ArtifactModeration from "./ArtifactModeration";
import { maxMarketDays } from "./TokenMarket";
import {
  ActionSection,
  ArtifactMedia,
  AttributeList,
  BackButton,
  ClassBadges,
  FieldLabel,
  MetadataEditor,
  bpsToPercent,
  classTitle,
  fieldCls,
  formatCoin,
  holderCanBurn,
  isHidden,
  isTransferable,
  issuerCanRevoke,
  looksLikeAddress,
  metadataFormFrom,
  metadataFormToMsg,
  parsePositiveAmount,
  parseUint,
  useArtifactParams,
  useArtifactTx,
  validateMetadataForm,
  type MetadataForm,
} from "./shared";

interface Props {
  classId: string;
  editionId: string;
  onBack: () => void;
  onOpenClass: (classId: string) => void;
}

type Section = "send" | "burn" | "list" | "fund" | "mint" | "cap" | "revoke" | "edit";

/** One edition of an EDITIONS class: its units, holders, listings and retro funding. */
export default function EditionDetail({ classId, editionId, onBack, onOpenClass }: Props) {
  const { address } = useWallet();
  const { config } = useChainConfig();
  const { isMine } = useMyAliases();
  const params = useArtifactParams();
  const [view, setView] = useState<EditionView | null>(null);
  const [cls, setCls] = useState<ArtifactClass | null>(null);
  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [holders, setHolders] = useState<BalanceView[]>([]);
  const [listings, setListings] = useState<UnitListing[]>([]);
  const [hides, setHides] = useState<HideRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [open, setOpen] = useState<Section | null>(null);
  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [e, c] = await Promise.all([getArtifactEdition(classId, editionId), getArtifactClass(classId)]);
      setView(e.edition);
      setCls(c.class.class);
      listArtifactEditionHolders(classId, editionId, { limit: "50" })
        .then((r) => setHolders(r.balances || []))
        .catch(() => setHolders([]));
      listArtifactUnitListings(classId, editionId, { limit: "50" })
        .then((r) => setListings(r.listings || []))
        .catch(() => setListings([]));
      // An edition's hides are recorded against (class, edition id).
      getArtifactHideRecords(classId, editionId).then(setHides).catch(() => setHides([]));
      if (address) getArtifactBalance(classId, editionId, address).then(setBalance).catch(() => setBalance(null));
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [classId, editionId, address]);

  useEffect(() => {
    load();
  }, [load]);

  const { pending, error, clearError, setError, send } = useArtifactTx(load);

  // Form state.
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [listQty, setListQty] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [listDays, setListDays] = useState("7");
  const [buyQty, setBuyQty] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [fund, setFund] = useState("");
  const [mintRows, setMintRows] = useState([{ recipient: "", amount: "1" }]);
  const [cap, setCap] = useState("");
  const [revoke, setRevoke] = useState({ holder: "", amount: "", reason: "" });
  const [meta, setMeta] = useState<MetadataForm | null>(null);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="sd-hull-tile h-64 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (loadError || !view || !cls) {
    return (
      <div>
        <BackButton onClick={onBack} />
        <ErrorState error={loadError} onRetry={load} fallback="Edition not found" />
      </div>
    );
  }

  const e = view.edition;
  const withheld = !!view.withheld;
  const hidden = withheld || isHidden(e.status) || isHidden(view.class_status) || isHidden(cls.status);
  const isOwner = isMine(cls.owner);
  const isMinter = isOwner || (cls.minters || []).some((m) => isMine(m));
  const transferable = isTransferable(cls);
  const marketOn = params?.market_enabled !== false;
  const maxDays = maxMarketDays(params);
  const maxBatch = params?.max_batch_size || 50;
  const md = e.metadata;
  const claim = e.claim;
  const isCertificate = !!claim && (!!claim.scope || (claim.contributors || []).length > 0 || (!!claim.initiative_id && claim.initiative_id !== "0"));
  const free = BigInt(balance?.balance.amount || "0");
  const locked = BigInt(balance?.balance.locked || "0");
  const claimable = balance?.claimable && balance.claimable !== "0" ? balance.claimable : null;
  const cid = BigInt(classId);
  const eid = BigInt(editionId);
  const busy = pending !== null;
  const royaltyBps = Math.min(cls.royalty_bps ?? 0, params?.max_royalty_bps ?? cls.royalty_bps ?? 0);
  const classHidden = isHidden(view.class_status) || isHidden(cls.status);
  // MsgUpdateToken on an EDITIONS class edits the edition (class owner only):
  // the class must allow edits and neither it nor the edition be frozen or hidden.
  const canEditMeta = isOwner && !!cls.flags?.token_metadata_mutable && !cls.metadata_frozen && !e.metadata_frozen && !hidden;
  const done = () => setOpen(null);

  const parseQty = (s: string, max?: bigint): bigint | null => {
    const q = parseUint(s);
    if (q === null || q === BigInt(0)) return null;
    if (max !== undefined && q > max) return null;
    return q;
  };

  const sendUnits = () => {
    if (!address) return;
    if (!looksLikeAddress(recipient, config.bech32Prefix)) return setError("Enter a valid address.");
    const q = parseQty(amount, free);
    if (!q) return setError(`Send 1 to ${free} units.`);
    const value: MsgTransferUnits = { sender: address, entries: [{ classId: cid, editionId: eid, recipient: recipient.trim(), amount: q }] };
    return send("send", { typeUrl: ArtifactMsgTypeUrls.TransferUnits, value }, "Couldn't send the units", () => {
      setRecipient("");
      setAmount("");
      done();
    });
  };

  const burnUnits = () => {
    if (!address) return;
    const q = parseQty(amount, free);
    if (!q) return setError(`Burn 1 to ${free} units.`);
    if (!confirm(`Burn ${q} unit${q === BigInt(1) ? "" : "s"} for good?`)) return;
    const value: MsgBurnUnits = { owner: address, classId: cid, editionId: eid, amount: q };
    return send("burn", { typeUrl: ArtifactMsgTypeUrls.BurnUnits, value }, "Burn failed", () => {
      setAmount("");
      done();
    });
  };

  const listUnits = () => {
    if (!address) return;
    const editingListing = editing ? listings.find((l) => l.id === editing) : null;
    const room = free + BigInt(editingListing?.quantity || "0");
    const q = parseQty(listQty, room);
    if (!q) return setError(`List 1 to ${room} units.`);
    const price = parsePositiveAmount(listPrice);
    if (!price) return setError("Enter a unit price above 0.");
    const d = Number(listDays);
    if (!Number.isFinite(d) || d <= 0 || d > maxDays) return setError(`A listing can run 1 to ${maxDays} days.`);
    const base = { seller: address, quantity: q, unitPrice: { denom: config.denom, amount: price }, duration: BigInt(Math.round(d * 86400)) };
    const after = () => {
      setListQty("");
      setListPrice("");
      setEditing(null);
      done();
    };
    if (editingListing) {
      const value: MsgUpdateUnitListing = { ...base, listingId: BigInt(editingListing.id) };
      return send("list", { typeUrl: ArtifactMsgTypeUrls.UpdateUnitListing, value }, "Couldn't update the listing", after);
    }
    const value: MsgListUnits = { ...base, classId: cid, editionId: eid };
    return send("list", { typeUrl: ArtifactMsgTypeUrls.ListUnits, value }, "Couldn't list the units", after);
  };

  const delist = (l: UnitListing) => {
    if (!address) return;
    const value: MsgDelistUnits = { seller: address, listingId: BigInt(l.id) };
    return send(`delist-${l.id}`, { typeUrl: ArtifactMsgTypeUrls.DelistUnits, value }, "Couldn't delist");
  };

  const buy = (l: UnitListing) => {
    if (!address) return;
    const q = parseQty(buyQty[l.id] || "1", BigInt(l.quantity || "0"));
    if (!q) return setError(`Buy 1 to ${l.quantity} units.`);
    const total = BigInt(l.unit_price?.amount || "0") * q;
    if (!confirm(`Buy ${q} unit${q === BigInt(1) ? "" : "s"} for ${formatSpark(total)} ${config.displayDenom}?`)) return;
    const value: MsgBuyUnits = {
      buyer: address,
      listingId: BigInt(l.id),
      quantity: q,
      // Exact terms as shown, and the edition's metadata as seen.
      expectedUnitPrice: { denom: l.unit_price?.denom || config.denom, amount: l.unit_price?.amount || "0" },
      expectedMetadataHash: view.metadata_hash || "",
    };
    return send(`buy-${l.id}`, { typeUrl: ArtifactMsgTypeUrls.BuyUnits, value }, "Purchase failed");
  };

  const fundEdition = () => {
    if (!address) return;
    const a = parsePositiveAmount(fund);
    if (!a) return setError("Enter an amount above 0.");
    if (!confirm(`Pay ${formatSpark(a)} ${config.displayDenom} to this edition's holders? It isn't refundable.`)) return;
    const value: MsgFundEdition = { funder: address, classId: cid, editionId: eid, amount: { denom: config.denom, amount: a } };
    return send("fund", { typeUrl: ArtifactMsgTypeUrls.FundEdition, value }, "Funding failed", () => {
      setFund("");
      done();
    });
  };

  const claimRewards = () => {
    if (!address) return;
    const value: MsgClaimEditionRewards = { holder: address, refs: [{ classId: cid, editionId: eid }] };
    return send("claim", { typeUrl: ArtifactMsgTypeUrls.ClaimEditionRewards, value }, "Couldn't claim");
  };

  const mintUnits = () => {
    if (!address) return;
    const entries = [];
    const seen = new Set<string>();
    for (const r of mintRows) {
      const to = r.recipient.trim();
      if (to && !looksLikeAddress(to, config.bech32Prefix)) return setError(`"${to}" isn't a valid address.`);
      const key = to || address;
      if (seen.has(key)) return setError("Each recipient can appear only once.");
      seen.add(key);
      const q = parseQty(r.amount);
      if (!q) return setError("Each recipient needs at least 1 unit.");
      entries.push({ recipient: to, amount: q });
    }
    const value: MsgMintUnits = { minter: address, classId: cid, editionId: eid, entries };
    return send("mint", { typeUrl: ArtifactMsgTypeUrls.MintUnits, value }, "Mint failed", () => {
      setMintRows([{ recipient: "", amount: "1" }]);
      done();
    });
  };

  const issued = BigInt(e.supply || "0") + BigInt(e.burned || "0") + BigInt(e.reserved || "0");
  const currentCap = BigInt(e.max_supply || "0");
  const setUnitCap = () => {
    if (!address) return;
    const c = parseUint(cap);
    if (c === null || c === BigInt(0)) return setError("Enter a cap above 0. A cap can't be removed once set.");
    if (c < issued) return setError(`The cap can't be below the ${issued} units already issued.`);
    if (currentCap !== BigInt(0) && c >= currentCap) return setError("The cap can only be lowered.");
    const value: MsgSetMaxSupply = { owner: address, classId: cid, maxSupply: c, editionId: eid };
    return send("cap", { typeUrl: ArtifactMsgTypeUrls.SetMaxSupply, value }, "Couldn't set the cap", () => {
      setCap("");
      done();
    });
  };

  const revokeUnits = () => {
    if (!address) return;
    if (!looksLikeAddress(revoke.holder, config.bech32Prefix)) return setError("Enter the holder's address.");
    const q = parseQty(revoke.amount);
    if (!q) return setError("Enter how many units to revoke.");
    if (!confirm(`Revoke ${q} unit${q === BigInt(1) ? "" : "s"} from this holder? They're burned.`)) return;
    const value: MsgRevokeUnits = { owner: address, classId: cid, editionId: eid, holder: revoke.holder.trim(), amount: q, reason: revoke.reason.trim() };
    return send("revoke", { typeUrl: ArtifactMsgTypeUrls.RevokeUnits, value }, "Revoke failed", () => {
      setRevoke({ holder: "", amount: "", reason: "" });
      done();
    });
  };

  const saveMeta = () => {
    if (!address || !meta) return;
    const bad = validateMetadataForm(meta);
    if (bad) return setError(bad);
    const value: MsgUpdateToken = { owner: address, classId: cid, tokenId: eid, metadata: metadataFormToMsg(meta) };
    return send("edit", { typeUrl: ArtifactMsgTypeUrls.UpdateToken, value }, "Couldn't update the edition", () => {
      setMeta(null);
      done();
    });
  };

  const freezeMeta = () => {
    if (!address) return;
    if (!confirm("Freeze this edition's metadata for good? Nobody can change it after this.")) return;
    const value: MsgFreezeTokenMetadata = { signer: address, refs: [{ classId: cid, tokenId: eid }] };
    return send("freeze", { typeUrl: ArtifactMsgTypeUrls.FreezeTokenMetadata, value }, "Couldn't freeze the metadata");
  };

  const title = withheld ? `Edition #${e.id}` : md?.name?.trim() || `Edition #${e.id}`;

  return (
    <div>
      <BackButton onClick={onBack} />

      <div className="sd-hull-tile rounded-xl p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="sm:w-64 sm:shrink-0">
            {withheld ? (
              <div className="flex aspect-square w-full max-w-xs items-center justify-center rounded-xl bg-zinc-900/70 text-xs text-zinc-600">Withheld</div>
            ) : (
              <ArtifactMedia key={md?.uri || ""} uri={md?.uri || ""} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-xl font-bold text-white">{title}</h2>
              <span className="font-mono text-sm text-zinc-500">{classId}/{editionId}</span>
              {isCertificate && !withheld && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Impact certificate</span>
              )}
              {hidden && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">Hidden</span>}
              {e.metadata_frozen && cls.flags?.token_metadata_mutable && !cls.metadata_frozen && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Frozen</span>
              )}
            </div>
            <button onClick={() => onOpenClass(classId)} className="mt-1 text-sm sd-artifact-link">
              {classTitle(cls, isHidden(cls.status))} <span className="font-mono text-xs text-zinc-500">#{cls.id}</span>
            </button>
            <div className="mt-2">
              <ClassBadges cls={cls} />
            </div>
            {withheld ? (
              <p className="mt-3 text-sm italic text-zinc-500">This edition&apos;s content is hidden by moderation. Units stay with their holders.</p>
            ) : (
              md?.description && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{md.description}</p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-zinc-500">Units</dt>
                <dd className="text-zinc-200">{e.supply || "0"}{currentCap ? ` of ${currentCap}` : ""}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Holders</dt>
                <dd className="text-zinc-200">{e.holders || "0"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Burned</dt>
                <dd className="text-zinc-200">{e.burned || "0"}</dd>
              </div>
              {e.reserved && e.reserved !== "0" && (
                <div>
                  <dt className="text-xs text-zinc-500">Awaiting acceptance</dt>
                  <dd className="text-zinc-200">{e.reserved}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-zinc-500">Retro funding paid</dt>
                <dd className="text-zinc-200">{formatSpark(e.rewards_funded || "0")} {config.displayDenom}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500">Created by</dt>
                <dd className="text-xs text-zinc-200"><CopyableAddress address={e.creator} resolveName /></dd>
              </div>
              {e.created_at && e.created_at !== "0" && (
                <div>
                  <dt className="text-xs text-zinc-500">Created</dt>
                  <dd className="text-zinc-200">{formatTime(e.created_at)}</dd>
                </div>
              )}
              {view.metadata_hash && (
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-xs text-zinc-500">Metadata hash</dt>
                  <dd className="break-all font-mono text-[11px] text-zinc-400">{view.metadata_hash}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {!withheld && md?.attributes && md.attributes.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-medium text-zinc-500">Attributes</h3>
            <AttributeList attributes={md.attributes} />
          </div>
        )}

        <ArtifactModeration
          kind="edition"
          classId={classId}
          tokenId={editionId}
          records={hides}
          hidden={isHidden(e.status) || classHidden}
          appellant={cls.owner}
          onChanged={load}
        />

        {isCertificate && !withheld && claim && (
          <div className="mt-5 space-y-2 rounded-lg border border-emerald-800/40 bg-emerald-900/10 p-3 text-sm">
            <h3 className="text-xs font-medium text-emerald-300">Impact claim</h3>
            {claim.scope && <p className="whitespace-pre-wrap text-zinc-300">{claim.scope}</p>}
            {(claim.work_start && claim.work_start !== "0") || (claim.work_end && claim.work_end !== "0") ? (
              <p className="text-xs text-zinc-400">
                Work {claim.work_start && claim.work_start !== "0" ? `from ${formatTime(claim.work_start)}` : ""}
                {claim.work_end && claim.work_end !== "0" ? ` to ${formatTime(claim.work_end)}` : ""}
              </p>
            ) : null}
            {claim.initiative_id && claim.initiative_id !== "0" && <p className="text-xs text-zinc-400">For initiative #{claim.initiative_id}</p>}
            {(claim.contributors || []).length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                <span>Contributors:</span>
                {(claim.contributors || []).map((c) => (
                  <CopyableAddress key={c} address={c} resolveName className="text-zinc-300" />
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-5 text-xs text-zinc-500">
          Holding units doesn&apos;t grant copyright. The media and metadata are public domain (CC0).
        </p>
      </div>

      <ActionBanner message={error} onDismiss={clearError} className="mt-3" />

      {/* Listings */}
      {(listings.length > 0 || (balance && transferable && marketOn && !hidden)) && (
        <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white">Units for sale</h3>
          <p className="text-xs text-zinc-500">
            Buy any part of a listing. A {bpsToPercent(params?.sale_fee_bps)} fee{royaltyBps > 0 ? ` and a ${bpsToPercent(royaltyBps)} royalty` : ""} come
            out of the price.
          </p>
          {listings.length === 0 && <p className="text-xs text-zinc-600">Nothing listed.</p>}
          {listings.map((l) => {
            const mine = isMine(l.seller);
            return (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs">
                <span className="inline-flex flex-wrap items-center gap-1 text-zinc-400">
                  <span className="font-semibold text-amber-200">{formatCoin(l.unit_price, config.displayDenom)}</span> each ·{" "}
                  {l.quantity} left · by <CopyableAddress address={l.seller} resolveName className="text-zinc-300" />
                  {l.expires_at && <span>· {timeRemaining(l.expires_at)}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {mine ? (
                    <>
                      <button
                        onClick={() => {
                          setEditing(l.id);
                          setListQty(l.quantity || "");
                          setListPrice(formatSpark(l.unit_price?.amount || "0").replace(/,/g, ""));
                          setOpen("list");
                        }}
                        disabled={busy}
                        className="text-zinc-400 hover:text-zinc-200"
                      >
                        Change
                      </button>
                      <button onClick={() => delist(l)} disabled={busy} className="text-zinc-400 hover:text-red-400 disabled:opacity-50">
                        {pending === `delist-${l.id}` ? "Delisting…" : "Delist"}
                      </button>
                    </>
                  ) : address && marketOn && !hidden ? (
                    <>
                      <input
                        value={buyQty[l.id] ?? "1"}
                        onChange={(ev) => setBuyQty({ ...buyQty, [l.id]: ev.target.value })}
                        inputMode="numeric"
                        aria-label="Units to buy"
                        className={`${fieldCls} w-16 py-1 text-xs`}
                      />
                      <button onClick={() => buy(l)} disabled={busy} className="sd-btn sd-btn-verdigris">
                        {pending === `buy-${l.id}` ? "Buying…" : "Buy"}
                      </button>
                    </>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Holder */}
      {balance && (free > BigInt(0) || locked > BigInt(0) || claimable) && (
        <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Your units</h3>
            <span className="text-sm text-zinc-200">
              {free.toString()} free{locked > BigInt(0) ? `, ${locked} listed or pending` : ""}
            </span>
          </div>
          {claimable && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-800/50 bg-emerald-900/15 px-3 py-2 text-xs text-emerald-200">
              <span>{formatSpark(claimable)} {config.displayDenom} of retro funding is yours to claim.</span>
              <button onClick={claimRewards} disabled={busy} className="sd-btn sd-btn-verdigris">
                {pending === "claim" ? "Claiming…" : "Claim"}
              </button>
            </div>
          )}
          {free > BigInt(0) && transferable && !hidden && (
            <ActionSection title="Send units" open={open === "send"} onToggle={() => toggle("send")}>
              <p className="text-xs text-zinc-500">Depending on the recipient&apos;s settings, the units may wait in their inbox until they accept.</p>
              <input value={recipient} onChange={(ev) => setRecipient(ev.target.value)} placeholder="Recipient address" className={`${fieldCls} font-mono text-xs`} />
              <div className="flex gap-2">
                <input value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder={`Units (up to ${free})`} inputMode="numeric" className={fieldCls} />
                <button onClick={sendUnits} disabled={busy} className="sd-btn sd-btn-secondary">{pending === "send" ? "Sending…" : "Send"}</button>
              </div>
            </ActionSection>
          )}
          {(free > BigInt(0) || editing) && transferable && marketOn && !hidden && (
            <ActionSection title={editing ? `Change listing #${editing}` : "Sell units"} open={open === "list"} onToggle={() => toggle("list")}>
              <div className="grid grid-cols-3 gap-2">
                <FieldLabel label="Units">
                  <input value={listQty} onChange={(ev) => setListQty(ev.target.value)} inputMode="numeric" className={fieldCls} />
                </FieldLabel>
                <FieldLabel label={`Each (${config.displayDenom})`}>
                  <input value={listPrice} onChange={(ev) => setListPrice(ev.target.value)} inputMode="decimal" className={fieldCls} />
                </FieldLabel>
                <FieldLabel label="Days" hint={`Up to ${maxDays}.`}>
                  <input value={listDays} onChange={(ev) => setListDays(ev.target.value)} inputMode="decimal" className={fieldCls} />
                </FieldLabel>
              </div>
              <p className="text-xs text-zinc-500">Listed units stay in your balance, locked, and keep earning retro funding until sold.</p>
              <div className="flex gap-2">
                <button onClick={listUnits} disabled={busy} className="sd-btn sd-btn-verdigris">
                  {pending === "list" ? "Saving…" : editing ? "Update listing" : "List units"}
                </button>
                {editing && (
                  <button onClick={() => { setEditing(null); setListQty(""); setListPrice(""); }} className="sd-btn sd-btn-secondary">
                    New listing instead
                  </button>
                )}
              </div>
            </ActionSection>
          )}
          {free > BigInt(0) && holderCanBurn(cls) && (
            <ActionSection title="Burn units" open={open === "burn"} onToggle={() => toggle("burn")} tone="danger">
              <p className="text-xs text-zinc-500">Destroys units for good. Emptying your balance returns its record deposit.</p>
              <div className="flex gap-2">
                <input value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder={`Units (up to ${free})`} inputMode="numeric" className={fieldCls} />
                <button onClick={burnUnits} disabled={busy} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                  {pending === "burn" ? "Burning…" : "Burn"}
                </button>
              </div>
            </ActionSection>
          )}
        </div>
      )}

      {/* Retro funding */}
      {address && !hidden && BigInt(e.supply || "0") > BigInt(0) && (
        <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
          <ActionSection title={isCertificate ? "Reward this work" : "Fund holders"} open={open === "fund"} onToggle={() => toggle("fund")}>
            <p className="text-xs text-zinc-500">
              Pays {config.displayDenom}{" "}to everyone holding units now, in proportion to how many they hold. Units sold later don&apos;t take
              what their earlier holder earned. Only {config.displayDenom}; it can&apos;t be undone.
            </p>
            <div className="flex gap-2">
              <input value={fund} onChange={(ev) => setFund(ev.target.value)} placeholder={`Amount (${config.displayDenom})`} inputMode="decimal" className={fieldCls} />
              <button onClick={fundEdition} disabled={busy || !fund.trim()} className="sd-btn sd-btn-verdigris">
                {pending === "fund" ? "Paying…" : "Pay holders"}
              </button>
            </div>
          </ActionSection>
        </div>
      )}

      {/* Issuer */}
      {isMinter && (
        <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white">Issuer actions</h3>
          {!cls.minting_closed && !hidden && (
            <ActionSection title="Mint units" open={open === "mint"} onToggle={() => toggle("mint")}>
              <p className="text-xs text-zinc-500">
                Each new holder&apos;s balance holds a {formatSpark(params?.token_deposit || "0")} {config.displayDenom} deposit from you,
                refunded to whoever empties it. Up to {maxBatch} recipients at a time.
              </p>
              {mintRows.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={r.recipient}
                    onChange={(ev) => setMintRows(mintRows.map((x, j) => (j === i ? { ...x, recipient: ev.target.value } : x)))}
                    placeholder="Recipient (blank for yourself)"
                    className={`${fieldCls} font-mono text-xs`}
                  />
                  <input
                    value={r.amount}
                    onChange={(ev) => setMintRows(mintRows.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)))}
                    inputMode="numeric"
                    aria-label="Units"
                    className={`${fieldCls} w-24`}
                  />
                  {mintRows.length > 1 && (
                    <button type="button" onClick={() => setMintRows(mintRows.filter((_, j) => j !== i))} className="px-1 text-xs text-zinc-500 hover:text-red-400" aria-label="Remove recipient">
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {mintRows.length < maxBatch && (
                <button type="button" onClick={() => setMintRows([...mintRows, { recipient: "", amount: "1" }])} className="text-xs text-zinc-400 hover:text-zinc-200">
                  + Add recipient
                </button>
              )}
              <button onClick={mintUnits} disabled={busy} className="sd-btn sd-btn-verdigris">{pending === "mint" ? "Minting…" : "Mint units"}</button>
            </ActionSection>
          )}
          {isOwner && (
            <ActionSection title="Unit cap" open={open === "cap"} onToggle={() => toggle("cap")}>
              <p className="text-xs text-zinc-500">
                {currentCap ? `Capped at ${currentCap}.` : "No cap yet."} {issued.toString()} issued so far, counting burned and pending units. A
                cap can only go down.
              </p>
              <div className="flex gap-2">
                <input value={cap} onChange={(ev) => setCap(ev.target.value)} placeholder="New cap" inputMode="numeric" className={fieldCls} />
                <button onClick={setUnitCap} disabled={busy || !cap} className="sd-btn sd-btn-secondary">{pending === "cap" ? "Saving…" : "Set cap"}</button>
              </div>
            </ActionSection>
          )}
          {canEditMeta && (
            <ActionSection title="Edit metadata" open={open === "edit"} onToggle={() => toggle("edit")}>
              <p className="text-xs text-zinc-500">Every holder sees the change. Freeze the metadata when it&apos;s final.</p>
              <MetadataEditor value={meta ?? metadataFormFrom(md)} onChange={setMeta} />
              <div className="flex flex-wrap gap-2">
                <button onClick={saveMeta} disabled={busy || !meta} className="sd-btn sd-btn-verdigris">
                  {pending === "edit" ? "Saving…" : "Save metadata"}
                </button>
                <button onClick={freezeMeta} disabled={busy} className="sd-btn sd-btn-secondary">
                  {pending === "freeze" ? "Freezing…" : "Freeze metadata"}
                </button>
              </div>
            </ActionSection>
          )}
          {isOwner && issuerCanRevoke(cls) && (
            <ActionSection title="Revoke units" open={open === "revoke"} onToggle={() => toggle("revoke")} tone="danger">
              <p className="text-xs text-zinc-500">Burns a holder&apos;s free units.</p>
              <input value={revoke.holder} onChange={(ev) => setRevoke({ ...revoke, holder: ev.target.value })} placeholder="Holder address" className={`${fieldCls} font-mono text-xs`} />
              <div className="flex gap-2">
                <input value={revoke.amount} onChange={(ev) => setRevoke({ ...revoke, amount: ev.target.value })} placeholder="Units" inputMode="numeric" className={`${fieldCls} w-28`} />
                <input value={revoke.reason} onChange={(ev) => setRevoke({ ...revoke, reason: ev.target.value })} placeholder="Reason (shown to the holder)" maxLength={256} className={fieldCls} />
              </div>
              <button onClick={revokeUnits} disabled={busy} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                {pending === "revoke" ? "Revoking…" : "Revoke"}
              </button>
            </ActionSection>
          )}
        </div>
      )}

      {/* Holders */}
      <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-300">Holders</h3>
      {holders.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-6 text-center text-sm text-zinc-500">No holders yet.</div>
      ) : (
        <div className="sd-hull-tile divide-y divide-zinc-800 rounded-xl">
          {holders.map((h) => {
            const units = BigInt(h.balance.amount || "0") + BigInt(h.balance.locked || "0");
            return (
              <div key={h.balance.owner} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                <CopyableAddress address={h.balance.owner} resolveName className="text-zinc-300" />
                <span className="text-zinc-400">{units.toString()} unit{units === BigInt(1) ? "" : "s"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
