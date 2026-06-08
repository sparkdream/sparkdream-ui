"use client";

import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Post, ReactionCounts } from "@/types/blog";
import { PostStatus, REACTION_INFO, ReactionType } from "@/types/blog";
import { listPosts, getAllMembers, listTags, getLatestBlockHeight, getReactionCounts } from "@/lib/api";
import { TrustLevel } from "@/types/rep";
import PostRow from "@/components/PostRow";
import CreatePostForm from "@/components/CreatePostForm";
import DreamDetail from "@/components/DreamDetail";
import {
  ContentPageLayout,
  ContentToolbar,
  SidebarSection,
} from "@/components/layout/ContentPageLayout";
import { useWallet } from "@/contexts/WalletContext";
import { timeAgo, formatTime, countToNum } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useLocalStorageBoolean } from "@/hooks/useLocalStorageBoolean";
import { useSearchShortcut } from "@/hooks/useSearchShortcut";

type SortOption = "newest" | "oldest";
type FilterOption = "my-posts" | "members" | "all";

// Ordered high→low as rendered. `rank` is used for "this level and above" filtering.
const TRUST_LEVELS: { key: string; label: string; cls: string; value: string; rank: number }[] = [
  { key: "core", label: "Core", cls: "trust-core", value: TrustLevel.CORE, rank: 4 },
  { key: "trusted", label: "Trusted", cls: "trust-trusted", value: TrustLevel.TRUSTED, rank: 3 },
  { key: "established", label: "Established", cls: "trust-est", value: TrustLevel.ESTABLISHED, rank: 2 },
  { key: "provisional", label: "Provisional", cls: "trust-prov", value: TrustLevel.PROVISIONAL, rank: 1 },
];

// Full enum→rank map (includes NEW=0, which has no filter pill) so a member's
// trust level resolves to a comparable rank during client-side filtering.
const TRUST_RANK: Record<string, number> = {
  [TrustLevel.NEW]: 0,
  [TrustLevel.PROVISIONAL]: 1,
  [TrustLevel.ESTABLISHED]: 2,
  [TrustLevel.TRUSTED]: 3,
  [TrustLevel.CORE]: 4,
};

export default function ImaginariumPage() {
  return (
    <Suspense fallback={null}>
      <ImaginariumPageInner />
    </Suspense>
  );
}

function ImaginariumPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // URL is the single source of truth for the selected post so a reload keeps
  // the user on the dream they were reading. `?post=<id>` is restricted to
  // digit-only ids (post ids are uint64) to avoid open-redirect-ish surfaces.
  const postParam = searchParams.get("post");
  const selectedPostId = postParam && /^\d+$/.test(postParam) ? postParam : null;
  const { connected, address, sessionActive, activeSession } = useWallet();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [memberAddresses, setMemberAddresses] = useState<Set<string>>(new Set());
  const [memberRanks, setMemberRanks] = useState<Map<string, number>>(new Map());
  const [membersLoading, setMembersLoading] = useState(true);
  const [trustFilter, setTrustFilter] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterOption>("members");
  const [sort, setSort] = useState<SortOption>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRestored, setFilterRestored] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [feedOpen, setFeedOpen] = useLocalStorageBoolean("imaginarium-feed-open", true);
  const [trustOpen, setTrustOpen] = useLocalStorageBoolean("imaginarium-trust-open", true);
  const [tagsOpen, setTagsOpen] = useLocalStorageBoolean("imaginarium-tags-open", true);

  const [tagList, setTagList] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  const [endOfFeedHeight, setEndOfFeedHeight] = useState<string | null>(null);
  useEffect(() => {
    if (nextKey || posts.length === 0) return;
    let cancelled = false;
    getLatestBlockHeight()
      .then((h) => { if (!cancelled) setEndOfFeedHeight(h); })
      .catch(() => { if (!cancelled) setEndOfFeedHeight(null); });
    return () => { cancelled = true; };
  }, [nextKey, posts.length]);

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
  const hiddenTagCount = Math.max(0, tagList.length - TOP_TAGS);

  useSearchShortcut(searchRef);

  useEffect(() => {
    const saved = localStorage.getItem("imaginarium-filter");
    if (saved === "my-posts" || saved === "members" || saved === "all") {
      if (saved === "my-posts" && !connected) setFilter("members");
      else setFilter(saved);
    }
    setFilterRestored(true);
  }, [connected]);

  useEffect(() => {
    if (filterRestored) localStorage.setItem("imaginarium-filter", filter);
  }, [filter, filterRestored]);

  useEffect(() => {
    getAllMembers()
      .then((members) => {
        setMemberAddresses(new Set(members.map((m) => m.address)));
        setMemberRanks(new Map(members.map((m) => [m.address, TRUST_RANK[m.trust_level] ?? 0])));
      })
      .catch(() => {})
      .finally(() => setMembersLoading(false));
  }, []);

  // Trust filtering is "selected level and above", computed client-side from the
  // member roster's trust_level. (The members_by_trust_level LCD endpoint is
  // broken, so we never query it — see getAllMembers.)
  const trustAddresses = useMemo(() => {
    if (!trustFilter) return null;
    const selected = TRUST_LEVELS.find((t) => t.key === trustFilter);
    if (!selected) return null;
    const addrs = new Set<string>();
    for (const [addr, rank] of memberRanks) {
      if (rank >= selected.rank) addrs.add(addr);
    }
    return addrs;
  }, [trustFilter, memberRanks]);

  const fetchPosts = useCallback(async (paginationKey?: string) => {
    try {
      setLoading(true);
      const res = await listPosts({
        limit: "20",
        countTotal: true,
        reverse: true,
        ...(paginationKey ? { key: paginationKey } : {}),
      });
      const active = (res.post || []).filter((p) => p.status !== PostStatus.DELETED);
      setPosts((prev) => (paginationKey ? [...prev, ...active] : active));
      setNextKey(res.pagination?.next_key || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dreams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Infinite scroll
  const nextKeyRef = useRef(nextKey);
  nextKeyRef.current = nextKey;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && nextKeyRef.current && !loadingRef.current) {
          fetchPosts(nextKeyRef.current);
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fetchPosts]);

  const filteredAndSorted = useMemo(() => {
    let result = posts;
    if (filter === "my-posts" && address) {
      result = result.filter((p) => p.creator === address);
    } else if (filter === "members" && memberAddresses.size > 0) {
      result = result.filter((p) => memberAddresses.has(p.creator));
    }
    if (trustFilter && trustAddresses) {
      result = result.filter((p) => trustAddresses.has(p.creator));
    }
    if (tagFilter) {
      result = result.filter((p) => (p.tags || []).includes(tagFilter));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((p) => {
        if (p.title?.toLowerCase().includes(q)) return true;
        if (p.body?.toLowerCase().includes(q)) return true;
        if (p.creator?.toLowerCase().includes(q)) return true;
        if ((p.tags || []).some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    if (sort === "oldest") {
      result = [...result].sort(
        (a, b) => parseInt(a.created_at, 10) - parseInt(b.created_at, 10)
      );
    }
    return result;
  }, [posts, filter, sort, memberAddresses, address, trustFilter, trustAddresses, tagFilter, searchQuery]);

  const featured = useMemo(
    () => filteredAndSorted.find((p) => !!p.pinned_by) || null,
    [filteredAndSorted]
  );
  const listPostsData = useMemo(
    () => (featured ? filteredAndSorted.filter((p) => p.id !== featured.id) : filteredAndSorted),
    [filteredAndSorted, featured]
  );

  const myPostCount = address
    ? posts.filter((p) => p.creator === address).length
    : 0;
  const memberPostCount = posts.filter((p) => memberAddresses.has(p.creator)).length;

  const sidebarFilters = (
    <>
      <SidebarSection label="Feed" open={feedOpen} onToggle={() => setFeedOpen(!feedOpen)}>
        <button
          type="button"
          className={`sd-side-item dream-item${filter === "all" ? " active" : ""}`}
          onClick={() => setFilter("all")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
          All dreams <span className="badge">{posts.length}</span>
        </button>
        <button
          type="button"
          className={`sd-side-item dream-item${filter === "members" ? " active" : ""}`}
          onClick={() => setFilter("members")}
        >
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
          Members <span className="badge">{memberPostCount}</span>
        </button>
        {connected && (
          <button
            type="button"
            className={`sd-side-item dream-item${filter === "my-posts" ? " active" : ""}`}
            onClick={() => setFilter("my-posts")}
          >
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            My dreams <span className="badge">{myPostCount}</span>
          </button>
        )}
      </SidebarSection>

      <SidebarSection label="Trust level" open={trustOpen} onToggle={() => setTrustOpen(!trustOpen)}>
        <div className="sd-side-pills">
          {TRUST_LEVELS.map((t) => {
            const selectedRank = TRUST_LEVELS.find((x) => x.key === trustFilter)?.rank ?? null;
            const included = selectedRank !== null && t.rank >= selectedRank;
            const isSelected = trustFilter === t.key;
            const dim = selectedRank !== null && !included;
            return (
              <button
                key={t.key}
                type="button"
                className={`sd-pill ${t.cls}`}
                style={{ opacity: dim ? 0.4 : 1, outline: isSelected ? "1px solid currentColor" : "none" }}
                onClick={() => setTrustFilter(isSelected ? null : t.key)}
                title={`${t.label} and above`}
              >
                {t.label}
              </button>
            );
          })}
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
            {hiddenTagCount > 0 && (
              <button
                type="button"
                className="sd-pill tag-neutral"
                onClick={() => setTagsExpanded((v) => !v)}
              >
                {tagsExpanded ? "Show less" : `+${hiddenTagCount} more`}
              </button>
            )}
          </div>
        </SidebarSection>
      )}
    </>
  );

  const primaryAction = {
    label: "New dream",
    variant: "dream" as const,
    onClick: () => setShowCreate(true),
    disabled: !connected,
    title: connected ? "MsgCreatePost" : "Connect a wallet to create a dream",
  };

  const handleSelectPost = (p: Post) =>
    router.push(`/imaginarium?post=${p.id}`, { scroll: false });
  const handleBackFromDetail = () =>
    router.push("/imaginarium", { scroll: false });

  const toolbar = !showCreate && !selectedPostId && (
    <ContentToolbar
      segments={
        <>
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            All dreams
          </button>
          <button className={filter === "members" ? "on" : ""} onClick={() => setFilter("members")}>
            Members
          </button>
          {connected && (
            <button className={filter === "my-posts" ? "on" : ""} onClick={() => setFilter("my-posts")}>
              My dreams
            </button>
          )}
        </>
      }
      searchPlaceholder="Search dreams, tags, or addresses…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchRef={searchRef}
      sort={sort}
      onSortChange={setSort}
      primaryAction={primaryAction}
    />
  );

  return (
    <ContentPageLayout
      title="Imaginarium"
      subtitle="Personal dreams, reflections, and self-published works from members"
      sidebar={sidebarFilters}
      toolbar={toolbar}
      railCards={
        <>
          <TrendingCard posts={posts.slice(0, 5)} onSelect={handleSelectPost} />
          <ActiveVoicesCard posts={posts} />
          <SessionKeyCard
            sessionActive={sessionActive}
            granteeAddr={activeSession?.grantee || null}
          />
        </>
      }
    >
      {selectedPostId ? (
        <DreamDetail postId={selectedPostId} onBack={handleBackFromDetail} />
      ) : showCreate ? (
        <CreatePostForm
          onCreated={() => setShowCreate(false)}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <>
          {error && (
            <div
              style={{
                marginBottom: 20,
                padding: "10px 14px",
                borderRadius: "var(--r-sm)",
                border: "1px solid rgba(244,63,94,0.35)",
                background: "rgba(244,63,94,0.08)",
                color: "#fb7185",
                fontSize: 13,
              }}
            >
              {error}
              <button
                onClick={() => fetchPosts()}
                style={{
                  marginLeft: 10,
                  background: "transparent",
                  border: 0,
                  color: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {featured && <FeaturedPost post={featured} onSelect={handleSelectPost} />}

          {(loading && posts.length === 0) ? (
            <PostRowSkeleton />
          ) : listPostsData.length === 0 && !featured ? (
            <EmptyState
              connected={connected}
              filter={filter}
              hasAnyPosts={posts.length > 0}
              onShowAll={() => setFilter("all")}
              onCreate={() => setShowCreate(true)}
            />
          ) : (
            <>
              <div className="sd-post-list">
                {listPostsData.map((p) => (
                  <PostRow key={p.id} post={p} onSelect={handleSelectPost} />
                ))}
              </div>
              <div ref={sentinelRef} style={{ height: 1 }} />
              {loading && posts.length > 0 && <PostRowSkeleton />}
              {!nextKey && posts.length > 0 && (
                <div className="sd-load-more">
                  End of feed{endOfFeedHeight ? ` · block ${Number(endOfFeedHeight).toLocaleString("en-US")}` : ""}
                </div>
              )}
            </>
          )}

          {membersLoading && filter === "members" && posts.length > 0 && (
            <div className="sd-load-more">Loading members…</div>
          )}
        </>
      )}
    </ContentPageLayout>
  );
}

function FeaturedPost({ post, onSelect }: { post: Post; onSelect: (p: Post) => void }) {
  const { name } = useDisplayName(post.creator);
  const [counts, setCounts] = useState<ReactionCounts | null>(null);
  useEffect(() => {
    getReactionCounts(post.id)
      .then((r) => setCounts(r.counts))
      .catch(() => {});
  }, [post.id]);
  return (
    <button
      type="button"
      onClick={() => onSelect(post)}
      className="sd-featured"
      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", width: "100%", textAlign: "left", font: "inherit" }}
    >
      <div className="art">
        <div className="glyph">
          <div className="frame">
            <b>◆ Pinned · Council Memo</b>
            <span className="hash">{formatTime(post.created_at)}</span>
          </div>
        </div>
      </div>
      <div className="body">
        <div className="meta-row">
          <span className="pin">◆ Pinned</span>
          <span>·</span>
          <span>{timeAgo(post.created_at)}</span>
        </div>
        <h2>{post.title}</h2>
        <p>{post.body}</p>
        <span className="more">Read more →</span>
        <div className="foot">
          <div className="who">
            <div className="sd-avatar">{(name || post.creator).charAt(name ? 0 : 8).toUpperCase()}</div>
            <div>
              <div className="name"><CopyableAddress address={post.creator} resolveName nested /></div>
              <CopyableAddress className="addr" address={post.creator} nested style={{ display: "block" }} />
            </div>
          </div>
          <div className="stats">
            {countToNum(post.reply_count) > 0 && (
              <span>💬 {countToNum(post.reply_count)} replies</span>
            )}
            {counts &&
              Object.values(ReactionType).map((rt) => {
                const info = REACTION_INFO[rt];
                const key = `${rt.replace("REACTION_TYPE_", "").toLowerCase()}_count` as keyof ReactionCounts;
                const n = countToNum(counts[key]);
                if (n === 0) return null;
                return (
                  <span key={rt}>
                    {info.emoji} {n}
                  </span>
                );
              })}
          </div>
        </div>
      </div>
    </button>
  );
}

function TrendingCard({ posts, onSelect }: { posts: Post[]; onSelect: (p: Post) => void }) {
  return (
    <div className="sd-rail-card dreams">
      <h5>
        Trending onchain
        <span className="live">
          <span className="d" />
          live
        </span>
      </h5>
      {posts.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--ink-soft)", padding: "4px 0" }}>
          No dreams yet.
        </div>
      )}
      {posts.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onSelect(p)}
          className="sd-trend-row"
          style={{ background: "transparent", border: 0, width: "100%", textAlign: "left", cursor: "pointer" }}
        >
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <span className="title">{p.title}</span>
          <span className="c">{p.reply_count}</span>
        </button>
      ))}
    </div>
  );
}

function ActiveVoicesCard({ posts }: { posts: Post[] }) {
  const voices = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of posts) map.set(p.creator, (map.get(p.creator) || 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [posts]);

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
        <div className="meta">{count} {count === 1 ? "dream" : "dreams"}</div>
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
            with <span style={{ color: "var(--ink)" }}>CreatePost · CreateReply · React</span>.
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

function PostRowSkeleton() {
  return (
    <div className="sd-post-list">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="sd-post"
          style={{ cursor: "default", pointerEvents: "none", opacity: 0.7 }}
        >
          <div className="who-col">
            <div className="sd-avatar" style={{ background: "var(--panel-2)" }} />
          </div>
          <div className="body-col">
            <div className="head">
              <span className="addr" style={{ width: 120, background: "var(--panel-2)", borderRadius: 4 }}>
                &nbsp;
              </span>
            </div>
            <h3 style={{ background: "var(--panel-2)", color: "transparent", borderRadius: 4, display: "inline-block", width: "60%" }}>
              &nbsp;
            </h3>
            <p className="excerpt" style={{ background: "var(--panel-2)", color: "transparent", borderRadius: 4 }}>
              &nbsp;
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  connected,
  filter,
  hasAnyPosts,
  onShowAll,
  onCreate,
}: {
  connected: boolean;
  filter: FilterOption;
  hasAnyPosts: boolean;
  onShowAll: () => void;
  onCreate: () => void;
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px dashed var(--rule-strong)",
        borderRadius: "var(--r-lg)",
        padding: "48px 24px",
        textAlign: "center",
        color: "var(--ink-mute)",
      }}
    >
      <p style={{ margin: 0 }}>
        {filter === "members" && hasAnyPosts
          ? "No member dreams found"
          : filter === "my-posts"
            ? "You haven't published a dream yet"
            : "No dreams yet"}
      </p>
      {filter === "members" && hasAnyPosts ? (
        <button
          onClick={onShowAll}
          style={{
            marginTop: 12,
            background: "transparent",
            border: 0,
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Show all dreams
        </button>
      ) : connected ? (
        <button
          type="button"
          onClick={onCreate}
          style={{
            display: "inline-block",
            marginTop: 12,
            background: "transparent",
            border: 0,
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {filter === "my-posts" ? "Publish your first dream" : "Publish the first dream"}
        </button>
      ) : null}
    </div>
  );
}
