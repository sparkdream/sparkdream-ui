"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useWallet } from "@/contexts/WalletContext";
import { listCategories as fetchForumCategories, listForumPosts, listTags } from "@/lib/api";
import CategoryList from "@/components/forum/CategoryList";
import ThreadList from "@/components/forum/ThreadList";
import ThreadDetail from "@/components/forum/ThreadDetail";
import CreatePostForm from "@/components/forum/CreatePostForm";
import BountyList from "@/components/forum/BountyList";
import SentinelPanel from "@/components/forum/SentinelPanel";
import {
  ContentPageLayout,
  ContentToolbar,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import ConnectPrompt from "@/components/layout/ConnectPrompt";
import CopyableAddress from "@/components/CopyableAddress";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";
import { useCommonsCouncil } from "@/hooks/useCommonsCouncil";
import { PostStatus } from "@/types/forum";
import type { ForumPost } from "@/types/forum";
import type { Category } from "@/types/commons";

type View =
  | "all-threads"
  | "categories"
  | "category-threads"
  | "top-posts"
  | "create"
  | "my-posts"
  | "active-bounties"
  | "my-bounties"
  | "sentinel"
  | "thread-detail";

const TRUST_LEVELS: { key: string; label: string; cls: string }[] = [
  { key: "core", label: "Core", cls: "trust-core" },
  { key: "trusted", label: "Trusted", cls: "trust-trusted" },
  { key: "established", label: "Established", cls: "trust-est" },
  { key: "provisional", label: "Provisional", cls: "trust-prov" },
];

export default function SwarmPage() {
  const { connected, ready, sessionActive, activeSession, address } = useWallet();
  const { isOpsCommitteeMember } = useCommonsCouncil(address);

  const [view, setView] = useState<View>("all-threads");
  const [discussionsOpen, setDiscussionsOpen] = useLocalStorageBoolean("swarm-discussions-open", true);
  const [bountiesOpen, setBountiesOpen] = useLocalStorageBoolean("swarm-bounties-open", true);
  const [moderationOpen, setModerationOpen] = useLocalStorageBoolean("swarm-moderation-open", true);
  const [trustOpen, setTrustOpen] = useLocalStorageBoolean("swarm-trust-open", true);
  const [tagsOpen, setTagsOpen] = useLocalStorageBoolean("swarm-tags-open", true);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useSearchShortcut(searchRef);

  // Page-level spark feed for rail cards (Trending / Active voices).
  const [railSparks, setRailSparks] = useState<ForumPost[]>([]);

  // Tags surfaced in the sidebar. Sourced from the on-chain rep tag registry
  // so the filter is visible even before any sparks have been tagged.
  const [tagList, setTagList] = useState<string[]>([]);
  useEffect(() => {
    listTags({ limit: "50" })
      .then((res) => {
        const ranked = [...(res.tag || [])].sort((a, b) => {
          const ua = parseInt(a.usage_count || "0", 10);
          const ub = parseInt(b.usage_count || "0", 10);
          return ub - ua;
        });
        setTagList(ranked.map((t) => t.name));
      })
      .catch(() => setTagList([]));
  }, []);

  const TOP_TAGS = 5;
  const visibleTags = useMemo(() => {
    if (tagsExpanded) return tagList;
    const top = tagList.slice(0, TOP_TAGS);
    if (tagFilter && !top.includes(tagFilter) && tagList.includes(tagFilter)) {
      return [...top, tagFilter];
    }
    return top;
  }, [tagList, tagsExpanded, tagFilter]);
  const hiddenCount = Math.max(0, tagList.length - TOP_TAGS);

  useEffect(() => {
    listForumPosts({ limit: "20", reverse: true })
      .then((res) => {
        const roots = (res.post || []).filter(
          (p) => (p.parent_id === "0" || !p.parent_id) && p.status !== PostStatus.DELETED
        );
        setRailSparks(roots);
      })
      .catch(() => setRailSparks([]));
  }, [listKey]);

  const switchView = (v: View) => {
    setView(v);
    if (v !== "category-threads") setSelectedCategory(null);
    if (v !== "thread-detail") setSelectedThreadId(null);
  };

  const handleSelectCategory = (cat: Category) => {
    setSelectedCategory(cat);
    setView("category-threads");
  };

  const handleSelectThread = (post: ForumPost) => {
    const rootId = !post.root_id || post.root_id === "0" ? post.post_id : post.root_id;
    setSelectedThreadId(rootId);
    setView("thread-detail");
  };

  const handleSelectThreadById = (threadId: string) => {
    setSelectedThreadId(threadId);
    setView("thread-detail");
  };

  const handleBackFromThread = () => {
    setSelectedThreadId(null);
    setView(selectedCategory ? "category-threads" : "all-threads");
  };

  const handleCreated = () => {
    setListKey((k) => k + 1);
    switchView("all-threads");
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
        label="Discussions"
        open={discussionsOpen}
        onToggle={() => setDiscussionsOpen(!discussionsOpen)}
      >
        <button
          type="button"
          className={`sd-side-item spark-item${view === "all-threads" || view === "thread-detail" ? " active" : ""}`}
          onClick={() => switchView("all-threads")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2s4 4.5 4 8.5a4 4 0 01-8 0c0-1.2.4-2.2.9-3-.2 1.6-1.4 2.5-1.4 4.2A5.5 5.5 0 0013 17.5c3 0 5.5-2.5 5.5-5.8 0-4-2-6.5-3.5-8.2C13.8 2.3 12 2 12 2z" />
          </svg>
          All sparks
        </button>
        <button
          type="button"
          className={`sd-side-item${view === "categories" || view === "category-threads" ? " active" : ""}`}
          onClick={() => switchView("categories")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          Categories
        </button>
        <button
          type="button"
          className={`sd-side-item spark-item${view === "top-posts" ? " active" : ""}`}
          onClick={() => switchView("top-posts")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          Top sparks
        </button>
        <button
          type="button"
          className={`sd-side-item spark-item${view === "my-posts" ? " active" : ""}`}
          onClick={() => switchView("my-posts")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          My sparks
        </button>
      </SidebarSection>

      <SidebarSection
        label="Bounties"
        open={bountiesOpen}
        onToggle={() => setBountiesOpen(!bountiesOpen)}
      >
        <button
          type="button"
          className={`sd-side-item${view === "active-bounties" ? " active" : ""}`}
          onClick={() => switchView("active-bounties")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Active
        </button>
        <button
          type="button"
          className={`sd-side-item${view === "my-bounties" ? " active" : ""}`}
          onClick={() => switchView("my-bounties")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
          My Bounties
        </button>
      </SidebarSection>

      <SidebarSection
        label="Moderation"
        open={moderationOpen}
        onToggle={() => setModerationOpen(!moderationOpen)}
      >
        <button
          type="button"
          className={`sd-side-item${view === "sentinel" ? " active" : ""}`}
          onClick={() => switchView("sentinel")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          Sentinel
        </button>
      </SidebarSection>

      <SidebarSection
        label="Trust level"
        open={trustOpen}
        onToggle={() => setTrustOpen(!trustOpen)}
      >
        <div className="sd-side-pills">
          {TRUST_LEVELS.map((t) => (
            <button key={t.key} type="button" className={`sd-pill ${t.cls}`}>
              {t.label}
            </button>
          ))}
        </div>
      </SidebarSection>

      {tagList.length > 0 && (
        <SidebarSection
          label="Tags"
          open={tagsOpen}
          onToggle={() => setTagsOpen(!tagsOpen)}
        >
          <div className="sd-side-pills">
            {visibleTags.map((t) => {
              const isActive = tagFilter === t;
              const dim = tagFilter !== null && !isActive;
              return (
                <button
                  key={t}
                  type="button"
                  className="sd-pill tag"
                  style={{ opacity: dim ? 0.4 : 1, outline: isActive ? "1px solid currentColor" : "none" }}
                  onClick={() => setTagFilter(isActive ? null : t)}
                >
                  #{t}
                </button>
              );
            })}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="sd-pill tag-neutral"
                onClick={() => setTagsExpanded((v) => !v)}
              >
                {tagsExpanded ? "Show less" : `+${hiddenCount} more`}
              </button>
            )}
          </div>
        </SidebarSection>
      )}
    </>
  );

  const primaryAction = {
    label: "New spark",
    variant: "spark" as const,
    onClick: () => switchView("create"),
    disabled: !connected,
    title: connected ? "MsgCreatePost" : "Connect a wallet to create a spark",
  };

  const showToolbar =
    view !== "thread-detail" && view !== "create" && view !== "sentinel";

  const toolbar = showToolbar ? (
    <ContentToolbar
      segments={
        <>
          <button
            className={view === "all-threads" ? "on" : ""}
            onClick={() => switchView("all-threads")}
          >
            All sparks
          </button>
          <button
            className={view === "top-posts" ? "on" : ""}
            onClick={() => switchView("top-posts")}
          >
            Top sparks
          </button>
          <button
            className={view === "my-posts" ? "on" : ""}
            onClick={() => switchView("my-posts")}
          >
            My sparks
          </button>
        </>
      }
      searchPlaceholder="Search sparks, tags, or addresses…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchRef={searchRef}
      sort={sort}
      onSortChange={setSort}
      primaryAction={primaryAction}
    />
  ) : null;

  return (
    <ContentPageLayout
      title="Swarm"
      subtitle="Community discussions, bounties, and moderation"
      sidebar={sidebarFilters}
      toolbar={toolbar}
      railCards={
        <>
          <TrendingSparksCard sparks={railSparks.slice(0, 5)} onSelect={handleSelectThread} />
          <ActiveSparkVoicesCard sparks={railSparks} />
          <SessionKeyCard
            sessionActive={sessionActive}
            granteeAddr={activeSession?.grantee || null}
          />
        </>
      }
    >
      {view === "all-threads" && (
        <ThreadList
          key={`all-${listKey}`}
          mode="all"
          onSelectThread={handleSelectThread}
          tagFilter={tagFilter}
          onCreate={connected ? () => switchView("create") : undefined}
        />
      )}
      {view === "categories" && (
        <div>
          {isOpsCommitteeMember && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-600/10 px-4 py-3">
              <div className="text-sm">
                <div className="font-medium text-indigo-300">Commons Operations Committee</div>
                <div className="text-xs text-zinc-400">
                  Propose a new Swarm category. Submitting opens a vote in the COC group.
                </div>
              </div>
              <Link
                href="/governance?group=Commons%20Operations%20Committee&action=create-category"
                className="sd-btn sd-btn-primary"
              >
                New category
              </Link>
            </div>
          )}
          <CategoryList onSelectCategory={handleSelectCategory} />
        </div>
      )}
      {view === "category-threads" && selectedCategory && (
        <div>
          <button
            onClick={() => switchView("categories")}
            className="mb-4 flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            All Categories
          </button>
          <ThreadList
            key={`cat-${selectedCategory.category_id}-${listKey}`}
            mode="category"
            category={selectedCategory}
            onSelectThread={handleSelectThread}
            tagFilter={tagFilter}
          />
        </div>
      )}
      {view === "top-posts" && (
        <ThreadList
          key={`top-${listKey}`}
          mode="top"
          onSelectThread={handleSelectThread}
          tagFilter={tagFilter}
          onCreate={connected ? () => switchView("create") : undefined}
        />
      )}
      {view === "create" && (
        <CreateThreadView
          onCreated={handleCreated}
          onCancel={() => switchView("all-threads")}
        />
      )}
      {view === "my-posts" && (
        connected ? (
          <ThreadList
            key={`my-${listKey}`}
            mode="my-posts"
            onSelectThread={handleSelectThread}
            tagFilter={tagFilter}
            onCreate={() => switchView("create")}
          />
        ) : (
          <ConnectPrompt message="Connect your wallet to see your sparks." />
        )
      )}
      {view === "active-bounties" && (
        <BountyList mode="active" onSelectThread={handleSelectThreadById} />
      )}
      {view === "my-bounties" && (
        connected ? (
          <BountyList mode="my" onSelectThread={handleSelectThreadById} />
        ) : (
          <ConnectPrompt message="Connect your wallet to see your bounties." />
        )
      )}
      {view === "sentinel" && (
        connected ? (
          <SentinelPanel />
        ) : (
          <ConnectPrompt message="Connect your wallet to access Sentinel moderation." />
        )
      )}
      {view === "thread-detail" && selectedThreadId && (
        <ThreadDetail
          threadId={selectedThreadId}
          onBack={handleBackFromThread}
        />
      )}
    </ContentPageLayout>
  );
}

/** Wrapper that fetches categories for the "New spark" form. */
function CreateThreadView({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [catId, setCatId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = useState(true);

  useEffect(() => {
    fetchForumCategories()
      .then((res) => {
        const cats = res.category || [];
        setCategories(cats);
        if (cats.length > 0) {
          setCatId(cats[0].category_id);
        }
      })
      .catch(() => setCategories([]))
      .finally(() => setLoadingCats(false));
  }, []);

  if (loadingCats) {
    return <div className="h-48 animate-pulse sd-hull-tile rounded-xl" />;
  }

  return (
    <div>
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Category</label>
        <select
          value={catId}
          onChange={(e) => setCatId(e.target.value)}
          className="sd-select"
        >
          {categories.map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
      {catId && (
        <CreatePostForm
          mode="thread"
          categoryId={catId}
          onCreated={onCreated}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

function TrendingSparksCard({ sparks, onSelect }: { sparks: ForumPost[]; onSelect: (p: ForumPost) => void }) {
  return (
    <div className="sd-rail-card sparks">
      <h5>
        Trending onchain
        <span className="live">
          <span className="d" />
          live
        </span>
      </h5>
      {sparks.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>
          No sparks yet.
        </div>
      )}
      {sparks.map((p, i) => {
        const preview = (p.content || "").length > 48
          ? (p.content || "").slice(0, 48) + "…"
          : (p.content || `Spark #${p.post_id}`);
        const score = parseInt(p.upvote_count || "0", 10) - parseInt(p.downvote_count || "0", 10);
        return (
          <button
            key={p.post_id}
            type="button"
            onClick={() => onSelect(p)}
            className="sd-trend-row"
            style={{ background: "transparent", border: 0, width: "100%", textAlign: "left", cursor: "pointer" }}
          >
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <span className="title">{preview}</span>
            <span className="c">{score}</span>
          </button>
        );
      })}
    </div>
  );
}

function ActiveSparkVoicesCard({ sparks }: { sparks: ForumPost[] }) {
  const voices = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of sparks) map.set(p.author, (map.get(p.author) || 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [sparks]);

  return (
    <div className="sd-rail-card">
      <h5>Active voices this week</h5>
      {voices.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>
          No voices yet.
        </div>
      ) : (
        voices.map(([addr, count], i) => (
          <ActiveVoiceRow key={addr} addr={addr} count={count} idx={i} />
        ))
      )}
    </div>
  );
}

function ActiveVoiceRow({ addr, count, idx }: { addr: string; count: number; idx: number }) {
  const { name } = useDisplayName(addr);
  const gradients = [
    "linear-gradient(135deg, var(--violet), var(--rose))",
    "linear-gradient(135deg, var(--green), var(--violet))",
    "linear-gradient(135deg, var(--amber), var(--rose))",
  ];
  const initial = (name || addr).charAt(name ? 0 : 8).toUpperCase();
  return (
    <div className="sd-member-row">
      <div className="sd-avatar sm" style={{ background: gradients[idx % gradients.length] }}>
        {initial}
      </div>
      <div className="info">
        <CopyableAddress className="addr" address={addr} resolveName />
        <div className="meta">{count} {count === 1 ? "spark" : "sparks"}</div>
      </div>
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
            <CopyableAddress className="sd-pill trust-core" style={{ fontFamily: "var(--font-geist-mono)" }} address={granteeAddr} />{" "}
            with <span style={{ color: "var(--ink)" }}>SendSpark · SendReply · Vote</span>.
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
