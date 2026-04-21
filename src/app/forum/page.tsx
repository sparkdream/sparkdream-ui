"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { listCategories as fetchForumCategories } from "@/lib/api";
import CategoryList from "@/components/forum/CategoryList";
import ThreadList from "@/components/forum/ThreadList";
import ThreadDetail from "@/components/forum/ThreadDetail";
import CreatePostForm from "@/components/forum/CreatePostForm";
import BountyList from "@/components/forum/BountyList";
import SentinelPanel from "@/components/forum/SentinelPanel";
import type { ForumPost } from "@/types/forum";
import type { Category } from "@/types/commons";

type View =
  | "all-threads"
  | "categories"
  | "category-threads"
  | "top-posts"
  | "create"
  | "my-posts"
  | "followed"
  | "active-bounties"
  | "my-bounties"
  | "sentinel"
  | "thread-detail";

export default function ForumPage() {
  const { connected, ready } = useWallet();

  const [view, setView] = useState<View>("all-threads");
  const [discussionsOpen, setDiscussionsOpen] = useState(true);
  const [myOpen, setMyOpen] = useState(true);
  const [bountiesOpen, setBountiesOpen] = useState(true);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const switchView = (v: View) => {
    setView(v);
    if (v !== "category-threads") setSelectedCategory(null);
    if (v !== "thread-detail") setSelectedThreadId(null);
    setMobileSidebarOpen(false);
  };

  const handleSelectCategory = (cat: Category) => {
    setSelectedCategory(cat);
    setView("category-threads");
    setMobileSidebarOpen(false);
  };

  const handleSelectThread = (post: ForumPost) => {
    // A thread's root is either its own post_id (if root_id is "0" or same) or root_id
    const rootId = !post.root_id || post.root_id === "0" ? post.post_id : post.root_id;
    setSelectedThreadId(rootId);
    setView("thread-detail");
    setMobileSidebarOpen(false);
  };

  const handleSelectThreadById = (threadId: string) => {
    setSelectedThreadId(threadId);
    setView("thread-detail");
    setMobileSidebarOpen(false);
  };

  const handleBackFromThread = () => {
    setSelectedThreadId(null);
    if (selectedCategory) {
      setView("category-threads");
    } else {
      setView("all-threads");
    }
  };

  const handleCreated = () => {
    setListKey((k) => k + 1);
    switchView("all-threads");
  };

  if (!ready) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
        <div className="flex gap-6">
          <div className="hidden w-56 shrink-0 md:block">
            <div className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
          </div>
          <div className="flex-1">
            <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
          </div>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="sd-page">
        <header className="sd-page-header">
          <h1>Forum</h1>
          <p>Community discussions, bounties, and moderation</p>
        </header>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            Connect your wallet to participate in the forum
          </p>
        </div>
      </div>
    );
  }

  const viewLabels: Record<View, string> = {
    "all-threads": "Discussions / All Posts",
    categories: "Discussions / Categories",
    "category-threads": `Discussions / ${selectedCategory?.title || "Category"}`,
    "top-posts": "Discussions / Top Posts",
    create: "Discussions / New Post",
    "my-posts": "My Activity / My Posts",
    followed: "My Activity / Followed",
    "active-bounties": "Bounties / Active",
    "my-bounties": "Bounties / My Bounties",
    sentinel: "Moderation / Sentinel",
    "thread-detail": "Post",
  };

  const sidebarContent = (
    <nav className="space-y-1">
      {/* Discussions section */}
      <div>
        <button
          onClick={() => setDiscussionsOpen(!discussionsOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Discussions</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${discussionsOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {discussionsOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("all-threads")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "all-threads" || view === "thread-detail"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              All Posts
            </button>

            <button
              onClick={() => switchView("categories")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "categories" || view === "category-threads"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Categories
            </button>

            <button
              onClick={() => switchView("top-posts")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "top-posts"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              Top Posts
            </button>

            <button
              onClick={() => switchView("create")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "create"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Post
            </button>
          </div>
        )}
      </div>

      {/* My Activity section */}
      <div className="pt-2">
        <button
          onClick={() => setMyOpen(!myOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>My Activity</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${myOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {myOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("my-posts")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "my-posts"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              My Posts
            </button>
          </div>
        )}
      </div>

      {/* Bounties section */}
      <div className="pt-2">
        <button
          onClick={() => setBountiesOpen(!bountiesOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Bounties</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${bountiesOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {bountiesOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("active-bounties")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "active-bounties"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Active
            </button>

            <button
              onClick={() => switchView("my-bounties")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "my-bounties"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              My Bounties
            </button>
          </div>
        )}
      </div>

      {/* Moderation section */}
      <div className="pt-2">
        <button
          onClick={() => setModerationOpen(!moderationOpen)}
          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800/50"
        >
          <span>Moderation</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${moderationOpen ? "rotate-0" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {moderationOpen && (
          <div className="mt-1 space-y-0.5 pl-1">
            <button
              onClick={() => switchView("sentinel")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                view === "sentinel"
                  ? "bg-indigo-600/15 text-indigo-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              Sentinel
            </button>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <h1>Forum</h1>
        <p>Community discussions, bounties, and moderation</p>
      </header>

      {/* Mobile sidebar toggle */}
      <div className="mb-4 md:hidden">
        <button
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-sm text-zinc-300"
        >
          <span>{viewLabels[view]}</span>
          <svg
            className={`h-4 w-4 text-zinc-500 transition-transform ${mobileSidebarOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {mobileSidebarOpen && (
          <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
            {sidebarContent}
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <div className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-24 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            {sidebarContent}
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {view === "all-threads" && (
            <ThreadList
              key={`all-${listKey}`}
              mode="all"
              onSelectThread={handleSelectThread}
            />
          )}
          {view === "categories" && (
            <CategoryList onSelectCategory={handleSelectCategory} />
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
              />
            </div>
          )}
          {view === "top-posts" && (
            <ThreadList
              key={`top-${listKey}`}
              mode="top"
              onSelectThread={handleSelectThread}
            />
          )}
          {view === "create" && (
            <CreateThreadView onCreated={handleCreated} />
          )}
          {view === "my-posts" && (
            <ThreadList
              key={`my-${listKey}`}
              mode="my-posts"
              onSelectThread={handleSelectThread}
            />
          )}
          {view === "active-bounties" && (
            <BountyList mode="active" onSelectThread={handleSelectThreadById} />
          )}
          {view === "my-bounties" && (
            <BountyList mode="my" onSelectThread={handleSelectThreadById} />
          )}
          {view === "sentinel" && <SentinelPanel />}
          {view === "thread-detail" && selectedThreadId && (
            <ThreadDetail
              threadId={selectedThreadId}
              onBack={handleBackFromThread}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Wrapper that fetches categories for the "New Thread" form. */
function CreateThreadView({ onCreated }: { onCreated: () => void }) {
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
    return <div className="h-48 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />;
  }

  return (
    <div>
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Category</label>
        <select
          value={catId}
          onChange={(e) => setCatId(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:outline-none"
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
          onCancel={() => {}}
        />
      )}
    </div>
  );
}
