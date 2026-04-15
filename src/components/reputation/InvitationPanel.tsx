"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { invitationsByInviter, listRepInvitations, collectTags } from "@/lib/api";
import TagPicker from "@/components/reputation/TagPicker";
import { RepMsgTypeUrls } from "@/lib/tx";
import { truncateAddress, formatTime } from "@/lib/utils";
import type { Invitation } from "@/types/rep";
import { INVITATION_STATUS_LABELS, InvitationStatus } from "@/types/rep";

function statusColor(status: string): string {
  switch (status) {
    case InvitationStatus.ACCEPTED: return "bg-emerald-500/15 text-emerald-400";
    case InvitationStatus.PENDING: return "bg-yellow-500/15 text-yellow-400";
    case InvitationStatus.EXPIRED: return "bg-zinc-500/15 text-zinc-400";
    default: return "bg-zinc-800/50 text-zinc-400";
  }
}

export default function InvitationPanel() {
  const { address, signAndBroadcast } = useWallet();
  const [sentInvitations, setSentInvitations] = useState<Invitation[]>([]);
  const [pendingForMe, setPendingForMe] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sentNextKey, setSentNextKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Invite form
  const [formInvitee, setFormInvitee] = useState("");
  const [formStake, setFormStake] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);

  const fetchInvitations = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);

      // Fetch invitations sent by this user (paginated)
      const sentRes = await invitationsByInviter(address, { limit: "50" }).catch(() => ({
        invitations: [] as Invitation[],
        pagination: { next_key: null, total: "0" },
      }));
      setSentInvitations(sentRes.invitations || []);
      setSentNextKey(sentRes.pagination?.next_key || null);

      // Paginate through all invitations to find pending ones for this address.
      // Stop after finding matches or exhausting pages (cap at 500 total).
      const pending: Invitation[] = [];
      let pageKey: string | undefined;
      for (let page = 0; page < 5; page++) {
        const res = await listRepInvitations({ limit: "100", key: pageKey }).catch(() => ({
          invitation: [] as Invitation[],
          pagination: { next_key: null, total: "0" },
        }));
        const items = res.invitation || [];
        for (const inv of items) {
          if (inv.invitee_address === address && inv.status === InvitationStatus.PENDING) {
            pending.push(inv);
          }
        }
        const nk = res.pagination?.next_key;
        if (!nk || items.length === 0) break;
        pageKey = nk;
      }
      setPendingForMe(pending);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load invitations";
      if (msg.includes("404") || msg.includes("not found") || msg.includes("501")) {
        setSentInvitations([]);
        setPendingForMe([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  const loadMoreSent = useCallback(async () => {
    if (!address || !sentNextKey || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await invitationsByInviter(address, { limit: "50", key: sentNextKey });
      setSentInvitations((prev) => [...prev, ...(res.invitations || [])]);
      setSentNextKey(res.pagination?.next_key || null);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [address, sentNextKey, loadingMore]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    setLoadingTags(true);
    collectTags().then((tags) => {
      if (!cancelled) setAvailableTags(tags);
    }).catch(() => {
      if (!cancelled) setAvailableTags([]);
    }).finally(() => {
      if (!cancelled) setLoadingTags(false);
    });
    return () => { cancelled = true; };
  }, [showForm]);

  const handleInvite = async () => {
    if (!address || !formInvitee.trim() || !formStake || parseFloat(formStake) <= 0 || isNaN(parseFloat(formStake))) return;
    try {
      setSubmitting(true);
      const stakeAmount = (BigInt(Math.floor(parseFloat(formStake) * 1e6))).toString();
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.InviteMember,
        value: {
          inviter: address,
          invitee_address: formInvitee.trim(),
          staked_dream: stakeAmount,
          vouched_tags: formTags,
        },
      }]);
      setShowForm(false);
      setFormInvitee("");
      setFormStake("");
      setFormTags([]);
      await fetchInvitations();
    } catch (err) {
      console.error("Invite failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAccept = async (invitationId: string) => {
    if (!address) return;
    try {
      setActionLoading(`accept-${invitationId}`);
      await signAndBroadcast([{
        typeUrl: RepMsgTypeUrls.AcceptInvitation,
        value: { invitee: address, invitation_id: parseInt(invitationId) },
      }]);
      await fetchInvitations();
    } catch (err) {
      console.error("Accept failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        <div className="h-20 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
        {error}
        <button onClick={fetchInvitations} className="ml-2 underline hover:text-red-300">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending invitations for me */}
      {pendingForMe.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-white">Pending Invitations</h2>
          <div className="space-y-2">
            {pendingForMe.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-xl border border-yellow-800/50 bg-yellow-900/10 px-4 py-3">
                <div>
                  <p className="text-sm text-zinc-200">
                    Invited by <span className="font-mono text-xs">{truncateAddress(inv.inviter)}</span>
                  </p>
                  {inv.vouched_tags?.length > 0 && (
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Tags: {inv.vouched_tags.join(", ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleAccept(inv.id)}
                  disabled={actionLoading === `accept-${inv.id}`}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                >
                  {actionLoading === `accept-${inv.id}` ? "Accepting..." : "Accept"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite form & sent invitations */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Send Invitations</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            {showForm ? "Cancel" : "Invite Member"}
          </button>
        </div>

        {showForm && (
          <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">New Invitation</h3>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Invitee address (sprkdrm1...)"
                value={formInvitee}
                onChange={(e) => setFormInvitee(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Stake amount (DREAM)"
                  value={formStake}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setFormStake(v);
                  }}
                  className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
                <TagPicker
                  options={availableTags}
                  value={formTags}
                  onChange={setFormTags}
                  placeholder="Select vouched tags..."
                  loading={loadingTags}
                />
              </div>
              <button
                onClick={handleInvite}
                disabled={submitting || !formInvitee.trim() || !formStake || parseFloat(formStake) <= 0 || isNaN(parseFloat(formStake))}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {submitting ? "Sending..." : "Send Invitation"}
              </button>
            </div>
          </div>
        )}

        {sentInvitations.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <p className="text-zinc-400">No invitations sent</p>
            <p className="mt-1 text-xs text-zinc-500">
              Invite new members to the reputation system by staking DREAM
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sentInvitations.map((inv) => (
              <div key={inv.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-zinc-300">{truncateAddress(inv.invitee_address)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(inv.status)}`}>
                        {INVITATION_STATUS_LABELS[inv.status] || inv.status}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
                      {inv.created_at && <span>{formatTime(inv.created_at)}</span>}
                      {inv.vouched_tags?.length > 0 && <span>Tags: {inv.vouched_tags.join(", ")}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {sentNextKey && (
              <button
                onClick={loadMoreSent}
                disabled={loadingMore}
                className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
