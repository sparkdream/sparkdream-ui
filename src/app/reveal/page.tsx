"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { listContributions, getRevealParams } from "@/lib/api";
import {
  ContentPageLayout,
  ContentToolbar,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import ConnectPrompt from "@/components/layout/ConnectPrompt";
import ContributionList from "@/components/reveal/ContributionList";
import ContributionDetail from "@/components/reveal/ContributionDetail";
import ProposeForm from "@/components/reveal/ProposeForm";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";
import CopyableAddress from "@/components/CopyableAddress";
import { formatDecPercent, formatDream } from "@/lib/reveal-fmt";
import { CONTRIBUTION_STATUS_LABELS } from "@/types/reveal";
import type { Contribution, RevealParams } from "@/types/reveal";

type View =
  | "all"
  | "proposed"
  | "in-progress"
  | "completed"
  | "mine"
  | "propose"
  | "detail";

export default function RevealPage() {
  const { address, connected, ready, sessionActive, activeSession } = useWallet();
  const isMember = useIsRepMember(address);
  const cannotPropose = connected && isMember === false;

  const [view, setView] = useState<View>("all");
  const [browseOpen, setBrowseOpen] = useLocalStorageBoolean("reveal-browse-open", true);
  const [myOpen, setMyOpen] = useLocalStorageBoolean("reveal-my-open", true);
  const [paramsOpen, setParamsOpen] = useLocalStorageBoolean("reveal-params-open", false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  const [railContribs, setRailContribs] = useState<Contribution[]>([]);
  const [params, setParams] = useState<RevealParams | null>(null);

  useEffect(() => {
    listContributions({ limit: "20", reverse: true })
      .then((res) => setRailContribs(res.contributions || []))
      .catch(() => setRailContribs([]));
  }, [listKey]);

  useEffect(() => {
    getRevealParams()
      .then((res) => setParams(res.params))
      .catch(() => setParams(null));
  }, []);

  const switchView = (v: View) => {
    setView(v);
    if (v !== "detail") setSelectedId(null);
  };

  const handleSelect = (c: Contribution) => {
    setSelectedId(c.id);
    setView("detail");
  };

  const handleBackFromDetail = () => {
    setSelectedId(null);
    setView("all");
  };

  const handleProposed = () => {
    setListKey((k) => k + 1);
    switchView("mine");
  };

  if (!ready) {
    return (
      <div className="sd-page">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
      </div>
    );
  }

  const sidebarFilters = (
    <>
      <SidebarSection
        label="Browse"
        open={browseOpen}
        onToggle={() => setBrowseOpen(!browseOpen)}
      >
        <SidebarItem active={view === "all" || view === "detail"} onClick={() => switchView("all")}>
          All contributions
        </SidebarItem>
        <SidebarItem active={view === "proposed"} onClick={() => switchView("proposed")}>
          Proposed
        </SidebarItem>
        <SidebarItem active={view === "in-progress"} onClick={() => switchView("in-progress")}>
          In progress
        </SidebarItem>
        <SidebarItem active={view === "completed"} onClick={() => switchView("completed")}>
          Completed
        </SidebarItem>
      </SidebarSection>

      <SidebarSection
        label="My contributions"
        open={myOpen}
        onToggle={() => setMyOpen(!myOpen)}
      >
        <SidebarItem active={view === "mine"} onClick={() => switchView("mine")}>
          Proposed by me
        </SidebarItem>
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

  const showToolbar = view !== "detail" && view !== "propose";

  const toolbar = showToolbar ? (
    <ContentToolbar
      segments={
        <>
          <button className={view === "all" ? "on" : ""} onClick={() => switchView("all")}>
            All
          </button>
          <button className={view === "in-progress" ? "on" : ""} onClick={() => switchView("in-progress")}>
            In progress
          </button>
          <button className={view === "mine" ? "on" : ""} onClick={() => switchView("mine")}>
            Mine
          </button>
        </>
      }
      searchPlaceholder="Search contributions…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchRef={searchRef}
      sort={sort}
      onSortChange={setSort}
      primaryAction={{
        label: "Propose",
        onClick: () => switchView("propose"),
        disabled: !connected || cannotPropose,
        title: !connected
          ? "Connect a wallet to propose a contribution"
          : cannotPropose
            ? "Only existing members can propose contributions"
            : "MsgProposeContribution",
      }}
    />
  ) : null;

  return (
    <ContentPageLayout
      title="Reveal"
      subtitle="Progressive open-source — staked conviction reveals closed-source code in tranches"
      sidebar={sidebarFilters}
      toolbar={toolbar}
      railCards={
        <>
          <RecentContributionsCard
            contributions={railContribs.slice(0, 5)}
            onSelect={handleSelect}
          />
          <SessionKeyCard
            sessionActive={sessionActive}
            granteeAddr={activeSession?.grantee || null}
          />
        </>
      }
    >
      {view === "all" && (
        <ContributionList key={`all-${listKey}`} mode="all" onSelect={handleSelect} />
      )}
      {view === "proposed" && (
        <ContributionList
          key={`proposed-${listKey}`}
          mode="by-status"
          status="PROPOSED"
          onSelect={handleSelect}
        />
      )}
      {view === "in-progress" && (
        <ContributionList
          key={`inprog-${listKey}`}
          mode="by-status"
          status="IN_PROGRESS"
          onSelect={handleSelect}
        />
      )}
      {view === "completed" && (
        <ContributionList
          key={`completed-${listKey}`}
          mode="by-status"
          status="COMPLETED"
          onSelect={handleSelect}
        />
      )}
      {view === "mine" && (
        connected && address ? (
          <ContributionList
            key={`mine-${listKey}`}
            mode="by-contributor"
            contributor={address}
            onSelect={handleSelect}
          />
        ) : (
          <ConnectPrompt message="Connect your wallet to see contributions you've proposed." />
        )
      )}
      {view === "propose" && (
        !connected ? (
          <ConnectPrompt message="Connect your wallet to propose a contribution." />
        ) : cannotPropose ? (
          <ConnectPrompt
            align="left"
            message={
              <>
                Want to propose a contribution? Proposing contributions is open to members. Ask any existing{" "}
                <Link href="/contribute?view=members" className="text-indigo-400 hover:text-indigo-300 underline">
                  member
                </Link>
                {" "}to invite you in. We&apos;d love to have you contribute.
              </>
            }
          />
        ) : (
          <ProposeForm onProposed={handleProposed} onCancel={() => switchView("all")} />
        )
      )}
      {view === "detail" && selectedId && (
        <ContributionDetail contributionId={selectedId} onBack={handleBackFromDetail} />
      )}
    </ContentPageLayout>
  );
}

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

function ParamList({ params }: { params: RevealParams }) {
  const rows = useMemo(
    () => [
      ["Stake deadline", `${params.stake_deadline_epochs} blocks`],
      ["Reveal deadline", `${params.reveal_deadline_epochs} blocks`],
      ["Verification window", `${params.verification_period_epochs} blocks`],
      ["Dispute window", `${params.dispute_resolution_epochs} blocks`],
      ["Verification threshold", formatDecPercent(params.verification_threshold)],
      ["Min votes", String(params.min_verification_votes)],
      ["Max tranches", String(params.max_tranches)],
      ["Max tranche valuation", `${formatDream(params.max_tranche_valuation)} DREAM`],
      ["Max total valuation", `${formatDream(params.max_total_valuation)} DREAM`],
      ["Bond rate", formatDecPercent(params.bond_rate)],
      ["Min stake", `${formatDream(params.min_stake_amount)} DREAM`],
      ["Holdback rate", formatDecPercent(params.payout_holdback_rate)],
      ["Cooldown", `${params.proposal_cooldown_epochs} blocks`],
    ],
    [params]
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

function RecentContributionsCard({
  contributions,
  onSelect,
}: {
  contributions: Contribution[];
  onSelect: (c: Contribution) => void;
}) {
  return (
    <div className="sd-rail-card">
      <h5>
        Recent contributions
        <span className="live">
          <span className="d" />
          live
        </span>
      </h5>
      {contributions.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>
          No contributions yet.
        </div>
      )}
      {contributions.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c)}
          className="sd-trend-row"
          style={{ background: "transparent", border: 0, width: "100%", textAlign: "left", cursor: "pointer" }}
        >
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <span className="title">{c.project_name || `Contribution #${c.id}`}</span>
          <span className="c">{CONTRIBUTION_STATUS_LABELS[c.status]?.slice(0, 4) || ""}</span>
        </button>
      ))}
    </div>
  );
}

function SessionKeyCard({
  sessionActive,
  granteeAddr,
}: {
  sessionActive: boolean;
  granteeAddr: string | null;
}) {
  return (
    <div className="sd-rail-card">
      <h5>Your session key</h5>
      <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55 }}>
        {sessionActive && granteeAddr ? (
          <>
            Granted to{" "}
            <CopyableAddress className="sd-pill trust-core" style={{ fontFamily: "var(--font-geist-mono)" }} address={granteeAddr} />
          </>
        ) : (
          <>
            No active session. Visit{" "}
            <Link href="/sessions" style={{ color: "var(--violet-hi)" }}>
              Sessions
            </Link>{" "}
            to create a scoped key for bots or agents.
          </>
        )}
      </div>
    </div>
  );
}
