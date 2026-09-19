"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  getFederationPeerPolicy,
  getFederationParams,
  getFederationVerifierActivity,
  getFederationOperatorRewardPool,
  listServiceTypes,
  listBondedRolesByType,
  getBondedRole,
  getBondedRoleConfig,
  getCouncilMembers,
  listGroups,
} from "@/lib/api";
import { errorKind } from "@/lib/errors";
import type { ServiceTypeConfig } from "@/types/service";
import {
  PeerType,
  PeerStatus,
  PEER_STATUS_LABELS,
  IdentityLinkStatus,
  FederatedContentStatus,
  type Peer,
  type PeerPolicy,
  type FederationParams,
  type BridgeOperator,
  type IdentityLink,
  type FederatedContent,
  type OutboundAttestation,
  type VerifierActivityView,
  type OperatorRewardPoolResponse,
} from "@/types/federation";
import {
  RoleType,
  BondedRoleStatus,
  BONDED_ROLE_STATUS_LABELS,
  TrustLevel,
  TRUST_LEVEL_LABELS as REP_TRUST_LEVEL_LABELS,
  type BondedRole,
  type BondedRoleConfig,
} from "@/types/rep";
import { useTrustRank } from "@/hooks/useTrustRank";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import { FederationMsgTypeUrls } from "@/lib/tx";
import LinkIdentityForm from "@/components/federation/LinkIdentityForm";
import PendingIdentityChallenges from "@/components/federation/PendingIdentityChallenges";
import PeerProposalForm, { type PeerAction } from "@/components/federation/PeerProposalForm";
import PeerPolicyForm from "@/components/federation/PeerPolicyForm";

// View slot in the sidebar. "overview" stacks every section; the rest narrow
// the page down to one slice. See VIEW_SECTIONS below for the mapping.
type View =
  | "overview"
  | "peers"
  | "identity"
  | "bridges"
  | "verifiers"
  | "content"
  | "moderation";

// Transport buckets for the side legend / filter — one per proto PeerType.
// Keep these in sync with the enum: an unmapped type falls through to the IBC
// styling and silently drops out of the transport counts.
type Transport = "ibc" | "ap" | "at" | "nostr" | "lens";

const APPROX_PEER_TYPE: Record<string, Transport> = {
  [PeerType.SPARK_DREAM]: "ibc",
  [PeerType.ACTIVITYPUB]: "ap",
  [PeerType.ATPROTO]: "at",
  [PeerType.NOSTR]: "nostr",
  [PeerType.LENS]: "lens",
};

// Protocol name per transport, for copy that has to name the wire format.
const TRANSPORT_LABELS: Record<Transport, string> = {
  ibc: "IBC",
  ap: "ActivityPub",
  at: "AT Protocol",
  nostr: "Nostr",
  lens: "Lens",
};

// Single-letter mark class shared by the constellation legend, the identity
// link rows and the queue cards.
const TRANSPORT_MARK: Record<Transport, string> = {
  ibc: "s",
  ap: "a",
  at: "t",
  nostr: "n",
  lens: "l",
};

// Which sections each sidebar view renders. The overview shows everything;
// the rest narrow the page to the slice the sidebar item names, so clicking
// an item actually changes the page.
type SectionKey =
  | "network"
  | "peers"
  | "identity"
  | "queue"
  | "verifiers"
  | "content"
  | "attestations"
  | "bridges";

// The council x/federation accepts peer-lifecycle messages from. Mirrors the
// constant the proposal form signs against.
const COUNCIL_NAME = "Commons Council";

// x/rep trust levels arrive from BondedRoleConfig as the enum's string name
// ("TRUST_LEVEL_ESTABLISHED"), while useTrustRank reports the member's level
// as the enum's ordinal. Map one onto the other so a requirement can be
// compared the same way BondRole compares it (int32 actual < required).
const REP_TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

// Federation timestamps are unix seconds (BlockTime().Unix()), and an unset
// one arrives as "0", not "". "0" is truthy, so a bare `ts ? timeAgo(ts) : "-"`
// takes the truthy branch and timeAgo returns "" for it, printing a blank where
// the dash belongs. Route every stamp through here.
function stamp(ts: string | undefined, fallback = "—"): string {
  if (!ts || ts === "0") return fallback;
  return timeAgo(ts) || fallback;
}

// Protobuf durations arrive from the LCD as seconds strings ("3600s"). Render
// the largest whole unit; anything unparseable passes straight through.
function formatDurationParam(d: string): string {
  const m = /^(\d+)s$/.exec(d);
  if (!m) return d;
  const secs = Number(m[1]);
  if (secs >= 86_400) return `${+(secs / 86_400).toFixed(1)}d`;
  if (secs >= 3_600) return `${+(secs / 3_600).toFixed(1)}h`;
  if (secs >= 60) return `${Math.round(secs / 60)}m`;
  return `${secs}s`;
}

const VIEW_SECTIONS: Record<View, SectionKey[]> = {
  overview: ["network", "peers", "identity", "queue", "attestations", "bridges"],
  peers: ["network", "peers"],
  identity: ["identity"],
  bridges: ["bridges"],
  verifiers: ["verifiers", "queue"],
  content: ["content", "attestations"],
  moderation: ["queue"],
};

