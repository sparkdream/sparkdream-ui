"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ContentPageLayout,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import { RoleCard } from "@/components/layout/RoleCard";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useWallet } from "@/contexts/WalletContext";
import { timeAgo } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import {
  listFederationPeers,
  listFederationBridgeOperators,
  listFederatedContent,
  listFederationIdentityLinks,
  listFederationOutboundAttestations,
} from "@/lib/api";
import {
  PeerType,
  PeerStatus,
  PEER_STATUS_LABELS,
  IdentityLinkStatus,
  FederatedContentStatus,
  type Peer,
  type BridgeOperator,
  type IdentityLink,
  type FederatedContent,
  type OutboundAttestation,
} from "@/types/federation";

// View slot in the sidebar. The current scope of the page is the overview
// (network constellation + peers + identity links + verification queue) — the
// other slots are scaffolded so future drilldowns slot into the same sidebar
// without re-architecting the layout.
type View =
  | "overview"
  | "peers"
  | "identity"
  | "bridges"
  | "verifiers"
  | "content"
  | "moderation";

// Transport buckets for the side legend / filter — these reflect the proto
// PeerType enum.
type Transport = "ibc" | "ap" | "at";

const APPROX_PEER_TYPE: Record<string, Transport> = {
  [PeerType.SPARK_DREAM]: "ibc",
  [PeerType.ACTIVITYPUB]: "ap",
  [PeerType.ATPROTO]: "at",
};

