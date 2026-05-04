"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import {
  stakesByStaker,
  listRepInitiatives,
  listRepProjects,
  listRepMembers,
  listPosts,
  collectTags,
} from "@/lib/api";
import { RepMsgTypeUrls } from "@/lib/tx";
import { truncateAddress } from "@/lib/utils";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import type { RepStake } from "@/types/rep";
import { STAKE_TARGET_LABELS, StakeTargetType } from "@/types/rep";
import SearchableSelect from "@/components/contribute/SearchableSelect";

interface TargetOption {
  value: string;
  label: string;
}

function formatDream(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  const divisor = BigInt(1000000);
  const whole = n / divisor;
  const frac = n % divisor;
  if (frac === BigInt(0)) return whole.toLocaleString();
  return `${whole.toLocaleString()}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

// Target types that populate target_id (numeric) via dropdown
const ID_DROPDOWN_TYPES = new Set<string>([
  StakeTargetType.INITIATIVE,
  StakeTargetType.PROJECT,
  StakeTargetType.BLOG_CONTENT,
  StakeTargetType.BLOG_AUTHOR_BOND,
]);

// Target types that populate target_identifier (string) via dropdown
const IDENTIFIER_DROPDOWN_TYPES = new Set<string>([
  StakeTargetType.MEMBER,
  StakeTargetType.TAG,
]);

// Target types that need freeform text for ID (no API available)
const ID_FREEFORM_TYPES = new Set<string>([
  StakeTargetType.FORUM_CONTENT,
  StakeTargetType.COLLECTION_CONTENT,
  StakeTargetType.FORUM_AUTHOR_BOND,
  StakeTargetType.COLLECTION_AUTHOR_BOND,
]);

export default function StakingPanel() {
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const canStake = isMember === true;
  const [stakes, setStakes] = useState<RepStake[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New stake form
  const [formTargetType, setFormTargetType] = useState<string>(StakeTargetType.INITIATIVE);
  const [formTargetId, setFormTargetId] = useState("");
  const [formTargetIdentifier, setFormTargetIdentifier] = useState("");
  const [formAmount, setFormAmount] = useState("");

  // Target options for dropdown
  const [targetOptions, setTargetOptions] = useState<TargetOption[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);

  const fetchStakes = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);
      const res = await stakesByStaker(address, { limit: "50" });
      setStakes(res.stakes || []);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load stakes";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setStakes([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  const loadMoreStakes = useCallback(async () => {
    if (!address || !nextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await stakesByStaker(address, { limit: "50", key: nextKey });
      setStakes((prev) => [...prev, ...(res.stakes || [])]);
      setNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [address, nextKey, loadingMore]);

  useEffect(() => {
    fetchStakes();
  }, [fetchStakes]);

  // Auto-close the form once we learn the user isn't a member.
  useEffect(() => {
    if (isMember === false) setShowForm(false);
  }, [isMember]);

  // Fetch valid target options when target type changes or form opens
  useEffect(() => {
    if (!showForm) return;

    const targetType = formTargetType;
    let cancelled = false;

    async function loadOptions() {
      setLoadingTargets(true);
      setTargetOptions([]);
      setFormTargetId("");
      setFormTargetIdentifier("");

      try {
        let options: TargetOption[] = [];

        if (targetType === StakeTargetType.INITIATIVE) {
          const res = await listRepInitiatives({ limit: "100" });
          options = (res.initiative || []).map((i) => ({
            value: i.id,
            label: `#${i.id} — ${i.title}`,
          }));
        } else if (targetType === StakeTargetType.PROJECT) {
          const res = await listRepProjects({ limit: "100" });
          options = (res.project || []).map((p) => ({
            value: p.id,
            label: `#${p.id} — ${p.name}`,
          }));
        } else if (
          targetType === StakeTargetType.BLOG_CONTENT ||
          targetType === StakeTargetType.BLOG_AUTHOR_BOND
        ) {
          const res = await listPosts({ limit: "100" });
          options = (res.post || []).map((p) => ({
            value: p.id,
            label: `#${p.id} — ${p.title}`,
          }));
        } else if (targetType === StakeTargetType.MEMBER) {
          const res = await listRepMembers({ limit: "100" });
          options = (res.member || []).map((m) => ({
            value: m.address,
            label: truncateAddress(m.address, 14, 6),
          }));
        } else if (targetType === StakeTargetType.TAG) {
          const tags = await collectTags();
          options = tags.map((t) => ({ value: t, label: t }));
        }

        if (!cancelled) {
          setTargetOptions(options);
          if (options.length > 0) {
            if (ID_DROPDOWN_TYPES.has(targetType)) {
              setFormTargetId(options[0].value);
            } else if (IDENTIFIER_DROPDOWN_TYPES.has(targetType)) {
              setFormTargetIdentifier(options[0].value);
            }
          }
        }
      } catch {
        if (!cancelled) setTargetOptions([]);
      } finally {
        if (!cancelled) setLoadingTargets(false);
      }
    }

    if (ID_DROPDOWN_TYPES.has(targetType) || IDENTIFIER_DROPDOWN_TYPES.has(targetType)) {
      loadOptions();
    } else {
      setTargetOptions([]);
      setLoadingTargets(false);
    }

    return () => { cancelled = true; };
  }, [formTargetType, showForm]);

  const handleStake = async () => {
    if (!address || !formAmount) return;
    try {
      setSubmitting(true);
      const amount = (BigInt(Math.floor(parseFloat(formAmount) * 1e6))).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.Stake,
        value: {
          staker: address,
          targetType: formTargetType,
          targetId: formTargetId ? parseInt(formTargetId) : 0,
          targetIdentifier: formTargetIdentifier,
          amount,
        },
      }]);
      setShowForm(false);
      setFormTargetId("");
      setFormTargetIdentifier("");
      setFormAmount("");
      await fetchStakes();
    } catch (err) {
      console.error("Stake failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaim = async (stakeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`claim-${stakeId}`);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.ClaimStakingRewards,
        value: { staker: address, stakeId: parseInt(stakeId) },
      }]);
      await fetchStakes();
    } catch (err) {
      console.error("Claim failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompound = async (stakeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`compound-${stakeId}`);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.CompoundStakingRewards,
        value: { staker: address, stakeId: parseInt(stakeId) },
      }]);
      await fetchStakes();
    } catch (err) {
      console.error("Compound failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnstake = async (stakeId: string, amount: string) => {
    if (!address) return;
    try {
      setActionLoading(`unstake-${stakeId}`);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.Unstake,
        value: { staker: address, stakeId: parseInt(stakeId), amount },
      }]);
      await fetchStakes();
    } catch (err) {
      console.error("Unstake failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const showIdDropdown = ID_DROPDOWN_TYPES.has(formTargetType);
  const showIdentifierDropdown = IDENTIFIER_DROPDOWN_TYPES.has(formTargetType);
  const showIdFreeform = ID_FREEFORM_TYPES.has(formTargetType);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-xl sd-hull-tile" />
        <div className="h-20 animate-pulse rounded-xl sd-hull-tile" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchStakes} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Staking</h2>
        {canStake && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="sd-btn sd-btn-primary"
          >
            New Stake
          </button>
        )}
      </div>

      {isMember === false && (
        <p className="mb-3 text-xs text-zinc-500">
          Only existing members can stake. Accept an invitation to join the system first.
        </p>
      )}

      {showForm && canStake && (
        <div className="mb-4 rounded-xl sd-hull-tile p-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Stake DREAM</h3>
          <div className="space-y-3">
            <select
              value={formTargetType}
              onChange={(e) => setFormTargetType(e.target.value)}
              className="sd-select w-full"
            >
              {Object.entries(STAKE_TARGET_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>

            {/* Searchable dropdown for ID-based targets */}
            {showIdDropdown && (
              loadingTargets ? (
                <div className="flex items-center gap-2 px-1 py-2 text-xs text-zinc-500">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
                  Loading {STAKE_TARGET_LABELS[formTargetType]?.toLowerCase()}s...
                </div>
              ) : targetOptions.length === 0 ? (
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-2 text-sm text-zinc-500">
                  No {STAKE_TARGET_LABELS[formTargetType]?.toLowerCase()}s available
                </div>
              ) : (
                <SearchableSelect
                  options={targetOptions}
                  value={formTargetId}
                  onChange={setFormTargetId}
                  placeholder={`Search ${STAKE_TARGET_LABELS[formTargetType]?.toLowerCase()}s...`}
                  emptyMessage="No matches"
                />
              )
            )}

            {/* Searchable dropdown for identifier-based targets (member, tag) */}
            {showIdentifierDropdown && (
              loadingTargets ? (
                <div className="flex items-center gap-2 px-1 py-2 text-xs text-zinc-500">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-400" />
                  Loading {STAKE_TARGET_LABELS[formTargetType]?.toLowerCase()}s...
                </div>
              ) : targetOptions.length === 0 ? (
                <div className="rounded-lg border border-zinc-700 bg-zinc-800/30 px-3 py-2 text-sm text-zinc-500">
                  No {STAKE_TARGET_LABELS[formTargetType]?.toLowerCase()}s available
                </div>
              ) : (
                <SearchableSelect
                  options={targetOptions}
                  value={formTargetIdentifier}
                  onChange={setFormTargetIdentifier}
                  placeholder={`Search ${STAKE_TARGET_LABELS[formTargetType]?.toLowerCase()}s...`}
                  emptyMessage="No matches"
                />
              )
            )}

            {/* Freeform ID for forum/collection (no API) */}
            {showIdFreeform && (
              <input
                type="text"
                inputMode="numeric"
                placeholder="Target ID"
                value={formTargetId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d+$/.test(v)) setFormTargetId(v);
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            )}

            <input
              type="text"
              inputMode="decimal"
              placeholder="Amount (DREAM)"
              value={formAmount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) setFormAmount(v);
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            {formAmount && (parseFloat(formAmount) <= 0 || isNaN(parseFloat(formAmount))) && (
              <p className="text-xs text-red-400">Enter a valid amount greater than 0</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleStake}
                disabled={submitting || !formAmount || parseFloat(formAmount) <= 0 || isNaN(parseFloat(formAmount))}
                className="sd-btn sd-btn-primary"
              >
                {submitting ? "Staking..." : "Stake"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="sd-btn sd-btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {stakes.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No active stakes</p>
          <p className="mt-1 text-xs text-zinc-500">
            Stake DREAM on initiatives, projects, members, or tags to earn rewards
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {stakes.map((s) => (
            <div key={s.id} className="rounded-xl sd-hull-tile px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">
                      {STAKE_TARGET_LABELS[s.target_type] || s.target_type}
                    </span>
                    <span className="text-sm text-zinc-300">
                      {s.target_identifier || `#${s.target_id}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Staked: {formatDream(s.amount)} DREAM
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleClaim(s.id)}
                    disabled={actionLoading === `claim-${s.id}`}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
                  >
                    {actionLoading === `claim-${s.id}` ? "..." : "Claim"}
                  </button>
                  <button
                    onClick={() => handleCompound(s.id)}
                    disabled={actionLoading === `compound-${s.id}`}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white disabled:opacity-50"
                  >
                    {actionLoading === `compound-${s.id}` ? "..." : "Compound"}
                  </button>
                  <button
                    onClick={() => handleUnstake(s.id, s.amount)}
                    disabled={actionLoading === `unstake-${s.id}`}
                    className="rounded-lg border border-red-800 px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-50"
                  >
                    {actionLoading === `unstake-${s.id}` ? "..." : "Unstake"}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {nextKey && (
            <button
              onClick={loadMoreStakes}
              disabled={loadingMore}
              className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load More"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
