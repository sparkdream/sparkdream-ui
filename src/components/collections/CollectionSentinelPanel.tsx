"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getBondedRole,
  getBondedRoleConfig,
} from "@/lib/api";
import { useWallet } from "@/contexts/WalletContext";
import { useIsRepMember } from "@/hooks/useIsRepMember";
import { RepMsgTypeUrls } from "@/lib/tx";
import NumberInput from "@/components/NumberInput";
import CollectionModerationPanel from "@/components/collections/CollectionModerationPanel";
import {
  RoleType,
  BondedRoleStatus,
  BONDED_ROLE_STATUS_LABELS,
} from "@/types/rep";
import type { BondedRole, BondedRoleConfig } from "@/types/rep";

interface Props {
  onViewCollection?: (collectionId: string) => void;
}

// The forum sentinel bond (ROLE_TYPE_FORUM_SENTINEL) is the same bond that
// gates collection moderation: there is no separate "collection sentinel", so
// becoming a sentinel here also unlocks Swarm moderation, and vice versa.
const SENTINEL_ROLE = RoleType.FORUM_SENTINEL;

function formatAmount(amount: string): string {
  if (!amount || amount === "0") return "0";
  const n = BigInt(amount);
  return (n / BigInt(1000000)).toLocaleString();
}

/**
 * Wonders moderation home. Mirrors the structure of Swarm's SentinelPanel -- a
 * bond/become-a-sentinel card on top, then the moderation queue -- but the queue
 * and actions are collection-specific (flag/hide on items and collections via
 * x/collect), so this is a dedicated panel rather than the forum one.
 */