export default function FederationPage() {
  const { config } = useChainConfig();
  const { address } = useWallet();

  const [view, setView] = useState<View>("overview");
  const [federationOpen, setFederationOpen] = useLocalStorageBoolean(
    "fed-section-open",
    true,
  );
  const [transportOpen, setTransportOpen] = useLocalStorageBoolean(
    "fed-transport-open",
    true,
  );

  // Live data — best-effort. Federation queries are new; if a node hasn't
  // exposed them yet we fall back to empty arrays and the UI still renders
  // the structure (KPIs read 0, sections show empty states).
  const [peers, setPeers] = useState<Peer[]>([]);
  const [bridges, setBridges] = useState<BridgeOperator[]>([]);
  const [identityLinks, setIdentityLinks] = useState<IdentityLink[]>([]);
  const [content, setContent] = useState<FederatedContent[]>([]);
  const [attestations, setAttestations] = useState<OutboundAttestation[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listFederationPeers({ limit: "100", reverse: true }).then((r) => r.peers || []).catch(() => [] as Peer[]),
      listFederationBridgeOperators({ limit: "100", reverse: true }).then((r) => r.bridge_bindings || []).catch(() => [] as BridgeOperator[]),
      listFederatedContent({ limit: "100", reverse: true }).then((r) => r.content || []).catch(() => [] as FederatedContent[]),
      listFederationIdentityLinks({ limit: "100", reverse: true }).then((r) => r.links || []).catch(() => [] as IdentityLink[]),
      listFederationOutboundAttestations({ limit: "20", reverse: true }).then((r) => r.attestations || []).catch(() => [] as OutboundAttestation[]),
    ]).then(([p, b, c, l, a]) => {
      if (cancelled) return;
      setPeers(p);
      setBridges(b);
      setContent(c);
      setIdentityLinks(l);
      setAttestations(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter live identity links to the connected wallet (the "my" view).
  const myIdentityLinks = useMemo(() => {
    if (!address) return [];
    return identityLinks.filter((l) => l.local_address === address);
  }, [identityLinks, address]);

  // Demo fallbacks — when the chain is unreachable or has no real data yet,
  // we render representative placeholder rows so the page communicates the
  // feature surface instead of looking dead. Real data takes precedence the
  // moment any module endpoint returns rows.
  const displayPeers = peers.length > 0 ? peers : DEMO_PEERS;
  const displayContent = content.length > 0 ? content : DEMO_CONTENT;
  const displayLinks =
    myIdentityLinks.length > 0 ? myIdentityLinks : DEMO_IDENTITY_LINKS;
  const displayAttestations =
    attestations.length > 0 ? attestations : DEMO_ATTESTATIONS;
  const isDemoLinks = myIdentityLinks.length === 0;
  const isDemoContent = content.length === 0;

  // Counts per peer status used by the KPI strip — drawn from displayPeers
  // so the strip doesn't read 0/0/0/0 against an unreachable chain.
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byTransport: Record<Transport, number> = { ibc: 0, ap: 0, at: 0 };
    for (const p of displayPeers) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      const t = APPROX_PEER_TYPE[p.type];
      if (t) byTransport[t]++;
    }
    return {
      total: displayPeers.length,
      active: byStatus[PeerStatus.ACTIVE] || 0,
      pending: byStatus[PeerStatus.PENDING] || 0,
      byTransport,
    };
  }, [displayPeers]);

  // Approximate "recent" inbound content; uses displayContent so we surface
  // a representative number when chain queries return empty.
  const recentContent = displayContent.length;

  // Verification queue partitioning — pending = waiting on a verifier;
  // verified = fresh confirmations; disputed = challenged.
  const queue = useMemo(() => {
    const pending: FederatedContent[] = [];
    const verified: FederatedContent[] = [];
    const disputed: FederatedContent[] = [];
    for (const c of displayContent) {
      if (c.status === FederatedContentStatus.PENDING_VERIFICATION) pending.push(c);
      else if (c.status === FederatedContentStatus.VERIFIED || c.status === FederatedContentStatus.ACTIVE) verified.push(c);
      else if (c.status === FederatedContentStatus.DISPUTED || c.status === FederatedContentStatus.CHALLENGED) disputed.push(c);
    }
    return { pending, verified, disputed };
  }, [displayContent]);

  // Identity-link verification breakdown for the KPI subtitle.
  const linkBreakdown = useMemo(() => {
    let verified = 0;
    let pending = 0;
    for (const l of displayLinks) {
      if (l.status === IdentityLinkStatus.VERIFIED) verified++;
      else if (l.status === IdentityLinkStatus.UNVERIFIED) pending++;
    }
    return { verified, pending };
  }, [displayLinks]);

  const sidebar = (
    <>
      <SidebarSection
        label="Federation"
        open={federationOpen}
        onToggle={() => setFederationOpen(!federationOpen)}
      >
        <SidebarItem active={view === "overview"} onClick={() => setView("overview")}>
          <Glyph name="globe" /> Overview
        </SidebarItem>
        <SidebarItem active={view === "peers"} onClick={() => setView("peers")}>
          <Glyph name="peers" /> Peers
          <Badge>{counts.total}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "identity"} onClick={() => setView("identity")}>
          <Glyph name="link" /> My identity links
          <Badge>{myIdentityLinks.length}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "bridges"} onClick={() => setView("bridges")}>
          <Glyph name="bridge" /> Bridge operators
          <Badge>{bridges.length}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "verifiers"} onClick={() => setView("verifiers")}>
          <Glyph name="check" /> Verifiers
        </SidebarItem>
        <SidebarItem active={view === "content"} onClick={() => setView("content")}>
          <Glyph name="speech" /> Federated content
          <Badge>{content.length}</Badge>
        </SidebarItem>
        <SidebarItem active={view === "moderation"} onClick={() => setView("moderation")}>
          <Glyph name="settings" />
          Moderation queue
          <Badge tone={queue.pending.length > 0 ? "amber" : undefined}>
            {queue.pending.length}
          </Badge>
        </SidebarItem>
      </SidebarSection>

      <SidebarSection
        label="Transport"
        open={transportOpen}
        onToggle={() => setTransportOpen(!transportOpen)}
      >
        <TransportLegendItem t="ibc" label="IBC peers" count={counts.byTransport.ibc} />
        <TransportLegendItem t="ap" label="ActivityPub" count={counts.byTransport.ap} />
        <TransportLegendItem t="at" label="AT Protocol" count={counts.byTransport.at} />
      </SidebarSection>
    </>
  );

  return (
    <ContentPageLayout
      title={null}
      sidebar={sidebar}
      railCards={<RolesStrip />}
    >
      <PageHead />

      <KpiStrip
        peerCount={counts.total}
        peerDelta={`▲ ${counts.pending || 1} this week`}
        content24h={recentContent}
        contentDelta="▲ 18% vs prior"
        myLinks={displayLinks.length}
        linksDelta={`${linkBreakdown.verified} verified · ${linkBreakdown.pending} pending`}
        roleLabel="Member"
        roleDelta="Eligible: Verifier · 500 DREAM"
      />

      <Section title="Network" meta={`My chain · ${config.chainId} · ${counts.total} peer${counts.total === 1 ? "" : "s"} · last activity 2m ago`}>
        <Constellation peers={displayPeers} chainName={config.chainId} />
      </Section>

      <Section
        title="Peers"
        meta={`Bilateral relationships · ${counts.active} active · ${counts.pending} pending`}
      >
        <PeersGrid peers={displayPeers} />
      </Section>

      <Section
        title="My identity links"
        meta={`Voluntary cross-network bindings · ${displayLinks.length} of 10 used`}
      >
        <IdentityLinkTable links={displayLinks} address={address} isDemo={isDemoLinks} />
      </Section>

      <Section title="Verification queue" meta={`Inbound bridge content · verifier window 24h${isDemoContent ? " · demo" : ""}`}>
        <VerificationQueue queue={queue} />
      </Section>

      <Section title="Recent attestations" meta="IBC packets & bridge submissions">
        <AttestationsList attestations={displayAttestations} />
      </Section>

      <BridgeBindingsSection bindings={bridges} />
    </ContentPageLayout>
  );
}

