"use client";

import { useEffect, useState, useCallback } from "react";
import type { Session, SessionParams } from "@/types/session";
import {
  getSessionsByGranter,
  getSessionsByGrantee,
  getAllowedMsgTypes,
  getSessionParams,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { SessionMsgTypeUrls } from "@/lib/tx";
import { truncateAddress, formatTime } from "@/lib/utils";
import CopyableAddress from "@/components/CopyableAddress";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import NumberInput from "@/components/NumberInput";

type Tab = "granted" | "received";

// Parse a google.protobuf.Duration LCD response — usually "604800s",
// occasionally { seconds, nanos } (mirrors ParamChangeForm's helper).
function parseDurationSeconds(raw: unknown): number {
  if (typeof raw === "string") {
    const m = raw.match(/^(\d+(?:\.\d+)?)s$/);
    if (m) return parseFloat(m[1]);
    return parseFloat(raw) || 0;
  }
  if (typeof raw === "object" && raw !== null) {
    return Number((raw as { seconds?: string | number }).seconds || 0);
  }
  return Number(raw) || 0;
}

// Fallbacks if the params query hasn't returned yet — match current
// x/session defaults (7 day max, 100 SPARK max, 10k exec max).
const FALLBACK_MAX_DAYS = 7;
const FALLBACK_MAX_SPEND = 100;
const FALLBACK_MAX_EXEC = 10_000;

export default function SessionsPage() {
  const { signerAddress, connected, ready, signAndBroadcast, activeSession, activateSession, deactivateSession } = useWallet();
  const { config: { denom: DENOM, displayDenom: DISPLAY_DENOM } } = useChainConfig();

  const [tab, setTab] = useState<Tab>("granted");
  const [grantedSessions, setGrantedSessions] = useState<Session[]>([]);
  const [receivedSessions, setReceivedSessions] = useState<Session[]>([]);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [sessionParams, setSessionParams] = useState<SessionParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Create session form state
  const [showCreate, setShowCreate] = useState(false);
  const [grantee, setGrantee] = useState("");
  const [selectedMsgTypes, setSelectedMsgTypes] = useState<string[]>([]);
  const [spendAmount, setSpendAmount] = useState("");
  const [expirationDays, setExpirationDays] = useState("");
  const [maxExecCount, setMaxExecCount] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Derived caps from on-chain params (fallback to current defaults).
  const maxExpirationDays = sessionParams
    ? Math.max(1, Math.floor(parseDurationSeconds(sessionParams.max_expiration) / 86400))
    : FALLBACK_MAX_DAYS;
  const maxSpendDisplay = sessionParams
    ? parseInt(sessionParams.max_spend_limit.amount || "0", 10) / 1_000_000
    : FALLBACK_MAX_SPEND;
  const maxExecCountCap = sessionParams
    ? parseInt(sessionParams.max_exec_count || "0", 10) || FALLBACK_MAX_EXEC
    : FALLBACK_MAX_EXEC;

  const fetchSessions = useCallback(async () => {
    if (!signerAddress) return;
    try {
      setLoading(true);
      const [granted, received, msgTypes, params] = await Promise.all([
        getSessionsByGranter(signerAddress),
        getSessionsByGrantee(signerAddress),
        getAllowedMsgTypes(),
        getSessionParams(),
      ]);
      setGrantedSessions(granted.sessions || []);
      setReceivedSessions(received.sessions || []);
      setAllowedTypes(msgTypes.allowed_msg_types || []);
      setSessionParams(params.params || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [signerAddress]);

  useEffect(() => {
    if (!ready) return;
    if (connected && signerAddress) {
      fetchSessions();
    } else {
      setLoading(false);
    }
  }, [ready, connected, signerAddress, fetchSessions]);

  const handleRevoke = async (session: Session) => {
    if (!confirm(`Revoke session for ${truncateAddress(session.grantee)}?`)) return;
    const key = `${session.granter}-${session.grantee}`;
    setActionLoading(key);
    try {
      await signAndBroadcast([
        {
          typeUrl: SessionMsgTypeUrls.RevokeSession,
          value: {
            granter: signerAddress,
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

    // The chain rejects a non-positive SpendLimit (ErrSpendLimitRequired) —
    // catch it here rather than in the broadcast error.
    const spendNum = parseFloat(spendAmount);
    if (!spendAmount || !isFinite(spendNum) || spendNum <= 0) {
      setCreateError(`Spend limit must be greater than 0 ${DISPLAY_DENOM}`);
      return;
    }

    // Same for max_exec_count — chain now rejects 0 (ErrMaxExecCountRequired).
    const execNum = parseInt(maxExecCount, 10);
    if (!maxExecCount || !Number.isFinite(execNum) || execNum <= 0) {
      setCreateError("Max executions must be greater than 0");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const expiration = new Date();
      expiration.setDate(expiration.getDate() + parseInt(expirationDays));

      await signAndBroadcast([
        {
          typeUrl: SessionMsgTypeUrls.CreateSession,
          value: {
            granter: signerAddress,
            grantee: grantee.trim(),
            allowedMsgTypes: selectedMsgTypes,
            spendLimit: {
              denom: DENOM,
              amount: Math.round(spendNum * 1_000_000).toString(),
            },
            expiration,
            maxExecCount: BigInt(execNum),
          },
        },
      ]);

      // Reset form and refresh
      setGrantee("");
      setSelectedMsgTypes([]);
      setSpendAmount(String(maxSpendDisplay));
      setExpirationDays(String(maxExpirationDays));
      setMaxExecCount(String(maxExecCountCap));
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

  const selectAllTypes = () => {
    setSelectedMsgTypes(
      selectedMsgTypes.length === allowedTypes.length ? [] : [...allowedTypes]
    );
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

  if (!ready) {
    return (
      <div className="sd-page">
        <div className="mb-8">
          <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-zinc-800/60" />
        </div>
        <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-3 w-16 rounded bg-zinc-800" />
              <div className="h-3 w-28 rounded bg-zinc-800" />
            </div>
            <div className="h-5 w-14 rounded bg-zinc-800" />
          </div>
          <div className="mb-3 flex gap-1.5">
            <div className="h-5 w-24 rounded bg-zinc-800" />
            <div className="h-5 w-20 rounded bg-zinc-800" />
            <div className="h-5 w-28 rounded bg-zinc-800" />
          </div>
          <div className="flex gap-4">
            <div className="h-3 w-20 rounded bg-zinc-800" />
            <div className="h-3 w-24 rounded bg-zinc-800" />
          </div>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="sd-page">
        <header className="sd-page-header">
          <span className="crumb">System</span>
          <h1>Session Keys</h1>
          <p>Delegate message signing to another address</p>
        </header>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">Connect your wallet to manage session keys</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <span className="crumb">System</span>
        <h1>Session Keys</h1>
        <p>Delegate message signing to another address</p>
        {!showCreate && (
          <button
            type="button"
            onClick={() => {
              // Pre-fill defaults from the live x/session params so the user
              // sees the maximum allowed values up front.
              setExpirationDays(String(maxExpirationDays));
              setSpendAmount(String(maxSpendDisplay));
              setMaxExecCount(String(maxExecCountCap));
              setShowCreate(true);
            }}
            className="sd-btn sd-btn-primary w-fit"
            style={{ marginLeft: "auto" }}
          >
            New Session
          </button>
        )}
      </header>

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
                onClick={selectAllTypes}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                {selectedMsgTypes.length === allowedTypes.length ? "Deselect all" : "Select all"}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="spendAmount" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Spend Limit ({DISPLAY_DENOM})
              </label>
              <NumberInput
                id="spendAmount"
                min="1"
                max={String(maxSpendDisplay)}
                value={spendAmount}
                onChange={(e) => setSpendAmount(e.target.value)}
                placeholder={`Max ${maxSpendDisplay} ${DISPLAY_DENOM}`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
              <p className="mt-1 text-xs text-zinc-600">
                Max {maxSpendDisplay} {DISPLAY_DENOM} per session
              </p>
            </div>
            <div>
              <label htmlFor="expirationDays" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Expires in (days)
              </label>
              <NumberInput
                id="expirationDays"
                min="1"
                max={String(maxExpirationDays)}
                value={expirationDays}
                onChange={(e) => setExpirationDays(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
              <p className="mt-1 text-xs text-zinc-600">
                Max {maxExpirationDays} day{maxExpirationDays === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              <label htmlFor="maxExecCount" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Max Executions
              </label>
              <NumberInput
                id="maxExecCount"
                min="1"
                max={String(maxExecCountCap)}
                value={maxExecCount}
                onChange={(e) => setMaxExecCount(e.target.value)}
                placeholder={`Max ${maxExecCountCap.toLocaleString()}`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              />
              <p className="mt-1 text-xs text-zinc-600">
                Max {maxExecCountCap.toLocaleString()} per session
              </p>
            </div>
          </div>

          {createError && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
              {createError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={creating || !grantee.trim() || selectedMsgTypes.length === 0}
              className="sd-btn sd-btn-primary"
            >
              {creating ? "Creating..." : "Create Session"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="sd-btn sd-btn-secondary"
            >
              Cancel
            </button>
          </div>
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
        <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-3 w-16 rounded bg-zinc-800" />
              <div className="h-3 w-28 rounded bg-zinc-800" />
            </div>
            <div className="h-5 w-14 rounded bg-zinc-800" />
          </div>
          <div className="mb-3 flex gap-1.5">
            <div className="h-5 w-24 rounded bg-zinc-800" />
            <div className="h-5 w-20 rounded bg-zinc-800" />
            <div className="h-5 w-28 rounded bg-zinc-800" />
          </div>
          <div className="flex gap-4">
            <div className="h-3 w-20 rounded bg-zinc-800" />
            <div className="h-3 w-24 rounded bg-zinc-800" />
          </div>
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
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-500">
                      {isGranter ? "Grantee:" : "Granter:"}
                    </span>
                    <CopyableAddress className="font-mono text-zinc-300" address={isGranter ? session.grantee : session.granter} />
                    {expired && (
                      <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-red-400">
                        Expired
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isGranter && !expired && (
                      <button
                        onClick={() => {
                          if (activeSession?.granter === session.granter) {
                            deactivateSession();
                          } else {
                            activateSession(session);
                          }
                        }}
                        className={`rounded px-3 py-1 text-xs transition-colors ${
                          activeSession?.granter === session.granter
                            ? "text-amber-400 hover:bg-amber-900/20"
                            : "text-indigo-400 hover:bg-indigo-900/20"
                        }`}
                      >
                        {activeSession?.granter === session.granter ? "Deactivate" : "Activate"}
                      </button>
                    )}
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
                  <span className="flex items-center gap-4 whitespace-nowrap">
                    <span>Created {formatTime(session.created_at)}</span>
                    {session.last_used_at && session.last_used_at !== "0001-01-01T00:00:00Z" && (
                      <span>Last used {formatTime(session.last_used_at)}</span>
                    )}
                    {session.expiration && (
                      <span>{expired ? "Expired" : "Expires"} {formatTime(session.expiration)}</span>
                    )}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
