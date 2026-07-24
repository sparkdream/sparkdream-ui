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
  listRepProjects,
  listRepMembers,
  reverseResolveName,
} from "@/lib/api";
import type { InitiativeSortKey } from "@/lib/api";
import { truncateAddress } from "@/lib/utils";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import TagPicker from "@/components/contribute/TagPicker";
import { RepMsgTypeUrls } from "@/lib/tx";
import CopyableAddress from "@/components/CopyableAddress";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import type { Initiative, RepProject } from "@/types/rep";
import {
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_TIER_LABELS,
  INITIATIVE_CATEGORY_LABELS,
  InitiativeStatus,
  InitiativeTier,
  InitiativeCategory,
} from "@/types/rep";
import {
  initiativeTierFromJSON,
  initiativeCategoryFromJSON,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/initiative";
import SearchableSelect from "@/components/contribute/SearchableSelect";

type Tab = "all" | "available" | "mine";

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

// Conviction progress at a glance: a small ring plus the percentage. Exact
// figures stay in the expanded details. A zero required_conviction has no
// ratio to show, so the widget renders nothing at all rather than an empty
// ring the reader has to interpret.
function ConvictionWheel({ current, required }: { current: string; required: string }) {
  const cur = parseFloat(current || "0");
  const req = parseFloat(required || "0");
  if (!(req > 0)) return null;
  const ratio = Math.min(Math.max(cur / req, 0), 1);
  const met = cur >= req;
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  return (
    <span
      className="flex items-center gap-1.5"
      title={`Conviction: ${cur.toFixed(2)} of ${req.toFixed(2)} required`}
    >
      <svg viewBox="0 0 18 18" className="h-4 w-4 -rotate-90" aria-hidden="true">
        <circle cx="9" cy="9" r={radius} fill="none" strokeWidth={2.5} className="stroke-zinc-700" />
        {ratio > 0 && (
          <circle
            cx="9" cy="9" r={radius} fill="none" strokeWidth={2.5} strokeLinecap="round"
            className={met ? "stroke-emerald-400" : "stroke-indigo-400"}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        )}
      </svg>
      <span className={met ? "text-emerald-400" : undefined}>{Math.round(ratio * 100)}%</span>
    </span>
  );
}

export default function InitiativeList() {
  const { address, signAndBroadcast } = useWallet();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMember = useIsRepMember(address);
  const canCreate = isMember === true;
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [sort, setSort] = useState<InitiativeSort>("newest");
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

  // Project filter. Mirrored into `?project=` so a filtered list is
  // shareable and so Projects can deep-link into its own initiatives.
  const urlProject = searchParams.get("project") || "";
  const [projectFilter, setProjectFilter] = useState(urlProject);
  useEffect(() => {
    setProjectFilter(urlProject);
  }, [urlProject]);

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
      const msg = err instanceof Error ? err.message : "Failed to load initiatives";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setInitiatives([]);
      } else {
        setError(msg);
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
            templateId: "",
            budget: budgetAmount,
          },
        },
      ]);
      if (tagMsgs.length > 0) refreshTags();
      setShowForm(false);
      setFormTitle("");
      setFormDesc("");
      setFormTags([]);
      setFormBudget("");
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

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "available", label: "Available" },
    { key: "mine", label: "My assignments" },
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

  // "No initiatives yet" would be wrong when the only ones loaded are closed
  // and currently hidden, so the empty state names whichever subset is empty.
  const emptyKind =
    tab === "available" ? "available "
    : tab === "mine" ? "assigned "
    : closedCount > 0 && !showClosed ? "active "
    : "";
  const emptyMessage = projectFilter
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
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={() => fetchInitiatives(tab, projectFilter, sort)} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
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

      {/* Tabs + project filter */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-1 gap-1 rounded-lg sd-hull-tile p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="sm:w-64">
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
        <div className="sm:w-52">
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

      {visibleInitiatives.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">{emptyMessage}</p>
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
          {visibleInitiatives.map((ini) => (
            <div key={ini.id} className="@container rounded-xl sd-hull-tile">
              {/* Header runs as one row when the card is wide enough and
                  stacks below that. Container queries rather than viewport
                  ones: the list shares the pane with a fixed 13rem sidebar. */}
              <div className="flex flex-col gap-1.5 px-4 py-3 @2xl:flex-row @2xl:items-center @2xl:gap-3">
                {/* The project sits outside the expand button so it can be a
                    link through to the project it belongs to. */}
                <Link
                  href={`/contribute?view=projects&project=${ini.project_id}`}
                  title={`View project ${projectLabel(ini.project_id)} (#${ini.project_id})`}
                  className="flex min-w-0 max-w-full items-center gap-1.5 self-start rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/20 hover:text-indigo-200 @2xl:max-w-52 @2xl:shrink-0 @2xl:self-auto"
                >
                  <svg className="h-3.5 w-3.5 shrink-0 text-indigo-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  <span className="truncate">{projectLabel(ini.project_id)}</span>
                </Link>
                <button
                  onClick={() => setExpanded(expanded === ini.id ? null : ini.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-y-0.5 @4xl:flex-row @4xl:items-center @4xl:justify-between @4xl:gap-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-200">{ini.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ini.status)}`}>
                        {INITIATIVE_STATUS_LABELS[ini.status] || ini.status}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tierColor(ini.tier)}`}>
                        {INITIATIVE_TIER_LABELS[ini.tier] || ini.tier}
                      </span>
                    </div>
                    {/* Glanceable only: category, budget amount and conviction
                        progress. Labels and exact figures live in the details. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500 @4xl:shrink-0 @4xl:justify-end">
                      <span>{INITIATIVE_CATEGORY_LABELS[ini.category] || ini.category}</span>
                      {ini.assignee && <span>Assignee: <CopyableAddress address={ini.assignee} prefixLen={8} suffixLen={4} nested /></span>}
                      <span title="Budget">{formatDream(ini.budget)} DREAM</span>
                      <ConvictionWheel current={ini.current_conviction} required={ini.required_conviction} />
                    </div>
                  </div>
                  <svg
                    className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded === ini.id ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {expanded === ini.id && (
                <div className="border-t border-zinc-800 px-4 py-3 text-sm">
                  {ini.description && <p className="mb-3 text-zinc-400">{ini.description}</p>}

                  {/* Project is intentionally absent — the header pill above
                      already names it and links through. */}
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 @md:grid-cols-2 @2xl:grid-cols-3">
                    <div>
                      <dt className="text-xs text-zinc-500">Budget</dt>
                      <dd className="text-zinc-300">{formatDream(ini.budget)} DREAM</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Conviction</dt>
                      <dd className="text-zinc-300">
                        {parseFloat(ini.current_conviction || "0").toFixed(2)} / {parseFloat(ini.required_conviction || "0").toFixed(2)}
                        <span className="ml-1.5 text-xs text-zinc-500">required</span>
                      </dd>
                    </div>
                    {ini.self_assign_bond && ini.self_assign_bond !== "0" && (
                      <div>
                        <dt className="text-xs text-zinc-500">Self-assign bond</dt>
                        <dd style={{ color: "var(--amber)" }}>{formatDream(ini.self_assign_bond)} DREAM</dd>
                      </div>
                    )}
                    {ini.deliverable_uri && (
                      <div>
                        <dt className="text-xs text-zinc-500">Deliverable</dt>
                        <dd className="truncate text-zinc-300">{ini.deliverable_uri}</dd>
                      </div>
                    )}
                  </dl>

                  {ini.tags?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ini.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
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
                  </div>

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

                  {actionError?.id === ini.id && (
                    <p className="mt-2 text-xs text-red-400">{actionError.message}</p>
                  )}
                </div>
              )}
            </div>
          ))}
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
  );
}