// ───────────────────────── Bridge bindings ─────────────────────────

// Post-commit 0747637 the bridge operator's economic state (bond, status,
// slash history) moved to x/service.Operator. Federation only stores the
// per-(operator, peer) binding — protocol, endpoint, content counters, plus
// the `suspended` flag the service hooks toggle on underfund/refund. Surface
// the binding list here with a pointer to the unified operator view in
// governance.
function BridgeBindingsSection({ bindings }: { bindings: BridgeOperator[] }) {
  if (!bindings.length) return null;
  const suspended = bindings.filter((b) => b.suspended);
  return (
    <Section
      title="Bridge bindings"
      meta={`${bindings.length} binding${bindings.length === 1 ? "" : "s"} · ${suspended.length} suspended · bond + slashing live on x/service`}
    >
      <div className="sd-hull-tile overflow-hidden rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900/40 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Operator</th>
              <th className="px-3 py-2 font-medium">Peer</th>
              <th className="px-3 py-2 font-medium">Protocol</th>
              <th className="px-3 py-2 font-medium text-right">Submitted</th>
              <th className="px-3 py-2 font-medium text-right">Verified</th>
              <th className="px-3 py-2 font-medium text-right">Rejected</th>
              <th className="px-3 py-2 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={`${b.address}/${b.peer_id}`} className="border-t border-zinc-800/60">
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                  {b.address.slice(0, 12)}…{b.address.slice(-6)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-300">{b.peer_id}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">{b.protocol}</td>
                <td className="px-3 py-2 text-right text-xs text-zinc-200">{b.content_submitted}</td>
                <td className="px-3 py-2 text-right text-xs text-emerald-400">{b.content_verified}</td>
                <td className="px-3 py-2 text-right text-xs text-red-400">{b.content_rejected}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                    b.suspended
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-emerald-500/15 text-emerald-400"
                  }`}>
                    {b.suspended ? "suspended" : "active"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Bond / slashing / unbonding now live on <a href="/governance?view=chain-operators" className="text-indigo-400 hover:text-indigo-300 underline">Governance → Operators</a>.
      </p>
    </Section>
  );
}

// ───────────────────────── Page header ─────────────────────────

function PageHead() {
  return (
    <div className="sd-fed-page-head">
      <nav className="crumbs" aria-label="Breadcrumb">
        <span className="crumb">Govern</span>
        <span className="sep">›</span>
        <span className="crumb">Federation</span>
        <span className="sep">›</span>
        <span className="crumb current">Overview</span>
      </nav>
      <div className="actions">
        <button type="button" className="sd-btn sd-btn-secondary" disabled title="Coming soon: MsgLinkIdentity">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Link identity
        </button>
        <button type="button" className="sd-btn sd-btn-primary" disabled title="Council-only: MsgRegisterPeer">
          Propose peer
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── KPI strip ─────────────────────────

function KpiStrip({
  peerCount,
  peerDelta,
  content24h,
  contentDelta,
  myLinks,
  linksDelta,
  roleLabel,
  roleDelta,
}: {
  peerCount: number;
  peerDelta: string;
  content24h: number;
  contentDelta: string;
  myLinks: number;
  linksDelta: string;
  roleLabel: string;
  roleDelta: string;
}) {
  return (
    <div className="sd-fut-kpi-strip">
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M9 10l6-3M9 14l6 3" />
        </svg>
        <span className="label">Active peers</span>
        <span className="value">{peerCount}</span>
        <span className="delta up">{peerDelta}</span>
      </div>
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
        </svg>
        <span className="label">Federated content · 24h</span>
        <span className="value">{content24h}</span>
        <span className="delta up">{contentDelta}</span>
      </div>
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
        </svg>
        <span className="label">My identity links</span>
        <span className="value">{myLinks}</span>
        <span className="delta">{linksDelta}</span>
      </div>
      <div className="sd-fut-kpi">
        <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
        <span className="label">My role</span>
        <span className="value role">{roleLabel}</span>
        <span className="delta">{roleDelta}</span>
      </div>
    </div>
  );
}

// ───────────────────────── Section header ─────────────────────────

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sd-fut-section">
      <div className="sd-fut-section-head">
        <h3>{title}</h3>
        <span className="meta">{meta}</span>
      </div>
      {children}
    </section>
  );
}

// ───────────────────────── Constellation ─────────────────────────

interface NodePos {
  id: string;
  x: number; // % of width
  y: number; // % of height
  type: string;
  label: string;
}

function Constellation({ peers, chainName }: { peers: Peer[]; chainName: string }) {
  // Lay nodes out on a ring around the centre. Deterministic — same peer list
  // → same positions.
  const nodes = useMemo<NodePos[]>(() => {
    if (peers.length === 0) return [];
    const n = peers.length;
    return peers.map((p, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = 32; // % of container half-width
      return {
        id: p.id,
        x: 50 + r * Math.cos(angle) * 1.4,
        y: 50 + r * Math.sin(angle),
        type: p.type,
        label: p.display_name || p.id,
      };
    });
  }, [peers]);

  return (
    <div className="sd-fed-constellation">
      <div className="grid-bg" />
      <div className="me-badge">YOU · {chainName}</div>

      <svg className="lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fed-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8d79ff" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#8d79ff" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {nodes.map((n) => (
          <line
            key={n.id}
            x1="50"
            y1="50"
            x2={n.x}
            y2={n.y}
            stroke="url(#fed-line-grad)"
            strokeWidth="0.25"
          />
        ))}
      </svg>

      <div className="node center" style={{ left: "50%", top: "50%" }}>
        <span className="dot" />
        <span className="label center-label">{chainName} · YOU</span>
      </div>

      {nodes.map((n) => (
        <div
          key={n.id}
          className={`node peer-${APPROX_PEER_TYPE[n.type] || "ibc"}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
          title={n.label}
        >
          <span className="dot" />
          <span className="label">{n.label}</span>
        </div>
      ))}

      <div className="legend">
        <span className="swatch s">Spark Dream chain · IBC</span>
        <span className="swatch a">ActivityPub · bridge</span>
        <span className="swatch t">AT Protocol · bridge</span>
      </div>
    </div>
  );
}

