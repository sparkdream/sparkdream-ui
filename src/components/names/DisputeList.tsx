"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { listDisputes, getNameParams } from "@/lib/api";
import { NameMsgTypeUrls } from "@/lib/tx";
import { truncateAddress } from "@/lib/utils";
import type { Dispute, NameParams } from "@/types/name";

export default function DisputeList() {
  const { address, signAndBroadcast } = useWallet();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [params, setParams] = useState<NameParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File dispute form
  const [showFile, setShowFile] = useState(false);
  const [disputeName, setDisputeName] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Contest form
  const [contestingName, setContestingName] = useState<string | null>(null);
  const [contestReason, setContestReason] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [disputeRes, paramsRes] = await Promise.all([
        listDisputes(),
        getNameParams(),
      ]);
      setDisputes(disputeRes.dispute || []);
      setParams(paramsRes.params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load disputes";
      if (msg.includes("404") || msg.includes("not found")) {
        setDisputes([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleFileDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !disputeName.trim()) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.FileDispute,
          value: {
            authority: address,
            name: disputeName.trim(),
            reason: disputeReason.trim(),
          },
        },
      ]);
      setDisputeName("");
      setDisputeReason("");
      setShowFile(false);
      fetchData();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to file dispute");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContest(name: string) {
    if (!address) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.ContestDispute,
          value: {
            authority: address,
            name,
            reason: contestReason.trim(),
          },
        },
      ]);
      setContestingName(null);
      setContestReason("");
      fetchData();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to contest dispute");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  const disputeStake = params?.dispute_stake_dream || "50";
  const contestStake = params?.contest_stake_dream || "100";
  const timeoutBlocks = params?.dispute_timeout_blocks || "100800";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Disputes</h2>
        <button
          onClick={() => setShowFile(!showFile)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          {showFile ? "Cancel" : "File Dispute"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={fetchData} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {submitError}
        </div>
      )}

      {/* File dispute form */}
      {showFile && (
        <form onSubmit={handleFileDispute} className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">File a name dispute</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Name to dispute</label>
              <input
                type="text"
                value={disputeName}
                onChange={(e) => setDisputeName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="name-to-claim"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Reason</label>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Why should you own this name?"
                rows={3}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                Requires {disputeStake} DREAM stake
              </span>
              <button
                type="submit"
                disabled={submitting || !disputeName.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {submitting ? "Filing..." : "File Dispute"}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Disputes list */}
      {disputes.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <p className="text-sm text-zinc-500">No active disputes</p>
        </div>
      ) : (
        <div className="space-y-2">
          {disputes.map((d) => {
            const isContested = !!d.contest_challenge_id;
            const isActive = d.active;

            return (
              <div
                key={d.name}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{d.name}</span>
                      {isActive ? (
                        isContested ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400 border border-amber-500/30">
                            Contested
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400 border border-red-500/30">
                            Disputed
                          </span>
                        )
                      ) : (
                        <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs text-zinc-400 border border-zinc-500/30">
                          Resolved
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-zinc-400">
                      <p>Claimant: {truncateAddress(d.claimant)}</p>
                      <p>Stake: {d.stake_amount} DREAM</p>
                      <p>Filed at block: {d.filed_at}</p>
                      {isContested && d.contested_at !== "0" && (
                        <p>Contested at block: {d.contested_at}</p>
                      )}
                      {!isActive && (
                        <p>Verdict: {d.contest_succeeded ? "Owner retained name" : "Name transferred to claimant"}</p>
                      )}
                    </div>
                  </div>

                  {/* Contest button - only for name owner if not yet contested */}
                  {isActive && !isContested && address && (
                    <button
                      onClick={() => {
                        if (contestingName === d.name) {
                          setContestingName(null);
                        } else {
                          setContestingName(d.name);
                          setContestReason("");
                        }
                      }}
                      className="shrink-0 rounded-lg border border-amber-500/30 px-2.5 py-1 text-xs text-amber-400 transition-colors hover:bg-amber-500/10"
                    >
                      {contestingName === d.name ? "Cancel" : "Contest"}
                    </button>
                  )}
                </div>

                {/* Contest form */}
                {contestingName === d.name && (
                  <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                    <textarea
                      value={contestReason}
                      onChange={(e) => setContestReason(e.target.value)}
                      placeholder="Why is this dispute invalid?"
                      rows={2}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">
                        Requires {contestStake} DREAM stake &middot; triggers jury review
                      </span>
                      <button
                        onClick={() => handleContest(d.name)}
                        disabled={submitting}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
                      >
                        {submitting ? "Contesting..." : "Contest Dispute"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <p className="mt-2 text-xs text-zinc-600">
            Uncontested disputes auto-resolve after ~{Math.round(parseInt(timeoutBlocks, 10) / 14400)} days ({timeoutBlocks} blocks)
          </p>
        </div>
      )}
    </div>
  );
}
