"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  listFutarchyMarkets,
  getFutarchyParams,
  getLatestBlockHeight,
  getAllBankBalances,
  type BankBalance,
} from "@/lib/api";
import {
  ContentPageLayout,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import { RoleCard } from "@/components/layout/RoleCard";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useWallet } from "@/contexts/WalletContext";
import CopyableAddress from "@/components/CopyableAddress";
import { formatDream } from "@/lib/reveal-fmt";
import {
  MarketStatus,
  MARKET_STATUS_LABELS,
  type Market,
  type FutarchyParams,
} from "@/types/futarchy";
import CreateMarketForm from "@/components/futarchy/CreateMarketForm";
import TradeModal from "@/components/futarchy/TradeModal";
import RedeemModal from "@/components/futarchy/RedeemModal";
import WithdrawLiquidityModal from "@/components/futarchy/WithdrawLiquidityModal";
import CancelMarketProposalModal from "@/components/futarchy/CancelMarketProposalModal";

// Sidebar view selectors. Each maps to a different filter/projection over the
// same underlying market list.
type View = "all" | "confidence" | "positions" | "resolution-log" | "liquidity";
type StatusFilter = "all" | "active" | "resolved" | "cancelled";
type KindFilter = "any" | "confidence" | "general";
type SortKey = "ending" | "volume" | "subsidy" | "extreme";

const APPROX_BLOCK_TIME_S = 6;

// Confidence-vote markets are linked to a Commons Group via x/commons'
// MarketToGroup map (see x/commons/keeper/hooks.go). That mapping isn't
// exposed via the LCD, so we infer the kind from a UI convention: confidence
// markets carry a `CONF-` symbol prefix. Anything else is general.
function isConfidenceMarket(m: Market): boolean {
  if (!m.symbol) return false;
  const s = m.symbol.toUpperCase();
  return s.startsWith("CONF-") || s.startsWith("CONF/");
}