export default function FederationPage() {
  const dream = useDreamDenom();
  const { config } = useChainConfig();
  const { address } = useWallet();

  const [view, setView] = useState<View>("overview");
  // Which compose form is open, if any. Both are council/wallet gated inside
  // the form rather than here, so the button always explains itself.
  const [composer, setComposer] = useState<null | "link" | "peer" | "policy">(null);
  const [peerAction, setPeerAction] = useState<PeerAction>("register");
  const [peerActionTarget, setPeerActionTarget] = useState("");
  // Bumped every time the composer is opened, and used as the form's `key`, so
  // opening it from a peer card re-seeds the action and target even when the
  // form is already on screen.
  const [composerNonce, setComposerNonce] = useState(0);
  // Bumped after a broadcast so the lists refetch without a page reload.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const [federationOpen, setFederationOpen] = useLocalStorageBoolean(
    "fed-section-open",
    true,
  );
  const [transportOpen, setTransportOpen] = useLocalStorageBoolean(
    "fed-transport-open",
    true,
  );

  // Live data. Each list is fetched independently and a failure degrades to an
  // empty array, but we record which queries failed: a node that hasn't exposed
  // an endpoint yet and a genuinely empty federation are very different things,
  // and rendering "no peers registered yet" for the first is a lie.
  const [loading, setLoading] = useState(true);
  const [failedQueries, setFailedQueries] = useState<string[]>([]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [bridges, setBridges] = useState<BridgeOperator[]>([]);
  const [identityLinks, setIdentityLinks] = useState<IdentityLink[]>([]);
  const [content, setContent] = useState<FederatedContent[]>([]);
  // Inbound content received in the last 24h, for the KPI tile. Counted when
  // the fetch lands rather than during render: `received_at` is unix seconds
  // (BlockTime().Unix(), not a height), and reading the clock in render trips
  // the purity rule. The fetch is capped at the newest 100, so a very busy day
  // floors at 100 rather than overcounting, the opposite of the all-time
  // number this tile used to show.
  const [content24h, setContent24h] = useState(0);
  const [attestations, setAttestations] = useState<OutboundAttestation[]>([]);
  // peer_id → bilateral policy, loaded after the peer list lands.
  const [policies, setPolicies] = useState<Record<string, PeerPolicy>>({});
  const [fedParams, setFedParams] = useState<FederationParams | null>(null);
  // The bridge bond and unbonding period live on x/service, one config per
  // `federation-bridge-<protocol>` service type. They are seeded identically,
  // so the first one stands in for the requirement the roles card states.
  const [bridgeConfig, setBridgeConfig] = useState<ServiceTypeConfig | null>(null);
  // The verifier corps, straight from x/rep: federation reports verifications
  // but the role, its bond and its standing are BondedRole records under
  // ROLE_TYPE_FEDERATION_VERIFIER. The "Verifiers" view used to be an alias of
  // the moderation queue and showed no verifier at all.
  const [verifiers, setVerifiers] = useState<BondedRole[]>([]);
  const [verifiersLoading, setVerifiersLoading] = useState(true);
  // address -> counter view, loaded per roster entry.
  const [verifierActivity, setVerifierActivity] = useState<Record<string, VerifierActivityView>>({});
  // The bond/trust/cooldown gate x/rep actually enforces on BondRole. The
  // role cards state requirements, so they have to read this rather than
  // assert a level nothing on chain checks.
  const [verifierRoleConfig, setVerifierRoleConfig] = useState<BondedRoleConfig | null>(null);
  const [rewardPool, setRewardPool] = useState<OperatorRewardPoolResponse | null>(null);
  // Commons Council roster, for the peer-proposal requirement card and the
  // connected wallet's role.
  const [councilMembers, setCouncilMembers] = useState<string[] | null>(null);
  const [councilMinMembers, setCouncilMinMembers] = useState<string | null>(null);
  // The connected wallet's own verifier record. The three non-record answers
  // are all different and the role tile reads differently for each: still
  // asking, the chain said "no such record" (they hold no verifier role), and
  // the read failed (we do not know).
  const [myVerifierRole, setMyVerifierRole] = useState<
    BondedRole | "loading" | "none" | "error"
  >("loading");
  const myTrustRank = useTrustRank(address);

  useEffect(() => {
    let cancelled = false;
    // No setLoading(true) here: the effect runs once, and `loading` already
    // starts true. Setting it synchronously in the effect body just cascades
    // a render.
    Promise.allSettled([
      listFederationPeers({ limit: "100", reverse: true }).then((r) => r.peers || []),
      listFederationBridgeOperators({ limit: "100", reverse: true }).then((r) => r.bridge_bindings || []),
      listFederatedContent({ limit: "100", reverse: true }).then((r) => r.content || []),
      listFederationIdentityLinks({ limit: "100", reverse: true }).then((r) => r.links || []),
      listFederationOutboundAttestations({ limit: "20", reverse: true }).then((r) => r.attestations || []),
    ]).then(([pr, br, cr, lr, ar]) => {
      if (cancelled) return;
      const failed: string[] = [];
      const take = <T,>(r: PromiseSettledResult<T>, label: string, empty: T): T => {
        if (r.status === "fulfilled") return r.value;
        failed.push(label);
        return empty;
      };
      const p = take(pr, "peers", [] as Peer[]);
      const b = take(br, "bridge bindings", [] as BridgeOperator[]);
      const c = take(cr, "federated content", [] as FederatedContent[]);
      const l = take(lr, "identity links", [] as IdentityLink[]);
      const a = take(ar, "outbound attestations", [] as OutboundAttestation[]);
      setPeers(p);
      setBridges(b);
      setContent(c);
      const cutoff = Date.now() / 1000 - 86_400;
      setContent24h(c.filter((x) => Number(x.received_at) >= cutoff).length);
      setIdentityLinks(l);
      setAttestations(a);
      setFailedQueries(failed);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    getFederationParams()
      .then((res) => setFedParams(res.params))
      .catch(() => setFedParams(null));
  }, []);

  useEffect(() => {
    listServiceTypes({ limit: "100" })
      .then((res) => {
        const cfg = (res.configs || []).find((c) =>
          c.service_type.startsWith("federation-bridge-")
        );
        setBridgeConfig(cfg ?? null);
      })
      .catch(() => setBridgeConfig(null));
  }, []);

  // Verifier corps + the bond gate + the operator pool. All three are plain
  // chain reads with no wallet dependency, so they load once with the page.
  useEffect(() => {
    let cancelled = false;
    listBondedRolesByType(RoleType.FEDERATION_VERIFIER, { limit: "100" })
      .then((res) => {
        if (cancelled) return;
        setVerifiers(res.bonded_roles || []);
        setVerifiersLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setVerifiers([]);
        setVerifiersLoading(false);
      });
    getBondedRoleConfig(RoleType.FEDERATION_VERIFIER)
      .then((res) => !cancelled && setVerifierRoleConfig(res.bonded_role_config))
      .catch(() => !cancelled && setVerifierRoleConfig(null));
    getFederationOperatorRewardPool()
      .then((res) => !cancelled && setRewardPool(res))
      .catch(() => !cancelled && setRewardPool(null));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Per-verifier counters. The roster carries bond and standing; the accuracy
  // numbers live behind a per-address query, so fan out over the roster.
  useEffect(() => {
    if (verifiers.length === 0) return;
    let cancelled = false;
    Promise.allSettled(
      verifiers.slice(0, 25).map((v) => getFederationVerifierActivity(v.address))
    ).then((results) => {
      if (cancelled) return;
      const byAddr: Record<string, VerifierActivityView> = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.activity) {
          byAddr[verifiers[i].address] = r.value.activity;
        }
      });
      setVerifierActivity(byAddr);
    });
    return () => {
      cancelled = true;
    };
  }, [verifiers]);

  useEffect(() => {
    let cancelled = false;
    getCouncilMembers(COUNCIL_NAME)
      .then((res) => {
        if (cancelled) return;
        setCouncilMembers((res.members || []).map((m) => m.address));
      })
      .catch(() => !cancelled && setCouncilMembers(null));
    listGroups()
      .then((res) => {
        if (cancelled) return;
        const g = (res.group || []).find((x) => x.index === COUNCIL_NAME);
        setCouncilMinMembers(g?.min_members ?? null);
      })
      .catch(() => !cancelled && setCouncilMinMembers(null));
    return () => {
      cancelled = true;
    };
  }, []);

  // The connected wallet's verifier record. x/rep answers "bonded role not
  // found" with a NotFound, which is the answer "you are not a verifier" --
  // distinguish it from a failed read so the role tile never claims a role
  // the chain did not confirm.
  // Clear the previous wallet's answer synchronously at the moment `address`
  // changes, so a reconnect never shows the old wallet's role for a render.
  // Doing this in the effect would cascade a render (set-state-in-effect).
  const [roleTrackedAddress, setRoleTrackedAddress] = useState(address);
  if (address !== roleTrackedAddress) {
    setRoleTrackedAddress(address);
    setMyVerifierRole("loading");
  }
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getBondedRole(RoleType.FEDERATION_VERIFIER, address)
      .then((res) => !cancelled && setMyVerifierRole(res.bonded_role))
      .catch((e) => {
        if (cancelled) return;
        // NotFound is the chain saying "no such record", i.e. not a
        // verifier. Anything else (node down, 501) leaves it unknown.
        setMyVerifierRole(errorKind(e) === "not-found" ? "none" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [address, reloadKey]);

  // Pull each peer's bilateral policy so the peer cards describe the real
  // relationship (allowlists, rate limits, reputation credit) instead of a
  // fixed sample. Best-effort — a missing policy just renders defaults.
  useEffect(() => {
    if (peers.length === 0) return;
    let cancelled = false;
    Promise.allSettled(
      peers.slice(0, 50).map((p) => getFederationPeerPolicy(p.id))
    ).then((results) => {
      if (cancelled) return;
      const byId: Record<string, PeerPolicy> = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.policy) {
          byId[peers[i].id] = r.value.policy;
        }
      });
      setPolicies(byId);
    });
    return () => {
      cancelled = true;
    };
  }, [peers]);

  // Filter live identity links to the connected wallet (the "my" view).
  const myIdentityLinks = useMemo(() => {
    if (!address) return [];
    return identityLinks.filter((l) => l.local_address === address);
  }, [identityLinks, address]);

  // Counts per peer status used by the KPI strip.
  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byTransport: Record<Transport, number> = { ibc: 0, ap: 0, at: 0, nostr: 0, lens: 0 };
    for (const p of peers) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      const t = APPROX_PEER_TYPE[p.type];
      if (t) byTransport[t]++;
    }
    return {
      total: peers.length,
      active: byStatus[PeerStatus.ACTIVE] || 0,
      pending: byStatus[PeerStatus.PENDING] || 0,
      byTransport,
    };
  }, [peers]);

  // peer_id → transport, so every row that carries a peer id (identity links,
  // queue cards) can mark it from the peer's real PeerType instead of guessing
  // from substrings in the id.
  const peerTransports = useMemo(() => {
    const byId: Record<string, Transport> = {};
    for (const p of peers) {
      const t = APPROX_PEER_TYPE[p.type];
      if (t) byId[p.id] = t;
    }
    return byId;
  }, [peers]);

  // Most recent peer activity, for the Network section caption. Computed
  // from the live last_activity stamps; null when nothing has happened yet.
  const lastActivity = useMemo(() => {
    let latest: string | null = null;
    for (const p of peers) {
      if (!p.last_activity || p.last_activity === "0") continue;
      if (latest === null || Number(p.last_activity) > Number(latest)) {
        latest = p.last_activity;
      }
    }
    return latest;
  }, [peers]);

  // Verification queue partitioning — pending = waiting on a verifier;
  // verified = fresh confirmations; disputed = challenged.
  const queue = useMemo(() => {
    const pending: FederatedContent[] = [];
    const verified: FederatedContent[] = [];
    const disputed: FederatedContent[] = [];
    for (const c of content) {
      if (c.status === FederatedContentStatus.PENDING_VERIFICATION) pending.push(c);
      else if (c.status === FederatedContentStatus.VERIFIED || c.status === FederatedContentStatus.ACTIVE) verified.push(c);
      else if (c.status === FederatedContentStatus.DISPUTED || c.status === FederatedContentStatus.CHALLENGED) disputed.push(c);
    }
    return { pending, verified, disputed };
  }, [content]);

  // Identity-link verification breakdown for the KPI subtitle.
  const linkBreakdown = useMemo(() => {
    let verified = 0;
    let pending = 0;
    for (const l of myIdentityLinks) {
      if (l.status === IdentityLinkStatus.VERIFIED) verified++;
      else if (l.status === IdentityLinkStatus.UNVERIFIED) pending++;
    }
    return { verified, pending };
  }, [myIdentityLinks]);

  // Whole-token verifier bond from params (µ → display), for the role KPI.
  const verifierBondWhole = fedParams
    ? Number(fedParams.min_verifier_bond || 0) / 1_000_000
    : null;
  const maxLinks = fedParams?.max_identity_links_per_user ?? null;

  // The connected wallet's standing in this module, entirely from chain
  // reads: the x/rep BondedRole record for the verifier role, the wallet's
  // own bridge bindings, the Commons Council roster, and its trust rank
  // against the bond gate. This tile used to read "Member · Eligible:
  // Verifier" for everyone, connected or not, which is a claim the chain had
  // never been asked to confirm.
  const myFedRole = useMemo<{ label: string; delta: string }>(() => {
    if (!address) return { label: "—", delta: "Connect a wallet" };
    if (typeof myVerifierRole !== "string") {
      const bond = Number(myVerifierRole.current_bond || 0) / 1_000_000;
      const status =
        BONDED_ROLE_STATUS_LABELS[myVerifierRole.bond_status] || myVerifierRole.bond_status;
      const unbonding = myVerifierRole.bond_status === BondedRoleStatus.UNBONDING;
      return {
        label: "Verifier",
        delta: `${status} · ${bond} ${dream} bonded${unbonding ? ", withdrawal queued" : ""}`,
      };
    }
    const myBindings = bridges.filter((b) => b.address === address);
    if (myBindings.length > 0) {
      const suspended = myBindings.filter((b) => b.suspended).length;
      return {
        label: "Bridge operator",
        delta: `${myBindings.length} binding${myBindings.length === 1 ? "" : "s"}${
          suspended > 0 ? ` · ${suspended} suspended` : ""
        }`,
      };
    }
    if (councilMembers?.includes(address)) {
      return { label: "Council", delta: `${COUNCIL_NAME} member` };
    }
    // No role held. State what the chain would require, and whether this
    // wallet clears it, rather than asserting eligibility.
    if (myVerifierRole === "loading") return { label: "…", delta: "Reading role records" };
    if (myVerifierRole === "error") {
      return { label: "—", delta: "Could not read your role records" };
    }
    if (myTrustRank === null) return { label: "Member", delta: "Checking verifier eligibility" };
    if (myTrustRank < 0) return { label: "Visitor", delta: "No reputation record on this chain" };
    const required = verifierRoleConfig?.min_trust_level ?? null;
    const requiredRank = required !== null ? REP_TRUST_RANK[required] ?? null : null;
    const bondCopy = verifierBondWhole !== null ? ` · ${verifierBondWhole} ${dream}` : "";
    if (requiredRank === null) return { label: "Member", delta: "Verifier bond gate unavailable" };
    if (myTrustRank >= requiredRank) {
      return { label: "Member", delta: `Eligible: verifier${bondCopy}` };
    }
    return {
      label: "Member",
      delta: `Verifier needs trust ${REP_TRUST_LEVEL_LABELS[required!] || required}${bondCopy}`,
    };
  }, [
    address,
    myVerifierRole,
    bridges,
    councilMembers,
    myTrustRank,
    verifierRoleConfig,
    verifierBondWhole,
    dream,
  ]);

  // Window the verifier gets to confirm inbound content, straight from params
  // (protobuf duration seconds, e.g. "3600s"). The caption used to claim a
  // fixed 24h, which is not what the chain enforces.
  const verificationMeta = `Inbound bridge content${
    fedParams?.verification_window
      ? ` · verifier window ${formatDurationParam(fedParams.verification_window)}`
      : ""
  }`;

  const shows = (key: SectionKey) => VIEW_SECTIONS[view].includes(key);

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
          <Badge>{verifiers.length}</Badge>
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
        <TransportLegendItem t="nostr" label="Nostr relays" count={counts.byTransport.nostr} />
        <TransportLegendItem t="lens" label="Lens" count={counts.byTransport.lens} />
      </SidebarSection>
    </>
  );

  return (
    <ContentPageLayout
      title={null}
      sidebar={sidebar}
      railCards={
        <RolesStrip
          params={fedParams}
          bridgeConfig={bridgeConfig}
          verifierRoleConfig={verifierRoleConfig}
          councilSize={councilMembers?.length ?? null}
          councilMinMembers={councilMinMembers}
        />
      }
    >
      <PageHead
        view={view}
        onLinkIdentity={() => {
          setComposer(composer === "link" ? null : "link");
          setView("identity");
        }}
        onProposePeer={() => {
          setComposer(composer === "peer" ? null : "peer");
          setPeerAction("register");
          setPeerActionTarget("");
          setComposerNonce((n) => n + 1);
          setView("peers");
        }}
        composer={composer}
      />

      {composer === "link" && (
        <LinkIdentityForm
          peers={peers}
          myLinks={myIdentityLinks}
          maxLinks={maxLinks}
          onLinked={() => {
            setComposer(null);
            reload();
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {composer === "policy" && (
        <PeerPolicyForm
          key={composerNonce}
          peers={peers}
          params={fedParams}
          initialPeerId={peerActionTarget}
          onSubmitted={() => {
            setComposer(null);
            reload();
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {composer === "peer" && (
        <PeerProposalForm
          key={composerNonce}
          peers={peers}
          initialAction={peerAction}
          initialPeerId={peerActionTarget}
          onSubmitted={() => {
            setComposer(null);
            reload();
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {failedQueries.length > 0 && (
        <div className="sd-fed-load-warning" role="status">
          Could not read {failedQueries.join(", ")} from the node. Those sections
          are blank because the query failed, not because the chain is empty.
        </div>
      )}

      <KpiStrip
        peerCount={counts.total}
        peerDelta={`${counts.active} active · ${counts.pending} pending`}
        content24h={content24h}
        contentDelta={`${queue.pending.length} awaiting verification`}
        myLinks={myIdentityLinks.length}
        linksDelta={`${linkBreakdown.verified} verified · ${linkBreakdown.pending} pending`}
        roleLabel={myFedRole.label}
        roleDelta={myFedRole.delta}
      />

      {shows("network") && (
        <Section title="Network" meta={`My chain · ${config.chainId} · ${counts.total} peer${counts.total === 1 ? "" : "s"}${lastActivity ? ` · last activity ${timeAgo(lastActivity)}` : ""}`}>
          <Constellation peers={peers} chainName={config.chainId} />
        </Section>
      )}

      {shows("peers") && (
        <Section
          title="Peers"
          meta={`Bilateral relationships · ${counts.active} active · ${counts.pending} pending`}
        >
          <PeersGrid
            peers={peers}
            policies={policies}
            loading={loading}
            onProposeFor={(peer) => {
              // Pre-pick the action the peer's current status allows, so the
              // form opens on the only thing the council can do to it.
              setPeerAction(peer.status === PeerStatus.ACTIVE ? "suspend" : "resume");
              setPeerActionTarget(peer.id);
              setComposerNonce((n) => n + 1);
              setComposer("peer");
            }}
            onEditPolicy={(peer) => {
              setPeerActionTarget(peer.id);
              setComposerNonce((n) => n + 1);
              setComposer("policy");
            }}
          />
        </Section>
      )}

      {/* Phase 2 of a link started on a peer chain. Rendered above the links
          table and outside it, because the table early-returns when empty --
          and having no links yet is exactly when a challenge is waiting. The
          panel renders nothing when there is nothing to confirm. */}
      {shows("identity") && <PendingIdentityChallenges />}
      {shows("identity") && (
        <Section
          title="My identity links"
          meta={`Voluntary cross-network bindings${maxLinks !== null ? ` · ${myIdentityLinks.length} of ${maxLinks} used` : ` · ${myIdentityLinks.length} linked`}`}
        >
          <IdentityLinkTable
            links={myIdentityLinks}
            address={address}
            transports={peerTransports}
            onUnlinked={reload}
          />
        </Section>
      )}

      {shows("verifiers") && (
        <VerifiersSection
          verifiers={verifiers}
          activity={verifierActivity}
          config={verifierRoleConfig}
          params={fedParams}
          pool={rewardPool}
          loading={verifiersLoading}
          address={address}
        />
      )}

      {shows("queue") && (
        <Section title="Verification queue" meta={verificationMeta}>
          <VerificationQueue queue={queue} transports={peerTransports} />
        </Section>
      )}

      {shows("content") && (
        <Section
          title="Federated content"
          meta={`Inbound from peers · newest ${content.length}${loading ? " · loading" : ""}`}
        >
          <FederatedContentList content={content} transports={peerTransports} />
        </Section>
      )}

      {shows("attestations") && (
        <Section title="Recent attestations" meta="Outbound content published to peers">
          <AttestationsList attestations={attestations} />
        </Section>
      )}

      {shows("bridges") && (
        <BridgeBindingsSection
          bindings={bridges}
          // On the overview an empty binding table is noise; when the sidebar
          // asked for this view specifically, an empty state is the answer.
          showWhenEmpty={view === "bridges"}
        />
      )}
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
function BridgeBindingsSection({
  bindings,
  showWhenEmpty,
}: {
  bindings: BridgeOperator[];
  showWhenEmpty: boolean;
}) {
  if (!bindings.length) {
    if (!showWhenEmpty) return null;
    return (
      <Section title="Bridge bindings" meta="Bond + slashing live on x/service">
        <div className="sd-positions-empty">
          No bridge operators registered yet. An operator bonds on x/service and
          binds to a peer with <span className="sd-mono">MsgRegisterBridge</span>.
        </div>
      </Section>
    );
  }
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
        Bond / slashing / unbonding now live on <Link href="/governance?view=chain-operators" className="text-indigo-400 hover:text-indigo-300 underline">Governance → Operators</Link>.
      </p>
    </Section>
  );
}

// ───────────────────────── Page header ─────────────────────────

const VIEW_LABELS: Record<View, string> = {
  overview: "Overview",
  peers: "Peers",
  identity: "My identity links",
  bridges: "Bridge operators",
  verifiers: "Verifiers",
  content: "Federated content",
  moderation: "Moderation queue",
};

function PageHead({
  view,
  onLinkIdentity,
  onProposePeer,
  composer,
}: {
  view: View;
  onLinkIdentity: () => void;
  onProposePeer: () => void;
  composer: null | "link" | "peer" | "policy";
}) {
  return (
    <div className="sd-fed-page-head">
      <nav className="crumbs" aria-label="Breadcrumb">
        <span className="crumb">Govern</span>
        <span className="sep">›</span>
        <span className="crumb">Federation</span>
        <span className="sep">›</span>
        <span className="crumb current">{VIEW_LABELS[view]}</span>
      </nav>
      <div className="actions">
        <button
          type="button"
          className="sd-btn sd-btn-secondary"
          onClick={onLinkIdentity}
          aria-expanded={composer === "link"}
          title="MsgLinkIdentity"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {composer === "link" ? "Close" : "Link identity"}
        </button>
        <button
          type="button"
          className="sd-btn sd-btn-primary"
          onClick={onProposePeer}
          aria-expanded={composer === "peer"}
          title="Commons Council proposal carrying MsgRegisterPeer"
        >
          {composer === "peer" ? "Close" : "Propose peer"}
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
        <span className="label">Federation peers</span>
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
        {/* One gradient per edge, in user space. An objectBoundingBox gradient
            collapses on a perfectly vertical or horizontal line — the box has
            zero width, so the line is not painted at all — which erased the
            only edge whenever a single peer landed straight above the centre.
            User space also fixes the direction: bright at us, fading out at
            the peer, whichever way the edge runs. */}
        <defs>
          {nodes.map((n, i) => (
            <linearGradient
              key={n.id}
              id={`fed-line-grad-${i}`}
              gradientUnits="userSpaceOnUse"
              x1="50"
              y1="50"
              x2={n.x}
              y2={n.y}
            >
              <stop offset="0%" stopColor="#8d79ff" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#8d79ff" stopOpacity="0.05" />
            </linearGradient>
          ))}
        </defs>
        {/* The viewBox is stretched to fill the panel, so an ordinary stroke
            comes out thicker on vertical edges than on horizontal ones. */}
        {nodes.map((n, i) => (
          <line
            key={n.id}
            x1="50"
            y1="50"
            x2={n.x}
            y2={n.y}
            stroke={`url(#fed-line-grad-${i})`}
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
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
        <span className="swatch n">Nostr relay · bridge</span>
        <span className="swatch l">Lens · bridge</span>
      </div>
    </div>
  );
}

// ───────────────────────── Peers grid ─────────────────────────

function PeersGrid({
  peers,
  policies,
  loading,
  onProposeFor,
  onEditPolicy,
}: {
  peers: Peer[];
  policies: Record<string, PeerPolicy>;
  loading: boolean;
  onProposeFor: (peer: Peer) => void;
  onEditPolicy: (peer: Peer) => void;
}) {
  if (peers.length === 0) {
    return (
      <div className="sd-positions-empty">
        {loading ? (
          "Loading peers…"
        ) : (
          <>
            No peers registered yet. Once the council registers a peer (
            <span className="sd-mono">MsgRegisterPeer</span>) it will appear here
            with its bilateral content policy and reputation cap.
          </>
        )}
      </div>
    );
  }
  return (
    <div className="sd-fed-peers-grid">
      {peers.map((p) => (
        <PeerCard
          key={p.id}
          peer={p}
          policy={policies[p.id]}
          onPropose={() => onProposeFor(p)}
          onEditPolicy={() => onEditPolicy(p)}
        />
      ))}
    </div>
  );
}

// x/rep TrustLevel values as stored in PeerPolicy.min_outbound_trust_level.
const TRUST_LEVEL_LABELS: Record<number, string> = {
  0: "any",
  1: "PROV",
  2: "EST",
  3: "TRUSTED",
  4: "CORE",
};

function PeerCard({
  peer,
  policy,
  onPropose,
  onEditPolicy,
}: {
  peer: Peer;
  policy?: PeerPolicy;
  onPropose: () => void;
  onEditPolicy: () => void;
}) {
  const t = APPROX_PEER_TYPE[peer.type] || "ibc";
  const statusClass =
    peer.status === PeerStatus.ACTIVE
      ? "active"
      : peer.status === PeerStatus.PENDING
        ? "pending"
        : "suspended";
  // Bilateral policy as configured on-chain. A freshly registered peer
  // carries the empty default policy — render that honestly ("none") rather
  // than implying a configured relationship. A policy we never loaded (the
  // query failed, or the peer fell past the fetch cap) is a different thing
  // and renders "—": "none"/"off" would read as a deliberately blocked peer.
  const outTypes = policy?.outbound_content_types ?? [];
  const inTypes = policy?.inbound_content_types ?? [];
  const minTrust = policy
    ? TRUST_LEVEL_LABELS[policy.min_outbound_trust_level] ?? String(policy.min_outbound_trust_level)
    : "—";
  // The default policy carries "0" (unlimited) — render that as unset.
  const rateLimitRaw = policy?.inbound_rate_limit_per_epoch;
  const rateLimit = rateLimitRaw && rateLimitRaw !== "0" ? rateLimitRaw : null;
  // Reputation credit is IBC-only, capped by the policy's max_trust_credit.
  const repCap = policy?.max_trust_credit ?? 0;
  const repAllowed = t === "ibc" && (policy?.accept_reputation_attestations ?? false);
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
        <PolicyRow arrow="→" label="Out" wide v={!policy ? "—" : outTypes.length > 0 ? outTypes.join(", ") : "none"} />
        <PolicyRow arrow="←" label="In" wide v={!policy ? "—" : inTypes.length > 0 ? inTypes.join(", ") : "none"} />
        <PolicyRow arrow="⊣" label="Min trust" v={minTrust} />
        <PolicyRow arrow="⏱" label="Rate" v={rateLimit ? `${rateLimit}/epoch` : "—"} />
      </div>
      <div className="trust-credit no-rep">
        <span>{t === "ibc" ? "Rep credit cap" : `No reputation bridging (${TRANSPORT_LABELS[t]})`}</span>
        <div className="bar">
          <i style={{ width: t === "ibc" ? `${Math.min(100, repCap * 25)}%` : 0 }} />
        </div>
        {t === "ibc" && (
          <span>{!policy ? "—" : repAllowed ? TRUST_LEVEL_LABELS[repCap] ?? `L${repCap}` : "off"}</span>
        )}
      </div>
      <div className="foot">
        <span className="stat">
          last activity <b>{stamp(peer.last_activity)}</b>
        </span>
        <span className="stat" style={{ marginLeft: "auto" }}>
          registered <b>{stamp(peer.registered_at)}</b>
        </span>
      </div>
      <div className="sd-fed-peer-actions">
        <button type="button" className="sd-fed-peer-action" onClick={onPropose}>
          {peer.status === PeerStatus.ACTIVE ? "Propose suspension" : "Propose activation"}
        </button>
        <button type="button" className="sd-fed-peer-action" onClick={onEditPolicy}>
          Edit policy
        </button>
      </div>
    </div>
  );
}

// `wide` is for the content-type lists: several comma-joined types never fit
// a half-card column, so they take the full row and wrap under themselves.
function PolicyRow({
  arrow,
  label,
  v,
  wide,
}: {
  arrow: string;
  label: string;
  v: string;
  wide?: boolean;
}) {
  return (
    <div className={`policy-row${wide ? " wide" : ""}`}>
      <span className="arrow">{arrow}</span> {label}: <span className="v">{v}</span>
    </div>
  );
}

// ───────────────────────── Identity links ─────────────────────────

function IdentityLinkTable({
  links,
  address,
  transports,
  onUnlinked,
}: {
  links: IdentityLink[];
  address: string | null;
  transports: Record<string, Transport>;
  onUnlinked: () => void;
}) {
  const { signAndBroadcast } = useWallet();
  const { pending, error, clearError, run } = useTxAction();

  // MsgUnlinkIdentity keys on (creator, peer_id) only -- one link per peer, so
  // the peer id is the whole identifier. Works on a link in any status,
  // including one still waiting on its challenge.
  const unlink = async (link: IdentityLink) => {
    if (!address) return;
    const ok = await run(
      link.peer_id,
      async () => {
        await signAndBroadcast([
          {
            typeUrl: FederationMsgTypeUrls.UnlinkIdentity,
            value: { creator: address, peerId: link.peer_id },
          },
        ]);
      },
      (raw) => `Could not unlink ${link.remote_identity}: ${raw}`
    );
    if (ok) onUnlinked();
  };
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
    <>
      <ActionBanner message={error} onDismiss={clearError} className="mb-2" />
      <div className="sd-fed-id-links">
      {links.map((l) => {
        const t = TRANSPORT_MARK[transports[l.peer_id] ?? "ibc"];
        return (
          <div key={`${l.local_address}-${l.peer_id}-${l.remote_identity}`} className="row">
            <div className="me">{(l.local_address.slice(-2) || "K").toUpperCase()}</div>
            <span className="local"><CopyableAddress address={l.local_address} /></span>
            <span className="arrow">→</span>
            <span className="remote">
              <span className={`peer-mark ${t}`} />
              <span className="text">
                {l.peer_id} · {l.remote_identity}
              </span>
            </span>
            <VerifyPill status={l.status} verifiedAt={l.verified_at} />
            <button
              type="button"
              className="more"
              onClick={() => unlink(l)}
              disabled={pending !== null}
              title={`Unlink ${l.remote_identity}`}
            >
              {pending === l.peer_id ? "…" : "Unlink"}
            </button>
          </div>
        );
      })}
      </div>
    </>
  );
}

function VerifyPill({ status, verifiedAt }: { status: string; verifiedAt: string }) {
  if (status === IdentityLinkStatus.VERIFIED) {
    return (
      <span className="verify verified">
        <span className="vd" />
        Verified · {stamp(verifiedAt, "now")}
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

// ───────────────────────── Verifiers ─────────────────────────

// Both tokens are micro-denominated at 6 decimals: BondedRole bonds are
// micro-DREAM, the operator pool is micro-SPARK.
function microToWhole(micro: string | undefined): number {
  return Number(micro || 0) / 1_000_000;
}

// Upheld against resolved, the ratio the reward split scores. Null until a
// verdict has actually resolved: 0% and "no verdicts yet" are different.
function accuracy(a: VerifierActivityView | undefined): { pct: number; resolved: number } | null {
  if (!a) return null;
  const upheld = Number(a.upheld_verifications || 0);
  const overturned = Number(a.overturned_verifications || 0);
  const resolved = upheld + overturned;
  if (resolved === 0) return null;
  return { pct: (upheld / resolved) * 100, resolved };
}

function VerifiersSection({
  verifiers,
  activity,
  config,
  params,
  pool,
  loading,
  address,
}: {
  verifiers: BondedRole[];
  activity: Record<string, VerifierActivityView>;
  config: BondedRoleConfig | null;
  params: FederationParams | null;
  pool: OperatorRewardPoolResponse | null;
  loading: boolean;
  address: string | null;
}) {
  const dream = useDreamDenom();
  const { config: chain } = useChainConfig();
  const spark = chain.displayDenom;
  const normal = verifiers.filter((v) => v.bond_status === BondedRoleStatus.NORMAL).length;
  const meta = config
    ? `Bond ${microToWhole(config.min_bond)} ${dream} · trust ≥ ${
        REP_TRUST_LEVEL_LABELS[config.min_trust_level] || config.min_trust_level
      } · ${verifiers.length} bonded, ${normal} in good standing`
    : `${verifiers.length} bonded, ${normal} in good standing`;
  return (
    <Section title="Verifiers" meta={meta}>
      {pool && (
        <div className="sd-fed-pool">
          <span className="lab">Operator reward pool</span>
          <span className="v">
            {microToWhole(pool.balance).toLocaleString()} {spark}
          </span>
          <span className="sub">
            funded today {microToWhole(pool.funded_today).toLocaleString()} of{" "}
            {microToWhole(pool.daily_funding_cap).toLocaleString()} {spark} · cap{" "}
            {microToWhole(pool.cap).toLocaleString()} {spark} · inflation share{" "}
            {(Number(pool.inflation_share || 0) * 100).toFixed(1)}%
          </span>
        </div>
      )}
      {verifiers.length === 0 ? (
        <div className="sd-positions-empty">
          {loading
            ? "Loading verifiers…"
            : config
              ? `No verifiers bonded yet. Bonding ${microToWhole(config.min_bond)} ${dream} at trust ${
                  REP_TRUST_LEVEL_LABELS[config.min_trust_level] || config.min_trust_level
                } or above claims the role.${
                  params
                    ? ` An overturned verdict slashes ${
                        Number(params.verifier_slash_amount || 0) / 1e6
                      } ${dream}, and the role is demoted once the bond falls below ${microToWhole(
                        config.demotion_threshold
                      )} ${dream}.`
                    : ""
                }`
              : "No verifiers bonded yet."}
        </div>
      ) : (
        <div className="sd-hull-tile overflow-hidden rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/40 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Verifier</th>
                <th className="px-3 py-2 font-medium text-right">Bond</th>
                <th className="px-3 py-2 font-medium text-right">Verified</th>
                <th className="px-3 py-2 font-medium text-right">This epoch</th>
                <th className="px-3 py-2 font-medium text-right">Accuracy</th>
                <th className="px-3 py-2 font-medium text-right">Slashes</th>
                <th className="px-3 py-2 font-medium">Standing</th>
              </tr>
            </thead>
            <tbody>
              {verifiers.map((v) => {
                const a = activity[v.address];
                const acc = accuracy(a);
                const mine = address !== null && v.address === address;
                return (
                  <tr
                    key={v.address}
                    className={`border-t border-zinc-800/60${mine ? " bg-indigo-500/5" : ""}`}
                  >
                    <td className="px-3 py-2 text-xs">
                      <CopyableAddress address={v.address} />
                      {mine && <span className="ml-2 text-[10px] text-indigo-400">you</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-200">
                      {microToWhole(v.current_bond).toLocaleString()} {dream}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-200">
                      {a ? a.total_verifications : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-400">
                      {a ? a.epoch_verifications : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-300">
                      {acc ? `${acc.pct.toFixed(0)}% of ${acc.resolved}` : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right text-xs ${
                        a && Number(a.slash_count) > 0 ? "text-red-400" : "text-zinc-500"
                      }`}
                    >
                      {a ? a.slash_count : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          v.bond_status === BondedRoleStatus.NORMAL
                            ? "bg-emerald-500/15 text-emerald-400"
                            : v.bond_status === BondedRoleStatus.DEMOTED
                              ? "bg-red-500/15 text-red-400"
                              : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        {BONDED_ROLE_STATUS_LABELS[v.bond_status] || v.bond_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        The bond and its standing live in x/rep as a bonded role. Manage it on{" "}
        <Link
          href="/governance?view=chain-operators"
          className="text-indigo-400 underline hover:text-indigo-300"
        >
          Governance → Operators
        </Link>
        .
      </p>
    </Section>
  );
}

// ───────────────────────── Verification queue ─────────────────────────

function VerificationQueue({
  queue,
  transports,
}: {
  queue: { pending: FederatedContent[]; verified: FederatedContent[]; disputed: FederatedContent[] };
  transports: Record<string, Transport>;
}) {
  return (
    <div className="sd-fed-queue-grid">
      <QueueColumn
        kind="pending"
        title="Pending verification"
        count={queue.pending.length}
        items={queue.pending.slice(0, 4)}
        transports={transports}
      />
      {/* The column is not time-windowed: it holds every VERIFIED/ACTIVE item
          in the fetched page, so it must not be captioned "· 24h". */}
      <QueueColumn
        kind="verified"
        title="Verified"
        count={queue.verified.length}
        items={queue.verified.slice(0, 4)}
        transports={transports}
      />
      <QueueColumn
        kind="disputed"
        title="Disputed"
        count={queue.disputed.length}
        items={queue.disputed.slice(0, 4)}
        transports={transports}
      />
    </div>
  );
}

function QueueColumn({
  kind,
  title,
  count,
  items,
  transports,
}: {
  kind: "pending" | "verified" | "disputed";
  title: string;
  count: number;
  items: FederatedContent[];
  transports: Record<string, Transport>;
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
        items.map((c) => <QueueItem key={c.id} c={c} transports={transports} />)
      )}
    </div>
  );
}

function QueueItem({
  c,
  transports,
}: {
  c: FederatedContent;
  transports: Record<string, Transport>;
}) {
  // The proto carries the source peer + creator handle; we present a 2-line
  // summary that mirrors the design's compact card.
  return (
    <div className="sd-fed-queue-item">
      <div className="src-line">
        <span className={`peer-mark ${TRANSPORT_MARK[transports[c.peer_id] ?? "ibc"]}`} />
        {c.peer_id} · {c.creator_name || c.creator_identity}
      </div>
      <div className="title">{c.title || c.body || "(untitled)"}</div>
      <div className="meta-line">
        <span className="hash">#{c.id}</span>
        <span>{stamp(c.received_at, "")}</span>
      </div>
    </div>
  );
}

// ──────────────────── Federated content (full list) ────────────────────

// The "Federated content" sidebar view. The verification queue only shows the
// four newest per status; this lists the whole fetched page with its status.
function FederatedContentList({
  content,
  transports,
}: {
  content: FederatedContent[];
  transports: Record<string, Transport>;
}) {
  if (content.length === 0) {
    return (
      <div className="sd-positions-empty">
        No federated content yet. A bridge operator submits inbound content with{" "}
        <span className="sd-mono">MsgSubmitFederatedContent</span>, and it lands
        here pending verification.
      </div>
    );
  }
  return (
    <div className="sd-fed-content-grid">
      {content.map((c) => (
        <div key={c.id} className="sd-fed-queue-item">
          <div className="src-line">
            <span className={`peer-mark ${TRANSPORT_MARK[transports[c.peer_id] ?? "ibc"]}`} />
            {c.peer_id} · {c.creator_name || c.creator_identity}
          </div>
          <div className="title">{c.title || c.body || "(untitled)"}</div>
          <div className="meta-line">
            <span className="hash">#{c.id}</span>
            <span>{c.content_type}</span>
            <span>{FED_CONTENT_STATUS_LABELS[c.status] || c.status}</span>
            <span>{stamp(c.received_at, "")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

const FED_CONTENT_STATUS_LABELS: Record<string, string> = {
  [FederatedContentStatus.PENDING_VERIFICATION]: "Pending verification",
  [FederatedContentStatus.VERIFIED]: "Verified",
  [FederatedContentStatus.ACTIVE]: "Active",
  [FederatedContentStatus.HIDDEN]: "Hidden",
  [FederatedContentStatus.DISPUTED]: "Disputed",
  [FederatedContentStatus.CHALLENGED]: "Challenged",
  [FederatedContentStatus.REJECTED]: "Rejected",
};

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
          <span className="when">{stamp(a.published_at)}</span>
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

// Full x/rep TrustLevel names, for copy that states a requirement. The peer
// cards use the abbreviated TRUST_LEVEL_LABELS instead, to fit the grid.
const TRUST_LEVEL_FULL: Record<number, string> = {
  0: "NONE",
  1: "PROVISIONAL",
  2: "ESTABLISHED",
  3: "TRUSTED",
  4: "CORE",
};

function RolesStrip({
  params,
  bridgeConfig,
  verifierRoleConfig,
  councilSize,
  councilMinMembers,
}: {
  params: FederationParams | null;
  bridgeConfig: ServiceTypeConfig | null;
  verifierRoleConfig: BondedRoleConfig | null;
  councilSize: number | null;
  councilMinMembers: string | null;
}) {
  const dream = useDreamDenom();
  const { config } = useChainConfig();
  // Every figure below is a live chain param. They were hardcoded before and
  // had drifted: the bridge bond reads 1000 SPARK on-chain, not the 10k this
  // card used to claim.
  // The bond gate x/rep enforces on BondRole is the authority here; the
  // federation params carry the same figures for the keeper's own checks, so
  // they stand in when the role config read fails.
  const verifierBond = verifierRoleConfig
    ? microToWhole(verifierRoleConfig.min_bond)
    : params
      ? Number(params.min_verifier_bond || 0) / 1e6
      : null;
  const verifierTrust = verifierRoleConfig
    ? REP_TRUST_LEVEL_LABELS[verifierRoleConfig.min_trust_level]?.toUpperCase() ??
      verifierRoleConfig.min_trust_level
    : params
      ? TRUST_LEVEL_FULL[params.min_verifier_trust_level] ?? `L${params.min_verifier_trust_level}`
      : null;
  const verifierSlash = params ? Number(params.verifier_slash_amount || 0) / 1e6 : null;
  const bridgeBond = bridgeConfig ? Number(bridgeConfig.min_bond_amount || 0) / 1e6 : null;
  const spark = config.displayDenom;
  return (
    <div className="sd-fut-roles">
      <RoleCard
        label={`${dream}-bonded`}
        title="Become a verifier"
        body={`Independently fetch federated content, hash it, and confirm matches. Earn SPARK + ${dream} per epoch. Slashed if proven wrong.`}
        reqs={[
          <>trust ≥ <b>{verifierTrust ?? "—"}</b></>,
          <>bond <b>{verifierBond !== null ? `${verifierBond} ${dream}` : "—"}</b></>,
          <>slash <b>{verifierSlash !== null ? `${verifierSlash} ${dream}` : "—"}</b></>,
        ]}
      />
      <RoleCard
        label={`${spark}-bonded`}
        title="Run a bridge"
        body="Operate a relay between this chain and ActivityPub, AT Protocol, Nostr, or Lens. Submit content, attest outbound, earn from the operator reward pool."
        reqs={[
          <>bond ≥ <b>{bridgeBond !== null ? `${bridgeBond.toLocaleString()} ${spark}` : "—"}</b></>,
          <>{bridgeConfig ? `${Number(bridgeConfig.unbonding_period_blocks).toLocaleString()} block unbond` : "unbonding on x/service"}</>,
          <>reports resolved by controller</>,
        ]}
      />
      <RoleCard
        label="Council vote"
        title="Propose a peer"
        body={`Bring a new Spark Dream chain, ActivityPub instance, or AT Protocol service into bilateral federation. Sets policies, content types, rate limits. x/federation accepts these messages only from the ${COUNCIL_NAME} policy address, so every one travels as a council proposal.`}
        reqs={[
          <>
            {COUNCIL_NAME} seat
            {councilSize !== null ? (
              <>
                {" "}
                (<b>{councilSize}</b> held)
              </>
            ) : null}
          </>,
          <>passes council{councilMinMembers ? `, quorum ${councilMinMembers}` : ""}</>,
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
  } else if (t === "at") {
    mark = {
      background: "var(--green)",
      width: 10,
      height: 10,
      clipPath:
        "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)",
      flex: "none",
      margin: "0 3px",
    };
  } else if (t === "nostr") {
    mark = {
      background: "var(--rose)",
      width: 10,
      height: 10,
      clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
      flex: "none",
      margin: "0 3px",
    };
  } else {
    mark = {
      background: "var(--blue)",
      width: 10,
      height: 10,
      borderRadius: 2,
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
