"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@/contexts/WalletContext";
import {
  listRepInitiatives,
  initiativesByProject,
  availableInitiatives,
  initiativesByAssignee,
  initiativesByCreator,
  listRepProjects,
  listRepMembers,
  reverseResolveName,
  stakesByTarget,
  getRepParams,
} from "@/lib/api";
import type { InitiativeSortKey } from "@/lib/api";
import { truncateAddress } from "@/lib/utils";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { useDisplayName } from "@/hooks/useDisplayName";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import TagPicker from "@/components/contribute/TagPicker";
import { RepMsgTypeUrls } from "@/lib/tx";
import CopyableAddress from "@/components/CopyableAddress";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import type { Initiative, RepProject, RepStake } from "@/types/rep";
import {
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_TIER_LABELS,
  INITIATIVE_CATEGORY_LABELS,
  InitiativeStatus,
  InitiativeTier,
  InitiativeCategory,
  StakeTargetType,
  CriteriaType,
  CriteriaTypeValue,
  CRITERIA_TYPE_LABELS,
} from "@/types/rep";
import {
  initiativeTierFromJSON,
  initiativeCategoryFromJSON,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/initiative";
import { stakeTargetTypeFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/stake";
import SearchableSelect from "@/components/contribute/SearchableSelect";
import SearchField from "@/components/contribute/SearchField";
import TrendingRailCard from "@/components/contribute/TrendingRailCard";
import InitiativeReviewPanel from "@/components/contribute/InitiativeReviewPanel";
import InitiativeChallengePanel from "@/components/contribute/InitiativeChallengePanel";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";
import ErrorState from "@/components/ErrorState";
import { isMissingEndpoint } from "@/lib/errors";

type Tab = "all" | "available" | "mine" | "authored";

// Terminal statuses: nothing further can happen to an initiative in one of
// these. They're hidden by default so finished and abandoned work (including
// initiatives superseded by a recreated one) doesn't crowd out live work.
const CLOSED_STATUSES = new Set<string>([
  InitiativeStatus.COMPLETED,
  InitiativeStatus.REJECTED,
  InitiativeStatus.ABANDONED,
  InitiativeStatus.CANCELLED,
]);

function statusColor(status: string): string {
  switch (status) {
    case InitiativeStatus.OPEN: return "bg-blue-500/15 text-blue-400";
    case InitiativeStatus.ASSIGNED: return "bg-yellow-500/15 text-yellow-400";
    case InitiativeStatus.SUBMITTED: return "bg-purple-500/15 text-purple-400";
    case InitiativeStatus.IN_REVIEW: return "bg-indigo-500/15 text-indigo-400";
    case InitiativeStatus.CHALLENGED: return "bg-red-500/15 text-red-400";
    case InitiativeStatus.COMPLETED: return "bg-emerald-500/15 text-emerald-400";
    case InitiativeStatus.REJECTED: return "bg-red-500/15 text-red-400";
    case InitiativeStatus.ABANDONED: return "bg-zinc-500/15 text-zinc-400";
    case InitiativeStatus.CANCELLED: return "bg-zinc-500/15 text-zinc-400";
    default: return "bg-zinc-800/50 text-zinc-400";
  }
}

function tierColor(tier: string): string {
  switch (tier) {
    case InitiativeTier.EPIC: return "bg-amber-500/15 text-amber-400";
    case InitiativeTier.EXPERT: return "bg-purple-500/15 text-purple-400";
    case InitiativeTier.STANDARD: return "bg-blue-500/15 text-blue-400";
    default: return "bg-zinc-500/15 text-zinc-300";
  }
}

// The wallet rethrows a failed tx as `Transaction failed: <rawLog>`, where
// rawLog is the chain's verbose form: "failed to execute message; message
// index: 0: <reason>". Strip the preamble so the inline error shows just the
// human reason (e.g. "project creator cannot self-assign initiatives").
function txErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const reason = raw
    .replace(/^Transaction failed:\s*/, "")
    .replace(/^failed to execute message; message index: \d+:\s*/, "")
    .replace(/^[a-z0-9]+1[a-z0-9]+:\s*/i, "")
    .trim();
  return reason || fallback;
}

function formatDream(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

// Same as formatDream but keeps the sub-DREAM fraction. Used where the exact
// micro-DREAM figure matters — the unstake Max value and the position it fills —
// so a Max on a 1,500,000 micro-DREAM position reads "1.5" rather than "1".
function formatDreamExact(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  const divisor = BigInt(1000000);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === BigInt(0)) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

// Conviction the way the chain computes it (x/rep/keeper/stake_conviction.go).
// Three steps, and skipping any of them makes the number wrong:
//   1. each stake matures linearly, reaching full weight after two half-lives;
//   2. a staker's matured total is sqrt-damped ONCE, over their aggregate — so
//      splitting a position across several stakes buys nothing;
//   3. the result is capped at max_conviction_share_per_member of what the
//      initiative requires, so no single member can carry an initiative.
// The chain also applies a reputation multiplier (1 + rep/1000) that would cost
// a per-tag reputation query per staker to reproduce, so it is left out here.
// Dropping a multiplier >= 1 makes every figure below a floor: it never
// overstates a staker's contribution, and it is exact whenever the cap binds —
// which is the case that matters most, since a capped staker can withdraw a
// large slice of their DREAM without moving conviction at all.
type ConvictionParams = {
  halfLifeSeconds: number;
  maxSharePerMember: number;
  // Fraction of the threshold that must come from members unaffiliated with the
  // work. The self-assigned figure applies when the assignee is also the project
  // creator: the two internal roles collapse into one party, so the community
  // alone has to vouch (CanCompleteInitiative).
  externalRatio: number;
  selfAssignedExternalRatio: number;
};

// Chain defaults (conviction_half_life_epochs 3 x epoch_blocks 300 x ~6s per
// block; max_conviction_share_per_member 0.33). Used until rep params load, and
// as the fallback on an older node that doesn't return them.
const DEFAULT_CONVICTION_PARAMS: ConvictionParams = {
  halfLifeSeconds: 3 * 300 * 6,
  maxSharePerMember: 0.33,
  externalRatio: 0.5,
  selfAssignedExternalRatio: 1,
};

// Weight of one stake at `nowSeconds`: 0 when just placed, 1 once held for two
// half-lives. Mirrors the chain's linear stand-in for exponential decay. Stake
// created_at is a unix timestamp (unlike the block-height *_at fields
// elsewhere), so wall-clock time is the right comparison.
function stakeTimeFactor(createdAt: string, nowSeconds: number, halfLifeSeconds: number): number {
  const created = parseInt(createdAt || "0", 10);
  if (!Number.isFinite(created) || halfLifeSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, nowSeconds - created) / (2 * halfLifeSeconds));
}

// One staker's conviction contribution to an initiative: sqrt of their matured
// micro-DREAM aggregate, capped at their share ceiling.
function stakerConviction(
  stakes: { amount: string; created_at: string }[],
  requiredConviction: number,
  nowSeconds: number,
  params: ConvictionParams,
): number {
  let raw = 0;
  for (const s of stakes) {
    const amt = Number(s.amount || "0");
    if (!(amt > 0)) continue;
    raw += amt * stakeTimeFactor(s.created_at, nowSeconds, params.halfLifeSeconds);
  }
  const damped = Math.sqrt(raw);
  const cap = requiredConviction * params.maxSharePerMember;
  return cap > 0 ? Math.min(damped, cap) : damped;
}

// The position left after withdrawing `amountMicro`, walking stakes in the same
// order handleUnstake drains them (oldest id first, each emptied before the
// next) so a projection describes the transaction the button actually sends.
// A partially drained stake keeps its created_at: the chain reduces it in place
// rather than replacing it, so its maturity carries over.
function stakesAfterWithdrawal(
  mine: RepStake[],
  amountMicro: bigint,
): { amount: string; created_at: string }[] {
  let remaining = amountMicro;
  const left: { amount: string; created_at: string }[] = [];
  for (const s of mine) {
    const amt = BigInt(s.amount || "0");
    if (amt <= BigInt(0)) continue;
    const take = remaining >= amt ? amt : remaining;
    remaining -= take;
    const rest = amt - take;
    if (rest > BigInt(0)) left.push({ amount: rest.toString(), created_at: s.created_at });
  }
  return left;
}

// Sorting happens chain-side: sort_by orders the complete initiative set
// before pagination, so a sorted first page is a true global first page and
// "Load more" continues in the same order. Newest/oldest use plain id order
// (ids are monotonic, so id order is creation order). The chain sorts status
// in enum order (actionable states first, terminal last), tier in enum order
// (Apprentice→Epic, reversed here for "highest first"), and conviction by the
// current/required completion ratio with ratioless initiatives always last.
type InitiativeSort =
  | "newest"
  | "oldest"
  | "status"
  | "reward-desc"
  | "reward-asc"
  | "conviction-desc"
  | "tier-desc";

const INITIATIVE_SORT_LABELS: Record<InitiativeSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  status: "Status",
  "reward-desc": "Reward: high to low",
  "reward-asc": "Reward: low to high",
  "conviction-desc": "Conviction: closest to done",
  "tier-desc": "Tier: highest first",
};

const INITIATIVE_SORT_QUERY: Record<InitiativeSort, { sortBy?: InitiativeSortKey; reverse: boolean }> = {
  newest: { reverse: true },
  oldest: { reverse: false },
  status: { sortBy: "status", reverse: false },
  "reward-desc": { sortBy: "budget", reverse: true },
  "reward-asc": { sortBy: "budget", reverse: false },
  "conviction-desc": { sortBy: "conviction", reverse: true },
  "tier-desc": { sortBy: "tier", reverse: true },
};