export default function CollectionSentinelPanel({ onViewCollection }: Props) {
  const { address, connected, signAndBroadcast } = useWallet();
  const isMember = useIsRepMember(address);
  const cannotBond = address ? isMember === false : false;

  const [bond, setBond] = useState<BondedRole | null>(null);
  const [config, setConfig] = useState<BondedRoleConfig | null>(null);
  const [isSentinel, setIsSentinel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showBondForm, setShowBondForm] = useState(false);
  const [bondAmount, setBondAmount] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);
      const [bondRes, configRes] = await Promise.all([
        getBondedRole(SENTINEL_ROLE, address).catch(() => null),
        getBondedRoleConfig(SENTINEL_ROLE).catch(() => null),
      ]);
      setConfig(configRes?.bonded_role_config ?? null);
      if (bondRes?.bonded_role) {
        setIsSentinel(true);
        setBond(bondRes.bonded_role);
      } else {
        setIsSentinel(false);
        setBond(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load sentinel data";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setIsSentinel(false);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleBond = async () => {
    if (!address || !bondAmount.trim()) return;
    setActionLoading("bond");
    try {
      const amountUdream = BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000)).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.BondRole,
        value: { creator: address, roleType: SENTINEL_ROLE, amount: amountUdream },
      }]);
      setBondAmount("");
      setShowBondForm(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bond failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnbond = async () => {
    if (!address || !bondAmount.trim()) return;
    setActionLoading("unbond");
    try {
      const amountUdream = BigInt(Math.floor(parseFloat(bondAmount) * 1_000_000)).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.UnbondRole,
        value: { creator: address, roleType: SENTINEL_ROLE, amount: amountUdream },
      }]);
      setBondAmount("");
      setShowBondForm(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unbond failed");
    } finally {
      setActionLoading(null);
    }
  };

  if (!connected) return null;

  const bondStatus = bond?.bond_status ?? "";
  const currentBond = bond?.current_bond ?? "0";
  const totalCommitted = bond?.total_committed_bond ?? "0";
  const availableBond = bond
    ? (BigInt(currentBond) - BigInt(totalCommitted)).toString()
    : "0";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Sentinel status</h2>

      {loading ? (
        <div className="h-32 animate-pulse sd-hull-tile rounded-xl" />
      ) : error ? (
        <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={fetchData} className="ml-2 underline hover:text-red-300">Retry</button>
        </div>
      ) : !isSentinel ? (
        <div className="sd-hull-tile rounded-xl p-6">
          <p className="mb-2 text-sm text-zinc-400">
            You are not a sentinel. Bond DREAM tokens to become a sentinel and help moderate
            collections. The same bond also lets you moderate{" "}
            <Link href="/swarm" className="text-indigo-400 underline hover:text-indigo-300">Swarm</Link>.
          </p>
          {config && (
            <p className="mb-4 text-xs text-zinc-500">
              Minimum bond: {formatAmount(config.min_bond)} DREAM
              {config.min_trust_level && config.min_trust_level !== "TRUST_LEVEL_UNSPECIFIED" &&
                ` · Min trust: ${config.min_trust_level.replace("TRUST_LEVEL_", "")}`}
            </p>
          )}
          {cannotBond && (
            <p className="mb-3 text-xs text-zinc-500">
              Bonding as a sentinel is open to members. Ask any existing{" "}
              <Link href="/contribute?view=members" className="text-indigo-400 underline hover:text-indigo-300">
                member
              </Link>{" "}
              to invite you in.
            </p>
          )}
          {!showBondForm ? (
            <button
              type="button"
              onClick={() => setShowBondForm(true)}
              disabled={cannotBond}
              title={cannotBond ? "Only existing members can become a sentinel" : undefined}
              className="sd-btn sd-btn-primary"
            >
              Become a sentinel
            </button>
          ) : (
            <div className="space-y-3">
              <NumberInput
                value={bondAmount}
                onChange={(e) => setBondAmount(e.target.value)}
                placeholder="Amount (DREAM)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleBond}
                  disabled={!bondAmount.trim() || actionLoading === "bond" || cannotBond}
                  title={cannotBond ? "Only existing members can become a sentinel" : undefined}
                  className="sd-btn sd-btn-primary"
                >
                  {actionLoading === "bond" ? "Bonding..." : "Bond"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBondForm(false)}
                  className="sd-btn sd-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="sd-hull-tile rounded-xl p-5">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-zinc-500">Status</p>
              <p className={`font-medium ${
                bondStatus === BondedRoleStatus.NORMAL ? "text-emerald-400"
                  : bondStatus === BondedRoleStatus.RECOVERY ? "text-amber-400"
                    : bondStatus === BondedRoleStatus.UNBONDING ? "text-amber-400"
                      : "text-red-400"
              }`}>
                {BONDED_ROLE_STATUS_LABELS[bondStatus] || bondStatus}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Current bond</p>
              <p className="font-medium text-zinc-200">{formatAmount(currentBond)} DREAM</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Available</p>
              <p className="font-medium text-zinc-200">{formatAmount(availableBond)} DREAM</p>
            </div>
            {bond?.cumulative_rewards && bond.cumulative_rewards !== "0" && (
              <div>
                <p className="text-xs text-zinc-500">Rewards</p>
                <p className="font-medium text-amber-400">{formatAmount(bond.cumulative_rewards)} DREAM</p>
              </div>
            )}
          </div>
          <p className="mt-3 border-t border-zinc-800/60 pt-3 text-xs text-zinc-500">
            Full sentinel activity, reward accuracy, and forum hide self-correction live on the{" "}
            <Link href="/swarm" className="text-indigo-400 underline hover:text-indigo-300">Swarm</Link>{" "}
            moderation panel. Here you act on flagged collection content below.
          </p>
          <div className="mt-4 flex gap-2">
            {!showBondForm ? (
              <button
                onClick={() => setShowBondForm(true)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
              >
                Bond / unbond
              </button>
            ) : (
              <div className="flex w-full items-center gap-2">
                <NumberInput
                  value={bondAmount}
                  onChange={(e) => setBondAmount(e.target.value)}
                  placeholder="Amount (DREAM)"
                  wrapperClassName="w-32"
                  className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleBond}
                  disabled={!bondAmount.trim() || !!actionLoading || cannotBond}
                  title={cannotBond ? "Only existing members can bond" : undefined}
                  className="sd-btn sd-btn-primary"
                >
                  {actionLoading === "bond" ? "..." : "Bond"}
                </button>
                <button
                  onClick={handleUnbond}
                  disabled={!bondAmount.trim() || !!actionLoading}
                  className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-700 disabled:opacity-50"
                >
                  {actionLoading === "unbond" ? "..." : "Unbond"}
                </button>
                <button
                  onClick={() => setShowBondForm(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collection-specific moderation queue: flagged items/collections + Hide. */}
      <CollectionModerationPanel onViewCollection={onViewCollection} />
    </div>
  );
}
