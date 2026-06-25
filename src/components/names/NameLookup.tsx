"use client";

import { useState } from "react";
import { resolveName, reverseResolveName } from "@/lib/api";
import type { NameRecord } from "@/types/name";

type Mode = "forward" | "reverse";

export default function NameLookup() {
  const [mode, setMode] = useState<Mode>("forward");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<NameRecord | null>(null);
  const [reverseName, setReverseName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setReverseName(null);

    try {
      if (mode === "forward") {
        const res = await resolveName(trimmed);
        setResult(res.name_record);
      } else {
        const res = await reverseResolveName(trimmed);
        if (res.name) {
          setReverseName(res.name);
        } else {
          setError("No primary name found for this address");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lookup failed";
      if (msg.includes("404") || msg.includes("not found")) {
        setError(mode === "forward" ? "Name not found" : "No primary name found for this address");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setQuery("");
    setResult(null);
    setReverseName(null);
    setError(null);
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">Name lookup</h2>

      {/* Mode toggle */}
      <div className="mb-4 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
        <button
          onClick={() => switchMode("forward")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "forward"
              ? "bg-indigo-600/20 text-indigo-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Name &rarr; Address
        </button>
        <button
          onClick={() => switchMode("reverse")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
            mode === "reverse"
              ? "bg-indigo-600/20 text-indigo-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Address &rarr; Name
        </button>
      </div>

      <form onSubmit={handleLookup} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "forward" ? "Enter a name..." : "Enter an address..."}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="sd-btn sd-btn-primary"
          >
            {loading ? "..." : "Resolve"}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium uppercase text-zinc-500">Name</span>
              <p className="mt-0.5 text-sm font-medium text-white">{result.name}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase text-zinc-500">Owner</span>
              <p className="mt-0.5 font-mono text-sm text-zinc-300">{result.owner}</p>
            </div>
            {result.data && (
              <div>
                <span className="text-xs font-medium uppercase text-zinc-500">Data</span>
                <p className="mt-0.5 break-all text-sm text-zinc-300">{result.data}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {reverseName && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="space-y-3">
            <div>
              <span className="text-xs font-medium uppercase text-zinc-500">Address</span>
              <p className="mt-0.5 font-mono text-sm text-zinc-300">{query.trim()}</p>
            </div>
            <div>
              <span className="text-xs font-medium uppercase text-zinc-500">Primary name</span>
              <p className="mt-0.5 text-sm font-medium text-white">{reverseName}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
