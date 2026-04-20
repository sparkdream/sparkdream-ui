"use client";

import { useEffect, useState, useCallback } from "react";
import { listCategories } from "@/lib/api";
import type { Category } from "@/types/commons";

interface CategoryListProps {
  onSelectCategory: (category: Category) => void;
}

export default function CategoryList({ onSelectCategory }: CategoryListProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listCategories();
      setCategories(res.category || []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load categories";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setCategories([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchCategories} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Categories</h2>
      {categories.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">No categories found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <button
              key={cat.category_id}
              onClick={() => onSelectCategory(cat)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">{cat.title}</span>
                    {cat.members_only_write && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                        Members Only
                      </span>
                    )}
                    {cat.admin_only_write && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                        Admin Only
                      </span>
                    )}
                  </div>
                  {cat.description && (
                    <p className="mt-1 text-sm text-zinc-400">{cat.description}</p>
                  )}
                </div>
                <svg className="h-4 w-4 shrink-0 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