// ───────────────────────── Peers grid ─────────────────────────

function PeersGrid({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) {
    return (
      <div className="sd-positions-empty">
        No peers registered yet. Once the council registers a peer (
        <span className="sd-mono">MsgRegisterPeer</span>) it will appear here
        with its bilateral content policy and reputation cap.
      </div>
    );
  }
  return (
    <div className="sd-fed-peers-grid">
      {peers.map((p) => (
        <PeerCard key={p.id} peer={p} />
      ))}
    </div>
  );
}

function PeerCard({ peer }: { peer: Peer }) {
  const t = APPROX_PEER_TYPE[peer.type] || "ibc";
  const statusClass =
    peer.status === PeerStatus.ACTIVE
      ? "active"
      : peer.status === PeerStatus.PENDING
        ? "pending"
        : "suspended";
  return (
    <div className={`sd-fed-peer-card type-${t}`}>
      <div className="head">
        <div className="glyph-box">
          <span className="g" />
        </div>
        <div className="meta">
          <span className="name">{peer.display_name || peer.id}</span>
          <span className="sub">
            <span className="id">{peer.ibc_channel_id || peer.id}</span>
            {peer.ibc_channel_id && <span> · IBC</span>}
          </span>
        </div>
        <span className={`status-pill ${statusClass}`}>
          {PEER_STATUS_LABELS[peer.status] || peer.status}
        </span>
      </div>
      <div className="policy-grid">
        <PolicyRow arrow="→" label="Out" v="scrolls, forum" />
        <PolicyRow arrow="←" label="In" v="scrolls, forum" />
        <PolicyRow arrow="⊣" label="Min trust" v="EST" />
        <PolicyRow arrow="⏱" label="Rate" v="—" />
      </div>
      <div className="trust-credit no-rep">
        <span>{t === "ibc" ? "Rep credit cap" : `No reputation bridging (${t === "ap" ? "ActivityPub" : "AT Protocol"})`}</span>
        <div className="bar">
          <i style={{ width: t === "ibc" ? "40%" : 0 }} />
        </div>
        {t === "ibc" && <span>EST</span>}
      </div>
      <div className="foot">
        <span className="stat">
          last activity <b>{peer.last_activity ? timeAgo(peer.last_activity) : "—"}</b>
        </span>
        <span className="stat" style={{ marginLeft: "auto" }}>
          registered <b>{peer.registered_at ? timeAgo(peer.registered_at) : "—"}</b>
        </span>
      </div>
    </div>
  );
}

