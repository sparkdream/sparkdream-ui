"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { listRepInitiatives, availableInitiatives, initiativesByAssignee, listRepProjects, collectTags } from "@/lib/api";
import TagPicker from "@/components/reputation/TagPicker";
import { RepMsgTypeUrls } from "@/lib/tx";
import { truncateAddress } from "@/lib/utils";
import type { Initiative, RepProject } from "@/types/rep";
import {
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_TIER_LABELS,
  INITIATIVE_CATEGORY_LABELS,
  InitiativeStatus,
  InitiativeTier,
  InitiativeCategory,
} from "@/types/rep";
import SearchableSelect from "@/components/reputation/SearchableSelect";

type Tab = "all" | "available" | "mine";

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

function formatDream(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

export default function InitiativeList() {
  const { address, signAndBroadcast } = useWallet();
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Projects for the create form dropdown
  const [projects, setProjects] = useState<RepProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Create initiative form
  const [formProjectId, setFormProjectId] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [formTier, setFormTier] = useState<string>(InitiativeTier.STANDARD);
  const [formCategory, setFormCategory] = useState<string>(InitiativeCategory.FEATURE);
  const [formBudget, setFormBudget] = useState("");

  const fetchInitiatives = useCallback(async (currentTab: Tab) => {
    try {
      setRefreshing(true);
      setError(null);
      setNextKey(null);
      let items: Initiative[] = [];
      let pageKey: string | null = null;
      if (currentTab === "available") {
        const res = await availableInitiatives({ limit: "50" });
        items = res.initiatives || [];
        pageKey = res.pagination?.next_key || null;
      } else if (currentTab === "mine" && address) {
        const res = await initiativesByAssignee(address, { limit: "50" });
        items = res.initiatives || [];
        pageKey = res.pagination?.next_key || null;
      } else {
        const res = await listRepInitiatives({ limit: "50", reverse: true });
        items = res.initiative || [];
        pageKey = res.pagination?.next_key || null;
      }
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
  }, [address]);

  const loadMore = useCallback(async () => {
    if (!nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      let items: Initiative[] = [];
      let pageKey: string | null = null;
      if (tab === "available") {
        const res = await availableInitiatives({ limit: "50", key: nextKey });
        items = res.initiatives || [];
        pageKey = res.pagination?.next_key || null;
      } else if (tab === "mine" && address) {
        const res = await initiativesByAssignee(address, { limit: "50", key: nextKey });
        items = res.initiatives || [];
        pageKey = res.pagination?.next_key || null;
      } else {
        const res = await listRepInitiatives({ limit: "50", reverse: true, key: nextKey });
        items = res.initiative || [];
        pageKey = res.pagination?.next_key || null;
      }
      setInitiatives((prev) => [...prev, ...items]);
      setNextKey(pageKey);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextKey, loadingMore, tab, address]);

  // Load projects when create form opens
  useEffect(() => {
    if (!showForm || projects.length > 0) return;
    let cancelled = false;
    async function load() {
      setLoadingProjects(true);
      try {
        const res = await listRepProjects({ limit: "100" });
        if (!cancelled) {
          const items = res.project || [];
          setProjects(items);
          if (items.length > 0) setFormProjectId((prev) => prev || items[0].id);
        }
      } catch {
        // ignore — empty dropdown
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [showForm, projects.length]);

  // Load tags when create form opens
  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    setLoadingTags(true);
    collectTags().then((tags) => {
      if (!cancelled) setAvailableTags(tags);
    }).catch(() => {
      if (!cancelled) setAvailableTags([]);
    }).finally(() => {
      if (!cancelled) setLoadingTags(false);
    });
    return () => { cancelled = true; };
  }, [showForm]);

  useEffect(() => {
    fetchInitiatives(tab);
  }, [tab, fetchInitiatives]);

  const handleCreate = async () => {
    if (!address || !formTitle.trim() || !formProjectId) return;
    try {
      setSubmitting(true);
      const budgetAmount = formBudget ? (BigInt(Math.floor(parseFloat(formBudget) * 1e6))).toString() : "0";
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.CreateInitiative,
        value: {
          creator: address,
          project_id: parseInt(formProjectId),
          title: formTitle.trim(),
          description: formDesc.trim(),
          tags: formTags,
          tier: formTier,
          category: formCategory,
          template_id: "",
          budget: budgetAmount,
        },
      }]);
      setShowForm(false);
      setFormTitle("");
      setFormDesc("");
      setFormTags([]);
      setFormBudget("");
      await fetchInitiatives(tab);
    } catch (err) {
      console.error("Create initiative failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssign = async (initiativeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`assign-${initiativeId}`);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.AssignInitiative,
        value: { creator: address, initiative_id: parseInt(initiativeId), assignee: address },
      }]);
      await fetchInitiatives(tab);
    } catch (err) {
      console.error("Assign failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleAbandon = async (initiativeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`abandon-${initiativeId}`);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.AbandonInitiative,
        value: { creator: address, initiative_id: parseInt(initiativeId), reason: "" },
      }]);
      await fetchInitiatives(tab);
    } catch (err) {
      console.error("Abandon failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "available", label: "Available" },
    { key: "mine", label: "My Assignments" },
  ];

  if (initialLoad) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={() => fetchInitiatives(tab)} className="ml-2 underline hover:text-red-300">Retry</button>
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
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {showForm ? "Cancel" : "Create Initiative"}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">New Initiative</h3>
          <div className="space-y-3">
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
                options={projects.map((p) => ({ value: p.id, label: `#${p.id} — ${p.name}` }))}
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
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
              >
                {Object.entries(INITIATIVE_TIER_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none"
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
                placeholder="Select or create tags..."
                loading={loadingTags}
                allowCreate
              />
              <input
                type="text"
                placeholder="Budget (DREAM)"
                value={formBudget}
                onChange={(e) => setFormBudget(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={submitting || !formTitle.trim() || !formProjectId}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Initiative"}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
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

      {initiatives.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            {tab === "available" ? "No available initiatives" : tab === "mine" ? "No assigned initiatives" : "No initiatives yet"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {initiatives.map((ini) => (
            <div key={ini.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50">
              <button
                onClick={() => setExpanded(expanded === ini.id ? null : ini.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{ini.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(ini.status)}`}>
                      {INITIATIVE_STATUS_LABELS[ini.status] || ini.status}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tierColor(ini.tier)}`}>
                      {INITIATIVE_TIER_LABELS[ini.tier] || ini.tier}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{INITIATIVE_CATEGORY_LABELS[ini.category] || ini.category}</span>
                    <span>Budget: {formatDream(ini.budget)} DREAM</span>
                    {ini.assignee && <span>Assignee: {truncateAddress(ini.assignee, 8, 4)}</span>}
                  </div>
                </div>
                <svg
                  className={`ml-3 h-4 w-4 shrink-0 text-zinc-500 transition-transform ${expanded === ini.id ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {expanded === ini.id && (
                <div className="border-t border-zinc-800 px-4 py-3 text-sm">
                  {ini.description && <p className="mb-3 text-zinc-400">{ini.description}</p>}

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-zinc-500">Project ID</dt>
                      <dd className="text-zinc-300">{ini.project_id}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-zinc-500">Conviction</dt>
                      <dd className="text-zinc-300">
                        {parseFloat(ini.current_conviction || "0").toFixed(2)} / {parseFloat(ini.required_conviction || "0").toFixed(2)}
                      </dd>
                    </div>
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
                  <div className="mt-3 flex gap-2 border-t border-zinc-800 pt-3">
                    {ini.status === InitiativeStatus.OPEN && (
                      <button
                        onClick={() => handleAssign(ini.id)}
                        disabled={actionLoading === `assign-${ini.id}`}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {actionLoading === `assign-${ini.id}` ? "Assigning..." : "Assign to Me"}
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
                  </div>
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
