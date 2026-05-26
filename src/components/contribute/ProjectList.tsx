"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { listRepProjects, listGroups, getRepParams, getLatestBlockHeight } from "@/lib/api";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import TagPicker from "@/components/contribute/TagPicker";
import type { Group } from "@/types/commons";
import { RepMsgTypeUrls } from "@/lib/tx";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import type { RepProject } from "@/types/rep";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_CATEGORY_LABELS,
  ProjectStatus,
  ProjectCategory,
  TRUST_LEVEL_LABELS,
  TrustLevel,
} from "@/types/rep";
import { projectCategoryFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/project";

// Chain defaults (x/rep params) — used as fallbacks if the params query
// hasn't completed when the form renders.
const FALLBACK_CREATION_FEE_UDREAM = "5000000"; // 5 DREAM
const FALLBACK_MIN_TRUST_LEVEL = 2; // ESTABLISHED
const FALLBACK_LARGE_PROJECT_THRESHOLD_UDREAM = "10000000000"; // 10,000 DREAM (Epic tier max)

// trust_level values are enum strings ("TRUST_LEVEL_ESTABLISHED" etc.) at
// the UI layer but the chain param is a uint32. Map the index → label so the
// info copy reads naturally ("ESTABLISHED" not "2").
const TRUST_LEVEL_BY_INDEX = [
  TrustLevel.NEW,
  TrustLevel.PROVISIONAL,
  TrustLevel.ESTABLISHED,
  TrustLevel.TRUSTED,
  TrustLevel.CORE,
] as const;

function statusColor(status: string): string {
  switch (status) {
    case ProjectStatus.ACTIVE: return "bg-emerald-500/15 text-emerald-400";
    case ProjectStatus.PROPOSED: return "bg-blue-500/15 text-blue-400";
    case ProjectStatus.COMPLETED: return "bg-zinc-500/15 text-zinc-300";
    case ProjectStatus.CANCELLED: return "bg-red-500/15 text-red-400";
    // EndBlocker-set terminal status for PROPOSED projects past their
    // expiry_block_height. Muted amber so it reads as "stale" rather than
    // "actively rejected" (which CANCELLED already covers in red).
    case ProjectStatus.EXPIRED: return "bg-amber-500/10 text-amber-400";
    default: return "bg-zinc-800/50 text-zinc-400";
  }
}

function formatDream(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

export default function ProjectList() {
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const canPropose = isMember === true;
  const [projects, setProjects] = useState<RepProject[]>([]);
  const [councils, setCouncils] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Form state
  const [formMode, setFormMode] = useState<"self-publish" | "request-funding">("self-publish");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();
  const canCreateTags = useCanCreateTags(address);
  const [formCategory, setFormCategory] = useState<string>(ProjectCategory.INFRASTRUCTURE);
  const [formCouncil, setFormCouncil] = useState("");
  const [formBudget, setFormBudget] = useState("");
  const [formSpark, setFormSpark] = useState("");

  // Live x/rep params for the permissionless path summary (fee + trust gate)
  // and the budget-backed tier threshold above which a council proposal is
  // required (vs. a single committee member).
  const [creationFeeUdream, setCreationFeeUdream] = useState<string>(FALLBACK_CREATION_FEE_UDREAM);
  const [minTrustLevelIdx, setMinTrustLevelIdx] = useState<number>(FALLBACK_MIN_TRUST_LEVEL);
  const [largeProjectThresholdUdream, setLargeProjectThresholdUdream] = useState<string>(
    FALLBACK_LARGE_PROJECT_THRESHOLD_UDREAM,
  );

  // Latest block height — used to turn a PROPOSED project's expiry_block_height
  // into a human-friendly "expires in N blocks" countdown. Best-effort; the
  // expiry block alone still renders if this fetch fails.
  const [latestHeight, setLatestHeight] = useState<bigint | null>(null);
  useEffect(() => {
    getLatestBlockHeight()
      .then((h) => setLatestHeight(BigInt(h)))
      .catch(() => { /* leave null — UI degrades to raw block number */ });
  }, []);

  useEffect(() => {
    getRepParams()
      .then((res) => {
        const p = (res.params as Record<string, unknown>) || {};
        const fee = p.project_creation_fee;
        if (typeof fee === "string" && fee) setCreationFeeUdream(fee);
        const lvl = p.permissionless_min_trust_level;
        if (typeof lvl === "number") setMinTrustLevelIdx(lvl);
        else if (typeof lvl === "string" && /^\d+$/.test(lvl)) setMinTrustLevelIdx(parseInt(lvl, 10));
        const threshold = p.large_project_budget_threshold;
        if (typeof threshold === "string" && threshold) setLargeProjectThresholdUdream(threshold);
      })
      .catch(() => {
        // Fall back to defaults — chain may be older than this UI.
      });
  }, []);

  // Display helpers for the path-summary panels.
  const creationFeeDream = (() => {
    try {
      const n = BigInt(creationFeeUdream);
      return (n / BigInt(1_000_000)).toLocaleString();
    } catch {
      return "5";
    }
  })();
  const minTrustLabel =
    TRUST_LEVEL_LABELS[TRUST_LEVEL_BY_INDEX[minTrustLevelIdx] ?? TrustLevel.ESTABLISHED] ?? "Established";
  const largeProjectThresholdDream = (() => {
    try {
      const n = BigInt(largeProjectThresholdUdream);
      return (n / BigInt(1_000_000)).toLocaleString();
    } catch {
      return "10,000";
    }
  })();

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [projectsRes, groupsRes] = await Promise.all([
        listRepProjects({ limit: "50", reverse: true }).catch(() => ({ project: [] as RepProject[], pagination: { next_key: null, total: "0" } })),
        listGroups().catch(() => ({ group: [] as Group[], pagination: { next_key: null, total: "0" } })),
      ]);
      setProjects(projectsRes.project || []);
      setNextKey(projectsRes.pagination?.next_key || null);
      const groups = groupsRes.group || [];
      setCouncils(groups);
      if (groups.length > 0) {
        setFormCouncil((prev) => prev || groups[0].index);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load projects";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setProjects([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await listRepProjects({ limit: "50", reverse: true, key: nextKey });
      setProjects((prev) => [...prev, ...(res.project || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Auto-close the form once we learn the user isn't a member.
  useEffect(() => {
    if (isMember === false) {
      setShowForm(false);
      setCreateError(null);
    }
  }, [isMember]);

  const handlePropose = async () => {
    if (!address || !formName.trim()) return;

    // Permissionless: zero budgets and no council needed (the council field is
    // metadata-only for permissionless projects since they never go through
    // committee approval).
    let budgetAmount = "0";
    let sparkAmount = "0";
    let council = "";

    if (formMode === "request-funding") {
      budgetAmount = formBudget ? BigInt(Math.floor(parseFloat(formBudget) * 1e6)).toString() : "0";
      sparkAmount = formSpark ? BigInt(Math.floor(parseFloat(formSpark) * 1e6)).toString() : "0";
      // Guard: an all-zero request-funding submit would silently take the
      // permissionless path on-chain. Surface that to the user instead.
      if (budgetAmount === "0" && sparkAmount === "0") {
        setCreateError("Request-funding mode requires a non-zero DREAM or SPARK amount.");
        return;
      }
      council = formCouncil.trim();
    }

    try {
      setSubmitting(true);
      setCreateError(null);
      const tagMsgs = buildCreateTagMsgs(address, formTags, availableTags);
      await signAndBroadcast([
        ...tagMsgs,
        {
          typeUrl: RepMsgTypeUrls.ProposeProject,
          value: {
            creator: address,
            name: formName.trim(),
            description: formDesc.trim(),
            tags: formTags,
            // ProjectCategory is a proto3 enum (int32 on the wire). The form
            // state holds it as its enum-string key for the <select> ("…
            // _INFRASTRUCTURE"); pass the int through fromJSON so the proto
            // encoder doesn't NaN-coerce the string to 0 (which both loses
            // the user's pick and breaks amino sigverify — JS would sign the
            // string while the chain reconstructs an omitted/numeric field).
            category: projectCategoryFromJSON(formCategory),
            council,
            requestedBudget: budgetAmount,
            requestedSpark: sparkAmount,
            deliverables: [],
            milestones: [],
          },
        },
      ]);
      if (tagMsgs.length > 0) refreshTags();
      setShowForm(false);
      setFormName("");
      setFormDesc("");
      setFormTags([]);
      setFormBudget("");
      setFormSpark("");
      setFormMode("self-publish");
      await fetchProjects();
    } catch (err) {
      console.error("Propose project failed:", err);
      setCreateError(err instanceof Error ? err.message : "Failed to propose project");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl sd-hull-tile" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchProjects} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Projects</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            disabled={!address || !canPropose}
            title={
              !address
                ? "Connect a wallet to propose a project"
                : isMember === false
                ? "Only existing members can propose projects"
                : "MsgProposeProject"
            }
            className="sd-btn sd-btn-primary"
          >
            Propose Project
          </button>
        )}
      </div>

      {address && isMember === false && (
        <p className="mb-3 text-xs text-zinc-500">
          Want to propose a project? Proposing projects is open to members. Ask any existing{" "}
          <Link href="/contribute?view=members" className="text-indigo-400 hover:text-indigo-300 underline">
            member
          </Link>
          {" "}to invite you in. We&apos;d love to have you contribute.
        </p>
      )}

      {showForm && canPropose && (
        <div className="mb-4 rounded-xl sd-hull-tile p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">New Project Proposal</h3>

          {createError && (
            <div className="mb-3 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-400">
              {createError}
            </div>
          )}

          {/* Mode toggle: permissionless self-publish vs. budget-backed request.
              The chain branches on whether requested_budget + requested_spark
              are both zero (msg_server_propose_project.go) — surfacing that as
              an explicit choice avoids the trap of silently switching paths. */}
          <div className="mb-3 inline-flex rounded-lg border border-zinc-700 bg-zinc-900/50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFormMode("self-publish")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                formMode === "self-publish"
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Self-publish
            </button>
            <button
              type="button"
              onClick={() => setFormMode("request-funding")}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                formMode === "request-funding"
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Request funding
            </button>
          </div>

          {formMode === "self-publish" ? (
            <div className="mb-3 rounded-lg border border-emerald-900/50 bg-emerald-900/10 px-3 py-2 text-xs text-emerald-300/90">
              Burns <span className="font-medium text-emerald-200">{creationFeeDream} DREAM</span>{" "}
              and the project activates immediately — no committee or council
              approval needed. Requires{" "}
              <span className="font-medium text-emerald-200">{minTrustLabel}</span>{" "}trust level or
              higher. You&apos;ll then be able to add initiatives (capped at 500 DREAM each on the
              permissionless path) that the community can stake to complete.
            </div>
          ) : (
            <div className="mb-3 rounded-lg border border-amber-900/50 bg-amber-900/10 px-3 py-2 text-xs text-amber-300/90">
              Sent to the council you pick below for approval. If approved,
              completing initiatives under this project mints DREAM (and SPARK)
              up to your requested cap — they&apos;re the spending authority.
              Up to{" "}
              <span className="font-medium text-amber-200">
                {largeProjectThresholdDream} DREAM
              </span>{" "}
              can be approved by an individual operations-committee member of
              the picked council; larger budgets require a passed council or
              committee proposal.
            </div>
          )}

          <div className="space-y-3">
            <input
              type="text"
              placeholder="Project name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
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
              <TagPicker
                options={availableTags}
                value={formTags}
                onChange={setFormTags}
                placeholder={canCreateTags ? "Select or create tags..." : "Select tags..."}
                loading={loadingTags}
                allowCreate={canCreateTags}
              />
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="sd-select"
              >
                {Object.entries(PROJECT_CATEGORY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {formMode === "request-funding" && (
              <>
                <select
                  value={formCouncil}
                  onChange={(e) => setFormCouncil(e.target.value)}
                  className="sd-select w-full"
                >
                  {councils.length === 0 && (
                    <option value="">No councils available</option>
                  )}
                  {councils.map((g) => (
                    <option key={g.index} value={g.index}>{g.index}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Requested budget (DREAM)"
                    value={formBudget}
                    onChange={(e) => setFormBudget(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="Requested SPARK"
                    value={formSpark}
                    onChange={(e) => setFormSpark(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePropose}
                disabled={
                  submitting ||
                  !formName.trim() ||
                  (formMode === "request-funding" && !formBudget && !formSpark)
                }
                className="sd-btn sd-btn-primary"
              >
                {submitting
                  ? "Submitting..."
                  : formMode === "self-publish"
                  ? `Self-publish (burn ${creationFeeDream} DREAM)`
                  : "Submit for approval"}
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

      {projects.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No projects yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div key={p.id} className="rounded-xl sd-hull-tile">
              <button
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{p.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(p.status)}`}>
                      {PROJECT_STATUS_LABELS[p.status] || p.status}
                    </span>
                    {p.permissionless && (
                      <span
                        className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-300"
                        title="Self-publish: skipped council approval; zero budget; rewards minted on completion"
                      >
                        Self-published
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{PROJECT_CATEGORY_LABELS[p.category] || p.category}</span>
                    {p.council && <span>Council: {p.council}</span>}
                    <span>Budget: {formatDream(p.approved_budget)} DREAM</span>
                    {/* Show expiry only while still PROPOSED — once the project
                        transitions out (Active/Cancelled/Expired) the chain
                        clears expiry_block_height to 0. The amber/red colors
                        flag <100/<10 remaining blocks so council approvers
                        notice imminent EndBlocker expiry. */}
                    {p.status === ProjectStatus.PROPOSED &&
                      p.expiry_block_height &&
                      p.expiry_block_height !== "0" && (
                        <ProposedExpiryHint
                          expiryBlockHeight={p.expiry_block_height}
                          latestHeight={latestHeight}
                        />
                      )}
                  </div>
                </div>
                <svg
                  className={`ml-3 h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded === p.id ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded === p.id && (
                <div className="border-t border-zinc-800 px-4 py-3 text-sm">
                  {p.description && <p className="mb-3 text-zinc-400">{p.description}</p>}
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-zinc-500">Allocated</dt>
                      <dd className="text-zinc-300">{formatDream(p.allocated_budget)} DREAM</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Spent</dt>
                      <dd className="text-zinc-300">{formatDream(p.spent_budget)} DREAM</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">SPARK Approved</dt>
                      <dd className="text-zinc-300">{formatDream(p.approved_spark)}</dd>
                    </div>
                  </dl>
                  {p.tags?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {p.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{tag}</span>
                      ))}
                    </div>
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
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Renders the per-project "expires in N blocks" hint for PROPOSED rows.
// Falls back to "expires at block N" when the chain head couldn't be fetched
// (so the data is still legible, just without a delta). Amber under 100
// blocks, red under 10 — that's the window where a council approval should
// be moving rather than queued.
function ProposedExpiryHint({
  expiryBlockHeight,
  latestHeight,
}: {
  expiryBlockHeight: string;
  latestHeight: bigint | null;
}) {
  let expiry: bigint;
  try {
    expiry = BigInt(expiryBlockHeight);
  } catch {
    return null;
  }
  if (latestHeight === null) {
    return <span title="Latest block height unavailable">Expires at block {expiryBlockHeight}</span>;
  }
  const remaining = expiry - latestHeight;
  if (remaining <= BigInt(0)) {
    // EndBlocker hasn't run yet but the deadline has passed — flag it.
    return <span className="text-amber-400">Expiring this block</span>;
  }
  const cls = remaining < BigInt(10)
    ? "text-red-400"
    : remaining < BigInt(100)
      ? "text-amber-400"
      : "text-zinc-500";
  return <span className={cls}>Expires in {remaining.toString()} blocks</span>;
}