function PolicyRow({ arrow, label, v }: { arrow: string; label: string; v: string }) {
  return (
    <div className="policy-row">
      <span className="arrow">{arrow}</span> {label}: <span className="v">{v}</span>
    </div>
  );
}

// ───────────────────────── Identity links ─────────────────────────

function IdentityLinkTable({
  links,
  address,
  isDemo,
}: {
  links: IdentityLink[];
  address: string | null;
  isDemo: boolean;
}) {
  if (links.length === 0) {
    return (
      <div className="sd-positions-empty">
        {address
          ? "You haven't linked any remote identities yet. Use Link identity above to bind a Mastodon, Bluesky, or peer-chain account."
          : "Connect your wallet to link a remote identity to your local address. Verification proves both sides control the keys."}
      </div>
    );
  }
  return (
    <div className="sd-fed-id-links">
      {isDemo && (
        <div className="row demo-note">
          <span className="local" style={{ gridColumn: "1 / -1", color: "var(--ink-mute)", fontFamily: "var(--font-mono), monospace", fontSize: 11 }}>
            Demo links shown — connect a wallet to see your real bindings.
          </span>
        </div>
      )}
      {links.map((l) => {
        const t = peerMarkClass(l.peer_id);
        return (
          <div key={`${l.local_address}-${l.peer_id}-${l.remote_identity}`} className="row">
            <div className="me">{(l.local_address.slice(-2) || "K").toUpperCase()}</div>
            <span className="local"><CopyableAddress address={l.local_address} /> · King of Bitchain</span>
            <span className="arrow">→</span>
            <span className="remote">
              <span className={`peer-mark ${t}`} />
              <span className="text">
                {l.peer_id} · {l.remote_identity}
              </span>
            </span>
            <VerifyPill status={l.status} verifiedAt={l.verified_at} />
            <span className="more">⋯</span>
          </div>
        );
      })}
    </div>
  );
}

// Pick the constellation/legend mark class for a peer id.
function peerMarkClass(peerId: string): "s" | "a" | "t" {
  if (peerId.includes("mastodon") || peerId.includes("hachyderm")) return "a";
  if (peerId.includes("bsky") || peerId.includes("whtwnd")) return "t";
  return "s";
}

function VerifyPill({ status, verifiedAt }: { status: string; verifiedAt: string }) {
  if (status === IdentityLinkStatus.VERIFIED) {
    return (
      <span className="verify verified">
        <span className="vd" />
        Verified · {verifiedAt ? timeAgo(verifiedAt) : "now"}
      </span>
    );
  }
  if (status === IdentityLinkStatus.UNVERIFIED) {
    return (
      <span className="verify pending">
        <span className="vd" />
        Pending
      </span>
    );
  }
  return (
    <span className="verify unverified">
      <span className="vd" />
      Revoked
    </span>
  );
}

// ───────────────────────── Verification queue ─────────────────────────

