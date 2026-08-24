"use client";

import { useEffect, useState, useCallback } from "react";
import { listCategories } from "@/lib/api";
import type { Category } from "@/types/commons";
import ErrorState from "@/components/ErrorState";
import { isMissingEndpoint } from "@/lib/errors";

interface CategoryListProps {
  onSelectCategory: (category: Category) => void;
}

export default function CategoryList({ onSelectCategory }: CategoryListProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listCategories();
      setCategories(res.category || []);
    } catch (err) {
      if (isMissingEndpoint(err)) {
        setCategories([]);
      } else {
        setError(err);
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
          <div key={i} className="h-20 animate-pulse sd-hull-tile rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState error={error} onRetry={fetchCategories} />
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Categories</h2>
      {categories.length === 0 ? (
        <div className="sd-hull-tile rounded-xl p-12 text-center">
          <p className="text-zinc-400">No categories found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <button
              key={cat.category_id}
              onClick={() => onSelectCategory(cat)}
              className="sd-hull-tile interactive w-full rounded-xl px-4 py-3 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">{cat.title}</span>
                    {cat.members_only_write && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
                        Members only
                      </span>
                    )}
                    {cat.admin_only_write && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                        Admin only
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
