"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import {
  getArtifactClass,
  getArtifactHideRecords,
  getArtifactParams,
  getArtifactToken,
  invalidateArtifacts,
} from "@/lib/artifactApi";
import { formatSpark, formatTime, parseSparkToUspark, timeRemaining } from "@/lib/utils";
import { TokenLock, type ArtifactClass, type ArtifactParams, type HideRecord, type Listing, type TokenView } from "@/types/artifact";
import type {
  MsgBurn,
  MsgBuy,
  MsgCancelOutgoing,
  MsgDelist,
  MsgFreezeTokenMetadata,
  MsgList,
  MsgRevoke,
  MsgTransfer,
  MsgUpdateListing,
  MsgUpdateToken,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import ArtifactModeration from "./ArtifactModeration";
import {
  ActionSection,
  ArtifactMedia,
  AttributeList,
  BackButton,
  ClassBadges,
  FieldLabel,
  LockBadge,
  MetadataEditor,
  bpsToPercent,
  classTitle,
  fieldCls,
  formatCoin,
  holderCanBurn,
  isHidden,
  isTransferable,
  issuerCanRevoke,
  lockOf,
  looksLikeAddress,
  metadataFormFrom,
  metadataFormToMsg,
  tokenMediaUri,
  tokenRef,
  tokenTitle,
  txFailure,
  validateMetadataForm,
  type MetadataForm,
} from "./shared";

interface Props {
  classId: string;
  tokenId: string;
  onBack: () => void;
  onOpenClass: (classId: string) => void;
}

type Section = "transfer" | "list" | "edit" | "burn" | "revoke";

export default function TokenDetail({ classId, tokenId, onBack, onOpenClass }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const { pending, error: txError, clearError, setError: setTxError, run } = useTxAction();

  const [view, setView] = useState<TokenView | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [cls, setCls] = useState<ArtifactClass | null>(null);
  const [hides, setHides] = useState<HideRecord[]>([]);
  const [params, setParams] = useState<ArtifactParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<Section | null>(null);
  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  // Form state.
  const [recipient, setRecipient] = useState("");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("7");
  const [meta, setMeta] = useState<MetadataForm | null>(null);
  const [revokeReason, setRevokeReason] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, c] = await Promise.all([getArtifactToken(classId, tokenId), getArtifactClass(classId)]);
      setView(t.token);
      setListing(t.listing && t.listing.seller ? t.listing : null);
      setCls(c.class.class);
      setMeta(null);
      getArtifactHideRecords(classId, tokenId).then(setHides).catch(() => setHides([]));
      getArtifactParams().then((r) => setParams(r.params)).catch(() => setParams(null));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [classId, tokenId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="sd-hull-tile h-64 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (error || !view || !cls) {
    return (
      <div>
        <BackButton onClick={onBack} />
        <ErrorState error={error} onRetry={load} fallback="Token not found" />
      </div>
    );
  }

  const t = view.token;
  const withheld = !!view.withheld;
  const tokenHidden = isHidden(t.status);
  const classHidden = isHidden(view.class_status) || isHidden(cls.status);
  const lock = lockOf(t);
  const isHolder = !!address && t.owner === address;
  const isClassOwner = !!address && cls.owner === address;
  const transferable = isTransferable(cls);
  const marketOn = params?.market_enabled !== false;
  const maxListingDays = params?.max_listing_duration ? Math.floor(Number(params.max_listing_duration) / 86400) : 30;
  const classIdN = BigInt(classId);
  const tokenIdN = BigInt(tokenId);
  const refs = [{ classId: classIdN, tokenId: tokenIdN }];
  const busy = pending !== null;
  const canEditMeta =
    isClassOwner && !!cls.flags?.token_metadata_mutable && !cls.metadata_frozen && !t.metadata_frozen && !tokenHidden && !classHidden;

  const send = (key: string, typeUrl: string, value: unknown, fail: string, after?: () => void) =>
    run(key, async () => {
      await signAndBroadcast([{ typeUrl, value }]);
      invalidateArtifacts();
      after?.();
      setOpen(null);
      await load();
    }, txFailure(fail));

  const transfer = () => {
    if (!address) return;
    if (!looksLikeAddress(recipient, config.bech32Prefix)) return setTxError("Enter a valid address.");
    if (recipient.trim() === address) return setTxError("You already hold this token.");
    const value: MsgTransfer = {
      sender: address,
      entries: [{ classId: classIdN, tokenId: tokenIdN, recipient: recipient.trim() }],
    };
    return send("transfer", ArtifactMsgTypeUrls.Transfer, value, "Transfer failed", () => setRecipient(""));
  };

  const listOrUpdate = () => {
    if (!address) return;
    const amount = parseSparkToUspark(price.trim());
    if (!amount || amount === "0") return setTxError("Enter a price above 0.");
    const d = Math.floor(Number(days));
    if (!Number.isFinite(d) || d < 1 || d > Math.max(1, maxListingDays)) {
      return setTxError(`The listing can run 1 to ${Math.max(1, maxListingDays)} days.`);
    }
    const base = {
      seller: address,
      classId: classIdN,
      tokenId: tokenIdN,
      price: { denom: config.denom, amount },
      duration: BigInt(d * 86400),
    };
    if (lock === TokenLock.LISTED) {
      const value: MsgUpdateListing = base;
      return send("list", ArtifactMsgTypeUrls.UpdateListing, value, "Couldn't update the listing");
    }
    const value: MsgList = base;
    return send("list", ArtifactMsgTypeUrls.List, value, "Couldn't list the token");
  };

  const delist = () => {
    if (!address) return;
    const value: MsgDelist = { seller: address, classId: classIdN, tokenId: tokenIdN };
    return send("delist", ArtifactMsgTypeUrls.Delist, value, "Couldn't delist");
  };

  const buy = () => {
    if (!address || !listing) return;
    const value: MsgBuy = {
      buyer: address,
      classId: classIdN,
      tokenId: tokenIdN,
      // Exact terms as shown. If the seller changes them first, the buy fails instead of paying more.
      expectedPrice: { denom: listing.price.denom, amount: listing.price.amount },
      expectedNonce: BigInt(listing.nonce || "0"),
      // Pin what the buyer saw, so a metadata swap in the meantime fails the buy.
      expectedMetadataHash: view.metadata_hash || "",
    };
    return send("buy", ArtifactMsgTypeUrls.Buy, value, "Purchase failed");
  };

  const cancelPending = () => {
    if (!address) return;
    const value: MsgCancelOutgoing = { signer: address, refs };
    return send("cancel", ArtifactMsgTypeUrls.CancelOutgoing, value, "Couldn't cancel the transfer");
  };

  const burn = () => {
    if (!address) return;
    if (!confirm("Burn this token? It's gone for good, and its deposit comes back to you.")) return;
    const value: MsgBurn = { owner: address, refs };
    return send("burn", ArtifactMsgTypeUrls.Burn, value, "Burn failed");
  };

  const revoke = () => {
    if (!address) return;
    if (!confirm("Revoke this token? It's burned and its deposit goes back to the holder.")) return;
    const value: MsgRevoke = { owner: address, classId: classIdN, tokenIds: [tokenIdN], reason: revokeReason.trim() };
    return send("revoke", ArtifactMsgTypeUrls.Revoke, value, "Revoke failed");
  };

  const freeze = () => {
    if (!address) return;
    if (!confirm("Freeze this token's metadata for good? Nobody can edit it after this.")) return;
    const value: MsgFreezeTokenMetadata = { signer: address, refs };
    return send("freeze", ArtifactMsgTypeUrls.FreezeTokenMetadata, value, "Couldn't freeze metadata");
  };

  const saveMeta = () => {
    if (!address || !meta) return;
    const bad = validateMetadataForm(meta);
    if (bad) return setTxError(bad);
    const value: MsgUpdateToken = { owner: address, classId: classIdN, tokenId: tokenIdN, metadata: metadataFormToMsg(meta) };
    return send("edit", ArtifactMsgTypeUrls.UpdateToken, value, "Couldn't update metadata");
  };

  const md = t.metadata;
  const deposit = t.deposit && t.deposit !== "0" ? `${formatSpark(t.deposit)} ${config.displayDenom}` : null;
  const saleFeeBps = params?.sale_fee_bps ?? 0;
  const royaltyBps = Math.min(cls.royalty_bps ?? 0, params?.max_royalty_bps ?? cls.royalty_bps ?? 0);

  return (
    <div>
      <BackButton onClick={onBack} />

      <div className="sd-hull-tile rounded-xl p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="sm:w-64 sm:shrink-0">
            {withheld ? (
              <div className="flex aspect-square w-full max-w-xs items-center justify-center rounded-xl bg-zinc-900/70 text-xs text-zinc-600">
                Withheld
              </div>
            ) : (
              <ArtifactMedia key={tokenMediaUri(t, cls)} uri={tokenMediaUri(t, cls)} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-xl font-bold text-white">{tokenTitle(t, withheld)}</h2>
              <span className="font-mono text-sm text-zinc-500">{tokenRef(classId, tokenId)}</span>
              <LockBadge lock={lock} />
              {(tokenHidden || classHidden) && (
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">Hidden</span>
              )}
              {t.metadata_frozen && cls.flags?.token_metadata_mutable && !cls.metadata_frozen && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Frozen</span>
              )}
            </div>
            <button onClick={() => onOpenClass(classId)} className="mt-1 text-sm text-indigo-300 hover:text-indigo-200">
              {classTitle(cls, isHidden(cls.status))} <span className="font-mono text-xs text-zinc-500">#{cls.id}</span>
            </button>
            <div className="mt-2">
              <ClassBadges cls={cls} />
            </div>

            {withheld ? (
              <p className="mt-3 text-sm italic text-zinc-500">This token&apos;s content is hidden by moderation. It still belongs to its holder.</p>
            ) : (
              md?.description && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{md.description}</p>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-zinc-500">Holder</dt>
                <dd className="text-xs text-zinc-200"><CopyableAddress address={t.owner} resolveName /></dd>
              </div>
              {t.minter && (
                <div>
                  <dt className="text-xs text-zinc-500">Minted by</dt>
                  <dd className="text-xs text-zinc-200"><CopyableAddress address={t.minter} resolveName /></dd>
                </div>
              )}
              {t.minted_at && t.minted_at !== "0" && (
                <div>
                  <dt className="text-xs text-zinc-500">Minted</dt>
                  <dd className="text-zinc-200">{formatTime(t.minted_at)}</dd>
                </div>
              )}
              {deposit && (
                <div>
                  <dt className="text-xs text-zinc-500">Deposit</dt>
                  <dd className="text-zinc-200" title="Refunded to whoever burns the token">{deposit}</dd>
                </div>
              )}
              {view.metadata_hash && (
                <div className="col-span-2">
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

        <p className="mt-5 text-xs text-zinc-500">
          Holding this token doesn&apos;t grant copyright. Its media and metadata are public domain (CC0), so anyone may copy, print or remix them.
        </p>

        <ArtifactModeration
          kind="token"
          classId={classId}
          tokenId={tokenId}
          records={hides}
          hidden={tokenHidden || classHidden}
          appellant={t.owner}
          onChanged={load}
        />
      </div>

      {listing && (
        <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">For sale</h3>
            <span className="text-lg font-semibold text-amber-200">{formatCoin(listing.price, config.displayDenom)}</span>
          </div>
          <p className="text-xs text-zinc-500">
            Listed by <CopyableAddress address={listing.seller} resolveName className="text-zinc-300" />
            {listing.expires_at && <> · {timeRemaining(listing.expires_at)}</>}.
            {" "}A {bpsToPercent(saleFeeBps)} fee goes to the community pool
            {royaltyBps > 0 ? ` and a ${bpsToPercent(royaltyBps)} royalty to the issuer` : ""}, out of the price.
          </p>
          {address && !isHolder && (
            <button
              onClick={buy}
              disabled={busy || !marketOn || tokenHidden || classHidden}
              className="sd-btn sd-btn-primary"
              title={!marketOn ? "The market is turned off right now" : undefined}
            >
              {pending === "buy" ? "Buying…" : `Buy for ${formatCoin(listing.price, config.displayDenom)}`}
            </button>
          )}
          {!address && <p className="text-xs text-zinc-500">Connect a wallet to buy.</p>}
        </div>
      )}

      <ActionBanner message={txError} onDismiss={clearError} className="mt-3" />

      {(isHolder || isClassOwner) && (
        <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white">{isHolder ? "Your token" : "Issuer actions"}</h3>

          {isHolder && lock === TokenLock.PENDING_TRANSFER && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-800/50 bg-sky-900/15 px-3 py-2 text-xs text-sky-200">
              <span>This token is waiting in someone&apos;s inbox. It stays yours until they accept.</span>
              <button onClick={cancelPending} disabled={busy} className="rounded-md border border-sky-600 px-2.5 py-1 hover:bg-sky-900/40 disabled:opacity-50">
                {pending === "cancel" ? "Cancelling…" : "Cancel transfer"}
              </button>
            </div>
          )}

          {isHolder && transferable && lock === TokenLock.NONE && (
            <ActionSection title="Send" open={open === "transfer"} onToggle={() => toggle("transfer")}>
              <p className="text-xs text-zinc-500">
                Depending on the recipient&apos;s settings, it may wait in their inbox until they accept. That costs a small fee
                {params?.inbox_fee && params.inbox_fee !== "0" ? ` (${formatSpark(params.inbox_fee)} ${config.displayDenom})` : ""}.
                Sending isn&apos;t a sale, so no royalty is paid.
              </p>
              <div className="flex gap-2">
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Recipient address" className={`${fieldCls} font-mono text-xs`} />
                <button onClick={transfer} disabled={busy || !recipient.trim()} className="sd-btn sd-btn-secondary">
                  {pending === "transfer" ? "Sending…" : "Send"}
                </button>
              </div>
            </ActionSection>
          )}

          {isHolder && transferable && (lock === TokenLock.NONE || lock === TokenLock.LISTED) && marketOn && !tokenHidden && !classHidden && (
            <ActionSection
              title={lock === TokenLock.LISTED ? "Change listing" : "Sell"}
              open={open === "list"}
              onToggle={() => toggle("list")}
            >
              <p className="text-xs text-zinc-500">
                Fixed price in {config.displayDenom}. Nothing leaves your wallet until someone buys. From the price, a {bpsToPercent(saleFeeBps)} fee
                {royaltyBps > 0 ? ` and a ${bpsToPercent(royaltyBps)} royalty` : ""} are taken.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label={`Price (${config.displayDenom})`}>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={fieldCls} />
                </FieldLabel>
                <FieldLabel label="Days" hint={`Up to ${maxListingDays}.`}>
                  <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={fieldCls} />
                </FieldLabel>
              </div>
              <div className="flex gap-2">
                <button onClick={listOrUpdate} disabled={busy || !price.trim()} className="sd-btn sd-btn-primary">
                  {pending === "list" ? "Saving…" : lock === TokenLock.LISTED ? "Update listing" : "List for sale"}
                </button>
                {lock === TokenLock.LISTED && (
                  <button onClick={delist} disabled={busy} className="sd-btn sd-btn-secondary">
                    {pending === "delist" ? "Delisting…" : "Delist"}
                  </button>
                )}
              </div>
            </ActionSection>
          )}

          {isHolder && lock === TokenLock.LISTED && (!marketOn || tokenHidden || classHidden) && (
            <button onClick={delist} disabled={busy} className="sd-btn sd-btn-secondary">
              {pending === "delist" ? "Delisting…" : "Delist"}
            </button>
          )}

          {canEditMeta && (
            <ActionSection
              title="Edit metadata"
              open={open === "edit"}
              onToggle={() => {
                if (!meta) setMeta(metadataFormFrom(md));
                toggle("edit");
              }}
            >
              <MetadataEditor value={meta ?? metadataFormFrom(md)} onChange={setMeta} />
              <button onClick={saveMeta} disabled={busy || !meta} className="sd-btn sd-btn-primary">
                {pending === "edit" ? "Saving…" : "Save metadata"}
              </button>
            </ActionSection>
          )}

          {(isHolder || isClassOwner) && !t.metadata_frozen && !cls.metadata_frozen && cls.flags?.token_metadata_mutable && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
              <span>
                {isHolder
                  ? "The issuer can still edit this token. Freeze it to lock in what you have."
                  : "Freeze this token so its metadata can't change again."}
              </span>
              <button onClick={freeze} disabled={busy} className="shrink-0 rounded-md border border-emerald-700/50 px-2.5 py-1 text-emerald-300 hover:bg-emerald-900/20 disabled:opacity-50">
                {pending === "freeze" ? "Freezing…" : "Freeze"}
              </button>
            </div>
          )}

          {isHolder && holderCanBurn(cls) && lock !== TokenLock.PENDING_TRANSFER && (
            <ActionSection title="Burn" open={open === "burn"} onToggle={() => toggle("burn")} tone="danger">
              <p className="text-xs text-zinc-500">
                Destroys the token for good{lock === TokenLock.LISTED ? " and cancels its listing" : ""}.
                {deposit ? ` Its ${deposit} deposit comes back to you.` : ""}
              </p>
              <button onClick={burn} disabled={busy} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                {pending === "burn" ? "Burning…" : "Burn token"}
              </button>
            </ActionSection>
          )}
          {isHolder && !holderCanBurn(cls) && (
            <p className="text-xs text-zinc-500">Only the issuer can remove tokens of this class.</p>
          )}

          {isClassOwner && issuerCanRevoke(cls) && (
            <ActionSection title="Revoke" open={open === "revoke"} onToggle={() => toggle("revoke")} tone="danger">
              <p className="text-xs text-zinc-500">Burns this token. Its deposit goes back to the holder.</p>
              <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Reason (shown to the holder)" maxLength={256} className={fieldCls} />
              <button onClick={revoke} disabled={busy} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                {pending === "revoke" ? "Revoking…" : "Revoke token"}
              </button>
            </ActionSection>
          )}
        </div>
      )}
    </div>
  );
}
