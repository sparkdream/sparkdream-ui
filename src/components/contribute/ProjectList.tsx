"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { listRepProjects, listGroups } from "@/lib/api";
import { buildCreateTagMsgs, useCanCreateTags, useTagRegistry } from "@/lib/tags";
import TagPicker from "@/components/contribute/TagPicker";
import type { Group } from "@/types/commons";
import { RepMsgTypeUrls } from "@/lib/tx";
import type { RepProject } from "@/types/rep";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_CATEGORY_LABELS,
  ProjectStatus,
  ProjectCategory,
} from "@/types/rep";

function statusColor(status: string): string {
  switch (status) {
    case ProjectStatus.ACTIVE: return "bg-emerald-500/15 text-emerald-400";
    case ProjectStatus.PROPOSED: return "bg-blue-500/15 text-blue-400";
    case ProjectStatus.COMPLETED: return "bg-zinc-500/15 text-zinc-300";
    case ProjectStatus.CANCELLED: return "bg-red-500/15 text-red-400";
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
  const [projects, setProjects] = useState<RepProject[]>([]);
  const [councils, setCouncils] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const { tags: availableTags, loading: loadingTags, refresh: refreshTags } = useTagRegistry();
  const canCreateTags = useCanCreateTags(address);
  const [formCategory, setFormCategory] = useState<string>(ProjectCategory.INFRASTRUCTURE);
  const [formCouncil, setFormCouncil] = useState("");
  const [formBudget, setFormBudget] = useState("");
  const [formSpark, setFormSpark] = useState("");

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

  const handlePropose = async () => {
    if (!address || !formName.trim()) return;
    try {
      setSubmitting(true);
      const budgetAmount = formBudget ? (BigInt(Math.floor(parseFloat(formBudget) * 1e6))).toString() : "0";
      const sparkAmount = formSpark ? (BigInt(Math.floor(parseFloat(formSpark) * 1e6))).toString() : "0";
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
            category: formCategory,
            council: formCouncil.trim(),
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
      await fetchProjects();
    } catch (err) {
      console.error("Propose project failed:", err);
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
            disabled={!address}
            title={address ? "MsgProposeProject" : "Connect a wallet to propose a project"}
            className="sd-btn sd-btn-primary"
          >
            Propose Project
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 rounded-xl sd-hull-tile p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">New Project Proposal</h3>
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
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePropose}
                disabled={submitting || !formName.trim()}
                className="sd-btn sd-btn-primary"
              >
                {submitting ? "Submitting..." : "Submit Proposal"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
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
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
                    <span>{PROJECT_CATEGORY_LABELS[p.category] || p.category}</span>
                    {p.council && <span>Council: {p.council}</span>}
                    <span>Budget: {formatDream(p.approved_budget)} DREAM</span>
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
