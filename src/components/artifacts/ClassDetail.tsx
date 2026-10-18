"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import NumberInput from "@/components/NumberInput";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import {
  getArtifactClass,
  getArtifactHideRecords,
  getArtifactParams,
  getArtifactPendingClassOwner,
  getArtifactPublicMintQuote,
  invalidateArtifacts,
  listArtifactTokens,
} from "@/lib/artifactApi";
import { formatTime, timeRemaining } from "@/lib/utils";
import type {
  ArtifactClass,
  ArtifactParams,
  HideRecord,
  PendingClassOwner,
  PublicMintQuoteResponse,
  TokenView,
} from "@/types/artifact";
import type {
  MsgAcceptClassOwner,
  MsgCancelClassOwner,
  MsgPublicMint,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import ArtifactModeration from "./ArtifactModeration";
import ClassManagePanel from "./ClassManagePanel";
import TokenGrid from "./TokenGrid";
import {
  ArtifactMedia,
  BackButton,
  ClassBadges,
  bpsToPercent,
  classTitle,
  formatCoin,
  isHidden,
  isTransferable,
  txFailure,
} from "./shared";

interface Props {
  classId: string;
  onBack: () => void;
  onSelectToken: (classId: string, tokenId: string) => void;
}

const TOKENS_PAGE = "30";

export default function ClassDetail({ classId, onBack, onSelectToken }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const { pending, error: txError, clearError, run } = useTxAction();

  const [cls, setCls] = useState<ArtifactClass | null>(null);
  const [withheld, setWithheld] = useState(false);
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [handover, setHandover] = useState<PendingClassOwner | null>(null);
  const [hides, setHides] = useState<HideRecord[]>([]);
  const [params, setParams] = useState<ArtifactParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, t] = await Promise.all([
        getArtifactClass(classId),
        listArtifactTokens(classId, { limit: TOKENS_PAGE }),
      ]);
      setCls(c.class.class);
      setWithheld(!!c.class.withheld);
      setTokens(t.tokens || []);
      setNextKey(t.pagination?.next_key || null);
      getArtifactPendingClassOwner(classId).then(setHandover).catch(() => setHandover(null));
      getArtifactHideRecords(classId).then(setHides).catch(() => setHides([]));
      getArtifactParams().then((r) => setParams(r.params)).catch(() => setParams(null));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const loadMore = async () => {
    if (!nextKey) return;
    try {
      const t = await listArtifactTokens(classId, { limit: TOKENS_PAGE, key: nextKey });
      setTokens((prev) => [...prev, ...(t.tokens || [])]);
      setNextKey(t.pagination?.next_key || null);
    } catch {
      // Leave the button for a retry.
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="sd-hull-tile h-40 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (error || !cls) {
    return (
      <div>
        <BackButton onClick={onBack} />
        <ErrorState error={error} onRetry={load} fallback="Class not found" />
      </div>
    );
  }

  const isOwner = !!address && cls.owner === address;
  const isMinter = !!address && (cls.minters || []).includes(address);
  const hidden = withheld || isHidden(cls.status);
  const cap = cls.max_supply && cls.max_supply !== "0" ? cls.max_supply : null;
  const policy = cls.mint_policy;

  const acceptHandover = () =>
    run("accept-owner", async () => {
      if (!address) return;
      const value: MsgAcceptClassOwner = { proposedOwner: address, classId: BigInt(classId) };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.AcceptClassOwner, value }]);
      invalidateArtifacts();
      await load();
    }, txFailure("Couldn't accept ownership"));

  const cancelHandover = () =>
    run("cancel-owner", async () => {
      if (!address) return;
      const value: MsgCancelClassOwner = { owner: address, classId: BigInt(classId) };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.CancelClassOwner, value }]);
      invalidateArtifacts();
      await load();
    }, txFailure("Couldn't cancel the handover"));

  return (
    <div>
      <BackButton onClick={onBack} />

      <div className="sd-hull-tile rounded-xl p-5">
        <div className="flex flex-col gap-5 sm:flex-row">
          {!hidden && (
            <div className="sm:w-56 sm:shrink-0">
              <ArtifactMedia key={cls.uri || ""} uri={cls.uri || ""} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-xl font-bold text-white">{classTitle(cls, withheld)}</h2>
              {cls.symbol && !withheld && <span className="font-mono text-sm text-zinc-400">{cls.symbol}</span>}
              <span className="font-mono text-sm text-zinc-600">#{cls.id}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
              <span>Owned by</span>
              <CopyableAddress address={cls.owner} resolveName className="text-zinc-300" />
              {cls.creator && cls.creator !== cls.owner && (
                <>
                  <span>· created by</span>
                  <CopyableAddress address={cls.creator} resolveName className="text-zinc-300" />
                </>
              )}
            </div>
            <div className="mt-2">
              <ClassBadges cls={cls} withheld={withheld} />
            </div>
            {hidden ? (
              <p className="mt-3 text-sm italic text-zinc-500">This class&apos;s content is hidden by moderation. Tokens stay with their holders.</p>
            ) : (
              cls.description && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{cls.description}</p>
            )}
            <p className="mt-2 text-[11px] text-zinc-600">
              Names and symbols aren&apos;t unique. Check the class number and owner before trusting a class.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-zinc-500">Live tokens</dt>
            <dd className="text-zinc-200">{cls.supply || "0"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Max supply</dt>
            <dd className="text-zinc-200">{cap ?? "No cap"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Burned</dt>
            <dd className="text-zinc-200">{cls.burned || "0"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Awaiting acceptance</dt>
            <dd className="text-zinc-200">{cls.reserved_supply || "0"}</dd>
          </div>
          {isTransferable(cls) && (
            <div>
              <dt className="text-xs text-zinc-500">Royalty</dt>
              <dd className="text-zinc-200" title="Paid on sales through the Spark Dream market">
                {bpsToPercent(cls.royalty_bps)}
              </dd>
            </div>
          )}
          {cls.created_at && cls.created_at !== "0" && (
            <div>
              <dt className="text-xs text-zinc-500">Created</dt>
              <dd className="text-zinc-200">{formatTime(cls.created_at)}</dd>
            </div>
          )}
          {cls.payout_address && (
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500">Payout</dt>
              <dd className="text-xs text-zinc-300"><CopyableAddress address={cls.payout_address} resolveName /></dd>
            </div>
          )}
        </dl>

        {isTransferable(cls) && (cls.royalty_bps ?? 0) > 0 && (
          <div className="mt-3 text-xs text-zinc-500">
            Royalties are paid on sales through the Spark Dream market only.
            {(cls.royalty_recipients || []).length > 1 && (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {(cls.royalty_recipients || []).map((r) => (
                  <span key={r.address} className="inline-flex items-center gap-1">
                    <CopyableAddress address={r.address} resolveName className="text-zinc-300" />
                    {bpsToPercent(r.weight_bps)}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {handover && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-800/50 bg-sky-900/15 px-3 py-2 text-xs text-sky-200">
            <span className="inline-flex flex-wrap items-center gap-1">
              Ownership offered to
              <CopyableAddress address={handover.proposed_owner} resolveName className="text-sky-100" />
              {handover.expires_at && <span className="text-sky-300/70">({timeRemaining(handover.expires_at)})</span>}
            </span>
            {address === handover.proposed_owner && (
              <button onClick={acceptHandover} disabled={pending !== null} className="rounded-md border border-sky-600 px-2.5 py-1 font-medium hover:bg-sky-900/40 disabled:opacity-50">
                {pending === "accept-owner" ? "Accepting…" : "Accept ownership"}
              </button>
            )}
            {isOwner && (
              <button onClick={cancelHandover} disabled={pending !== null} className="rounded-md border border-zinc-600 px-2.5 py-1 hover:bg-zinc-800 disabled:opacity-50">
                {pending === "cancel-owner" ? "Cancelling…" : "Cancel offer"}
              </button>
            )}
          </div>
        )}

        <ActionBanner message={txError} onDismiss={clearError} className="mt-3" />

        <ArtifactModeration
          kind="class"
          classId={cls.id}
          records={hides}
          hidden={hidden}
          appellant={cls.owner}
          onChanged={load}
        />
      </div>

      {policy?.public_mint_enabled && !cls.minting_closed && !hidden && params?.public_mint_enabled !== false && (
        <PublicMintCard cls={cls} displayDenom={config.displayDenom} denom={config.denom} onMinted={load} />
      )}

      {(isOwner || isMinter) && (
        <ClassManagePanel
          key={`${cls.id}-${cls.updated_at}-${cls.owner}`}
          cls={cls}
          params={params}
          isOwner={isOwner}
          onChanged={load}
          onDeleted={onBack}
        />
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-300">Tokens</h3>
      <TokenGrid tokens={tokens} onSelect={onSelectToken} empty="No tokens minted yet." />
      {nextKey && (
        <button
          onClick={loadMore}
          className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function PublicMintCard({
  cls,
  displayDenom,
  denom,
  onMinted,
}: {
  cls: ArtifactClass;
  displayDenom: string;
  denom: string;
  onMinted: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const { pending, error, clearError, run } = useTxAction();
  const [quantity, setQuantity] = useState("1");
  const [quote, setQuote] = useState<PublicMintQuoteResponse | null>(null);
  // Time the card opened, for the "opens"/"closes" copy. The chain decides the window.
  const [now] = useState(() => Date.now() / 1000);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const policy = cls.mint_policy!;
  const price = policy.price ?? { denom, amount: "0" };

  useEffect(() => {
    if (!address) return;
    let live = true;
    getArtifactPublicMintQuote(cls.id, address, qty)
      .then((q) => live && setQuote(q))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [cls.id, address, qty]);

  const mint = () =>
    run("public-mint", async () => {
      if (!address) return;
      const value: MsgPublicMint = {
        buyer: address,
        classId: BigInt(cls.id),
        quantity: qty,
        // Per-token ceiling: the price shown here. A raise in the meantime fails the tx.
        maxPrice: { denom: price.denom || denom, amount: price.amount || "0" },
      };
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.PublicMint, value }]);
      invalidateArtifacts();
      onMinted();
    }, txFailure("Mint failed"));

  const start = Number(policy.start_time || "0");
  const end = Number(policy.end_time || "0");

  return (
    <div className="sd-hull-tile mt-4 space-y-3 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Public mint</h3>
        <span className="text-sm text-zinc-200">{formatCoin(price, displayDenom)} each</span>
      </div>
      <p className="text-xs text-zinc-500">
        {start > now ? `Opens ${formatTime(String(start))}. ` : ""}
        {end ? (end > now ? `Closes ${formatTime(String(end))}. ` : "Closed. ") : ""}
        {policy.per_address_limit ? `Up to ${policy.per_address_limit} per address. ` : ""}
        Each token also holds a refundable deposit.
      </p>
      {address ? (
        <>
          <div className="flex items-center gap-2">
            <NumberInput value={quantity} min={1} onChange={(e) => setQuantity(e.target.value)} wrapperClassName="w-24" />
            <button onClick={mint} disabled={pending !== null || quote?.available === false} className="sd-btn sd-btn-verdigris">
              {pending === "public-mint" ? "Minting…" : `Mint ${qty}`}
            </button>
          </div>
          {quote && (
            <p className="text-xs text-zinc-400">
              Total {formatCoin(quote.total_price, displayDenom)} plus {formatCoin(quote.deposit, displayDenom)} in deposits.
              {quote.remaining_allowance && quote.remaining_allowance !== "-1" && ` You can mint ${quote.remaining_allowance} more.`}
              {quote.available === false && <span className="text-amber-300"> Not available: {quote.reason || "minting is closed"}.</span>}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-zinc-500">Connect a wallet to mint.</p>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