// Conviction meter — the primary per-row signal: how much conviction an
// initiative has gathered against the threshold it must clear to complete, as a
// percentage, a current/required figure, and a progress bar. An initiative with
// no required conviction (the permissionless ones) has no threshold to track, so
// it shows a muted note instead.
//
// The fill splits into two segments (design 2a): everyone else's conviction in
// the state color and *your* contribution in a lighter tint of the same hue.
// Both are conviction, not DREAM — a member at the per-member cap owns a smaller
// slice of the bar than their DREAM share would suggest, which is the point.
//
// This deliberately does NOT show DREAM staked against the initiative's budget.
// The two are different quantities (a budget of 80 DREAM against a threshold of
// 1788.85, a sqrt-damped score), and staked/budget saturates: three initiatives
// backed by 120, 180 and 190 DREAM all read "100% of an 80 DREAM budget" while
// their conviction was 66%, 132% and 66%. The DREAM behind an initiative stays
// available in the tooltip and in the expanded row.
//
// Conviction comes off the initiative itself, refreshed every block by the rep
// EndBlocker, so the percentage needs no per-row query and never renders a
// placeholder. Only `yours` depends on the stakes query.
function ConvictionMeter({
  current = 0,
  required = 0,
  yours = 0,
  externalCurrent = 0,
  externalRequired = 0,
  poolMicro,
  budgetMicro = BigInt(0),
  released = false,
}: {
  current?: number;
  required?: number;
  yours?: number;
  externalCurrent?: number;
  externalRequired?: number;
  poolMicro?: bigint;
  budgetMicro?: bigint;
  released?: boolean;
}) {
  const fmtConv = (n: number) => Math.round(n).toLocaleString();
  const fmtDream = (n: bigint) => formatDream(n.toString());
  if (released) {
    return (
      <div className="w-full" title="Threshold met, initiative completed and stakes returned">
        <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
          <span className="font-semibold text-emerald-400">Complete</span>
          <span className="truncate text-zinc-500">{fmtConv(required)} conviction</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-emerald-400/30" />
      </div>
    );
  }
  if (!(required > 0)) {
    return <div className="text-xs text-zinc-600">No conviction threshold</div>;
  }
  const ratio = current / required;
  // Two independent gates, both from CanCompleteInitiative: the total must reach
  // the threshold AND enough of it must come from members unaffiliated with the
  // work. An initiative over 100% that hasn't cleared the external gate is not
  // ready, so it reads amber rather than the emerald of a genuinely met bar.
  const totalMet = current >= required;
  const externalMet = externalRequired <= 0 || externalCurrent >= externalRequired;
  const met = totalMet && externalMet;
  const fillPct = Math.min(ratio, 1) * 100;
  const yoursPct = current > 0 ? fillPct * Math.min(yours / current, 1) : 0;
  const othersPct = Math.max(0, fillPct - yoursPct);
  const barColor = met ? "bg-emerald-400" : totalMet ? "bg-amber-400" : "bg-indigo-400";
  const yoursColor = met ? "bg-emerald-200" : totalMet ? "bg-amber-200" : "bg-indigo-300";
  const textColor = met ? "text-emerald-400" : totalMet ? "text-amber-400" : "text-indigo-300";
  const backing =
    poolMicro !== undefined
      ? ` · backed by ${fmtDream(poolMicro)} DREAM${
          budgetMicro > BigInt(0) ? ` toward a ${fmtDream(budgetMicro)} DREAM budget` : ""
        }`
      : "";
  const externalNote =
    externalRequired > 0
      ? ` · external ${fmtConv(externalCurrent)} / ${fmtConv(externalRequired)} required${
          totalMet && !externalMet ? " (not yet met)" : ""
        }`
      : "";
  return (
    <div
      className="w-full"
      title={`Conviction ${fmtConv(current)} / ${fmtConv(required)} required${externalNote}${backing}`}
    >
      <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
        <span className={`font-semibold ${textColor}`}>{Math.round(ratio * 100)}%</span>
        {/* Unit spelled out. Bare figures next to a "80 DREAM" budget on the
            metadata line above read as DREAM, and a conviction score is a
            different quantity an order of magnitude larger. */}
        <span className="truncate text-zinc-500">
          {fmtConv(current)} / {fmtConv(required)} conviction
        </span>
      </div>
      <div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-zinc-700/50">
        <div className={`h-full ${barColor}`} style={{ width: `${othersPct}%` }} />
        {yoursPct > 0 && <div className={`h-full ${yoursColor}`} style={{ width: `${yoursPct}%` }} />}
      </div>
    </div>
  );
}

// One row of the acceptance-criteria editor. `id` is what a challenger cites
// and what a reviewer's per-criterion verdict answers, so it is authored
// explicitly rather than generated from the question text.
type CriteriaDraft = {
  id: string;
  question: string;
  type: string;
  required: boolean;
  howToVerify: string;
};

const EMPTY_CRITERIA_DRAFT: CriteriaDraft = {
  id: "",
  question: "",
  type: CriteriaType.BINARY,
  required: true,
  howToVerify: "",
};

// Chain-side limits from x/rep/types/accountability_defaults.go. Enforced here
// so the form refuses what ValidateAcceptanceCriteria would reject at creation,
// where the criteria are already immutable.
const MAX_ACCEPTANCE_CRITERIA = 20;
const MAX_CRITERIA_ID_LENGTH = 64;
const MAX_CRITERIA_QUESTION_LENGTH = 512;

// CriteriaType travels as the numeric enum in tx messages and as the string
// form in LCD responses.
function criteriaTypeValue(type: string): number {
  switch (type) {
    case CriteriaType.SCALE:
      return CriteriaTypeValue.SCALE;
    case CriteriaType.TEXT:
      return CriteriaTypeValue.TEXT;
    default:
      return CriteriaTypeValue.BINARY;
  }
}

// Resolves an assignee address to its onchain name, falling back to the
// truncated bech32, for the compact row metadata. Plain text on purpose: the
// row itself is the click target (expand), so this stays non-interactive,
// unlike the expanded <CopyableAddress>. Uses useDisplayName so the row and the
// expanded detail agree on the same name.
function AssigneeName({ address }: { address: string }) {
  const { name } = useDisplayName(address);
  return <>{name || truncateAddress(address)}</>;
}

