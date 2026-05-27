"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import type { Group, Proposal, Member } from "@/types/commons";
import { listGroups, getCouncilMembers, listProposals } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import CommunityProposals from "@/components/governance/CommunityProposals";
import CommunityMembers from "@/components/governance/CommunityMembers";
import { CommunityTreasuries } from "@/components/governance/CouncilTreasury";
import ChainProposals from "@/components/governance/ChainProposals";
import ServiceOperators from "@/components/governance/ServiceOperators";
import type { ProposalType } from "@/components/governance/NewCommunityProposal";

type View =
  | "community-proposals"
  | "community-members"
  | "community-treasuries"
  | "chain-proposals"
  | "chain-operators";

const VALID_ACTIONS: ProposalType[] = [
  "general",
  "invite",
  "remove",
  "treasury-spend",
  "update-config",
  "create-category",
  "delete-category",
  "unhide-post",
];

export default function GovernancePage() {
  return (
    <Suspense fallback={
      <div className="sd-page">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
      </div>
    }>
      <GovernancePageInner />
    </Suspense>
  );
}

function GovernancePageInner() {
  const { ready } = useWallet();
  const searchParams = useSearchParams();
  const queryGroup = searchParams.get("group");
  const queryAction = searchParams.get("action");
  const initialAction: ProposalType | undefined = VALID_ACTIONS.includes(queryAction as ProposalType)
    ? (queryAction as ProposalType)
    : undefined;
  // Pre-fill post_id when reached via the SentinelPanel COC-override deep-link.
  const initialPostId = searchParams.get("post_id") ?? undefined;

  // Sidebar state
  const [view, setView] = useState<View>("community-proposals");
  const [communityOpen, setCommunityOpen] = useState(true);
  const [chainOpen, setChainOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Community data
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Forward initialAction to CommunityProposals only until it's been consumed
  // (i.e., the proposals view has rendered with a selected group). After that,
  // navigating away and back won't keep reopening the form.
  const [actionConsumed, setActionConsumed] = useState(false);
  const effectiveAction = actionConsumed ? undefined : initialAction;
  useEffect(() => {
    if (initialAction && selectedGroup && view === "community-proposals") {
      setActionConsumed(true);
    }
  }, [initialAction, selectedGroup, view]);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await listGroups();
      const groupList = res.group || [];
      setGroups(groupList);
      if (groupList.length > 0 && !selectedGroup) {
        const match = queryGroup ? groupList.find((g) => g.index === queryGroup) : null;
        setSelectedGroup(match || groupList[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    }
  }, [selectedGroup, queryGroup]);

  const fetchGroupData = useCallback(async () => {
    if (!selectedGroup) return;
    try {
      setCommunityLoading(true);
      const [membersRes, proposalsRes] = await Promise.all([
        getCouncilMembers(selectedGroup.index),
        listProposals(selectedGroup.index, { reverse: true, limit: "50" }),
      ]);
      setMembers(membersRes.members || []);
      setProposals(proposalsRes.proposals || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setCommunityLoading(false);
    }
  }, [selectedGroup]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    if (selectedGroup) fetchGroupData();
  }, [selectedGroup, fetchGroupData]);

  const switchView = (v: View) => {
    setView(v);
    setMobileSidebarOpen(false);
  };

  // Skeleton while wallet resolves
  if (!ready) {
    return (
      <div className="sd-page">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
        <div className="flex gap-6">
          <div className="hidden w-56 shrink-0 md:block">
            <div className="h-64 animate-pulse rounded-xl sd-hull-tile" />
          </div>
          <div className="flex-1">
            <div className="h-48 animate-pulse rounded-xl sd-hull-tile" />
          </div>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <nav className="space-y-1">
      {/* Community section */}
      <div>
        <button
          onClick={() => setCommunityOpen(!communityOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Community</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${communityOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {communityOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            {/* Council selector */}
            {groups.length > 1 && (
              <div className="px-2 py-1.5">
                <select
                  value={selectedGroup?.index || ""}
                  onChange={(e) => {
                    const g = groups.find((g) => g.index === e.target.value);
                    if (g) setSelectedGroup(g);
                  }}
                  className="sd-select w-full"
                >
                  {groups.map((g) => (
                    <option key={g.index} value={g.index}>
                      {g.index}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {groups.length === 1 && selectedGroup && (
              <div className="px-3 py-1.5 text-xs text-zinc-500">
                {selectedGroup.index}
              </div>
            )}

            <button
              onClick={() => switchView("community-proposals")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "community-proposals"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
              Proposals
            </button>

            <button
              onClick={() => switchView("community-members")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "community-members"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              Members
            </button>

            {/* Treasuries spans all groups, not just the selected one. */}
            <button
              onClick={() => switchView("community-treasuries")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "community-treasuries"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              Treasuries
            </button>
          </div>
        )}
      </div>

      {/* Chain section */}
      <div className="pt-2">
        <button
          onClick={() => setChainOpen(!chainOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Chain</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${chainOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {chainOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("chain-proposals")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "chain-proposals"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.15c0 .415.336.75.75.75z" />
              </svg>
              Proposals
            </button>
            <button
              onClick={() => switchView("chain-operators")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "chain-operators"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Operators
            </button>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <span className="crumb">Govern</span>
        <h1>Governance</h1>
        <p>Community council and chain governance</p>
      </header>

      {/* Mobile sidebar toggle */}
      <div className="mb-4 md:hidden">
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="flex w-full items-center justify-between rounded-lg sd-hull-tile px-4 py-2.5 text-sm text-zinc-300"
        >
          <span>
            {view === "community-proposals" && "Community / Proposals"}
            {view === "community-members" && "Community / Members"}
            {view === "community-treasuries" && "Community / Treasuries"}
            {view === "chain-proposals" && "Chain / Proposals"}
            {view === "chain-operators" && "Chain / Operators"}
          </span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${mobileSidebarOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {mobileSidebarOpen && (
          <div className="sd-hull-tile mt-2 rounded-lg p-3">
            {sidebarContent}
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <div className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-24 rounded-xl sd-hull-tile p-3">
            {sidebarContent}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {error && (
            <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {error}
              <button
                onClick={fetchGroupData}
                className="ml-2 underline hover:text-red-300"
              >
                Retry
              </button>
            </div>
          )}

          {view === "community-proposals" && selectedGroup && (
            <CommunityProposals
              group={selectedGroup}
              members={members}
              proposals={proposals}
              loading={communityLoading}
              onRefresh={fetchGroupData}
              initialAction={effectiveAction}
              initialPostId={effectiveAction === "unhide-post" ? initialPostId : undefined}
            />
          )}

          {view === "community-members" && selectedGroup && (
            <CommunityMembers group={selectedGroup} members={members} />
          )}

          {view === "community-treasuries" && (
            <CommunityTreasuries groups={groups} />
          )}

          {view === "chain-proposals" && <ChainProposals />}

          {view === "chain-operators" && <ServiceOperators />}

          {/* Show message if no groups loaded yet for the per-group views.
              Treasuries renders its own empty state from `groups`. */}
          {(view === "community-proposals" || view === "community-members") &&
            !selectedGroup &&
            !error && (
              <div className="rounded-xl sd-hull-tile p-12 text-center">
                <p className="text-zinc-400">Loading councils...</p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