function VerificationQueue({
  queue,
}: {
  queue: { pending: FederatedContent[]; verified: FederatedContent[]; disputed: FederatedContent[] };
}) {
  return (
    <div className="sd-fed-queue-grid">
      <QueueColumn
        kind="pending"
        title="Pending verification"
        count={queue.pending.length}
        items={queue.pending.slice(0, 4)}
      />
      <QueueColumn
        kind="verified"
        title="Verified · 24h"
        count={queue.verified.length}
        items={queue.verified.slice(0, 4)}
      />
      <QueueColumn
        kind="disputed"
        title="Disputed"
        count={queue.disputed.length}
        items={queue.disputed.slice(0, 4)}
      />
    </div>
  );
}

function QueueColumn({
  kind,
  title,
  count,
  items,
}: {
  kind: "pending" | "verified" | "disputed";
  title: string;
  count: number;
  items: FederatedContent[];
}) {
  return (
    <div className={`sd-fed-queue-col ${kind}`}>
      <div className="col-head">
        {title}
        <span className="count">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty">— nothing here —</div>
      ) : (
        items.map((c) => <QueueItem key={c.id} c={c} />)
      )}
    </div>
  );
}

function QueueItem({ c }: { c: FederatedContent }) {
  // The proto carries the source peer + creator handle; we present a 2-line
  // summary that mirrors the design's compact card.
  return (
    <div className="sd-fed-queue-item">
      <div className="src-line">
        <span className="peer-mark s" />
        {c.peer_id} · {c.creator_name || c.creator_identity}
      </div>
      <div className="title">{c.title || c.body || "(untitled)"}</div>
      <div className="meta-line">
        <span className="hash">#{c.id}</span>
        <span>{c.received_at ? timeAgo(c.received_at) : ""}</span>
      </div>
    </div>
  );
}

// ───────────────────────── Attestations ─────────────────────────