export default function FutarchyPage() {
  const { address: rawAddress } = useWallet();
  const { config } = useChainConfig();

  // Wallet state is client-only (auto-reconnect happens in a useEffect inside
  // WalletProvider). Treat the address as null until after mount so SSR and
  // the first client paint render identically; otherwise every wallet-gated
  // disabled / conditional throws a hydration warning.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const address = mounted ? rawAddress : null;

  // Sidebar / filter state
  const [view, setView] = useState<View>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("any");
  const [sort, setSort] = useState<SortKey>("ending");
  const [marketsOpen, setMarketsOpen] = useLocalStorageBoolean("fut-markets-open", true);
  const [statusOpen, setStatusOpen] = useLocalStorageBoolean("fut-status-open", true);
  const [paramsOpen, setParamsOpen] = useLocalStorageBoolean("fut-params-open", false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  // Data
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [params, setParams] = useState<FutarchyParams | null>(null);
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);
  const [shareBalances, setShareBalances] = useState<BankBalance[]>([]);
  // Bumped after a successful tx so the markets / balances effects re-run.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // Action modals
  const [createOpen, setCreateOpen] = useState(false);
  const [tradeTarget, setTradeTarget] = useState<{ market: Market; outcome: "yes" | "no" } | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<{ market: Market; yes: string; no: string } | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<Market | null>(null);
  const [cancelProposalTarget, setCancelProposalTarget] = useState<Market | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMarketsLoading(true);
    listFutarchyMarkets({ limit: "100", reverse: true })
      .then((res) => {
        if (cancelled) return;
        // Fall back to DEMO_MARKETS when the chain has no markets yet so the
        // page still communicates the feature surface. Real data takes
        // precedence the moment any market exists.
        const real = res.market || [];
        setMarkets(real.length > 0 ? real : DEMO_MARKETS);
        setMarketsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setMarkets(DEMO_MARKETS);
        setMarketsError(err instanceof Error ? err.message : "Failed to load markets");
      })
      .finally(() => !cancelled && setMarketsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    getFutarchyParams()
      .then((res) => setParams(res.params))
      .catch(() => setParams(null));
  }, []);

  useEffect(() => {
    getLatestBlockHeight()
      .then((h) => setCurrentBlock(BigInt(h)))
      // When the chain is unreachable we use a synthetic "now" block so the
      // demo markets show meaningful "ends in Nd Nh" countdowns rather than
      // bare block numbers.
      .catch(() => setCurrentBlock(DEMO_NOW_BLOCK));
  }, []);

  // Pull share balances (f/{id}/yes, f/{id}/no) for the connected wallet so
  // we can render the "My positions" cards.
  useEffect(() => {
    if (!address) {
      setShareBalances([]);
      return;
    }
    let cancelled = false;
    getAllBankBalances(address, { limit: "200" })
      .then((res) => {
        if (cancelled) return;
        setShareBalances(
          (res.balances || []).filter((b) => b.denom.startsWith("f/"))
        );
      })
      .catch(() => !cancelled && setShareBalances([]));
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  // Counts derived from raw market list
  const counts = useMemo(() => {
    const c = {
      all: markets.length,
      active: 0,
      confidence: 0,
      resolvedYes: 0,
      resolvedNo: 0,
      resolved: 0,
      invalid: 0,
      cancelled: 0,
    };
    for (const m of markets) {
      if (isConfidenceMarket(m)) c.confidence++;
      if (m.status === MarketStatus.ACTIVE) c.active++;
      else if (m.status === MarketStatus.RESOLVED_YES) c.resolvedYes++;
      else if (m.status === MarketStatus.RESOLVED_NO) c.resolvedNo++;
      else if (m.status === MarketStatus.RESOLVED_INVALID) c.invalid++;
      else if (m.status === MarketStatus.CANCELLED) c.cancelled++;
    }
    c.resolved = c.resolvedYes + c.resolvedNo + c.invalid;
    return c;
  }, [markets]);

  const featured = useMemo<Market | null>(() => {
    // Prefer the most-funded active market; fall back to most recent any-state.
    const active = markets.filter((m) => m.status === MarketStatus.ACTIVE);
    if (active.length > 0) {
      const ranked = [...active].sort((a, b) => {
        const ai = bigIntFromOptional(a.initial_liquidity);
        const bi = bigIntFromOptional(b.initial_liquidity);
        if (bi > ai) return 1;
        if (bi < ai) return -1;
        return Number(BigInt(b.index) - BigInt(a.index));
      });
      return ranked[0];
    }
    return markets[0] || null;
  }, [markets]);

  // Aggregate KPIs across the full market set
  const kpis = useMemo(() => {
    let tvl = BigInt(0);
    for (const m of markets) {
      const ini = bigIntFromOptional(m.initial_liquidity);
      const wd = bigIntFromOptional(m.liquidity_withdrawn);
      tvl += ini > wd ? ini - wd : BigInt(0);
    }
    return { tvl: tvl.toString() };
  }, [markets]);

  // Map market_id → market for quick lookup from share balances.
  const marketsById = useMemo(() => {
    const m = new Map<string, Market>();
    for (const mk of markets) m.set(mk.index, mk);
    return m;
  }, [markets]);

  // Markets the connected wallet created. Used by the "Liquidity & residuals"
  // view and to count creator-eligible withdrawals in the sidebar badge.
  const createdMarkets = useMemo(() => {
    if (!address) return [];
    return markets.filter((m) => m.creator === address);
  }, [markets, address]);

  const withdrawableCount = useMemo(() => {
    return createdMarkets.filter((m) => {
      const eligible =
        m.status === MarketStatus.RESOLVED_YES ||
        m.status === MarketStatus.RESOLVED_NO ||
        m.status === MarketStatus.RESOLVED_INVALID;
      if (!eligible) return false;
      const ini = bigIntFromOptional(m.initial_liquidity);
      const wd = bigIntFromOptional(m.liquidity_withdrawn);
      return ini > wd;
    }).length;
  }, [createdMarkets]);

  // Position cards reconstructed from share balances.
  const positions = useMemo(() => {
    const byMarket = new Map<string, { yes?: string; no?: string }>();
    for (const b of shareBalances) {
      const parsed = parseShareDenom(b.denom);
      if (!parsed) continue;
      const slot = byMarket.get(parsed.marketId) || {};
      if (parsed.outcome === "yes") slot.yes = b.amount;
      else slot.no = b.amount;
      byMarket.set(parsed.marketId, slot);
    }
    const list: Array<{ market: Market; yes: string; no: string }> = [];
    for (const [marketId, legs] of byMarket.entries()) {
      const market = marketsById.get(marketId);
      if (!market) continue;
      list.push({
        market,
        yes: legs.yes || "0",
        no: legs.no || "0",
      });
    }
    list.sort((a, b) => Number(BigInt(b.market.index) - BigInt(a.market.index)));
    return list;
  }, [shareBalances, marketsById]);

  // Apply status / kind / search / sort to the market list for the table.
  const filteredMarkets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let out = markets.slice();

    if (statusFilter === "active") out = out.filter((m) => m.status === MarketStatus.ACTIVE);
    else if (statusFilter === "resolved") out = out.filter((m) =>
      m.status === MarketStatus.RESOLVED_YES ||
      m.status === MarketStatus.RESOLVED_NO ||
      m.status === MarketStatus.RESOLVED_INVALID
    );
    else if (statusFilter === "cancelled") out = out.filter((m) => m.status === MarketStatus.CANCELLED);

    if (kindFilter === "confidence") out = out.filter(isConfidenceMarket);
    else if (kindFilter === "general") out = out.filter((m) => !isConfidenceMarket(m));

    if (q) {
      out = out.filter((m) =>
        `${m.symbol} ${m.question}`.toLowerCase().includes(q)
      );
    }

    out.sort((a, b) => {
      if (sort === "ending") {
        // Active markets ending soonest first; resolved/cancelled at the end.
        const ax = a.status === MarketStatus.ACTIVE ? 0 : 1;
        const bx = b.status === MarketStatus.ACTIVE ? 0 : 1;
        if (ax !== bx) return ax - bx;
        return Number(BigInt(a.end_block) - BigInt(b.end_block));
      }
      if (sort === "subsidy") {
        return Number(bigIntFromOptional(b.initial_liquidity) - bigIntFromOptional(a.initial_liquidity));
      }
      if (sort === "extreme") {
        const ax = Math.abs(lmsrYesProb(a) - 0.5);
        const bx = Math.abs(lmsrYesProb(b) - 0.5);
        return bx - ax;
      }
      // "volume" — we don't have a per-market volume field; proxy with pool sum.
      const aVol = bigIntFromOptional(a.pool_yes) + bigIntFromOptional(a.pool_no);
      const bVol = bigIntFromOptional(b.pool_yes) + bigIntFromOptional(b.pool_no);
      return Number(bVol - aVol);
    });

    return out;
  }, [markets, statusFilter, kindFilter, searchQuery, sort]);

  // Switch sidebar view; resets the table filters where appropriate.
  const switchView = (v: View) => {
    setView(v);
    if (v === "all") { setStatusFilter("all"); setKindFilter("any"); }
    else if (v === "confidence") { setKindFilter("confidence"); setStatusFilter("all"); }
    else if (v === "resolution-log") { setStatusFilter("resolved"); setKindFilter("any"); }
  };

  const sidebar = (
    <>
      <SidebarSection
        label="Futarchy"
        open={marketsOpen}
        onToggle={() => setMarketsOpen(!marketsOpen)}
      >
        <SidebarItem active={view === "all"} onClick={() => switchView("all")}>
          <Glyph name="markets" /> Markets
          <Badge>{counts.all}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "confidence"} onClick={() => switchView("confidence")}>
          <Glyph name="layers" /> Confidence votes
          <Badge tone={counts.confidence > 0 ? "amber" : undefined}>{counts.confidence}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "positions"} onClick={() => switchView("positions")}>
          <Glyph name="user" /> My positions
          <Badge>{positions.length}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "resolution-log"} onClick={() => switchView("resolution-log")}>
          <Glyph name="clock" /> Resolution log
          <Badge>{counts.resolved}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "liquidity"} onClick={() => switchView("liquidity")}>
          <Glyph name="liquidity" /> Liquidity & residuals
          <Badge tone={withdrawableCount > 0 ? "amber" : undefined}>
            {createdMarkets.length}
          </Badge>
        </SidebarItem>
      </SidebarSection>

      <SidebarSection
        label="Status"
        open={statusOpen}
        onToggle={() => setStatusOpen(!statusOpen)}
      >
        <StatusLegendItem dot="amber" label="Active" count={counts.active} />
        <StatusLegendItem dot="green" label="Resolved YES" count={counts.resolvedYes} />
        <StatusLegendItem dot="rose"  label="Resolved NO" count={counts.resolvedNo} />
        <StatusLegendItem dot="mute"  label="Invalid · Cancelled" count={counts.invalid + counts.cancelled} />
      </SidebarSection>

      {params && (
        <SidebarSection
          label="Module params"
          open={paramsOpen}
          onToggle={() => setParamsOpen(!paramsOpen)}
        >
          <ParamList params={params} />
        </SidebarSection>
      )}
    </>
  );

  return (
    <ContentPageLayout
      title="Futarchy"
      subtitle="Decision markets — LMSR-priced YES/NO outcomes; resolution drives commons policy"
      sidebar={sidebar}
      railCards={<RolesStrip params={params} />}
    >
      <PageHead
        onToggleCreate={() => setCreateOpen((v) => !v)}
        canCreate={!!address}
        createOpen={createOpen}
      />

      {createOpen && (
        <CreateMarketForm
          params={params}
          currentBlock={currentBlock}
          onCancel={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}

      {featured && (
        <FeaturedHero
          market={featured}
          currentBlock={currentBlock}
          onTrade={(outcome) => setTradeTarget({ market: featured, outcome })}
          canTrade={!!address}
        />
      )}

      <KpiStrip
        counts={counts}
        tvlSpark={kpis.tvl}
        marketCount={markets.length}
        myPositions={positions.length}
      />

      {view === "liquidity" && (
        <CreatorResidualsSection
          createdMarkets={createdMarkets}
          withdrawableCount={withdrawableCount}
          canAct={!!address}
          onWithdraw={setWithdrawTarget}
        />
      )}

      {view !== "liquidity" && (
      <section className="sd-fut-section">
        <div className="sd-fut-section-head">
          <h3>{view === "resolution-log" ? "Resolution log" : view === "confidence" ? "Confidence votes" : "All markets"}</h3>
          <div className="head-actions">
            <div className="sd-seg" role="tablist">
              <button
                className={statusFilter === "all" ? "on" : ""}
                onClick={() => setStatusFilter("all")}
              >All</button>
              <button
                className={statusFilter === "active" ? "on" : ""}
                onClick={() => setStatusFilter("active")}
              >Active</button>
              <button
                className={statusFilter === "resolved" ? "on" : ""}
                onClick={() => setStatusFilter("resolved")}
              >Resolved</button>
              <button
                className={statusFilter === "cancelled" ? "on" : ""}
                onClick={() => setStatusFilter("cancelled")}
              >Cancelled</button>
            </div>
            <div className="sd-seg" role="tablist">
              <button
                className={kindFilter === "any" ? "on" : ""}
                onClick={() => setKindFilter("any")}
              >Any kind</button>
              <button
                className={kindFilter === "confidence" ? "on" : ""}
                onClick={() => setKindFilter("confidence")}
              >Confidence</button>
              <button
                className={kindFilter === "general" ? "on" : ""}
                onClick={() => setKindFilter("general")}
              >General</button>
            </div>
          </div>
        </div>

        <div className="sd-markets-controls">
          <div className="search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search by symbol or question…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="sd-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="ending">Sort: ending soonest</option>
            <option value="volume">Sort: highest volume</option>
            <option value="subsidy">Sort: largest subsidy</option>
            <option value="extreme">Sort: most extreme price</option>
          </select>
        </div>

        <MarketsTable
          markets={filteredMarkets}
          loading={marketsLoading}
          error={marketsError}
          currentBlock={currentBlock}
          shareBalances={shareBalances}
          canAct={!!address}
          onAct={(target) => {
            if (target.kind === "trade") setTradeTarget({ market: target.market, outcome: "yes" });
            else if (target.kind === "redeem" || target.kind === "settle") {
              setRedeemTarget({ market: target.market, yes: target.yes, no: target.no });
            }
          }}
        />
      </section>
      )}

      {/* My positions — only shown when the wallet is connected and holds
          futarchy share denoms. Liquidity view has its own dedicated section. */}
      {address && view !== "liquidity" && (
        <section className="sd-fut-section">
          <div className="sd-fut-section-head">
            <h3>My positions</h3>
            <span className="meta">
              {positions.length === 0
                ? "no outstanding shares"
                : `${positions.length} across ${positions.length} market${positions.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {positions.length === 0 ? (
            <div className="sd-positions-empty">
              You have no outstanding YES/NO shares. Open or trade a market to
              start a position — your share balances appear here as bank
              tokens with denoms like{" "}
              <span className="sd-mono">f/{`{id}`}/yes</span>.
            </div>
          ) : (
            <div className="sd-positions-grid">
              {positions.map((p) => (
                <PositionCard
                  key={p.market.index}
                  market={p.market}
                  yes={p.yes}
                  no={p.no}
                  denom={config.displayDenom}
                  onRedeem={() => setRedeemTarget({ market: p.market, yes: p.yes, no: p.no })}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="sd-fut-section">
        <div className="sd-fut-section-head">
          <h3>How pricing works</h3>
          <span className="meta">LMSR · gas-metered</span>
        </div>
        <LMSRCard params={params} />
      </section>

      {tradeTarget && (
        <TradeModal
          market={tradeTarget.market}
          initialOutcome={tradeTarget.outcome}
          params={params}
          onClose={() => setTradeTarget(null)}
          onTraded={() => {
            setTradeTarget(null);
            refresh();
          }}
          onProposeCancel={
            tradeTarget.market.status === MarketStatus.ACTIVE
              ? () => {
                  // Hand off to the cancel-proposal modal. Close trade first
                  // so we never have two modal layers stacked.
                  const m = tradeTarget.market;
                  setTradeTarget(null);
                  setCancelProposalTarget(m);
                }
              : undefined
          }
        />
      )}
      {redeemTarget && (
        <RedeemModal
          market={redeemTarget.market}
          yesShares={redeemTarget.yes}
          noShares={redeemTarget.no}
          onClose={() => setRedeemTarget(null)}
          onRedeemed={() => {
            setRedeemTarget(null);
            refresh();
          }}
        />
      )}
      {withdrawTarget && (
        <WithdrawLiquidityModal
          market={withdrawTarget}
          onClose={() => setWithdrawTarget(null)}
          onWithdrawn={() => {
            setWithdrawTarget(null);
            refresh();
          }}
        />
      )}
      {cancelProposalTarget && (
        <CancelMarketProposalModal
          market={cancelProposalTarget}
          onClose={() => setCancelProposalTarget(null)}
          onSubmitted={() => {
            setCancelProposalTarget(null);
            // The proposal is in voting; markets won't change yet, so no
            // refresh — but we don't want to leave the modal open.
          }}
        />
      )}
    </ContentPageLayout>
  );
}

// ---------- Page header (actions) ----------

function PageHead({
  onToggleCreate,
  canCreate,
  createOpen,
}: {
  onToggleCreate: () => void;
  canCreate: boolean;
  createOpen: boolean;
}) {
  if (createOpen) return null;
  return (
    <div className="sd-fut-page-head">
      <div className="actions">
        <button
          type="button"
          className="sd-btn sd-btn-primary"
          onClick={onToggleCreate}
          disabled={!canCreate}
          title={canCreate ? "MsgCreateMarket" : "Connect a wallet to create a market"}
          suppressHydrationWarning
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create market
        </button>
      </div>
    </div>
  );
}

// ---------- Featured hero ----------

function FeaturedHero({
  market,
  currentBlock,
  onTrade,
  canTrade,
}: {
  market: Market;
  currentBlock: bigint | null;
  onTrade: (outcome: "yes" | "no") => void;
  canTrade: boolean;
}) {
  const { config } = useChainConfig();
  const yesProb = lmsrYesProb(market);
  const noProb = 1 - yesProb;
  const isActive = market.status === MarketStatus.ACTIVE;
  const isConf = isConfidenceMarket(market);
  const ends = formatBlocksTo(market.end_block, currentBlock);
  const liq = formatDream(remainingLiquidity(market));

  // Confidence-vote markets get an effect strip showing what each outcome
  // does to council tenure. The numbers come from x/commons hooks.go:
  //   YES → +20% term (TermDuration / 5)
  //   NO  → −50% term (TermDuration / 2)
  //   INVALID → no change
  return (
    <div className="sd-fut-hero">
      <div className="sd-fut-hero-grid">
        <div className="sd-fut-hero-l">
          <div className="ribbon">
            {isConf ? "Confidence vote · live" : isActive ? "Live market" : MARKET_STATUS_LABELS[market.status] || market.status}
            <span className="market-id">
              #{market.index} · {market.symbol || `MARKET-${market.index}`}
            </span>
          </div>
          <h2>{market.question || "Untitled market"}</h2>
          <p className="subtitle">
            {isConf
              ? "Triggered by x/commons. Resolution drives elastic tenure: YES extends the council's term by +20%, NO shortens by −50%, invalid leaves tenure unchanged."
              : "LMSR automated market maker — buying YES or NO shares moves the implied probability. Resolves deterministically at end_block by comparing YES vs NO pool sizes."}
          </p>

          <div className="meta-row">
            <span className="m">Subsidy <b>{liq} {config.displayDenom}</b></span>
            <span className="m">b-value <b>{formatDecPlain(market.b_value)}</b></span>
            <span className="m">Min tick <b>{market.min_tick} {config.denom}</b></span>
            <span className="m">
              Ends <b className={ends.urgent ? "urgent" : ""}>{ends.label}</b>
            </span>
            <span className="m">Status <b>{MARKET_STATUS_LABELS[market.status] || market.status}</b></span>
          </div>

          {isConf && (
            <div className="sd-fut-hero-effects">
              <div className="effect yes">
                <span className="lab">If YES resolves</span>
                <span className="val">+20% term</span>
              </div>
              <div className="effect no">
                <span className="lab">If NO resolves</span>
                <span className="val">−50% term</span>
              </div>
              <div className="effect inv">
                <span className="lab">If invalid</span>
                <span className="val">No change</span>
              </div>
            </div>
          )}
        </div>

        <div className="sd-fut-hero-r">
          <div className="sd-prob-display">
            <div className="heads">
              <div className="yes-prob">
                {Math.round(yesProb * 100)}<span className="pct">%</span>
              </div>
              <div className="no-prob">
                <b>{Math.round(noProb * 100)}%</b>
                <span>NO</span>
              </div>
            </div>
            <div className="split">
              <div className="y" style={{ width: `${(yesProb * 100).toFixed(2)}%` }} />
              <div className="n" />
            </div>
            <div className="ticks">
              <span>YES · {yesProb.toFixed(2)}</span>
              <span>NO · {noProb.toFixed(2)}</span>
            </div>
            <div className="pool-row">
              <div className="cell yes">
                <span className="l">YES pool</span>
                <span className="v">{formatIntCompact(market.pool_yes)}</span>
              </div>
              <div className="cell no">
                <span className="l">NO pool</span>
                <span className="v">{formatIntCompact(market.pool_no)}</span>
              </div>
            </div>
          </div>

          <div className="trade-row">
            <button
              className="sd-btn sd-btn-yes"
              disabled={!isActive || !canTrade}
              onClick={() => onTrade("yes")}
              title={!canTrade ? "Connect a wallet to trade" : !isActive ? "Market not active" : "Buy YES (MsgTrade)"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Buy YES @ {yesProb.toFixed(2)}
            </button>
            <button
              className="sd-btn sd-btn-no"
              disabled={!isActive || !canTrade}
              onClick={() => onTrade("no")}
              title={!canTrade ? "Connect a wallet to trade" : !isActive ? "Market not active" : "Buy NO (MsgTrade)"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Buy NO @ {noProb.toFixed(2)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- KPI strip ----------

function KpiStrip({
  counts,
  tvlSpark,
  marketCount,
  myPositions,
}: {
  counts: { active: number; confidence: number; resolvedYes: number; resolvedNo: number; invalid: number };
  tvlSpark: string;
  marketCount: number;
  myPositions: number;
}) {
  const { config } = useChainConfig();
  const generalActive = Math.max(0, counts.active - counts.confidence);
  return (
    <div className="sd-fut-kpi-strip">
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 3v18h18" />
          <polyline points="7 14 11 10 14 13 20 7" />
        </svg>
        <span className="label">Active markets</span>
        <span className="value">{counts.active}</span>
        <span className="delta">
          {counts.confidence} confidence · {generalActive} general
        </span>
      </div>
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
          <circle cx="17" cy="12" r="2" />
        </svg>
        <span className="label">TVL · subsidy + collateral</span>
        <span className="value">
          {formatDream(tvlSpark)}<span className="unit">{config.displayDenom}</span>
        </span>
        <span className="delta">across {marketCount} market{marketCount === 1 ? "" : "s"}</span>
      </div>
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="label">Resolution mix</span>
        <span className="value">
          {counts.resolvedYes}
          <span className="unit"> YES</span>
        </span>
        <span className="delta">
          {counts.resolvedNo} NO · {counts.invalid} invalid
        </span>
      </div>
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        <span className="label">My positions</span>
        <span className="value">{myPositions}</span>
        <span className="delta">{myPositions === 0 ? "none yet" : "tap below to redeem"}</span>
      </div>
    </div>
  );
}

// ---------- Markets table ----------

type RowActionTarget =
  | { kind: "trade"; market: Market }
  | { kind: "redeem"; market: Market; yes: string; no: string }
  | { kind: "settle"; market: Market; yes: string; no: string };

function MarketsTable({
  markets,
  loading,
  error,
  currentBlock,
  shareBalances,
  canAct,
  onAct,
}: {
  markets: Market[];
  loading: boolean;
  error: string | null;
  currentBlock: bigint | null;
  shareBalances: BankBalance[];
  canAct: boolean;
  onAct: (target: RowActionTarget) => void;
}) {
  if (loading) {
    return (
      <div className="sd-markets-table">
        <div className="row empty">Loading markets…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="sd-markets-table">
        <div className="row empty">Could not load markets: {error}</div>
      </div>
    );
  }
  if (markets.length === 0) {
    return (
      <div className="sd-markets-table">
        <div className="row empty">No markets match this filter.</div>
      </div>
    );
  }
  // Index user-held shares by market for quick lookup; non-redeem rows don't
  // need them but the redeem/settle action does.
  const sharesByMarket = new Map<string, { yes: string; no: string }>();
  for (const b of shareBalances) {
    const parsed = parseShareDenom(b.denom);
    if (!parsed) continue;
    const slot = sharesByMarket.get(parsed.marketId) || { yes: "0", no: "0" };
    if (parsed.outcome === "yes") slot.yes = b.amount;
    else slot.no = b.amount;
    sharesByMarket.set(parsed.marketId, slot);
  }
  return (
    <div className="sd-markets-table">
      <div className="row head">
        <div className="h-symbol">Symbol</div>
        <div className="h-question">Question</div>
        <div className="h-prob">YES · NO</div>
        <div className="h-liq" style={{ textAlign: "right" }}>Liquidity</div>
        <div className="h-ends" style={{ textAlign: "right" }}>Ends</div>
        <div className="h-status">Status</div>
        <div className="h-action" />
      </div>
      {markets.map((m) => {
        const legs = sharesByMarket.get(m.index) || { yes: "0", no: "0" };
        return (
          <MarketRow
            key={m.index}
            market={m}
            currentBlock={currentBlock}
            canAct={canAct}
            onAct={() => {
              const action = rowAction(m.status);
              if (action === "Trade") onAct({ kind: "trade", market: m });
              else if (action === "Redeem") onAct({ kind: "redeem", market: m, yes: legs.yes, no: legs.no });
              else onAct({ kind: "settle", market: m, yes: legs.yes, no: legs.no });
            }}
          />
        );
      })}
    </div>
  );
}

function MarketRow({
  market,
  currentBlock,
  canAct,
  onAct,
}: {
  market: Market;
  currentBlock: bigint | null;
  canAct: boolean;
  onAct: () => void;
}) {
  const { config } = useChainConfig();
  const yesProb = lmsrYesProb(market);
  const noProb = 1 - yesProb;
  const ends = formatBlocksTo(market.end_block, currentBlock);
  const liq = formatDream(remainingLiquidity(market));
  const conf = isConfidenceMarket(market);
  const action = rowAction(market.status);

  return (
    <div className="row body">
      <div className="symbol">
        {market.symbol || "—"}
        <span className={`tag ${conf ? "conf" : "gen"}`}>
          {conf ? "Confidence" : "General"}
        </span>
        <span className="id-tag">#{market.index}</span>
      </div>
      <div className="question">
        {market.question || "—"}
        <span className="by">
          by <CopyableAddress className="who" address={market.creator} prefixLen={9} suffixLen={4} />
        </span>
      </div>
      <div className="prob-cell">
        <div className="pct">
          <span className="y">{Math.round(yesProb * 100)}%</span>
          <span className="n">{Math.round(noProb * 100)}%</span>
        </div>
        <div className="mini-bar">
          <span className="y" style={{ width: `${(yesProb * 100).toFixed(2)}%` }} />
          <span className="n" />
        </div>
      </div>
      <div className="liq">
        <b>{liq}</b>
        <span className="sub">{config.displayDenom} subsidy</span>
      </div>
      <div className={`ends${ends.urgent ? " urgent" : ""}`}>
        <b>{ends.label}</b>
        <span className="sub">block {market.end_block}</span>
      </div>
      <div className="status">
        <span className={`status-pill ${statusPillClass(market.status)}`}>
          {MARKET_STATUS_LABELS[market.status] || market.status}
        </span>
      </div>
      <div className="row-action">
        <button
          type="button"
          onClick={onAct}
          disabled={!canAct}
          title={canAct ? action : "Connect a wallet"}
        >
          {action}
        </button>
      </div>
    </div>
  );
}

function rowAction(status: string): string {
  if (status === MarketStatus.ACTIVE) return "Trade";
  if (status === MarketStatus.RESOLVED_YES || status === MarketStatus.RESOLVED_NO) return "Redeem";
  return "Settle";
}

// ---------- Position card ----------

function PositionCard({
  market,
  yes,
  no,
  denom,
  onRedeem,
}: {
  market: Market;
  yes: string;
  no: string;
  denom: string;
  onRedeem: () => void;
}) {
  const status = market.status;
  const isActive = status === MarketStatus.ACTIVE;
  const winner =
    status === MarketStatus.RESOLVED_YES ? "yes" :
    status === MarketStatus.RESOLVED_NO ? "no" : null;

  // Best-effort P&L proxy: shares of the winning side pay 1:1; shares of the
  // losing side pay 0; settled-invalid pays at the snapshot price. We don't
  // track cost basis on-chain, so display the redeemable value only.
  let redeemable = BigInt(0);
  if (winner === "yes") redeemable = bigIntFromOptional(yes);
  else if (winner === "no") redeemable = bigIntFromOptional(no);
  else if (status === MarketStatus.RESOLVED_INVALID || status === MarketStatus.CANCELLED) {
    const p = parseLegacyDec(market.settlement_price_yes);
    if (p > 0 && p < 1) {
      const yesN = bigIntFromOptional(yes);
      const noN = bigIntFromOptional(no);
      redeemable = BigInt(Math.round(Number(yesN) * p)) + BigInt(Math.round(Number(noN) * (1 - p)));
    }
  }

  return (
    <div className="sd-position-card">
      <div className="ph">
        <div className="qq">
          <span className="sym">{market.symbol || `MARKET-${market.index}`} · #{market.index}</span>
          {market.question || "Untitled market"}
        </div>
        <span className={`status-pill ${statusPillClass(status)}`}>
          {MARKET_STATUS_LABELS[status] || status}
        </span>
      </div>
      <div className="legs">
        <PositionLeg outcome="yes" market={market} amount={yes} />
        <PositionLeg outcome="no" market={market} amount={no} />
      </div>
      <div className="pf">
        <div className="pl">
          <span className="lab">Status</span>
          <b>{MARKET_STATUS_LABELS[status] || status}</b>
        </div>
        {!isActive && (
          <div className="pl up">
            <span className="lab">Redeemable</span>
            <b>{formatDream(redeemable.toString())} {denom}</b>
          </div>
        )}
        <button
          className="redeem"
          onClick={onRedeem}
          disabled={isActive}
          title={isActive ? "Resolves at end_block" : "MsgRedeem"}
        >
          {isActive ? "Hold" : "Redeem"}
        </button>
      </div>
    </div>
  );
}

function PositionLeg({
  outcome,
  market,
  amount,
}: {
  outcome: "yes" | "no";
  market: Market;
  amount: string;
}) {
  const has = bigIntFromOptional(amount) > BigInt(0);
  return (
    <div className={`leg ${outcome}${has ? "" : " empty"}`}>
      <div className="l">
        <span>{outcome.toUpperCase()}</span>
        <span className="denom">f/{market.index}/{outcome}</span>
      </div>
      <div className="v">
        {has ? formatIntCompact(amount) : "—"}
        {has && <span className="denom"> shares</span>}
      </div>
    </div>
  );
}

// ---------- Creator residuals (Liquidity & residuals view) ----------

/**
 * Renders the user's created markets with their initial / withdrawn /
 * remaining liquidity and a Withdraw button when the keeper would accept a
 * MsgWithdrawLiquidity. Cancelled markets get refunded inline by the cancel
 * tx so they show as "—" with no withdraw action.
 */
function CreatorResidualsSection({
  createdMarkets,
  withdrawableCount,
  canAct,
  onWithdraw,
}: {
  createdMarkets: Market[];
  withdrawableCount: number;
  canAct: boolean;
  onWithdraw: (market: Market) => void;
}) {
  const { config } = useChainConfig();

  return (
    <section className="sd-fut-section">
      <div className="sd-fut-section-head">
        <h3>Liquidity & residuals</h3>
        <span className="meta">
          {!canAct
            ? "connect a wallet"
            : createdMarkets.length === 0
              ? "no markets created"
              : `${createdMarkets.length} created · ${withdrawableCount} withdrawable`}
        </span>
      </div>

      {!canAct && (
        <div className="sd-positions-empty">
          Connect your wallet to see markets you&apos;ve opened and withdraw the
          residual subsidy after they resolve.
        </div>
      )}

      {canAct && createdMarkets.length === 0 && (
        <div className="sd-positions-empty">
          You haven&apos;t opened any markets yet. Tap{" "}
          <span className="sd-mono">Create market</span> above to seed a new
          LMSR pool — your initial liquidity caps your maximum subsidy loss
          and the residual returns to you on resolution.
        </div>
      )}

      {canAct && createdMarkets.length > 0 && (
        <div className="sd-residuals-table">
          <div className="row head">
            <div>Market</div>
            <div style={{ textAlign: "right" }}>Initial</div>
            <div style={{ textAlign: "right" }}>Withdrawn</div>
            <div style={{ textAlign: "right" }}>Remaining</div>
            <div>Status</div>
            <div />
          </div>
          {createdMarkets.map((m) => {
            const ini = bigIntFromOptional(m.initial_liquidity);
            const wd = bigIntFromOptional(m.liquidity_withdrawn);
            const remaining = ini > wd ? ini - wd : BigInt(0);
            const eligible =
              m.status === MarketStatus.RESOLVED_YES ||
              m.status === MarketStatus.RESOLVED_NO ||
              m.status === MarketStatus.RESOLVED_INVALID;
            const canWithdraw = eligible && remaining > BigInt(0);
            const tooltip = !eligible
              ? m.status === MarketStatus.ACTIVE
                ? "Market still active"
                : m.status === MarketStatus.CANCELLED
                  ? "Cancel tx already refunded the creator"
                  : "Status not eligible"
              : remaining === BigInt(0)
                ? "Already withdrawn in full"
                : "MsgWithdrawLiquidity";
            return (
              <div key={m.index} className="row body">
                <div className="m-info">
                  <div className="sym">{m.symbol || `MARKET-${m.index}`} · #{m.index}</div>
                  <div className="q">{m.question || "Untitled market"}</div>
                </div>
                <div className="num">
                  <b>{formatDream(ini.toString())}</b>
                  <span className="sub">{config.displayDenom}</span>
                </div>
                <div className="num">
                  <b>{formatDream(wd.toString())}</b>
                  <span className="sub">{config.displayDenom}</span>
                </div>
                <div className="num">
                  <b className={remaining > BigInt(0) && eligible ? "highlight" : undefined}>
                    {formatDream(remaining.toString())}
                  </b>
                  <span className="sub">{config.displayDenom}</span>
                </div>
                <div>
                  <span className={`status-pill ${statusPillClass(m.status)}`}>
                    {MARKET_STATUS_LABELS[m.status] || m.status}
                  </span>
                </div>
                <div className="row-action">
                  <button
                    type="button"
                    onClick={() => onWithdraw(m)}
                    disabled={!canWithdraw}
                    title={tooltip}
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------- LMSR explainer ----------

function LMSRCard({ params }: { params: FutarchyParams | null }) {
  const { config } = useChainConfig();
  // Concrete params + a one-line summary stay visible; the full prose +
  // formula + footnote is hidden behind "More" since most users don't need
  // to re-read the explainer every visit.
  const [open, setOpen] = useState(false);
  return (
    <div className="sd-lmsr-card">
      <h4>Logarithmic Market Scoring Rule</h4>
      <p className={open ? "" : "clamp-2"}>
        Every market is an automated market maker — no order book, no
        counterparty matching, just two pools (yes, no) and a cost function
        that determines the price of any incremental trade.
      </p>

      {open && (
        <>
          <div className="formula">
            <span className="var">C</span>(q<sub>Y</sub>, q<sub>N</sub>) = <span className="var">b</span> · ln(<i>e</i><sup>q<sub>Y</sub>/<span className="var">b</span></sup> + <i>e</i><sup>q<sub>N</sub>/<span className="var">b</span></sup>)
            <br />
            <span className="var">p</span><sub>yes</sub> = <i>e</i><sup>q<sub>Y</sub>/<span className="var">b</span></sup> / (<i>e</i><sup>q<sub>Y</sub>/<span className="var">b</span></sup> + <i>e</i><sup>q<sub>N</sub>/<span className="var">b</span></sup>)
          </div>
          <p>
            <span className="var" style={{ color: "var(--violet-hi)" }}>b</span> is the
            liquidity parameter — derived from the creator&apos;s seed liquidity as{" "}
            <b style={{ color: "var(--ink)" }}>b = subsidy / ln(2)</b> so the maximum
            loss the creator subsidises equals their initial deposit. Bigger{" "}
            <b>b</b> ⇒ flatter price, more liquidity, larger creator subsidy.
          </p>
        </>
      )}

      {params && (
        <div className="params-grid">
          <div>
            <span className="pl">trading fee</span>
            <span className="pv">
              {(parseInt(params.trading_fee_bps, 10) / 100).toFixed(2)}%
              <span className="u">({params.trading_fee_bps} bps)</span>
            </span>
          </div>
          <div>
            <span className="pl">min liquidity</span>
            <span className="pv">{params.min_liquidity}<span className="u">{config.denom}</span></span>
          </div>
          <div>
            <span className="pl">default min tick</span>
            <span className="pv">{params.default_min_tick}<span className="u">{config.denom}</span></span>
          </div>
          <div>
            <span className="pl">max duration</span>
            <span className="pv">{formatBlockSpan(params.max_duration)}</span>
          </div>
          <div>
            <span className="pl">max redemption delay</span>
            <span className="pv">{formatBlockSpan(params.max_redemption_delay)}</span>
          </div>
          <div>
            <span className="pl">max LMSR exponent</span>
            <span className="pv">{params.max_lmsr_exponent}<span className="u">clamp</span></span>
          </div>
        </div>
      )}

      {open && (
        <p className="footnote">
          <b style={{ color: "var(--ink)" }}>Resolution is deterministic.</b>{" "}
          No oracle. At <span className="sd-mono">end_block</span>, the EndBlocker
          compares pools: more YES bought ⇒ resolves YES; more NO ⇒ resolves NO;
          tied or empty ⇒ invalid. Outstanding shares from cancelled or invalid
          markets redeem at a snapshotted LMSR-implied price so no funds are
          trapped.
        </p>
      )}

      <button
        type="button"
        className="role-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "Less ▴" : "More ▾"}
      </button>
    </div>
  );
}

// ---------- Roles strip ----------

function RolesStrip({ params }: { params: FutarchyParams | null }) {
  const { config } = useChainConfig();
  const minLiquidity = params
    ? `${formatDream(params.min_liquidity)} ${config.displayDenom}`
    : "—";
  const maxDuration = params ? humanizeBlocks(BigInt(params.max_duration)) : "—";
  const minTick = params
    ? `${parseInt(params.default_min_tick, 10).toLocaleString()} ${config.denom}`
    : "—";
  const tradingFee = params
    ? `${(parseInt(params.trading_fee_bps, 10) / 100).toFixed(2)}%`
    : "—";
  return (
    <div className="sd-fut-roles">
      <RoleCard
        label="Member ESTABLISHED+"
        title="Open a market"
        body={
          <>
            Stake the chain denom as initial liquidity. Your stake sets{" "}
            <b style={{ color: "var(--ink)" }}>b</b> and bounds your maximum
            subsidy loss; the residual returns to you on resolution via
            WithdrawLiquidity.
          </>
        }
        reqs={[
          <>min <b>{minLiquidity}</b></>,
          <>duration ≤ <b>{maxDuration}</b></>,
        ]}
      />
      <RoleCard
        label="Any Member"
        title="Trade a market"
        body={
          <>
            Buy YES or NO shares against any active market. Resolution pays
            winning shares 1:1 in the market denom. Tied / cancelled markets
            settle at the snapshot price recorded by the keeper.
          </>
        }
        reqs={[
          <>min <b>{minTick}</b>/trade</>,
          <>fee <b>{tradingFee}</b></>,
        ]}
      />
      <RoleCard
        label="Operations Committee"
        title="Tune the module"
        body={
          <>
            The Commons Operations Committee can update the operational subset
            — <b style={{ color: "var(--ink)" }}>trading_fee_bps</b>,
            max_duration, max_redemption_delay — without full governance.
            Pricing-critical params still require{" "}
            <span className="sd-mono">MsgUpdateParams</span>.
          </>
        }
        reqs={[
          <>commons authority</>,
          <>two-tier auth</>,
        ]}
      />
    </div>
  );
}

// ---------- Sidebar bits ----------

function SidebarItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`sd-side-item${active ? " active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "amber" }) {
  const style: React.CSSProperties = {
    marginLeft: "auto",
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: 10,
    background: "var(--panel-2)",
    border: "1px solid var(--rule)",
    padding: "1px 6px",
    borderRadius: 999,
    color: tone === "amber" ? "var(--amber)" : "var(--ink-mute)",
  };
  return <span style={style}>{children}</span>;
}

function Glyph({
  name,
}: {
  name: "markets" | "layers" | "user" | "clock" | "liquidity";
}) {
  const props = {
    className: "ic",
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
  } as const;
  if (name === "markets") {
    return (
      <svg {...props}>
        <path d="M3 3v18h18" />
        <polyline points="7 14 11 10 14 13 20 7" />
      </svg>
    );
  }
  if (name === "layers") {
    return (
      <svg {...props}>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    );
  }
  if (name === "user") {
    return (
      <svg {...props}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M12 1v22M5 8h14M5 16h14" />
    </svg>
  );
}

function StatusLegendItem({
  dot,
  label,
  count,
}: {
  dot: "amber" | "green" | "rose" | "mute";
  label: string;
  count: number;
}) {
  const color =
    dot === "amber" ? "var(--amber)" :
    dot === "green" ? "var(--green)" :
    dot === "rose"  ? "var(--rose)"  : "var(--ink-mute)";
  return (
    <div className="sd-side-item" style={{ cursor: "default" }}>
      <span
        className="ic"
        aria-hidden="true"
        style={{
          background: color,
          width: 8,
          height: 8,
          borderRadius: 999,
          margin: "0 4px",
          flex: "none",
        }}
      />
      {label}
      <Badge>{count}</Badge>
    </div>
  );
}

function ParamList({ params }: { params: FutarchyParams }) {
  const { config } = useChainConfig();
  const rows = useMemo<[string, string][]>(
    () => [
      ["Trading fee", `${(parseInt(params.trading_fee_bps, 10) / 100).toFixed(2)}% (${params.trading_fee_bps} bps)`],
      ["Min liquidity", `${params.min_liquidity} ${config.denom}`],
      ["Default min tick", `${params.default_min_tick} ${config.denom}`],
      ["Max duration", formatBlockSpan(params.max_duration)],
      ["Max redemption delay", formatBlockSpan(params.max_redemption_delay)],
      ["Max LMSR exponent", params.max_lmsr_exponent],
    ],
    [params, config.denom]
  );
  return (
    <div className="space-y-1 px-2 py-1 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <span className="text-zinc-500">{k}</span>
          <span className="text-zinc-300 text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Helpers ----------

function bigIntFromOptional(s: string | undefined | null): bigint {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

// remaining = initial − withdrawn (floored at 0)
function remainingLiquidity(m: Market): string {
  const ini = bigIntFromOptional(m.initial_liquidity);
  const wd = bigIntFromOptional(m.liquidity_withdrawn);
  const r = ini > wd ? ini - wd : BigInt(0);
  return r.toString();
}

function parseLegacyDec(s: string | undefined | null): number {
  if (!s) return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Compute current YES probability from the LMSR pools and b. Numerically
// stable form: p_yes = 1 / (1 + exp((q_no - q_yes)/b)).
function lmsrYesProb(m: Market): number {
  if (m.settlement_price_yes && m.settlement_price_yes !== "0") {
    const p = parseLegacyDec(m.settlement_price_yes);
    if (p > 0 && p < 1) return p;
  }
  if (m.status === MarketStatus.RESOLVED_YES) return 1;
  if (m.status === MarketStatus.RESOLVED_NO) return 0;

  const b = parseLegacyDec(m.b_value);
  if (b <= 0) return 0.5;

  const qYes = Number(bigIntFromOptional(m.pool_yes));
  const qNo = Number(bigIntFromOptional(m.pool_no));
  if (!isFinite(qYes) || !isFinite(qNo)) return 0.5;

  const diff = (qNo - qYes) / b;
  const clamped = Math.max(-50, Math.min(50, diff));
  return 1 / (1 + Math.exp(clamped));
}

function formatDecPlain(s: string | undefined | null): string {
  if (!s) return "—";
  const n = parseLegacyDec(s);
  if (!isFinite(n)) return s;
  if (n >= 1000) return Math.round(n).toLocaleString();
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function formatIntCompact(s: string | undefined | null): string {
  if (!s || s === "0") return "0";
  let n: bigint;
  try {
    n = BigInt(s);
  } catch {
    return s;
  }
  if (n < BigInt(1_000_000)) return n.toLocaleString();
  const million = BigInt(1_000_000);
  const billion = BigInt(1_000_000_000);
  if (n < billion) return `${(Number(n) / Number(million)).toFixed(2)}M`;
  return `${(Number(n) / Number(billion)).toFixed(2)}B`;
}

function formatBlocksTo(
  endBlockStr: string | undefined | null,
  currentBlock: bigint | null
): { label: string; urgent: boolean } {
  if (!endBlockStr || endBlockStr === "0") return { label: "—", urgent: false };
  let end: bigint;
  try {
    end = BigInt(endBlockStr);
  } catch {
    return { label: endBlockStr, urgent: false };
  }
  if (currentBlock === null) {
    return { label: `block ${endBlockStr}`, urgent: false };
  }
  if (end <= currentBlock) {
    const diff = currentBlock - end;
    if (diff === BigInt(0)) return { label: "now", urgent: false };
    return { label: humanizeBlocks(diff) + " ago", urgent: false };
  }
  const remaining = end - currentBlock;
  const seconds = Number(remaining) * APPROX_BLOCK_TIME_S;
  const urgent = seconds <= 60 * 60 * 24;
  return { label: "in " + humanizeBlocks(remaining), urgent };
}

function humanizeBlocks(blocks: bigint): string {
  const seconds = Number(blocks) * APPROX_BLOCK_TIME_S;
  if (!isFinite(seconds)) return `${blocks.toString()} blocks`;
  const min = 60;
  const hour = 60 * min;
  const day = 24 * hour;
  if (seconds < hour) return `${Math.max(1, Math.round(seconds / min))}m`;
  if (seconds < day) {
    const h = Math.floor(seconds / hour);
    const m = Math.floor((seconds % hour) / min);
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  }
  const d = Math.floor(seconds / day);
  const h = Math.floor((seconds % day) / hour);
  return `${d}d ${h.toString().padStart(2, "0")}h`;
}

function formatBlockSpan(blocksStr: string | undefined | null): string {
  if (!blocksStr) return "—";
  let n: bigint;
  try {
    n = BigInt(blocksStr);
  } catch {
    return blocksStr;
  }
  return `${n.toLocaleString()} blocks · ~${humanizeBlocks(n)}`;
}

function statusPillClass(status: string): string {
  if (status === MarketStatus.ACTIVE) return "active";
  if (status === MarketStatus.RESOLVED_YES) return "resolved-y";
  if (status === MarketStatus.RESOLVED_NO) return "resolved-n";
  if (status === MarketStatus.RESOLVED_INVALID) return "invalid";
  if (status === MarketStatus.CANCELLED) return "cancelled";
  return "invalid";
}

// Share denoms minted by x/futarchy follow `f/{marketId}/{outcome}`. See
// keeper/msg_server_trade.go.
function parseShareDenom(denom: string): { marketId: string; outcome: "yes" | "no" } | null {
  if (!denom.startsWith("f/")) return null;
  const parts = denom.split("/");
  if (parts.length !== 3) return null;
  const [, marketId, outcome] = parts;
  if (outcome !== "yes" && outcome !== "no") return null;
  if (!/^\d+$/.test(marketId)) return null;
  return { marketId, outcome };
}

// ───────────────────────── Demo data ─────────────────────────

// Synthetic "current block" used to render meaningful countdowns ("ends in
// 2d 14h") on demo markets when the chain RPC is unreachable.
const DEMO_NOW_BLOCK = BigInt(1_302_000);

// Pool sizes here are picked to make lmsrYesProb produce the labelled YES%
// at b_value = 1000:  prob = 1 / (1 + e^((qNo - qYes)/b))
// 68% → qY-qN ≈ 754 ; 41% → qY-qN ≈ -364 ; 82% → qY-qN ≈ 1516 ; 23% → qY-qN ≈ -1207
const DEMO_MARKETS: Market[] = [
  makeMarket({
    index: "1248",
    symbol: "CONF-Commons-1248k",
    question: "Should the Commons Council retain the public's confidence at block 1,248,000?",
    creator: "sprkdrm1commonscouncil00000000000000000000",
    poolYes: "1500", poolNo: "746", b: "1000",
    initialLiquidity: "1000000000", liquidityWithdrawn: "0",
    endBlock: "1324800", // ~2d 14h after DEMO_NOW
    status: MarketStatus.ACTIVE,
  }),
  makeMarket({
    index: "1305",
    symbol: "REVEAL-R4-SHIP",
    question: "Will Reveal round 4 ship a passing tranche before block 1,375,200?",
    creator: "sprkdrm1nightingale00000000000000000000000",
    poolYes: "500", poolNo: "864", b: "1000",
    initialLiquidity: "500000000", liquidityWithdrawn: "0",
    endBlock: "1375200", // ~5d 02h
    status: MarketStatus.ACTIVE,
  }),
  makeMarket({
    index: "1289",
    symbol: "FED-NIGHT-PASS",
    question: "Will the council approve federation peer nightingale-1 by block 1,500,000?",
    creator: "sprkdrm1ymoderator0000000000000000000000000",
    poolYes: "2000", poolNo: "484", b: "1000",
    initialLiquidity: "250000000", liquidityWithdrawn: "0",
    endBlock: "1500000", // ~13d 18h
    status: MarketStatus.ACTIVE,
  }),
  makeMarket({
    index: "1276",
    symbol: "SEASON-5-LAUNCH",
    question: "Will Season 5 commitments exceed 50,000 SPARK before block 1,434,000?",
    creator: "sprkdrm1seasonjudge000000000000000000000000",
    poolYes: "500", poolNo: "1707", b: "1000",
    initialLiquidity: "800000000", liquidityWithdrawn: "0",
    endBlock: "1434000", // ~9d 04h
    status: MarketStatus.ACTIVE,
  }),
  makeMarket({
    index: "1180",
    symbol: "CONF-Ops-1180k",
    question: "Should the Operations Committee retain its mandate at block 1,180,000?",
    creator: "sprkdrm1commonscouncil00000000000000000000",
    poolYes: "4100", poolNo: "0", b: "1000",
    initialLiquidity: "1000000000", liquidityWithdrawn: "0",
    endBlock: "1180000",
    status: MarketStatus.RESOLVED_YES,
  }),
  makeMarket({
    index: "1219",
    symbol: "SLASH-POLICY-V2",
    question: "Will the proposed slashing-policy v2 hard-fork pass governance?",
    creator: "sprkdrm1policydraft0000000000000000000000",
    poolYes: "200", poolNo: "1400", b: "1000",
    initialLiquidity: "320000000", liquidityWithdrawn: "0",
    endBlock: "1272400",
    status: MarketStatus.RESOLVED_NO,
    settlementPriceYes: "0.120000000000000000",
  }),
  makeMarket({
    index: "1156",
    symbol: "BRIDGE-MASTODON",
    question: "Will mastodon.social bridge submit ≥ 100 verified posts in epoch 14?",
    creator: "sprkdrm1bridgeops00000000000000000000000",
    poolYes: "92", poolNo: "92", b: "1000",
    initialLiquidity: "200000000", liquidityWithdrawn: "0",
    endBlock: "1228500",
    status: MarketStatus.RESOLVED_INVALID,
    settlementPriceYes: "0.500000000000000000",
  }),
];

function makeMarket(p: {
  index: string;
  symbol: string;
  question: string;
  creator: string;
  poolYes: string;
  poolNo: string;
  b: string;
  initialLiquidity: string;
  liquidityWithdrawn: string;
  endBlock: string;
  status: string;
  settlementPriceYes?: string;
}): Market {
  return {
    index: p.index,
    creator: p.creator,
    symbol: p.symbol,
    question: p.question,
    denom: "uspark",
    min_tick: "1000",
    end_block: p.endBlock,
    redemption_blocks: "0",
    resolution_height: p.status === MarketStatus.ACTIVE ? "0" : p.endBlock,
    status: p.status,
    b_value: p.b,
    pool_yes: p.poolYes,
    pool_no: p.poolNo,
    initial_liquidity: p.initialLiquidity,
    liquidity_withdrawn: p.liquidityWithdrawn,
    settlement_price_yes: p.settlementPriceYes ?? "",
  };
}
