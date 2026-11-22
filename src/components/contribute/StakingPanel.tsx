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
  getRepMember,
  getRepParams,
  getLatestBlockHeight,
} from "@/lib/api";
import { RepMsgTypeUrls } from "@/lib/tx";
import { truncateAddress } from "@/lib/utils";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import type { RepStake } from "@/types/rep";
import { STAKE_TARGET_LABELS, StakeTargetType } from "@/types/rep";
import { stakeTargetTypeFromJSON } from "@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/stake";
import SearchableSelect from "@/components/contribute/SearchableSelect";
import ErrorState from "@/components/ErrorState";
import { isMissingEndpoint, txErrorMessage } from "@/lib/errors";
import { primeRepMember } from "@/lib/repMember";
import { useDreamDenom } from "@/hooks/useDreamDenom";

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

// Decimal DREAM string to micro-DREAM, without the float rounding that
// parseFloat(x) * 1e6 introduces. Digits past the sixth decimal are dropped.
function toMicro(value: string): bigint | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || "0") * BigInt(1000000) + BigInt((m[2] || "").slice(0, 6).padEnd(6, "0"));
}

// Micro-DREAM to a plain decimal string an amount input accepts (no grouping).
function microToInput(micro: bigint): string {
  const whole = micro / BigInt(1000000);
  const frac = (micro % BigInt(1000000)).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

// How long a wallet prompt may stay open, in blocks, with Max still landing.
const SIGNING_MARGIN_BLOCKS = 100;
const DEC_ONE = BigInt("1000000000000000000");

// An LCD LegacyDec string ("0.002000000000000000") as an 18-decimal integer.
function decToInt18(value: string): bigint {
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole || "0") * DEC_ONE + BigInt(frac.slice(0, 18).padEnd(18, "0"));
}