export default function InitiativeList() {
  const { address, signAndBroadcast } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMember = useIsRepMember(address);
  const canCreate = isMember === true;
  const canStake = isMember === true;
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [sort, setSort] = useState<InitiativeSort>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Projects back three things: the create-form dropdown, the project name
  // shown on every initiative row, and the project filter. Loaded once on
  // mount rather than lazily with the form so rows never render a bare id.
  const [projects, setProjects] = useState<RepProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  // Project creators may assign anyone; so may the Commons Operations
  // Committee. Anyone else can only take an initiative themselves — mirrors
  // msg_server_assign_initiative.go's authorization check.
  const projectCreatorById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.creator])),
    [projects],
  );
  const { isOpsCommitteeMember } = useCommonsCouncil(address ?? null);

  // Assign-to-member picker: which initiative it's open for, the chosen
  // assignee, and the member list backing it (loaded on first open).
  const [assignPickerFor, setAssignPickerFor] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState("");
  const [memberOptions, setMemberOptions] = useState<{ value: string; label: string }[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Submit-work panel: which initiative it's open for, plus the deliverable URI
  // and comments typed into it. This is the step that moves an ASSIGNED
  // initiative to SUBMITTED, where the conviction gates are evaluated.
  const [submitWorkFor, setSubmitWorkFor] = useState<string | null>(null);
  const [deliverableUri, setDeliverableUri] = useState("");
  const [submitComments, setSubmitComments] = useState("");

  // Review panel: which initiative it's open for and the reviewer's comments.
  // Shared by the approve and disapprove verdicts.
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [reviewComments, setReviewComments] = useState("");

  // Inline conviction staking: which initiative the stake form is open for and
  // the DREAM amount typed into it. Lets a member back an initiative from its
  // own details card instead of routing through the Staking view. The panel is
  // shared by adding stake ("stake") and withdrawing it ("unstake") — partial
  // unstaking reuses the same amount field rather than a separate all-or-nothing
  // confirmation, since MsgUnstake carries its own amount.
  const [stakePickerFor, setStakePickerFor] = useState<string | null>(null);
  const [stakeMode, setStakeMode] = useState<"stake" | "unstake">("stake");
  const [stakeAmount, setStakeAmount] = useState("");

  // Per-initiative stake info: every stake backing it, plus the `poolTotal`
  // DREAM they add up to. One stakes_by_target read per initiative — that query
  // returns the full repeated shape, unlike the broken stakes_by_staker.
  // Prefetched for every row (not just on expand) so a position reads at a
  // glance, and so the meter can size your segment against the pool.
  // `poolTotal` is DREAM, not conviction, so it only splits the meter
  // proportionally.
  //
  // Stakes are kept whole rather than pre-split into "mine" and a total, because
  // nothing here depends on who is signing: the signer's slice is derived at
  // render time. That keeps the pool — and with it the percentage every reader
  // sees — independent of whether a wallet is connected.
  const [stakeInfo, setStakeInfo] = useState<Record<string, { stakes: RepStake[]; poolTotal: string }>>({});
  // Ids already requested, so the prefetch effect never double-fetches. A ref
  // (not state) keeps it out of the effect's dependency loop.
  const stakeLoadRef = useRef<Set<string>>(new Set());

  // Conviction params drive the withdrawal projection (maturity half-life and
  // the per-member share ceiling). Defaults stand in until this lands, and on
  // an older node that doesn't report them.
  const [convictionParams, setConvictionParams] = useState<ConvictionParams>(DEFAULT_CONVICTION_PARAMS);
  // Hard ceiling on the DREAM one member may stake on a single initiative,
  // enforced by AddStake (ErrInitiativeStakeCap). Distinct from the conviction
  // share cap: that one only bounds how much a stake counts, this one rejects
  // the transaction outright, so the amount field has to respect it.
  const [maxStakePerMemberMicro, setMaxStakePerMemberMicro] = useState<bigint | null>(null);
  // Budget above which completion needs a bonded reviewer's approval, whatever
  // the parent project's policy says (chain commit 32f2cee). The gate keys on
  // how much DREAM a completion CREATES, so it applies to permissionless work
  // too — that is the path with no treasury behind it.
  const [reviewRequiredAboveMicro, setReviewRequiredAboveMicro] = useState<bigint | null>(null);
  // Fraction of the budget a PERMISSIONLESS initiative escrows as a review
  // bounty at creation, charged only above the threshold above. Below the gate
  // it would take DREAM for a review that never happens.
  const [minBountyRate, setMinBountyRate] = useState(0);
  useEffect(() => {
    getRepParams()
      .then((res) => {
        const p = (res.params as Record<string, unknown>) || {};
        const halfLifeEpochs = Number(p.conviction_half_life_epochs);
        const epochBlocks = Number(p.epoch_blocks);
        const maxShare = Number(p.max_conviction_share_per_member);
        const extRatio = Number(p.external_conviction_ratio);
        const selfExtRatio = Number(p.self_assigned_external_conviction_ratio);
        const reviewAbove = p.review_required_above_budget;
        if (typeof reviewAbove === "string" && /^\d+$/.test(reviewAbove)) {
          setReviewRequiredAboveMicro(BigInt(reviewAbove));
        }
        const bountyRate = Number(p.permissionless_min_review_bounty_rate);
        if (bountyRate > 0) setMinBountyRate(bountyRate);
        const maxStake = p.max_initiative_stake_per_member;
        if (typeof maxStake === "string" && /^\d+$/.test(maxStake)) {
          setMaxStakePerMemberMicro(BigInt(maxStake));
        }
        setConvictionParams({
          // Same arithmetic as the keeper: epochs x blocks x ~6s per block.
          halfLifeSeconds:
            halfLifeEpochs > 0 && epochBlocks > 0
              ? halfLifeEpochs * epochBlocks * 6
              : DEFAULT_CONVICTION_PARAMS.halfLifeSeconds,
          maxSharePerMember:
            maxShare > 0 ? maxShare : DEFAULT_CONVICTION_PARAMS.maxSharePerMember,
          externalRatio: extRatio > 0 ? extRatio : DEFAULT_CONVICTION_PARAMS.externalRatio,
          selfAssignedExternalRatio:
            selfExtRatio > 0 ? selfExtRatio : DEFAULT_CONVICTION_PARAMS.selfAssignedExternalRatio,
        });
      })
      .catch(() => {
        // Keep the defaults — the projection stays approximate, not absent.
      });
  }, []);

  // Project filter. Mirrored into `?project=` so a filtered list is
  // shareable and so Projects can deep-link into its own initiatives.
  const urlProject = searchParams.get("project") || "";
  const [projectFilter, setProjectFilter] = useState(urlProject);
  useEffect(() => {
    setProjectFilter(urlProject);
  }, [urlProject]);

  // `?initiative=<id>` opens one initiative directly — that's how the Review
  // queue links to the work it wants a verdict on. The list is paginated, so
  // the id is pushed through the search field (which matches a bare or #-
  // prefixed id) rather than assumed to be on the current page, and closed
  // statuses are unhidden so a completed one still resolves.
  const urlInitiative = searchParams.get("initiative") || "";
  useEffect(() => {
    if (!urlInitiative) return;
    setSearchQuery(`#${urlInitiative}`);
    setShowClosed(true);
    setExpanded(urlInitiative);
  }, [urlInitiative]);

  const selectProject = useCallback(
    (id: string) => {
      setProjectFilter(id);
      // Local state drives the render; the URL push is only for
      // shareability/back-forward (a same-pathname push doesn't reliably
      // re-fire useSearchParams).
      router.replace(`/contribute?view=initiatives${id ? `&project=${id}` : ""}`, { scroll: false });
    },
    [router],
  );

  // Create initiative form
  const [formProjectId, setFormProjectId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();
  const canCreateTags = useCanCreateTags(address);
  const [formTier, setFormTier] = useState<string>(InitiativeTier.STANDARD);
  const [formCategory, setFormCategory] = useState<string>(InitiativeCategory.FEATURE);
  const [formBudget, setFormBudget] = useState("");
  // Acceptance criteria: the definition of done, pre-committed before any work
  // starts and immutable afterwards. Optional, and empty by default — an
  // initiative with none can only ever be challenged free-form, which is what
  // every initiative could do before chain commit 70dce72.
  const [formCriteria, setFormCriteria] = useState<CriteriaDraft[]>([]);

  // Budget as micro-DREAM, for the review-gate notice under the form. Parsed
  // leniently: the field is free text and only compares against the threshold.
  const budgetMicro = useMemo(() => {
    const parsed = parseFloat(formBudget);
    return Number.isFinite(parsed) && parsed > 0
      ? BigInt(Math.floor(parsed * 1e6))
      : BigInt(0);
  }, [formBudget]);
  const selectedProjectPermissionless = useMemo(
    () => projects.find((p) => p.id === formProjectId)?.permissionless === true,
    [projects, formProjectId],
  );

  // One page of the list backing the current tab, sorted chain-side.
  //
  // Each tab now has a real chain query behind it: "Available" reads
  // available_initiatives (status OPEN) and "My assignments" reads
  // initiatives_by_assignee, both of which return repeated Initiative lists
  // since the singular-response fix. Against an older node those endpoints
  // still answer with the defective singular shape (no `initiatives` field),
  // so both fall back to the unfiltered list plus the client-side tab filter
  // that also covers the project-filtered path.
  //
  // A project filter can't be combined with a status/assignee filter
  // chain-side, so with one active every tab reads initiatives_by_project and
  // the tab narrows client-side, as before.
  const fetchPage = useCallback(async (tabSel: Tab, filterProject: string, sortSel: InitiativeSort, key?: string) => {
    const { sortBy, reverse } = INITIATIVE_SORT_QUERY[sortSel];
    const page = { limit: "50", reverse, ...(key ? { key } : {}) };
    if (filterProject) {
      const res = await initiativesByProject(filterProject, page, sortBy);
      return { items: res.initiatives || [], pageKey: res.pagination?.next_key || null };
    }
    if (tabSel === "available") {
      const res = await availableInitiatives(page, sortBy);
      if (res.initiatives) {
        return { items: res.initiatives, pageKey: res.pagination?.next_key || null };
      }
    } else if (tabSel === "mine") {
      if (!address) return { items: [], pageKey: null };
      const res = await initiativesByAssignee(address, page, sortBy);
      if (res.initiatives) {
        return { items: res.initiatives, pageKey: res.pagination?.next_key || null };
      }
    } else if (tabSel === "authored") {
      if (!address) return { items: [], pageKey: null };
      // initiatives_by_creator lands with the chain release that adds
      // Initiative.creator. An older node 404s here rather than answering with a
      // degenerate shape, so swallow the error and fall through to the
      // unfiltered list — the client-side creator filter below then narrows it,
      // and yields nothing while no initiative carries a creator yet.
      try {
        const res = await initiativesByCreator(address, page, sortBy);
        if (res.initiatives) {
          return { items: res.initiatives, pageKey: res.pagination?.next_key || null };
        }
      } catch {
        /* fall through */
      }
    }
    const res = await listRepInitiatives(page, sortBy);
    return { items: res.initiative || [], pageKey: res.pagination?.next_key || null };
  }, [address]);

  const fetchInitiatives = useCallback(async (tabSel: Tab, filterProject: string, sortSel: InitiativeSort) => {
    try {
      setRefreshing(true);
      setError(null);
      setNextKey(null);
      const { items, pageKey } = await fetchPage(tabSel, filterProject, sortSel);
      setInitiatives(items);
      setNextKey(pageKey);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setInitiatives([]);
      } else {
        setError(err);
      }
    } finally {
      setRefreshing(false);
      setInitialLoad(false);
    }
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const { items, pageKey } = await fetchPage(tab, projectFilter, sort, nextKey);
      setInitiatives((prev) => [...prev, ...items]);
      setNextKey(pageKey);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore, tab, projectFilter, sort, fetchPage]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await listRepProjects({ limit: "200" });
        if (!cancelled) setProjects(res.project || []);
      } catch {
        // Non-fatal: rows fall back to "Project #<id>" and the filter is empty.
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Members for the assign picker, loaded on first open. Names come from one
  // reverse-resolve per member — cheap at this list's size, and the label
  // degrades to the bare address when an address has no registered name.
  //
  // The once-guard is a ref, not `loadingMembers`: setting that state before
  // the first await re-ran this effect, whose cleanup then cancelled the very
  // fetch it had just started, leaving the picker spinning forever. A ref
  // doesn't re-render, and nothing here cancels — a late setState on an
  // unmounted component is a no-op.
  const membersRequested = useRef(false);
  useEffect(() => {
    if (!assignPickerFor || membersRequested.current) return;
    membersRequested.current = true;
    setLoadingMembers(true);
    (async () => {
      try {
        const res = await listRepMembers({ limit: "100" });
        const list = res.member || [];
        const names = await Promise.all(
          list.map((m) => reverseResolveName(m.address).then((r) => r.name || "").catch(() => "")),
        );
        setMemberOptions(
          list.map((m, i) => ({
            value: m.address,
            label: names[i] ? `${names[i]} · ${truncateAddress(m.address)}` : m.address,
          })),
        );
      } catch {
        // Let the next open retry rather than stranding an empty picker.
        membersRequested.current = false;
      } finally {
        setLoadingMembers(false);
      }
    })();
  }, [assignPickerFor]);

  // Default the create form to whichever project is being filtered on, else
  // the first one loaded.
  useEffect(() => {
    if (projects.length === 0) return;
    setFormProjectId((prev) => prev || projectFilter || projects[0].id);
  }, [projects, projectFilter]);

  useEffect(() => {
    fetchInitiatives(tab, projectFilter, sort);
  }, [tab, projectFilter, sort, fetchInitiatives]);

  // Auto-close the form once we learn the user isn't a member.
  useEffect(() => {
    if (isMember === false) {
      setShowForm(false);
      setCreateError(null);
    }
  }, [isMember]);

  const handleCreate = async () => {
    if (!address || !formTitle.trim() || !formProjectId) return;
    try {
      setSubmitting(true);
      setCreateError(null);
      const budgetAmount = formBudget ? (BigInt(Math.floor(parseFloat(formBudget) * 1e6))).toString() : "0";
      const tagMsgs = buildCreateTagMsgs(address, formTags, availableTags);
      await signAndBroadcast([
        ...tagMsgs,
        {
          typeUrl: RepMsgTypeUrls.CreateInitiative,
          value: {
            creator: address,
            // project_id / tier / category are uint64 on MsgCreateInitiative
            // (tier and category are proto3 enums on Initiative but the msg
            // declares them uint64 for wire compatibility). sparkdreamjs's
            // amino override compares each via `!== BigInt(0)` — passing a
            // JS Number makes the ternary always-truthy (Number !== BigInt is
            // always true under strict equality), so signing a zero category
            // emitted `"category":"0"` while the chain's aminojson omits
            // uint64 zeros, breaking sigverify as "unauthorized". This bit
            // every "Create Initiative" submission because the form's default
            // INITIATIVE_CATEGORY_FEATURE happens to be enum value 0. Wrap in
            // BigInt so the override correctly omits zero and the form keeps
            // working when STANDARD tier (1) is also picked. The enum-string
            // → number routing through *FromJSON still happens first to dodge
            // the prior `BigInt("INITIATIVE_TIER_STANDARD")` SyntaxError.
            projectId: BigInt(parseInt(formProjectId) || 0),
            title: formTitle.trim(),
            description: formDesc.trim(),
            tags: formTags,
            tier: BigInt(initiativeTierFromJSON(formTier)),
            category: BigInt(initiativeCategoryFromJSON(formCategory)),
            budget: budgetAmount,
            // The definition of done, immutable from here on. Chain commit
            // 70dce72 replaced template_id (which resolved against a registry
            // no message could write to) with these per-initiative criteria.
            // Rows with no question are dropped: an empty one fails
            // ValidateAcceptanceCriteria rather than being ignored.
            acceptanceCriteria: formCriteria
              .filter((c) => c.question.trim())
              .map((c, i) => ({
                id: c.id.trim() || `c${i + 1}`,
                question: c.question.trim(),
                type: criteriaTypeValue(c.type),
                required: c.required,
                howToVerify: c.howToVerify.trim(),
                evidence: "",
              })),
          },
        },
      ]);
      if (tagMsgs.length > 0) refreshTags();
      setShowForm(false);
      setFormTitle("");
      setFormDesc("");
      setFormTags([]);
      setFormBudget("");
      setFormCriteria([]);
      await fetchInitiatives(tab, projectFilter, sort);
    } catch (err) {
      console.error("Create initiative failed:", err);
      setCreateError(err instanceof Error ? err.message : "Failed to create initiative");
    } finally {
      setSubmitting(false);
    }
  };

  // `assignee` defaults to the signer (self-assign). Assigning anyone else is
  // only accepted from the parent project's creator or the Commons Operations
  // Committee — the picker is hidden otherwise, and the chain rejects it
  // regardless.
  const handleAssign = async (initiativeId: string, assignee?: string) => {
    if (!address) return;
    const target = assignee || address;
    try {
      setActionLoading(`assign-${initiativeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.AssignInitiative,
        // initiative_id is uint64; pass BigInt so the override's
        // `!== BigInt(0)` check survives JS strict equality (a Number(0)
        // would sign "initiative_id":"0" against an omit-zero chain).
        value: { creator: address, initiativeId: BigInt(initiativeId), assignee: target },
      }]);
      setAssignPickerFor(null);
      setAssignTarget("");
      await fetchInitiatives(tab, projectFilter, sort);
    } catch (err) {
      console.error("Assign failed:", err);
      setActionError({ id: initiativeId, message: txErrorMessage(err, "Failed to assign initiative") });
    } finally {
      setActionLoading(null);
    }
  };

  // Hands in the deliverable for an initiative you're assigned to. The chain
  // only accepts this from the assignee while the initiative is ASSIGNED, and
  // it doesn't check conviction here: submitting flips the status to SUBMITTED,
  // and the EndBlocker then evaluates the completion gates (total conviction,
  // the external share, no open challenges) every block from that point on.
  //
  // deliverable_uri has no ValidateBasic chain-side, so an empty string would
  // be accepted and leave the initiative in review with nothing to review. The
  // button is disabled until something is typed.
  const handleSubmitWork = async (initiativeId: string) => {
    if (!address || !deliverableUri.trim()) return;
    try {
      setActionLoading(`submit-${initiativeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.SubmitInitiativeWork,
        // initiative_id is uint64; BigInt keeps the amino converter's
        // `!== BigInt(0)` omit-zero check honest under JS strict equality.
        value: {
          creator: address,
          initiativeId: BigInt(initiativeId),
          deliverableUri: deliverableUri.trim(),
          comments: submitComments.trim(),
        },
      }]);
      setSubmitWorkFor(null);
      setDeliverableUri("");
      setSubmitComments("");
      await fetchInitiatives(tab, projectFilter, sort);
    } catch (err) {
      console.error("Submit work failed:", err);
      setActionError({ id: initiativeId, message: txErrorMessage(err, "Failed to submit work") });
    } finally {
      setActionLoading(null);
    }
  };

  // Records a staker's endorsement of submitted work, or the Operations
  // Committee's decision to end it.
  //
  // The two verdicts are not symmetric. Approval is advisory: the chain appends
  // the signer to `approvals` and nothing consults that list, so conviction and
  // the bonded reviewers' verdicts remain the gates on payout. Disapproval is
  // committee-only and abandons the initiative outright, returning its budget
  // and self-assign bond. The stake-weighted staker veto that used to sit here
  // was retired in chain commit 70dce72: it was held by exactly the people paid
  // on completion, and quality is the bonded reviewer's question now. Stakers
  // still exit by withdrawing stake, which drops conviction back below the bar.
  //
  // MsgApproveInitiative no longer carries criteria_votes at all. Per-criterion
  // verdicts moved to MsgSubmitInitiativeReview and MsgSubmitJurorVote, where
  // somebody is accountable for getting them right.
  const handleReview = async (initiativeId: string, approved: boolean) => {
    if (!address) return;
    const key = approved ? `approve-${initiativeId}` : `disapprove-${initiativeId}`;
    try {
      setActionLoading(key);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.ApproveInitiative,
        // initiative_id is uint64; BigInt keeps the amino override's
        // `!== BigInt(0)` omit-zero check honest under JS strict equality.
        value: {
          creator: address,
          initiativeId: BigInt(initiativeId),
          approved,
          comments: reviewComments.trim(),
        },
      }]);
      setReviewFor(null);
      setReviewComments("");
      await fetchInitiatives(tab, projectFilter, sort);
    } catch (err) {
      console.error("Review failed:", err);
      setActionError({
        id: initiativeId,
        message: txErrorMessage(err, approved ? "Failed to approve" : "Failed to end initiative"),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleAbandon = async (initiativeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`abandon-${initiativeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.AbandonInitiative,
        value: { creator: address, initiativeId: BigInt(initiativeId), reason: "" },
      }]);
      await fetchInitiatives(tab, projectFilter, sort);
    } catch (err) {
      console.error("Abandon failed:", err);
      setActionError({ id: initiativeId, message: txErrorMessage(err, "Failed to abandon initiative") });
    } finally {
      setActionLoading(null);
    }
  };

  // Retires an OPEN, unassigned initiative. Authorization mirrors
  // msg_server_cancel_initiative.go: project creator or Commons Operations
  // Committee — the same standing as assigning someone else, so the button is
  // gated by canAssignOthers below.
  const handleCancel = async (initiativeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`cancel-${initiativeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.CancelInitiative,
        // initiative_id is uint64; pass BigInt so the amino override's
        // `!== BigInt(0)` omit-zero check survives JS strict equality.
        value: { creator: address, initiativeId: BigInt(initiativeId), reason: "" },
      }]);
      await fetchInitiatives(tab, projectFilter, sort);
    } catch (err) {
      console.error("Cancel failed:", err);
      setActionError({ id: initiativeId, message: txErrorMessage(err, "Failed to cancel initiative") });
    } finally {
      setActionLoading(null);
    }
  };

  // Load stake info for one initiative: every stake on it (the correct repeated
  // shape from stakes_by_target) and the `poolTotal` DREAM they sum to.
  //
  // Pages through to the end rather than reading one 200-stake page: a
  // truncated page silently undercounts the pool, which shows up as a funding
  // percentage that is too low on exactly the most-backed initiatives. The page
  // cap also bounds the walk, so a node that keeps returning a next_key can't
  // spin this forever.
  const loadStakeInfo = useCallback(async (initiativeId: string) => {
    const targetType = stakeTargetTypeFromJSON(StakeTargetType.INITIATIVE);
    const all: RepStake[] = [];
    let key: string | undefined;
    try {
      for (let page = 0; page < 20; page++) {
        const res = await stakesByTarget(targetType, initiativeId, { limit: "200", key });
        all.push(...(res.stakes || []));
        key = res.pagination?.next_key || undefined;
        if (!key) break;
      }
      const poolTotal = all
        .reduce((sum, s) => sum + BigInt(s.amount || "0"), BigInt(0))
        .toString();
      setStakeInfo((prev) => ({ ...prev, [initiativeId]: { stakes: all, poolTotal } }));
    } catch {
      // Drop the id from the guard so a transient failure can be retried on the
      // next render pass, and leave the entry absent so the meter shows its
      // unknown state instead of claiming nothing is staked.
      stakeLoadRef.current.delete(initiativeId);
    }
  }, []);

  // Prefetch stake info for every loaded initiative so a position and a funding
  // percentage show without expanding. No wallet gate: the pool is public and
  // the percentage every reader sees comes from it, so gating this on a
  // connected signer left disconnected visitors reading 0% on every row. Closed
  // initiatives are fetched too — CANCELLED and ABANDONED ones keep their
  // stakes, and the expanded row still lists them.
  useEffect(() => {
    for (const ini of initiatives) {
      if (stakeLoadRef.current.has(ini.id)) continue;
      stakeLoadRef.current.add(ini.id);
      loadStakeInfo(ini.id);
    }
  }, [initiatives, loadStakeInfo]);

  // Stake DREAM directly on an initiative to build its conviction, without
  // leaving the Initiatives view. Mirrors StakingPanel's MsgStake for an
  // INITIATIVE target: target_id carries the initiative id and
  // target_identifier stays empty. BigInt on the uint64 id keeps the amino
  // override's `!== BigInt(0)` omit-zero check honest under JS strict equality.
  const handleStake = async (initiativeId: string) => {
    if (!address || !stakeAmount) return;
    const amt = parseFloat(stakeAmount);
    if (!(amt > 0)) return;
    try {
      setActionLoading(`stake-${initiativeId}`);
      setActionError(null);
      const amount = (BigInt(Math.floor(amt * 1e6))).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.Stake,
        value: {
          staker: address,
          targetType: stakeTargetTypeFromJSON(StakeTargetType.INITIATIVE),
          targetId: BigInt(initiativeId),
          targetIdentifier: "",
          amount,
        },
      }]);
      setStakePickerFor(null);
      setStakeAmount("");
      await Promise.all([
        loadStakeInfo(initiativeId),
        fetchInitiatives(tab, projectFilter, sort),
      ]);
    } catch (err) {
      console.error("Stake failed:", err);
      setActionError({ id: initiativeId, message: txErrorMessage(err, "Failed to stake") });
    } finally {
      setActionLoading(null);
    }
  };

  // Withdraw some or all of the signer's position on an initiative. MsgUnstake
  // carries an amount (the chain's RemoveStake reduces a stake in place and
  // emits a `stake_reduced` event for the remainder), so a position held across
  // several stakes is withdrawn by walking them in id order: drain each one
  // fully until the requested total is covered, then reduce the last touched
  // stake by just the remainder. Asking for the whole position reproduces the
  // old all-or-nothing path (one MsgUnstake per stake at its full amount).
  // `amount` is a micro-DREAM string, which the chain's math.Int field takes
  // verbatim and the amino converter passes straight through.
  const handleUnstake = async (initiativeId: string) => {
    if (!address) return;
    const mine = (stakeInfo[initiativeId]?.stakes ?? []).filter((s) => s.staker === address);
    if (mine.length === 0) return;
    const amt = parseFloat(stakeAmount);
    if (!(amt > 0)) return;
    let remaining = BigInt(Math.floor(amt * 1e6));
    if (remaining <= BigInt(0)) return;
    const msgs = [];
    for (const s of mine) {
      if (remaining <= BigInt(0)) break;
      const stakeAmt = BigInt(s.amount || "0");
      if (stakeAmt <= BigInt(0)) continue;
      const take = remaining >= stakeAmt ? stakeAmt : remaining;
      msgs.push({
        typeUrl: RepMsgTypeUrls.Unstake,
        value: { staker: address, stakeId: BigInt(s.id), amount: take.toString() },
      });
      remaining -= take;
    }
    if (msgs.length === 0) return;
    try {
      setActionLoading(`unstake-${initiativeId}`);
      setActionError(null);
      await signAndBroadcast(msgs);
      setStakePickerFor(null);
      setStakeAmount("");
      await Promise.all([
        loadStakeInfo(initiativeId),
        fetchInitiatives(tab, projectFilter, sort),
      ]);
    } catch (err) {
      console.error("Unstake failed:", err);
      setActionError({ id: initiativeId, message: txErrorMessage(err, "Failed to unstake") });
    } finally {
      setActionLoading(null);
    }
  };

  // Open the shared stake/unstake panel for an initiative. Expands the row so
  // the panel (which lives in the details) is in view, picks the mode, and
  // resets the amount/error so a stale figure from a prior open can't leak in.
  const openStakePanel = useCallback((id: string, mode: "stake" | "unstake") => {
    setExpanded(id);
    setStakeMode(mode);
    setStakePickerFor(id);
    setStakeAmount("");
    setActionError(null);
  }, []);
  const closeStakePanel = useCallback(() => {
    setStakePickerFor(null);
    setStakeAmount("");
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "available", label: "Available" },
    { key: "mine", label: "My assignments" },
    { key: "authored", label: "Authored by me" },
  ];

  // Projects the chain knows about but this UI hasn't loaded a name for
  // (older node, or beyond the 200-project page) still get a usable label.
  const projectLabel = (id: string) => projectNameById.get(id) || `Project #${id}`;
  const filterProjectLabel = projectFilter ? projectLabel(projectFilter) : "";

  // Assigning someone else needs project-creator or ops-committee standing.
  // If the parent project wasn't in the loaded page we can't prove creator
  // standing, so fall back to the committee check alone.
  const canAssignOthers = (ini: Initiative) =>
    !!address && (projectCreatorById.get(ini.project_id) === address || isOpsCommitteeMember);

  // The tab filters are a safety net over what fetchPage returned: they're
  // no-ops when the tab's own chain endpoint answered (its results already
  // satisfy the predicate), and they do the real narrowing on the
  // project-filtered path and the old-node fallback, where fetchPage serves
  // an unfiltered list. "Available" mirrors the chain's definition in
  // query_available_initiatives.go: status OPEN, exactly the set that can
  // still be assigned.
  const tabInitiatives = useMemo(() => {
    if (tab === "available") return initiatives.filter((i) => i.status === InitiativeStatus.OPEN);
    if (tab === "mine") return address ? initiatives.filter((i) => i.assignee === address) : [];
    // `creator` is absent on initiatives written before the field existed, so
    // this narrows to nothing rather than mislabelling them as anyone's.
    if (tab === "authored") return address ? initiatives.filter((i) => i.creator === address) : [];
    return initiatives;
  }, [initiatives, tab, address]);

  const closedCount = useMemo(
    () => tabInitiatives.filter((i) => CLOSED_STATUSES.has(i.status)).length,
    [tabInitiatives],
  );

  // Order comes from the chain (see fetchPage) — no client-side sort here.
  const visibleInitiatives = useMemo(
    () => (showClosed ? tabInitiatives : tabInitiatives.filter((i) => !CLOSED_STATUSES.has(i.status))),
    [tabInitiatives, showClosed],
  );

  // Free-text search over the loaded page, applied client-side on top of the
  // tab/closed filters. Matches title, description, tags, the numeric id (with
  // or without a leading #), assignee address, project name, and the category/
  // tier labels — the same fields a reader scans a row for.
  const searchedInitiatives = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleInitiatives;
    const bare = q.replace(/^#/, "");
    return visibleInitiatives.filter((i) => {
      if (i.title?.toLowerCase().includes(q)) return true;
      if (i.description?.toLowerCase().includes(q)) return true;
      if (i.id === bare) return true;
      if ((i.tags || []).some((t) => t.toLowerCase().includes(q))) return true;
      if (i.assignee?.toLowerCase().includes(q)) return true;
      if (i.creator?.toLowerCase().includes(q)) return true;
      if (projectLabel(i.project_id).toLowerCase().includes(q)) return true;
      const cat = (INITIATIVE_CATEGORY_LABELS[i.category] || i.category || "").toLowerCase();
      const tier = (INITIATIVE_TIER_LABELS[i.tier] || i.tier || "").toLowerCase();
      return cat.includes(q) || tier.includes(q);
    });
    // projectNameById backs projectLabel; re-run when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleInitiatives, searchQuery, projectNameById]);

  // Rail widget: live initiatives ranked by how close their conviction is to the
  // required threshold. Terminal ones (already complete/abandoned) are excluded
  // so the card shows work still climbing, not finished work sitting at 100%.
  const trendingInitiatives = useMemo(
    () =>
      initiatives
        .filter((i) => !CLOSED_STATUSES.has(i.status) && parseFloat(i.required_conviction || "0") > 0)
        .map((i) => {
          const cur = parseFloat(i.current_conviction || "0");
          const req = parseFloat(i.required_conviction || "0");
          // Unclamped: an initiative past its threshold is further along than
          // one sitting exactly on it, and clamping tied them all at 100%.
          return { i, ratio: Math.max(cur / req, 0) };
        })
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 5)
        .map(({ i, ratio }) => ({ id: i.id, title: i.title, metric: `${Math.round(ratio * 100)}%` })),
    [initiatives],
  );

  // Clicking a trending row expands that initiative and scrolls to it. Search is
  // cleared first so a filtered-out target still renders (trending is drawn from
  // the current tab's loaded set, so the row is always present once unfiltered).
  const handleTrendingSelect = useCallback((id: string) => {
    setSearchQuery("");
    setExpanded(id);
    requestAnimationFrame(() => {
      document.getElementById(`initiative-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  // "No initiatives yet" would be wrong when the only ones loaded are closed
  // and currently hidden, so the empty state names whichever subset is empty.
  const emptyKind =
    tab === "available" ? "available "
    : tab === "mine" ? "assigned "
    : tab === "authored" ? "authored "
    : closedCount > 0 && !showClosed ? "active "
    : "";
  const emptyMessage = searchQuery.trim()
    ? `No initiatives match "${searchQuery.trim()}"`
    : projectFilter
    ? `No ${emptyKind}initiatives in ${filterProjectLabel}`
    : emptyKind
    ? `No ${emptyKind}initiatives`
    : "No initiatives yet";

  if (initialLoad) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl sd-hull-tile" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState error={error} onRetry={() => fetchInitiatives(tab, projectFilter, sort)} />
    );
  }

  return (
    <div className="flex gap-6">
      <div className="min-w-0 flex-1">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Initiatives</h2>
          {refreshing && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
          )}
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={!address || !canCreate}
            title={
              !address
                ? "Connect a wallet to create an initiative"
                : isMember === false
                ? "Only existing members can create initiatives"
                : "MsgCreateInitiative"
            }
            className="sd-btn sd-btn-primary"
          >
            Create initiative
          </button>
        )}
      </div>

      {address && isMember === false && (
        <p className="mb-3 text-xs text-zinc-500">
          Want to create an initiative? Creating initiatives is open to members. Ask any existing{" "}
          <Link href="/contribute?view=members" className="text-indigo-400 hover:text-indigo-300 underline">
            member
          </Link>
          {" "}to invite you in. We&apos;d love to have you contribute.
        </p>
      )}

      {showForm && canCreate && (
        <div className="mb-4 rounded-xl sd-hull-tile p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">New initiative</h3>
          <div className="space-y-3">
            {createError && (
              <div className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-400">
                {createError}
              </div>
            )}
            {loadingProjects ? (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-zinc-500">
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
                Loading projects...
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-2 text-sm text-zinc-500">
                No projects available — create a project first
              </div>
            ) : (
              <SearchableSelect
                options={projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` }))}
                value={formProjectId}
                onChange={setFormProjectId}
                placeholder="Search projects..."
                emptyMessage="No matching projects"
              />
            )}
            <input
              type="text"
              placeholder="Title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            <textarea
              placeholder="Description"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={formTier}
                onChange={(e) => setFormTier(e.target.value)}
                className="sd-select"
              >
                {Object.entries(INITIATIVE_TIER_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="sd-select"
              >
                {Object.entries(INITIATIVE_CATEGORY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TagPicker
                options={availableTags}
                value={formTags}
                onChange={setFormTags}
                placeholder={canCreateTags ? "Select or create tags..." : "Select tags..."}
                loading={loadingTags}
                allowCreate={canCreateTags}
              />
              <input
                type="text"
                placeholder="Budget (DREAM)"
                value={formBudget}
                onChange={(e) => setFormBudget(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Acceptance criteria. Optional, and worth saying why they are
                worth writing: they are fixed before any work starts, so they
                give a challenger something objective to point at and a reviewer
                a real question to answer instead of a free-form impression. */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Definition of done
                </h4>
                <button
                  type="button"
                  onClick={() => setFormCriteria((prev) => [...prev, { ...EMPTY_CRITERIA_DRAFT }])}
                  disabled={formCriteria.length >= MAX_ACCEPTANCE_CRITERIA}
                  className="sd-btn sd-btn-secondary"
                >
                  Add criterion
                </button>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                Optional, and fixed once the initiative exists. Each criterion gives a
                challenger a concrete claim to dispute and a reviewer a specific question to
                answer. Up to {MAX_ACCEPTANCE_CRITERIA}.
              </p>
              {formCriteria.map((c, idx) => (
                <div key={idx} className="mt-2 rounded border border-zinc-800 p-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      placeholder={`id (defaults to c${idx + 1})`}
                      value={c.id}
                      maxLength={MAX_CRITERIA_ID_LENGTH}
                      onChange={(e) =>
                        setFormCriteria((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, id: e.target.value } : x)),
                        )
                      }
                      className="w-32 rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <select
                      value={c.type}
                      onChange={(e) =>
                        setFormCriteria((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, type: e.target.value } : x)),
                        )
                      }
                      className="rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                    >
                      {Object.entries(CRITERIA_TYPE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={c.required}
                        onChange={(e) =>
                          setFormCriteria((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, required: e.target.checked } : x)),
                          )
                        }
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => setFormCriteria((prev) => prev.filter((_, i) => i !== idx))}
                      className="ml-auto text-xs text-zinc-500 transition-colors hover:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="What has to be true for this to be done?"
                    value={c.question}
                    maxLength={MAX_CRITERIA_QUESTION_LENGTH}
                    onChange={(e) =>
                      setFormCriteria((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, question: e.target.value } : x)),
                      )
                    }
                    className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="How to verify it (optional)"
                    value={c.howToVerify}
                    maxLength={MAX_CRITERIA_QUESTION_LENGTH}
                    onChange={(e) =>
                      setFormCriteria((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, howToVerify: e.target.value } : x)),
                      )
                    }
                    className="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>

            {/* What creating this will cost beyond the budget itself. Both
                notices key on the same chain-wide threshold. */}
            {reviewRequiredAboveMicro !== null &&
              reviewRequiredAboveMicro > BigInt(0) &&
              budgetMicro > reviewRequiredAboveMicro && (
              <p className="text-xs leading-relaxed text-zinc-500">
                A budget this size needs at least one bonded reviewer&apos;s approval before it
                can complete.
                {selectedProjectPermissionless && minBountyRate > 0 && (
                  <>
                    {" "}
                    Because this project is permissionless, creating it also locks{" "}
                    <span style={{ color: "var(--amber)" }}>
                      {formatDream(
                        ((budgetMicro * BigInt(Math.round(minBountyRate * 1e6))) / BigInt(1e6)).toString(),
                      )}{" "}
                      DREAM
                    </span>{" "}
                    of yours as a review bounty, so the review is paid for by whoever
                    commissions the mint.
                  </>
                )}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !formTitle.trim() || !formProjectId}
                className="sd-btn sd-btn-primary"
              >
                {submitting ? "Creating..." : "Create initiative"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setCreateError(null);
                }}
                className="sd-btn sd-btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-3">
        <SearchField
          ref={searchRef}
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search initiatives by title, tag, #id, or assignee..."
        />
      </div>

      {/* Tabs + project filter */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-1 gap-1 rounded-lg sd-hull-tile p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="sm:w-48">
          <SearchableSelect
            options={[
              { value: "", label: "All projects" },
              ...projects.map((p) => ({ value: p.id, label: `${p.name} (#${p.id})` })),
            ]}
            value={projectFilter}
            onChange={selectProject}
            placeholder={loadingProjects ? "Loading projects..." : "Filter by project..."}
            emptyMessage="No matching projects"
          />
        </div>
        <div className="sm:w-40">
          <SearchableSelect
            options={(Object.entries(INITIATIVE_SORT_LABELS) as [InitiativeSort, string][]).map(
              ([val, label]) => ({ value: val, label }),
            )}
            value={sort}
            onChange={(v) => setSort(v as InitiativeSort)}
            searchable={false}
          />
        </div>
      </div>

      {/* Only worth a control once there's something to reveal. The Available
          tab is open-only by definition, so it never has a closed count. */}
      {tab !== "available" && (closedCount > 0 || showClosed) && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            className="text-xs text-zinc-500 underline transition-colors hover:text-zinc-300"
          >
            {showClosed
              ? "Hide closed initiatives"
              : `Show ${closedCount} closed initiative${closedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {searchedInitiatives.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">{emptyMessage}</p>
          {searchQuery.trim() && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="mt-3 text-xs text-indigo-400 underline hover:text-indigo-300"
            >
              Clear search
            </button>
          )}
          {projectFilter && (
            <button
              type="button"
              onClick={() => selectProject("")}
              className="mt-3 text-xs text-indigo-400 underline hover:text-indigo-300"
            >
              Clear project filter
            </button>
          )}
          {/* A tab filtered client-side can come up empty while later pages
              still hold matches, so the empty state has to offer the next
              page too. Otherwise the list would be a dead end. */}
          {nextKey && (
            <div>
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-3 text-xs text-indigo-400 underline hover:text-indigo-300 disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load more initiatives"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {searchedInitiatives.map((ini) => {
            // Your position on this initiative and the total staked pool, used by
            // the YOU pill, the segmented meter, and the stake/unstake panel.
            // `info` absent means the stakes query hasn't landed; poolMicro stays
            // undefined so the tooltip omits the DREAM backing rather than
            // claiming none. The conviction bar itself doesn't wait on it.
            const info = stakeInfo[ini.id];
            const mineStakes = address ? (info?.stakes ?? []).filter((s) => s.staker === address) : [];
            const yoursMicro = mineStakes.reduce((s, x) => s + BigInt(x.amount || "0"), BigInt(0));
            const poolMicro = info ? BigInt(info.poolTotal) : undefined;
            const hasStake = yoursMicro > BigInt(0);
            const curConv = parseFloat(ini.current_conviction || "0");
            const reqConv = parseFloat(ini.required_conviction || "0");
            // Your DREAM stated as a plain fraction of the pool rather than a
            // percentage. A bare "17% of pool" invited being read as your share
            // of the initiative's progress, which it is not: DREAM share and
            // conviction share diverge under sqrt dampening and the per-member
            // cap (30 of 180 DREAM is 17% of the pool but 25% of the conviction
            // once four members are all capped). The percentage that decides
            // anything is the conviction one, below.
            const poolStr =
              poolMicro !== undefined ? `of ${formatDream(poolMicro.toString())} staked` : "";
            const canManageStake = !CLOSED_STATUSES.has(ini.status);
            // Completion unlocks and deletes every stake, so a COMPLETED
            // initiative has an empty pool by design rather than by neglect.
            const stakesReleased = ini.status === InitiativeStatus.COMPLETED;
            // The external-conviction gate the chain checks alongside the total.
            // A self-assigned initiative (assignee is the project creator) needs
            // the whole threshold from unaffiliated members.
            const extConv = parseFloat(ini.external_conviction || "0");
            const extRatio =
              ini.assignee && projectCreatorById.get(ini.project_id) === ini.assignee
                ? convictionParams.selfAssignedExternalRatio
                : convictionParams.externalRatio;
            const extReqConv = reqConv * extRatio;

            // Endorsement standing, mirroring msg_server_approve_initiative.go:
            // an active stake on the initiative or a seat on the Operations
            // Committee, minus the conflict-of-interest exclusion that bars the
            // assignee and the parent project's creator from judging the work.
            // Ending the initiative is committee-only; a staker's button only
            // records the advisory endorsement.
            const inReview =
              ini.status === InitiativeStatus.SUBMITTED ||
              ini.status === InitiativeStatus.IN_REVIEW;
            const isConflicted =
              !!address &&
              (ini.assignee === address || projectCreatorById.get(ini.project_id) === address);
            const canReview =
              inReview && !!address && !isConflicted && (hasStake || isOpsCommitteeMember);
            const youApproved = !!address && (ini.approvals ?? []).includes(address);
            // Shared stake/unstake panel values. Only this row's panel reads
            // them, but they're cheap and keep the JSX below branch-free. In
            // unstake mode the amount is bounded by the signer's position.
            const panelOpen = stakePickerFor === ini.id;
            const isUnstakePanel = panelOpen && stakeMode === "unstake";
            const amtNum = stakeAmount ? parseFloat(stakeAmount) : NaN;
            const amtMicro = Number.isFinite(amtNum) && amtNum > 0 ? BigInt(Math.floor(amtNum * 1e6)) : BigInt(0);
            const maxDreamStr = formatDreamExact(yoursMicro.toString());
            const overPosition = isUnstakePanel && amtMicro > yoursMicro;
            // AddStake rejects anything that would push a member's total on one
            // initiative past max_initiative_stake_per_member, so catch it here
            // rather than letting the tx fail at broadcast.
            const overStakeCap =
              !isUnstakePanel &&
              maxStakePerMemberMicro !== null &&
              yoursMicro + amtMicro > maxStakePerMemberMicro;
            const stakeHeadroomStr =
              maxStakePerMemberMicro !== null && maxStakePerMemberMicro > yoursMicro
                ? formatDreamExact((maxStakePerMemberMicro - yoursMicro).toString())
                : "0";
            const amountOk = amtMicro > BigInt(0) && !overPosition && !overStakeCap;
            // Conviction after this withdrawal. Conviction is not proportional
            // to DREAM: it is sqrt-damped and capped per member, so the old
            // pool-share estimate (conviction falls by your share of the pool)
            // was wrong by roughly 2x in both directions — worst where a staker
            // sits at the per-member cap, whose conviction doesn't move at all
            // until the withdrawal drops them under it. Recompute your own
            // contribution before and after under the chain's own rules and
            // swap it into the reported total.
            const nowSeconds = Math.floor(Date.now() / 1000);
            const yoursConvNow = stakerConviction(mineStakes, reqConv, nowSeconds, convictionParams);
            const yoursConvAfter = stakerConviction(
              stakesAfterWithdrawal(mineStakes, amtMicro),
              reqConv,
              nowSeconds,
              convictionParams,
            );
            const atConvictionCap =
              reqConv > 0 && yoursConvNow >= reqConv * convictionParams.maxSharePerMember - 1e-9;
            // Your slice of the conviction actually gathered — the same fraction
            // the meter draws as your segment, so the panel and the bar agree.
            const convShare = curConv > 0 && yoursConvNow > 0 ? yoursConvNow / curConv : 0;
            const postConv = Math.max(0, curConv - yoursConvNow + yoursConvAfter);
            const postConvPct = reqConv > 0 ? Math.round(Math.min(postConv / reqConv, 1) * 100) : 0;
            const remainingMicro = isUnstakePanel && amountOk ? yoursMicro - amtMicro : BigInt(0);
            return (
            <div key={ini.id} id={`initiative-${ini.id}`} className="@container rounded-xl sd-hull-tile">
              {/* Conviction-first row (design 1b): the title leads, the funding
                  meter is the primary right-hand axis, and every open row carries
                  a Stake affordance. The right cluster drops below the title where
                  the pane is narrow (@2xl). Container queries, not viewport ones:
                  the list shares the pane with a fixed sidebar and the rail. */}
              <div
                onClick={() => setExpanded(expanded === ini.id ? null : ini.id)}
                className="flex cursor-pointer flex-col gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-white/[0.02] @2xl:flex-row @2xl:items-center @2xl:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-zinc-100">
                      {ini.title}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-500">#{ini.id}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ini.status)}`}>
                      {INITIATIVE_STATUS_LABELS[ini.status] || ini.status}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tierColor(ini.tier)}`}>
                      {INITIATIVE_TIER_LABELS[ini.tier] || ini.tier}
                    </span>
                    {/* Your position, visible without expanding (design 2a). */}
                    {hasStake && (
                      <span
                        title="Your stake on this initiative"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/[0.13] px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-300"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                        YOU {formatDream(yoursMicro.toString())} DREAM
                      </span>
                    )}
                  </div>
                  {/* One compact metadata line — project (links through),
                      category, budget, assignee. Budget and conviction are not
                      repeated in the expanded panel. */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                    <Link
                      href={`/contribute?view=projects&project=${ini.project_id}`}
                      title={`View project ${projectLabel(ini.project_id)} (#${ini.project_id})`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 text-indigo-300/90 transition-colors hover:text-indigo-200"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0 text-indigo-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      <span className="truncate">{projectLabel(ini.project_id)}</span>
                    </Link>
                    <span className="text-zinc-700">·</span>
                    <span>{INITIATIVE_CATEGORY_LABELS[ini.category] || ini.category}</span>
                    <span className="text-zinc-700">·</span>
                    <span className="font-mono">{formatDream(ini.budget)} DREAM</span>
                    {ini.assignee && (
                      <>
                        <span className="text-zinc-700">·</span>
                        <span className="truncate">Assigned <AssigneeName address={ini.assignee} /></span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 @2xl:shrink-0 @2xl:gap-4">
                  <div className="min-w-0 flex-1 @2xl:w-56 @2xl:flex-none">
                    <ConvictionMeter
                      current={curConv}
                      required={reqConv}
                      yours={yoursConvNow}
                      externalCurrent={extConv}
                      externalRequired={extReqConv}
                      poolMicro={poolMicro}
                      budgetMicro={BigInt(ini.budget || "0")}
                      released={stakesReleased}
                    />
                  </div>
                  {/* Stake affordance, keyed to your position (design 2a): Stake
                      when you hold none, Add + Unstake when you do. Both open
                      the shared amount panel below — unstaking supports partial
                      withdrawals, so it takes an amount, not a confirmation. */}
                  {canManageStake && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStakePanel(ini.id, "stake");
                        }}
                        disabled={!canStake}
                        title={
                          !address
                            ? "Connect a wallet to stake"
                            : isMember === false
                            ? "Only existing members can stake"
                            : atConvictionCap
                            ? "Add to your stake. Your conviction is already at the per-member cap, so more DREAM earns rewards rather than adding progress"
                            : hasStake
                            ? "Add to your stake"
                            : "Stake DREAM toward this initiative's conviction"
                        }
                        className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {hasStake ? "Add" : "Stake"}
                      </button>
                      {hasStake && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openStakePanel(ini.id, "unstake");
                          }}
                          title="Withdraw some or all of your stake"
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-zinc-200"
                        >
                          Unstake
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpanded(expanded === ini.id ? null : ini.id);
                    }}
                    aria-label={expanded === ini.id ? "Collapse details" : "Expand details"}
                    className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    <svg
                      className={`h-4 w-4 transition-transform ${expanded === ini.id ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Add/withdrawal panel, directly under the row's Add/Unstake buttons
                  so the amount field sits next to the control that opened it,
                  rather than at the bottom of the expanded details. */}
              {stakePickerFor === ini.id && (
                <div className="mx-4 mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label className="block text-xs text-zinc-400">
                      {isUnstakePanel ? "Withdraw DREAM from your stake" : "Stake DREAM toward conviction"}
                    </label>
                    {isUnstakePanel && (
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        Position {maxDreamStr}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      placeholder="Amount (DREAM)"
                      value={stakeAmount}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^\d*\.?\d*$/.test(v)) setStakeAmount(v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && amountOk) {
                          if (isUnstakePanel) handleUnstake(ini.id);
                          else handleStake(ini.id);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                    />
                    {isUnstakePanel && (
                      <button
                        type="button"
                        onClick={() => setStakeAmount(maxDreamStr)}
                        disabled={yoursMicro <= BigInt(0)}
                        title="Fill your whole position"
                        className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
                      >
                        Max
                      </button>
                    )}
                  </div>
                  {stakeAmount !== "" && !amountOk && (
                    <p className="mt-1.5 text-xs text-red-400">
                      {overPosition
                        ? `Enter at most ${maxDreamStr} DREAM`
                        : overStakeCap
                        ? `One member may stake at most ${formatDream(
                            (maxStakePerMemberMicro ?? BigInt(0)).toString(),
                          )} DREAM on an initiative. You can add ${stakeHeadroomStr} more.`
                        : "Enter a valid amount greater than 0"}
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                    {isUnstakePanel ? (
                      <>
                        {yoursConvAfter >= yoursConvNow ? (
                          <>
                            Conviction stays near{" "}
                            <span className="font-mono text-zinc-300">{postConvPct}%</span> of what this
                            initiative needs. Your remaining stake still counts for as much, since a member&apos;s
                            conviction is capped at a share of the threshold.
                          </>
                        ) : (
                          <>
                            Conviction drops to roughly{" "}
                            <span className="font-mono text-zinc-300">{postConvPct}%</span> of what this
                            initiative needs.
                          </>
                        )}
                        {amountOk && remainingMicro > BigInt(0)
                          ? ` ${formatDreamExact(remainingMicro.toString())} DREAM stays staked.`
                          : amountOk
                          ? " Withdrawing everything returns the full amount and you'd stake again from zero."
                          : ""}
                      </>
                    ) : atConvictionCap ? (
                      <>
                        {/* Staking on past the cap is allowed and not pointless:
                            completion rewards are proportional to DREAM staked,
                            not to conviction. Saying so is the honest version of
                            leaving Add enabled. */}
                        Your conviction is already at the per-member cap of{" "}
                        {Math.round(reqConv * convictionParams.maxSharePerMember).toLocaleString()}, so more DREAM
                        here won&apos;t move this initiative closer to its threshold. It still increases your share
                        of the rewards paid out on completion. To raise the conviction, ask another member to stake.
                      </>
                    ) : (
                      <>
                        Your stake counts toward the{" "}
                        {parseFloat(ini.required_conviction || "0").toFixed(2)} conviction this initiative needs.
                        You can unstake or claim rewards later from the Staking view.
                      </>
                    )}
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => (isUnstakePanel ? handleUnstake(ini.id) : handleStake(ini.id))}
                      disabled={
                        !amountOk ||
                        actionLoading === (isUnstakePanel ? `unstake-${ini.id}` : `stake-${ini.id}`)
                      }
                      className="sd-btn sd-btn-primary"
                    >
                      {actionLoading === (isUnstakePanel ? `unstake-${ini.id}` : `stake-${ini.id}`)
                        ? isUnstakePanel
                          ? "Unstaking..."
                          : "Staking..."
                        : isUnstakePanel
                        ? "Unstake"
                        : "Stake"}
                    </button>
                    <button
                      type="button"
                      onClick={closeStakePanel}
                      className="sd-btn sd-btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {actionError?.id === ini.id && (
                <p className="mx-4 mb-2 text-xs text-red-400">{actionError.message}</p>
              )}

              {expanded === ini.id && (
                <div className="border-t border-zinc-800 px-4 py-3 text-sm">
                  {/* Description + metadata on the left, your position card on the
                      right (design 2a). ID/budget/conviction live in the row. */}
                  <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-[minmax(0,1fr)_17rem]">
                    <div className="min-w-0">
                      {ini.description && <p className="mb-3 text-zinc-400">{ini.description}</p>}

                      {(ini.creator || ini.assignee || (ini.self_assign_bond && ini.self_assign_bond !== "0") || ini.deliverable_uri) && (
                        <dl className="flex flex-wrap gap-x-8 gap-y-2">
                          {/* Authorship is only on state for initiatives created
                              after the creator field shipped; older ones simply
                              omit the term rather than showing a blank. */}
                          {ini.creator && (
                            <div className="min-w-0">
                              <dt className="text-xs text-zinc-500">Author</dt>
                              <dd className="text-zinc-300">
                                <CopyableAddress address={ini.creator} prefixLen={10} suffixLen={6} resolveName />
                              </dd>
                            </div>
                          )}
                          {ini.assignee && (
                            <div className="min-w-0">
                              <dt className="text-xs text-zinc-500">Assignee</dt>
                              <dd className="text-zinc-300">
                                <CopyableAddress address={ini.assignee} prefixLen={10} suffixLen={6} resolveName />
                              </dd>
                            </div>
                          )}
                          {ini.self_assign_bond && ini.self_assign_bond !== "0" && (
                            <div>
                              <dt className="text-xs text-zinc-500">Self-assign bond</dt>
                              <dd style={{ color: "var(--amber)" }}>{formatDream(ini.self_assign_bond)} DREAM</dd>
                            </div>
                          )}
                          {ini.deliverable_uri && (
                            <div className="min-w-0 max-w-xs">
                              <dt className="text-xs text-zinc-500">Deliverable</dt>
                              <dd className="truncate text-zinc-300">{ini.deliverable_uri}</dd>
                            </div>
                          )}
                          {/* Staker endorsements. Kept separate from the
                              reviewer verdicts below, because they are a
                              different claim: this one says members who backed
                              the work like the result, and nothing reads it. */}
                          {inReview && (ini.approvals?.length ?? 0) > 0 && (
                            <div className="min-w-0">
                              <dt className="text-xs text-zinc-500">Endorsements</dt>
                              <dd className="text-emerald-400">
                                {ini.approvals.length} staker
                                {ini.approvals.length === 1 ? "" : "s"}
                              </dd>
                            </div>
                          )}
                        </dl>
                      )}

                      {ini.tags?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {ini.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* YOUR POSITION (design 2a): your exposure, share of the
                        pool, and the same Add / Unstake affordances as the row.
                        Add and Unstake both open the shared amount panel below. */}
                    <div>
                      <div className="rounded-xl border border-indigo-500/20 bg-zinc-950/40 p-4">
                        <div className="font-mono text-[10px] font-semibold tracking-wider text-indigo-400">
                          YOUR POSITION
                        </div>
                        {!address ? (
                          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                            Connect a wallet to stake on this initiative.
                          </p>
                        ) : hasStake ? (
                          <>
                            <div className="mt-2 flex items-baseline gap-1.5">
                              <span className="font-mono text-2xl font-semibold text-zinc-100">
                                {formatDream(yoursMicro.toString())}
                              </span>
                              <span className="text-xs text-zinc-500">DREAM {poolStr}</span>
                            </div>
                            <div className="mt-2.5 flex flex-col gap-1 font-mono text-[10.5px] text-zinc-500">
                              <span>{mineStakes.length} stake{mineStakes.length === 1 ? "" : "s"}</span>
                              {/* What the position is actually worth to the
                                  completion gate. Worth stating separately from
                                  the DREAM figure above: the two diverge once
                                  sqrt dampening and the per-member cap bite, and
                                  at the cap more DREAM buys no more conviction. */}
                              {reqConv > 0 && (
                                <span>
                                  {Math.round(yoursConvNow).toLocaleString()} conviction ·{" "}
                                  {Math.round(convShare * 100)}% of the total
                                  {atConvictionCap ? " · at the per-member cap" : ""}
                                </span>
                              )}
                              <span>Withdraw any amount, up to the full position.</span>
                            </div>
                            {canManageStake && (
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => openStakePanel(ini.id, "stake")}
                                  disabled={!canStake}
                                  className="flex-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Add stake
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openStakePanel(ini.id, "unstake")}
                                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-zinc-200"
                                >
                                  Unstake
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                              You haven&apos;t staked here. Backing an initiative signals it should be built and is
                              refundable until it&apos;s accepted.
                            </p>
                            {canManageStake && (
                              <button
                                type="button"
                                onClick={() => openStakePanel(ini.id, "stake")}
                                disabled={!canStake}
                                title={isMember === false ? "Only existing members can stake" : undefined}
                                className="sd-btn sd-btn-primary mt-3 w-full justify-center"
                              >
                                Stake DREAM
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* The bonded-reviewer gate: verdicts filed on the deliverable,
                      the bounty bidding for reviewer attention, and the actions a
                      reviewer or the Operations Committee can take. Full width
                      below the two columns, and mounted only while the card is
                      open, since it owns four reads of its own. */}
                  <InitiativeReviewPanel
                    initiative={ini}
                    projectCreator={projectCreatorById.get(ini.project_id)}
                    isOpsCommitteeMember={isOpsCommitteeMember}
                    onChanged={() => { void fetchInitiatives(tab, projectFilter, sort); }}
                  />

                  {/* Disputes over the same deliverable, directly under the
                      verdicts on it: a challenge is what a reader does when
                      they think the reviewers got it wrong. */}
                  <InitiativeChallengePanel
                    initiative={ini}
                    onChanged={() => { void fetchInitiatives(tab, projectFilter, sort); }}
                  />

                  {/* Actions */}
                  {(ini.status === InitiativeStatus.OPEN ||
                    (ini.status === InitiativeStatus.ASSIGNED && ini.assignee === address) ||
                    canReview) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
                    {ini.status === InitiativeStatus.OPEN && (
                      <button
                        type="button"
                        onClick={() => handleAssign(ini.id)}
                        disabled={actionLoading === `assign-${ini.id}` || !canCreate}
                        title={
                          isMember === false
                            ? "Only existing members can self-assign initiatives"
                            : undefined
                        }
                        className="sd-btn sd-btn-primary"
                      >
                        {actionLoading === `assign-${ini.id}` ? "Assigning..." : "Assign to me"}
                      </button>
                    )}
                    {ini.status === InitiativeStatus.OPEN && canAssignOthers(ini) && assignPickerFor !== ini.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssignPickerFor(ini.id);
                          setAssignTarget("");
                          setActionError(null);
                        }}
                        title={
                          projectCreatorById.get(ini.project_id) === address
                            ? "You created this project"
                            : "Commons Operations Committee"
                        }
                        className="sd-btn sd-btn-secondary"
                      >
                        Assign to member...
                      </button>
                    )}
                    {ini.status === InitiativeStatus.ASSIGNED &&
                      ini.assignee === address &&
                      submitWorkFor !== ini.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setSubmitWorkFor(ini.id);
                          setDeliverableUri("");
                          setSubmitComments("");
                          setActionError(null);
                        }}
                        className="sd-btn sd-btn-primary"
                      >
                        Submit work
                      </button>
                    )}
                    {ini.status === InitiativeStatus.ASSIGNED && ini.assignee === address && (
                      <button
                        onClick={() => handleAbandon(ini.id)}
                        disabled={actionLoading === `abandon-${ini.id}`}
                        className="rounded-lg border border-red-700 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
                      >
                        {actionLoading === `abandon-${ini.id}` ? "Abandoning..." : "Abandon"}
                      </button>
                    )}
                    {/* Cancel retires an OPEN initiative before anyone takes it
                        on. Project creator / ops committee only, and never once
                        assigned (the assignee's Abandon owns that exit). */}
                    {ini.status === InitiativeStatus.OPEN && !ini.assignee && canAssignOthers(ini) && (
                      <button
                        type="button"
                        onClick={() => handleCancel(ini.id)}
                        disabled={actionLoading === `cancel-${ini.id}`}
                        title={
                          projectCreatorById.get(ini.project_id) === address
                            ? "You created this project"
                            : "Commons Operations Committee"
                        }
                        className="rounded-lg border border-red-700 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
                      >
                        {actionLoading === `cancel-${ini.id}` ? "Cancelling..." : "Cancel initiative"}
                      </button>
                    )}
                    {/* Staking is initiated from the row's Stake button, which
                        opens the panel directly under the row — no separate
                        action button here. */}
                  </div>
                  )}

                    {canReview && reviewFor !== ini.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewFor(ini.id);
                          setReviewComments("");
                          setActionError(null);
                        }}
                        className="sd-btn sd-btn-secondary"
                      >
                        {isOpsCommitteeMember ? "Endorse or end..." : "Endorse work"}
                      </button>
                    )}

                    {reviewFor === ini.id && (
                    <div className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <label className="mb-1.5 block text-xs text-zinc-400">Review comments</label>
                      <textarea
                        placeholder="What you checked, and what you found (optional)"
                        value={reviewComments}
                        onChange={(e) => setReviewComments(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                      />

                      {/* Be explicit about what each button does. The two are
                          not symmetric, and neither is the quality judgement:
                          that belongs to the bonded reviewers below. */}
                      <div className="mt-2 space-y-1 text-xs leading-relaxed text-zinc-500">
                        <p>
                          Approving records your endorsement on the initiative. It does not
                          change whether the work completes. Conviction and the reviewer
                          verdicts decide that.
                        </p>
                        {/* Ending the initiative is committee-only. The
                            stake-weighted staker veto was retired: it was held by
                            the people paid on completion, and withdrawing stake is
                            the exit that actually works. */}
                        {isOpsCommitteeMember ? (
                          <p className="text-red-400">
                            You are on the Operations Committee, so ending this initiative
                            abandons it immediately and returns its budget to the project.
                            The assignee keeps their self-assign bond.
                          </p>
                        ) : (
                          <p>
                            Only the Operations Committee can end submitted work. If you no
                            longer back this initiative, withdraw your stake instead:
                            conviction is recomputed from live stakes, so it drops back below
                            the completion bar within about one refresh.
                          </p>
                        )}
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleReview(ini.id, true)}
                          disabled={actionLoading === `approve-${ini.id}` || youApproved}
                          title={youApproved ? "You have already approved this initiative" : undefined}
                          className="sd-btn sd-btn-primary"
                        >
                          {actionLoading === `approve-${ini.id}`
                            ? "Approving..."
                            : youApproved
                              ? "Approved"
                              : "Approve"}
                        </button>
                        {isOpsCommitteeMember && (
                          <button
                            type="button"
                            onClick={() => handleReview(ini.id, false)}
                            disabled={actionLoading === `disapprove-${ini.id}`}
                            className="rounded-lg border border-red-700 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
                          >
                            {actionLoading === `disapprove-${ini.id}`
                              ? "Ending..."
                              : "End initiative"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReviewFor(null);
                            setReviewComments("");
                          }}
                          className="sd-btn sd-btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {submitWorkFor === ini.id && (
                    /* w-full so this wraps onto its own line inside the flex
                       actions row rather than shrinking to its content width. */
                    <div className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <label className="mb-1.5 block text-xs text-zinc-400">Deliverable link</label>
                      <input
                        type="text"
                        placeholder="https://github.com/... or ipfs://..."
                        value={deliverableUri}
                        onChange={(e) => setDeliverableUri(e.target.value)}
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                      />
                      <textarea
                        placeholder="Comments (optional)"
                        value={submitComments}
                        onChange={(e) => setSubmitComments(e.target.value)}
                        rows={2}
                        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                      />
                      {/* Submitting itself has no conviction requirement. Say so,
                          then state whichever gate is still outstanding, so a
                          member doesn't hold work back waiting for a bar that
                          only matters once the initiative is in review. */}
                      <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                        {curConv >= reqConv && extConv >= extReqConv
                          ? "Conviction has already cleared both gates. Once submitted, this enters the review and challenge window, then completes and pays out."
                          : curConv >= reqConv
                            ? `Submitting doesn't require conviction. This one is over the total bar but still needs ${Math.round(extReqConv).toLocaleString()} conviction from members unaffiliated with the work before it can complete.`
                            : `Submitting doesn't require conviction. The initiative waits in review until it reaches ${Math.round(reqConv).toLocaleString()} conviction, with ${Math.round(extReqConv).toLocaleString()} of that from members unaffiliated with the work.`}
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSubmitWork(ini.id)}
                          disabled={!deliverableUri.trim() || actionLoading === `submit-${ini.id}`}
                          className="sd-btn sd-btn-primary"
                        >
                          {actionLoading === `submit-${ini.id}` ? "Submitting..." : "Submit work"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSubmitWorkFor(null);
                            setDeliverableUri("");
                            setSubmitComments("");
                          }}
                          className="sd-btn sd-btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {assignPickerFor === ini.id && (
                    <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <label className="mb-1.5 block text-xs text-zinc-400">Assign to member</label>
                      {loadingMembers ? (
                        <div className="flex items-center gap-2 py-1 text-xs text-zinc-500">
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
                          Loading members...
                        </div>
                      ) : (
                        <SearchableSelect
                          options={memberOptions.filter((m) => m.value !== address)}
                          value={assignTarget}
                          onChange={setAssignTarget}
                          placeholder="Search members..."
                          emptyMessage="No matching members"
                        />
                      )}
                      <p className="mt-2 text-xs text-zinc-500">
                        The member needs enough reputation for this initiative&apos;s{" "}
                        {INITIATIVE_TIER_LABELS[ini.tier] || ini.tier} tier and room under the
                        active-initiative cap, or the chain will reject the assignment.
                      </p>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleAssign(ini.id, assignTarget)}
                          disabled={!assignTarget || actionLoading === `assign-${ini.id}`}
                          className="sd-btn sd-btn-primary"
                        >
                          {actionLoading === `assign-${ini.id}` ? "Assigning..." : "Assign"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAssignPickerFor(null);
                            setAssignTarget("");
                          }}
                          className="sd-btn sd-btn-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
          {nextKey && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
      </div>

      {/* Right rail: initiatives closest to their required conviction. */}
      <aside className="hidden w-72 shrink-0 xl:block">
        <div className="sticky top-24 space-y-4">
          <TrendingRailCard
            items={trendingInitiatives}
            emptyText="No conviction climbing yet."
            onSelect={handleTrendingSelect}
          />
        </div>
      </aside>
    </div>
  );
}
