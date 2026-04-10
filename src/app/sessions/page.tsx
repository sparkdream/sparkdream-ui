"use client";

import { useEffect, useState, useCallback } from "react";
import type { Session } from "@/types/session";
import { getSessionsByGranter, getSessionsByGrantee, getAllowedMsgTypes } from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { truncateAddress, formatTime } from "@/lib/utils";
import { DENOM, DISPLAY_DENOM } from "@/lib/chain";

type Tab = "granted" | "received";

export default function SessionsPage() {
  const { address, connected, signAndBroadcast } = useWallet();

  const [tab, setTab] = useState<Tab>("granted");
  const [grantedSessions, setGrantedSessions] = useState<Session[]>([]);
  const [receivedSessions, setReceivedSessions] = useState<Session[]>([]);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create session form state
  const [showCreate, setShowCreate] = useState(false);
  const [grantee, setGrantee] = useState("");
  const [selectedMsgTypes, setSelectedMsgTypes] = useState<string[]>([]);
  const [spendAmount, setSpendAmount] = useState("");
  const [expirationDays, setExpirationDays] = useState("30");
  const [maxExecCount, setMaxExecCount] = useState("0");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      const [granted, received, msgTypes] = await Promise.all([
        getSessionsByGranter(address),
        getSessionsByGrantee(address),
        getAllowedMsgTypes(),
      ]);
      setGrantedSessions(granted.sessions || []);
      setReceivedSessions(received.sessions || []);
      setAllowedTypes(msgTypes.allowed_msg_types || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (connected && address) {
      fetchSessions();
    } else {
      setLoading(false);
    }
  }, [connected, address, fetchSessions]);

  const handleRevoke = async (session: Session) => {
    if (!confirm(`Revoke session for ${truncateAddress(session.grantee)}?`)) return;
    const key = `${session.granter}-${session.grantee}`;
    setActionLoading(key);
    try {
      await signAndBroadcast([
        {
          typeUrl: SessionMsgTypeUrls.RevokeSession,
          value: {
            granter: address,
            grantee: session.grantee,
          },
        },
      ]);
      await fetchSessions();
    } catch (err) {
      console.error("Revoke failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !grantee.trim() || selectedMsgTypes.length === 0) return;

    setCreating(true);
    setCreateError(null);

    try {
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + parseInt(expirationDays));

      await signAndBroadcast([
        {
          typeUrl: SessionMsgTypeUrls.CreateSession,
          value: {
            granter: address,
            grantee: grantee.trim(),
            allowedMsgTypes: selectedMsgTypes,
            spendLimit: {
              denom: DENOM,
              amount: spendAmount ? (parseInt(spendAmount) * 1_000_000).toString() : "0",
            },
            expiration,
            maxExecCount: BigInt(maxExecCount || "0"),
          },
        },
      ]);

      // Reset form and refresh
      setGrantee("");
      setSelectedMsgTypes([]);
      setSpendAmount("");
      setExpirationDays("30");
      setMaxExecCount("0");
      setShowCreate(false);
      await fetchSessions();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  const toggleMsgType = (t: string) => {
    setSelectedMsgTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const selectAllBlogTypes = () => {
    const blogTypes = allowedTypes.filter((t) => t.includes(".blog."));
    setSelectedMsgTypes(blogTypes);
  };

  function msgTypeLabel(typeUrl: string): string {
    // "/sparkdream.blog.v1.MsgCreatePost" → "CreatePost (blog)"
    const parts = typeUrl.split(".");
    const msg = parts[parts.length - 1].replace("Msg", "");
    const mod = parts[1] || "";
    return `${msg} (${mod})`;
  }

  function isExpired(session: Session): boolean {
    if (!session.expiration) return false;
    return new Date(session.expiration) < new Date();
  }

  const sessions = tab === "granted" ? grantedSessions : receivedSessions;

  if (!connected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-white">Session Keys</h1>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to manage session keys</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Session Keys</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Delegate message signing to another address
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {showCreate ? "Cancel" : "New Session"}
        </button>
      </div>

      {/* Create session form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-8 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
        >
          <h2 className="text-lg font-semibold text-white">Create Session Key</h2>

          <div>
            <label htmlFor="grantee" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Grantee Address
            </label>
            <input
              id="grantee"
              type="text"
              value={grantee}
              onChange={(e) => setGrantee(e.target.value)}
              placeholder="sprkdrm1..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-zinc-600">
              The hot wallet address that will be able to sign on your behalf
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-300">
                Allowed Message Types
              </label>
              <button
                type="button"
                onClick={selectAllBlogTypes}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                Select all blog
              </button>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              {allowedTypes.length === 0 ? (
                <p className="text-xs text-zinc-500">Loading allowed types...</p>
              ) : (
                allowedTypes.map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMsgTypes.includes(t)}
                      onChange={() => toggleMsgType(t)}
                      className="rounded border-zinc-600 bg-zinc-800 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-zinc-300">{msgTypeLabel(t)}</span>
                  </label>
                ))
              )}
            </div>
            {selectedMsgTypes.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500">
                {selectedMsgTypes.length} type{selectedMsgTypes.length !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="spendAmount" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Spend Limit ({DISPLAY_DENOM})
              </label>
              <input
                id="spendAmount"
                type="number"
                min="0"
                value={spendAmount}
                onChange={(e) => setSpendAmount(e.target.value)}
                placeholder="0 (no limit)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
            </div>
            <div>
              <label htmlFor="expirationDays" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Expires in (days)
              </label>
              <input
                id="expirationDays"
                type="number"
                min="1"
                max="365"
                value={expirationDays}
                onChange={(e) => setExpirationDays(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
            </div>
            <div>
              <label htmlFor="maxExecCount" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Max Executions
              </label>
              <input
                id="maxExecCount"
                type="number"
                min="0"
                value={maxExecCount}
                onChange={(e) => setMaxExecCount(e.target.value)}
                placeholder="0 (unlimited)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
            </div>
          </div>

          {createError && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {createError}
            </div>
          )}

          <button
            type="submit"
            disabled={creating || !grantee.trim() || selectedMsgTypes.length === 0}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create Session"}
          </button>
        </form>
      )}

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
          <button
            onClick={() => setTab("granted")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "granted"
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            Granted ({grantedSessions.length})
          </button>
          <button
            onClick={() => setTab("received")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "received"
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:text-zinc-300"
            }`}
          >
            Received ({receivedSessions.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={fetchSessions} className="ml-2 underline hover:text-red-300">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50"
            />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">
            {tab === "granted"
              ? "You haven't granted any session keys"
              : "No session keys have been granted to you"}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => {
            const expired = isExpired(session);
            const key = `${session.granter}-${session.grantee}`;
            const isGranter = tab === "granted";

            return (
              <article
                key={key}
                className={`rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 ${
                  expired ? "opacity-50" : ""
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500">
                      {isGranter ? "Grantee:" : "Granter:"}
                    </span>
                    <span className="font-mono text-zinc-300">
                      {truncateAddress(isGranter ? session.grantee : session.granter)}
                    </span>
                    {expired && (
                      <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-red-400">
                        Expired
                      </span>
                    )}
                  </div>
                  {isGranter && !expired && (
                    <button
                      onClick={() => handleRevoke(session)}
                      disabled={actionLoading === key}
                      className="rounded px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-900/20 hover:text-red-400 disabled:opacity-50"
                    >
                      {actionLoading === key ? "Revoking..." : "Revoke"}
                    </button>
                  )}
                </div>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {session.allowed_msg_types.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                    >
                      {msgTypeLabel(t)}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                  {session.spend_limit && session.spend_limit.amount !== "0" && (
                    <span>
                      Spend: {parseInt(session.spent?.amount || "0") / 1_000_000}/
                      {parseInt(session.spend_limit.amount) / 1_000_000} {DISPLAY_DENOM}
                    </span>
                  )}
                  {session.max_exec_count && session.max_exec_count !== "0" && (
                    <span>
                      Execs: {session.exec_count || "0"}/{session.max_exec_count}
                    </span>
                  )}
                  <span>Created {formatTime(session.created_at)}</span>
                  {session.expiration && (
                    <span>
                      {expired ? "Expired" : "Expires"} {new Date(session.expiration).toLocaleDateString()}
                    </span>
                  )}
                  {session.last_used_at && session.last_used_at !== "0001-01-01T00:00:00Z" && (
                    <span>Last used {formatTime(session.last_used_at)}</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