// The unlocked amount that is still there when the tx lands. Unstaked DREAM
// decays at each epoch boundary (ApplyPendingDecay in the chain's
// x/rep/keeper/dream.go), so an amount read just before a boundary is more
// than the chain will lock just after it. For every boundary that falls inside
// the signing margin, apply the chain's own step: trunc(unstaked * (1 - rate)).
function spendableAfterDecay(
  unlocked: bigint,
  height: bigint,
  epochBlocks: bigint,
  decayRate: bigint
): bigint {
  if (epochBlocks <= BigInt(0) || decayRate <= BigInt(0)) return unlocked;
  const crossings =
    (height + BigInt(SIGNING_MARGIN_BLOCKS)) / epochBlocks - height / epochBlocks;
  let amount = unlocked;
  for (let i = BigInt(0); i < crossings && amount > BigInt(0); i++) {
    amount = (amount * (DEC_ONE - decayRate)) / DEC_ONE;
  }
  return amount;
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
  const dream = useDreamDenom();
  const { address, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const canStake = isMember === true;
  const [stakes, setStakes] = useState<RepStake[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextKey, setNextKey] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New stake form
  const [formTargetType, setFormTargetType] = useState<string>(StakeTargetType.INITIATIVE);
  const [formTargetId, setFormTargetId] = useState("");
  const [formTargetIdentifier, setFormTargetIdentifier] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  // Micro-DREAM that can be staked now: balance minus everything already
  // locked, less any decay due before the tx can land. null until loaded.
  const [available, setAvailable] = useState<bigint | null>(null);
  // Set by the Max button, cleared by typing: stake whatever is available at
  // submit time instead of the figure that was on screen when it was pressed.
  const [stakeMax, setStakeMax] = useState(false);

  const fetchAvailable = useCallback(async (): Promise<bigint | null> => {
    if (!address) return null;
    try {
      // Height first: if a boundary passes between the two reads, the member
      // record is the later one and already carries that epoch's decay.
      const [height, params] = await Promise.all([getLatestBlockHeight(), getRepParams()]);
      const res = await getRepMember(address);
      if (!res.member?.address) return null;
      primeRepMember(address, res.member);
      const unlocked = BigInt(res.member.dream_balance || "0") - BigInt(res.member.staked_dream || "0");
      const free = spendableAfterDecay(
        unlocked > BigInt(0) ? unlocked : BigInt(0),
        BigInt(height),
        BigInt(String(params.params.epoch_blocks ?? "0")),
        decToInt18(String(params.params.unstaked_decay_rate ?? "0"))
      );
      setAvailable(free);
      return free;
    } catch {
      // The form still works without the hint; the chain enforces the limit.
      return null;
    }
  }, [address]);

  useEffect(() => {
    setAvailable(null);
    fetchAvailable();
  }, [fetchAvailable]);

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
      if (isMissingEndpoint(err)) {
        setStakes([]);
      } else {
        setError(err);
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
      setStakeError(null);
      let micro = toMicro(formAmount);
      // Re-read the balance: the figure on screen may predate an epoch
      // boundary or a lock taken elsewhere.
      const fresh = await fetchAvailable();
      if (fresh !== null) {
        if (stakeMax) {
          micro = fresh;
          setFormAmount(microToInput(fresh));
        } else if (micro !== null && micro > fresh) {
          // The inline message under the field now explains why.
          return;
        }
      }
      if (micro === null || micro <= BigInt(0)) return;
      const amount = micro.toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.Stake,
        value: {
          staker: address,
          // StakeTargetType is a proto3 int32 enum; the form holds the
          // enum-string key for the <select>. Convert to int before
          // broadcast so the proto encoder doesn't NaN-coerce it to 0 and
          // amino sigverify doesn't fail on the string-vs-int mismatch.
          targetType: stakeTargetTypeFromJSON(formTargetType),
          // target_id is uint64. For identifier-based targets (MEMBER, TAG,
          // FORUM_*_BOND, COLLECTION_*_BOND) formTargetId stays empty and
          // target_id legitimately defaults to 0. The amino override checks
          // `message.targetId !== BigInt(0)` and Number(0) !== 0n is always
          // true under JS strict equality, so the prior Number-typed default
          // signed `"target_id":"0"` while the chain omits the uint64 zero —
          // every identifier-target Stake hit "unauthorized" sigverify. Wrap
          // in BigInt so the zero-omit branch actually fires.
          targetId: formTargetId ? BigInt(formTargetId) : BigInt(0),
          targetIdentifier: formTargetIdentifier,
          amount,
        },
      }]);
      setShowForm(false);
      setFormTargetId("");
      setFormTargetIdentifier("");
      setFormAmount("");
      setStakeMax(false);
      await Promise.all([fetchStakes(), fetchAvailable()]);
    } catch (err) {
      console.error("Stake failed:", err);
      setStakeError(txErrorMessage(err, "Failed to stake"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClaim = async (stakeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`claim-${stakeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.ClaimStakingRewards,
        // stake_id is uint64; pass BigInt so the override's `!== BigInt(0)`
        // check works correctly under strict equality (Number-vs-BigInt is
        // always inequal, which signs "0" for any zero-valued numeric).
        value: { staker: address, stakeId: BigInt(stakeId) },
      }]);
      await Promise.all([fetchStakes(), fetchAvailable()]);
    } catch (err) {
      console.error("Claim failed:", err);
      setActionError({ id: stakeId, message: txErrorMessage(err, "Failed to claim") });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCompound = async (stakeId: string) => {
    if (!address) return;
    try {
      setActionLoading(`compound-${stakeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.CompoundStakingRewards,
        value: { staker: address, stakeId: BigInt(stakeId) },
      }]);
      await Promise.all([fetchStakes(), fetchAvailable()]);
    } catch (err) {
      console.error("Compound failed:", err);
      setActionError({ id: stakeId, message: txErrorMessage(err, "Failed to compound") });
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnstake = async (stakeId: string, amount: string) => {
    if (!address) return;
    try {
      setActionLoading(`unstake-${stakeId}`);
      setActionError(null);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.Unstake,
        value: { staker: address, stakeId: BigInt(stakeId), amount },
      }]);
      await Promise.all([fetchStakes(), fetchAvailable()]);
    } catch (err) {
      console.error("Unstake failed:", err);
      setActionError({ id: stakeId, message: txErrorMessage(err, "Failed to unstake") });
    } finally {
      setActionLoading(null);
    }
  };

  const amountMicro = formAmount ? toMicro(formAmount) : null;
  const amountInvalid = formAmount !== "" && (amountMicro === null || amountMicro <= BigInt(0));
  const overAvailable = available !== null && amountMicro !== null && amountMicro > available;

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
      <ErrorState error={error} onRetry={fetchStakes} />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Staking</h2>
        {canStake && !showForm && (
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              // The balance decays and other panels lock DREAM, so re-read it.
              fetchAvailable();
            }}
            className="sd-btn sd-btn-primary"
          >
            New stake
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
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">Stake {dream}</h3>
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
              placeholder={`Amount (${dream})`}
              value={formAmount}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) {
                  setFormAmount(v);
                  setStakeMax(false);
                  setStakeError(null);
                }
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            {available !== null && (
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span>
                  Available: {formatDream(available.toString())} {dream}
                </span>
                {available > BigInt(0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFormAmount(microToInput(available));
                      setStakeMax(true);
                      setStakeError(null);
                    }}
                    className="text-indigo-400 transition-colors hover:text-indigo-300"
                  >
                    Max
                  </button>
                )}
              </div>
            )}
            {amountInvalid && (
              <p className="text-xs text-red-400">Enter a valid amount greater than 0</p>
            )}
            {overAvailable && (
              <p className="text-xs text-red-400">
                That is more than your available {dream}. Locked {dream} cannot be staked again.
              </p>
            )}
            {stakeError && (
              <div className="rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-400">
                {stakeError}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleStake}
                disabled={submitting || !formAmount || amountInvalid || overAvailable}
                className="sd-btn sd-btn-primary"
              >
                {submitting ? "Staking..." : "Stake"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setStakeError(null);
                }}
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
            Stake {dream} on initiatives, projects, members, or tags to earn rewards
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
                    Staked: {formatDream(s.amount)} {dream}
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
              {actionError?.id === s.id && (
                <p className="mt-2 text-xs text-red-400">{actionError.message}</p>
              )}
            </div>
          ))}
          {nextKey && (
            <button
              onClick={loadMoreStakes}
              disabled={loadingMore}
              className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