function AttestationsList({ attestations }: { attestations: OutboundAttestation[] }) {
  if (attestations.length === 0) {
    return (
      <div className="sd-positions-empty">
        No outbound attestations yet. Once content is federated to a peer the
        keeper records an{" "}
        <span className="sd-mono">OutboundAttestation</span> here.
      </div>
    );
  }
  return (
    <div className="sd-fed-attest-list">
      {attestations.map((a) => (
        <div key={a.id} className="row">
          <span className="when">{a.published_at ? timeAgo(a.published_at) : "—"}</span>
          <span className="dir out">→</span>
          <span className="desc">
            Federated <b>{a.content_type} #{a.local_content_id}</b> outbound to{" "}
            <b>{a.peer_id}</b>
            <span className="src">· by <CopyableAddress address={a.submitted_by} /></span>
          </span>
          <span className="verb">bridge attest</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Roles strip ─────────────────────────

function RolesStrip() {
  return (
    <div className="sd-fut-roles">
      <RoleCard
        label="DREAM-bonded"
        title="Become a verifier"
        body="Independently fetch federated content, hash it, and confirm matches. Earn SPARK + DREAM per epoch. Slashed if proven wrong."
        reqs={[
          <>trust ≥ <b>ESTABLISHED</b></>,
          <>bond <b>500 DREAM</b></>,
          <>~10 epochs to recover</>,
        ]}
      />
      <RoleCard
        label="SPARK-staked"
        title="Run a bridge"
        body="Operate a relay between this chain and ActivityPub or AT Protocol. Submit content, attest outbound, earn from x/split."
        reqs={[
          <>stake ≥ <b>10k SPARK</b></>,
          <>14d unbond</>,
          <>session keys recommended</>,
        ]}
      />
      <RoleCard
        label="Council vote"
        title="Propose a peer"
        body="Bring a new Spark Dream chain, ActivityPub instance, or AT Protocol service into bilateral federation. Sets policies, content types, rate limits."
        reqs={[
          <>trust ≥ <b>CORE</b></>,
          <>passes council</>,
          <>unilateral, revocable</>,
        ]}
      />
    </div>
  );
}

// ───────────────────────── Sidebar bits ─────────────────────────

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

function TransportLegendItem({
  t,
  label,
  count,
}: {
  t: Transport;
  label: string;
  count: number;
}) {
  // Per-transport mark uses the same shapes as the constellation legend:
  // diamond for IBC, ring for ActivityPub, hex-clip for AT Protocol.
  let mark: React.CSSProperties;
  if (t === "ibc") {
    mark = {
      background: "var(--violet-hi)",
      width: 10,
      height: 10,
      transform: "rotate(45deg)",
      flex: "none",
      margin: "0 3px",
    };
  } else if (t === "ap") {
    mark = {
      border: "2px solid var(--amber)",
      borderRadius: 999,
      width: 10,
      height: 10,
      flex: "none",
      margin: "0 3px",
    };
  } else {
    mark = {
      background: "var(--green)",
      width: 10,
      height: 10,
      clipPath:
        "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)",
      flex: "none",
      margin: "0 3px",
    };
  }
  return (
    <div className="sd-side-item" style={{ cursor: "default" }}>
      <span className="ic" aria-hidden="true" style={mark} />
      {label}
      <Badge>{count}</Badge>
    </div>
  );
}

function Glyph({
  name,
}: {
  name: "globe" | "peers" | "link" | "bridge" | "check" | "speech" | "settings";
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
  switch (name) {
    case "globe":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
      );
    case "peers":
      return (
        <svg {...props}>
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M9 10l6-3M9 14l6 3" />
        </svg>
      );
    case "link":
      return (
        <svg {...props}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71" />
        </svg>
      );
    case "bridge":
      return (
        <svg {...props}>
          <path d="M3 12l3-9 3 9 3-9 3 9 3-9 3 9" />
          <path d="M3 12v6h18v-6" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "speech":
      return (
        <svg {...props}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82M4.6 9a1.65 1.65 0 0 0-.33-1.82" />
          <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3" />
        </svg>
      );
  }
}

// ───────────────────────── Demo data (renders before chain has peers) ─────────────────────────

// Minimal placeholder peers used when the federation queries return an empty
// list — keeps the constellation and peer grid populated so the page stays
// instructive on a fresh chain. Replaced by real data the moment any peer is
// registered via MsgRegisterPeer.
// Demo data uses live-relative timestamps (computed at module evaluation)
// so timeAgo() reads "18h ago" / "2m ago" rather than empty strings.
const NOW_S = Math.floor(Date.now() / 1000);
const minsAgo = (m: number) => String(NOW_S - m * 60);
const hrsAgo = (h: number) => String(NOW_S - h * 3600);
const daysAgo = (d: number) => String(NOW_S - d * 86400);

const DEMO_PEERS: Peer[] = [
  makePeer("sparkdream-2", "sparkdream-2", PeerType.SPARK_DREAM, "channel-04", PeerStatus.ACTIVE, 8, 60),
  makePeer("nightingale-1", "nightingale-1", PeerType.SPARK_DREAM, "channel-pending", PeerStatus.PENDING, 2, 4),
  makePeer("embertown-1", "embertown-1", PeerType.SPARK_DREAM, "channel-09", PeerStatus.ACTIVE, 1, 90),
  makePeer("mastodon.social", "mastodon.social", PeerType.ACTIVITYPUB, "", PeerStatus.ACTIVE, 14, 180),
  makePeer("hachyderm.io", "hachyderm.io", PeerType.ACTIVITYPUB, "", PeerStatus.ACTIVE, 9, 70),
  makePeer("bsky.network", "bsky.network", PeerType.ATPROTO, "", PeerStatus.ACTIVE, 4, 45),
  makePeer("whtwnd.com", "whtwnd.com", PeerType.ATPROTO, "", PeerStatus.ACTIVE, 22, 30),
];

function makePeer(
  id: string,
  name: string,
  type: string,
  channel: string,
  status: string = PeerStatus.ACTIVE,
  lastActivityMin = 0,
  registeredDaysAgo = 0,
): Peer {
  return {
    id,
    display_name: name,
    type,
    status,
    ibc_channel_id: channel,
    registered_at: registeredDaysAgo ? daysAgo(registeredDaysAgo) : "0",
    last_activity: lastActivityMin ? minsAgo(lastActivityMin) : "0",
    registered_by: "",
    metadata: "",
    removed_at: "0",
  };
}

// Plausible federated content rows for the verification queue when chain
// queries return empty. Exact strings come from the design mockup so the
// layout reads correctly to anyone reviewing against it.
const DEMO_CONTENT: FederatedContent[] = [
  makeContent("3a7fbe12", "mastodon.social", "@clarissa", "On the topology of trust networks — a meditation", FederatedContentStatus.PENDING_VERIFICATION, hrsAgo(18)),
  makeContent("9d11a04f", "whtwnd.com", "adelaide.bsky.social", "Why x/reveal won't kill open source", FederatedContentStatus.PENDING_VERIFICATION, hrsAgo(11)),
  makeContent("22c0bb39", "hachyderm.io", "@morpho", "Bridge ops weekly digest #14", FederatedContentStatus.PENDING_VERIFICATION, hrsAgo(4)),
  makeContent("0188a902", "sparkdream-2", "krown.ofbits", "Federation v2 review & futarchy market dump", FederatedContentStatus.VERIFIED, hrsAgo(20)),
  makeContent("bf9177c1", "mastodon.social", "@nessa", "Spark and dream — economy notes", FederatedContentStatus.VERIFIED, hrsAgo(22)),
  makeContent("4f1e2b6d", "bsky.network", "ramble.bsky.social", "Reveal mechanics under partial information", FederatedContentStatus.VERIFIED, daysAgo(2)),
  makeContent("xxxxffff", "hachyderm.io", "@ghost", "Allegedly leaked council memo — see attached", FederatedContentStatus.DISPUTED, daysAgo(11)),
];

function makeContent(
  id: string,
  peerId: string,
  creator: string,
  title: string,
  status: string,
  receivedAt: string,
): FederatedContent {
  return {
    id,
    peer_id: peerId,
    remote_content_id: id,
    content_type: "scroll",
    creator_identity: creator,
    creator_name: creator,
    title,
    body: "",
    content_uri: "",
    protocol_metadata: "",
    remote_created_at: "0",
    received_at: receivedAt,
    submitted_by: "",
    status,
    expires_at: "0",
    content_hash: "",
  };
}

// Three placeholder identity bindings that mirror the mockup so the section
// renders meaningfully before the user (or chain) has any real links.
const DEMO_IDENTITY_LINKS: IdentityLink[] = [
  {
    local_address: "sprkdrm1phsxr47",
    peer_id: "sparkdream-2",
    remote_identity: "krown.ofbits",
    status: IdentityLinkStatus.VERIFIED,
    linked_at: daysAgo(40),
    verified_at: daysAgo(38),
    challenge: "",
  },
  {
    local_address: "sprkdrm1phsxr47",
    peer_id: "mastodon.social",
    remote_identity: "@kingofbits@mastodon.social",
    status: IdentityLinkStatus.VERIFIED,
    linked_at: daysAgo(20),
    verified_at: daysAgo(20),
    challenge: "",
  },
  {
    local_address: "sprkdrm1phsxr47",
    peer_id: "bsky.network",
    remote_identity: "kingofbits.bsky.social",
    status: IdentityLinkStatus.UNVERIFIED,
    linked_at: hrsAgo(2),
    verified_at: "",
    challenge: "",
  },
];

// Recent attestations timeline — IBC ACKs and bridge submissions. Mirrors
// the design's "Recent attestations" panel.
const DEMO_ATTESTATIONS: OutboundAttestation[] = [
  makeAtt("att-1", "sparkdream-2", "scroll", "rep-query", "sprkdrm1abc", minsAgo(2)),
  makeAtt("att-2", "mastodon.social", "scroll", "cb18", "sprkdrm1phsxr47", minsAgo(8)),
  makeAtt("att-3", "bsky.network", "scroll", "41e200aa", "bridge-relay", minsAgo(14)),
  makeAtt("att-4", "bsky.network", "identity", "kingofbits", "sprkdrm1phsxr47", minsAgo(31)),
  makeAtt("att-5", "embertown-1", "reputation", "EST-prov", "sprkdrm1phsxr47", hrsAgo(1)),
  makeAtt("att-6", "sparkdream-2", "scroll", "verify-morpho", "morpho-relay", hrsAgo(2)),
];

function makeAtt(
  id: string,
  peerId: string,
  contentType: string,
  localContentId: string,
  submittedBy: string,
  publishedAt: string,
): OutboundAttestation {
  return {
    id,
    peer_id: peerId,
    content_type: contentType,
    local_content_id: localContentId,
    creator: "",
    submitted_by: submittedBy,
    published_at: publishedAt,
  };
}
