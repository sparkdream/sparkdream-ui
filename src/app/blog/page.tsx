"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { Post } from "@/types/blog";
import { PostStatus } from "@/types/blog";
import { listPosts, getAllMemberAddresses } from "@/lib/api";
import PostRow from "@/components/PostRow";
import { useWallet } from "@/contexts/WalletContext";
import { timeAgo, truncateAddress } from "@/lib/utils";
import { useResolveName } from "@/hooks/useResolveName";

type SortOption = "newest" | "oldest";
type FilterOption = "my-posts" | "members" | "all";

export default function BlogPage() {
  const { connected, address, sessionActive, activeSession } = useWallet();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [memberAddresses, setMemberAddresses] = useState<Set<string>>(new Set());
  const [membersLoading, setMembersLoading] = useState(true);

  const [filter, setFilter] = useState<FilterOption>("members");
  const [sort, setSort] = useState<SortOption>("newest");
  const [filterRestored, setFilterRestored] = useState(false);
  const [feedCollapsed, setFeedCollapsed] = useState(false);
  const [trustCollapsed, setTrustCollapsed] = useState(false);
  const [tagsCollapsed, setTagsCollapsed] = useState(false);
  const [collapseRestored, setCollapseRestored] = useState(false);

  useEffect(() => {
    setFeedCollapsed(localStorage.getItem("blog-feed-collapsed") === "1");
    setTrustCollapsed(localStorage.getItem("blog-trust-collapsed") === "1");
    setTagsCollapsed(localStorage.getItem("blog-tags-collapsed") === "1");
    setCollapseRestored(true);
  }, []);

  useEffect(() => {
    if (!collapseRestored) return;
    localStorage.setItem("blog-feed-collapsed", feedCollapsed ? "1" : "0");
    localStorage.setItem("blog-trust-collapsed", trustCollapsed ? "1" : "0");
    localStorage.setItem("blog-tags-collapsed", tagsCollapsed ? "1" : "0");
  }, [feedCollapsed, trustCollapsed, tagsCollapsed, collapseRestored]);

  const TRUST_LEVELS: { key: string; label: string; cls: string }[] = [
    { key: "core", label: "Core", cls: "trust-core" },
    { key: "trusted", label: "Trusted", cls: "trust-trusted" },
    { key: "established", label: "Established", cls: "trust-est" },
    { key: "provisional", label: "Provisional", cls: "trust-prov" },
  ];

  const TAG_FILTERS: string[] = [
    "governance",
    "staking",
    "collections",
    "changelog",
    "builders",
  ];

  useEffect(() => {
    const saved = localStorage.getItem("blog-filter");
    if (saved === "my-posts" || saved === "members" || saved === "all") {
      if (saved === "my-posts" && !connected) setFilter("members");
      else setFilter(saved);
    }
    setFilterRestored(true);
  }, [connected]);

  useEffect(() => {
    if (filterRestored) localStorage.setItem("blog-filter", filter);
  }, [filter, filterRestored]);

  useEffect(() => {
    getAllMemberAddresses()
      .then(setMemberAddresses)
      .catch(() => {})
      .finally(() => setMembersLoading(false));
  }, []);

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
      setError(err instanceof Error ? err.message : "Failed to load scrolls");
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

  // ⌘K / Ctrl-K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const filteredAndSorted = useMemo(() => {
    let result = posts;
    if (filter === "my-posts" && address) {
      result = result.filter((p) => p.creator === address);
    } else if (filter === "members" && memberAddresses.size > 0) {
      result = result.filter((p) => memberAddresses.has(p.creator));
    }
    if (sort === "oldest") {
      result = [...result].sort(
        (a, b) => parseInt(a.created_at, 10) - parseInt(b.created_at, 10)
      );
    }
    return result;
  }, [posts, filter, sort, memberAddresses, address]);

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

  const collapseHead = (label: string, collapsed: boolean, toggle: () => void) => (
    <button
      type="button"
      className="sd-side-group-head"
      aria-expanded={!collapsed}
      onClick={toggle}
    >
      {label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );

  const feedFilters = (
    <>
      <div className={`sd-side-group${feedCollapsed ? " collapsed" : ""}`}>
        {collapseHead("Feed", feedCollapsed, () => setFeedCollapsed((v) => !v))}
        {!feedCollapsed && (
          <>
            <button
              type="button"
              className={`sd-side-item${filter === "all" ? " active" : ""}`}
              onClick={() => setFilter("all")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              All scrolls <span className="badge">{posts.length}</span>
            </button>
            <button
              type="button"
              className={`sd-side-item${filter === "members" ? " active" : ""}`}
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
                className={`sd-side-item${filter === "my-posts" ? " active" : ""}`}
                onClick={() => setFilter("my-posts")}
              >
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
                My scrolls <span className="badge">{myPostCount}</span>
              </button>
            )}
          </>
        )}
      </div>

      <div className={`sd-side-group${trustCollapsed ? " collapsed" : ""}`}>
        {collapseHead("Trust level", trustCollapsed, () => setTrustCollapsed((v) => !v))}
        {!trustCollapsed && (
          <div className="sd-side-pills">
            {TRUST_LEVELS.map((t) => (
              <button key={t.key} type="button" className={`sd-pill ${t.cls}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`sd-side-group${tagsCollapsed ? " collapsed" : ""}`}>
        {collapseHead("Tags", tagsCollapsed, () => setTagsCollapsed((v) => !v))}
        {!tagsCollapsed && (
          <div className="sd-side-pills">
            {TAG_FILTERS.map((t) => (
              <button key={t} type="button" className="sd-pill tag">
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <h1>Scrolls</h1>
        <p>Long-form posts, reactions, and pinned memos from the community</p>
      </header>
      <div className="sd-page-grid with-rail">
        {/* LEFT SIDEBAR (desktop only) */}
        <aside className="sd-side">{feedFilters}</aside>

        {/* MAIN COLUMN */}
        <section>
          <div className="sd-blog-toolbar">
            <div className="sd-seg">
              <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
                All Scrolls
              </button>
              <button className={filter === "members" ? "on" : ""} onClick={() => setFilter("members")}>
                Members
              </button>
              {connected && (
                <button className={filter === "my-posts" ? "on" : ""} onClick={() => setFilter("my-posts")}>
                  My Scrolls
                </button>
              )}
            </div>
            <label className="search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: "var(--ink-mute)" }}>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input ref={searchRef} placeholder="Search scrolls, tags, or addresses…" />
              <span className="k">⌘K</span>
            </label>
            <select
              className="sd-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
            <div className="sd-toolbar-actions">
              <button className="sd-btn sd-btn-secondary" title="RSS feed" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 11a9 9 0 0 1 9 9" />
                  <path d="M4 4a16 16 0 0 1 16 16" />
                  <circle cx="5" cy="19" r="1" fill="currentColor" />
                </svg>
                RSS
              </button>
              {connected && (
                <Link href="/blog/new" className="sd-btn sd-btn-primary">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New Scroll
                </Link>
              )}
            </div>
          </div>

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

          {featured && <FeaturedPost post={featured} />}

          {(loading && posts.length === 0) ? (
            <PostRowSkeleton />
          ) : listPostsData.length === 0 && !featured ? (
            <EmptyState
              connected={connected}
              filter={filter}
              hasAnyPosts={posts.length > 0}
              onShowAll={() => setFilter("all")}
            />
          ) : (
            <>
              <div className="sd-post-list">
                {listPostsData.map((p) => (
                  <PostRow key={p.id} post={p} />
                ))}
              </div>
              <div ref={sentinelRef} style={{ height: 1 }} />
              {loading && posts.length > 0 && <PostRowSkeleton />}
              {!nextKey && posts.length > 0 && (
                <div className="sd-load-more">
                  End of feed · block {posts[posts.length - 1]?.created_at || "—"}
                </div>
              )}
            </>
          )}

          {membersLoading && filter === "members" && posts.length > 0 && (
            <div className="sd-load-more">Loading members…</div>
          )}
        </section>

        {/* RIGHT RAIL */}
        <aside className="sd-rail">
          <div className="sd-rail-filters">{feedFilters}</div>
          <div className="sd-col-actions">
            <button className="sd-btn sd-btn-secondary" title="RSS feed" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" fill="currentColor" />
              </svg>
              RSS
            </button>
            {connected && (
              <Link href="/blog/new" className="sd-btn sd-btn-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Scroll
              </Link>
            )}
          </div>

          <TrendingCard posts={posts.slice(0, 5)} />
          <ActiveVoicesCard posts={posts} />
          <SessionKeyCard
            sessionActive={sessionActive}
            granteeAddr={activeSession?.grantee || null}
          />
        </aside>
      </div>
    </div>
  );
}

function FeaturedPost({ post }: { post: Post }) {
  const { name } = useResolveName(post.creator);
  return (
    <Link href={`/blog/${post.id}`} className="sd-featured">
      <div className="art">
        <div className="glyph">
          <div className="frame">
            <b>◆ Pinned · Council Memo</b>
            <span className="hash">block · {post.created_at}</span>
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
        <div className="foot">
          <div className="who">
            <div className="sd-avatar">{(name || post.creator).charAt(name ? 0 : 8).toUpperCase()}</div>
            <div>
              <div className="name">{name || truncateAddress(post.creator)}</div>
              <div className="addr">{truncateAddress(post.creator)}</div>
            </div>
          </div>
          <div className="stats">
            <span>💬 {post.reply_count} replies</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function TrendingCard({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null;
  return (
    <div className="sd-rail-card">
      <h5>
        Trending on-chain
        <span className="live">
          <span className="d" />
          live
        </span>
      </h5>
      {posts.map((p, i) => (
        <Link
          key={p.id}
          href={`/blog/${p.id}`}
          className="sd-trend-row"
          style={{ textDecoration: "none" }}
        >
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <span className="title">{p.title}</span>
          <span className="c">{p.reply_count}</span>
        </Link>
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

  if (voices.length === 0) return null;
  return (
    <div className="sd-rail-card">
      <h5>Active voices this week</h5>
      {voices.map(([addr, count], i) => (
        <ActiveVoiceRow key={addr} addr={addr} count={count} idx={i} />
      ))}
    </div>
  );
}

function ActiveVoiceRow({ addr, count, idx }: { addr: string; count: number; idx: number }) {
  const { name } = useResolveName(addr);
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
        <span className="addr">{name || truncateAddress(addr)}</span>
        <div className="meta">{count} {count === 1 ? "scroll" : "scrolls"}</div>
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
            <span className="sd-pill trust-core" style={{ fontFamily: "var(--font-geist-mono)" }}>
              {truncateAddress(granteeAddr)}
            </span>{" "}
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
}: {
  connected: boolean;
  filter: FilterOption;
  hasAnyPosts: boolean;
  onShowAll: () => void;
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
          ? "No member scrolls found"
          : filter === "my-posts"
            ? "You haven't written a scroll yet"
            : "No scrolls yet"}
      </p>
      {filter === "members" && hasAnyPosts ? (
        <button
          onClick={onShowAll}
          style={{
            marginTop: 12,
            background: "transparent",
            border: 0,
            color: "var(--violet-hi)",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Show all scrolls
        </button>
      ) : connected ? (
        <Link href="/blog/new" style={{ display: "inline-block", marginTop: 12, color: "var(--violet-hi)", fontSize: 13 }}>
          Create the first scroll
        </Link>
      ) : null}
    </div>
  );
}
