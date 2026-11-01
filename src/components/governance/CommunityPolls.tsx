"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Group, Member, Poll, PollVote } from "@/types/commons";
import { PollStatus } from "@/types/commons";
import { getPollVoterTree, getPollVotes, listPolls } from "@/lib/api";
import { CommonsMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import { formatTime, timeRemaining } from "@/lib/utils";
import { useTxAction } from "@/hooks/useTxAction";
import { SHIELD_PHASE_LABELS, useAnonymousSubmit } from "@/hooks/useShieldIdentity";
import NameOrAddress from "@/components/NameOrAddress";
import NumberInput from "@/components/NumberInput";
import ActionBanner from "@/components/ActionBanner";
import ErrorState from "@/components/ErrorState";

// x/commons poll bounds (spec §11.4). The chain enforces them; these only
// catch mistakes before the wallet opens.
const MAX_QUESTION_BYTES = 500;
const MAX_OPTION_BYTES = 100;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const MAX_DURATION_SECONDS = 30 * 86400;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

interface CommunityPollsProps {
  group: Group;
  members: Member[];
}

/**
 * Non-binding, single-choice polls put to a group's members. Open polls are
 * voted with the member's address; secret polls anonymously through x/shield,
 * proven against the voter snapshot taken when the poll opened.
 */
export default function CommunityPolls({ group, members }: CommunityPollsProps) {
  const { address } = useWallet();
  const isMember = members.some((m) => m.address === address);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listPolls(group.index, 0, { reverse: true, limit: "50" });
      setPolls(res.polls || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [group.index]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    setRefreshKey((k) => k + 1);
    load();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Polls
          <span className="ml-2 text-sm font-normal text-zinc-500">{group.index}</span>
        </h2>
        {isMember && !showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="sd-btn sd-btn-primary">
            New poll
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Polls ask the members a question. Nothing executes, and every member gets one vote whatever their weight.
      </p>

      {showForm && (
        <div className="mb-6">
          <NewPollForm
            group={group}
            onClose={() => setShowForm(false)}
            onSuccess={() => {
              setShowForm(false);
              refresh();
            }}
          />
        </div>
      )}

      {error ? <ErrorState error={error} onRetry={load} className="mb-6" /> : null}

      {loading && polls.length === 0 ? (
        <div className="h-32 animate-pulse rounded-xl sd-hull-tile" />
      ) : polls.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No polls yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {polls.map((poll) => (
            <PollCard key={`${poll.id}-${refreshKey}`} poll={poll} isMember={isMember} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── New poll form ───────────────────────────────────────────────────

function NewPollForm({
  group,
  onClose,
  onSuccess,
}: {
  group: Group;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const tx = useTxAction();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [duration, setDuration] = useState("3");
  const [unit, setUnit] = useState<"hours" | "days">("days");
  const [secret, setSecret] = useState(false);

  const setOption = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    const opts = options.map((o) => o.trim());
    const seconds = Math.round(parseFloat(duration) * (unit === "days" ? 86400 : 3600));
    if (!q) return tx.setError("Write a question.");
    if (byteLength(q) > MAX_QUESTION_BYTES) return tx.setError(`The question is limited to ${MAX_QUESTION_BYTES} bytes.`);
    if (opts.some((o) => !o)) return tx.setError("Fill in or remove the empty options.");
    if (opts.some((o) => byteLength(o) > MAX_OPTION_BYTES)) return tx.setError(`Each option is limited to ${MAX_OPTION_BYTES} bytes.`);
    if (new Set(opts).size !== opts.length) return tx.setError("Options must be distinct.");
    if (!Number.isFinite(seconds) || seconds <= 0) return tx.setError("Enter how long voting stays open.");
    if (seconds > MAX_DURATION_SECONDS) return tx.setError("A poll can stay open for at most 30 days.");

    const ok = await tx.run("open", async () => {
      await signAndBroadcast([
        {
          typeUrl: CommonsMsgTypeUrls.OpenPoll,
          value: {
            creator: address,
            councilName: group.index,
            question: q,
            options: opts,
            durationSeconds: BigInt(seconds),
            secretBallot: secret,
          },
        },
      ]);
    });
    if (ok) onSuccess();
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl sd-hull-tile p-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Question</label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="What should the members weigh in on?"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Options</label>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
              />
              {options.length > MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOptions((opts) => opts.filter((_, j) => j !== i))}
                  className="shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                  aria-label={`Remove option ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions((o) => [...o, ""])}
            className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
          >
            Add option
          </button>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-zinc-300">Open for</label>
        <div className="flex gap-2">
          <NumberInput
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            min={0}
            step="any"
            wrapperClassName="w-32"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
          <select value={unit} onChange={(e) => setUnit(e.target.value as "hours" | "days")} className="sd-select">
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
        <p className="mt-1 text-xs text-zinc-500">At least an hour, at most 30 days.</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
        <input type="checkbox" className="mt-1" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
        <span>
          <span className="block text-sm font-medium text-zinc-200">Secret ballot</span>
          <span className="block text-xs text-zinc-500">
            Members vote with their anonymous identity, and the tally never shows who voted what. Needs equal member
            weights and at least 5 members with an anonymous identity. Only those members can vote.
          </span>
        </span>
      </label>

      <ActionBanner message={tx.error} onDismiss={tx.clearError} />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={tx.busy} className="sd-btn sd-btn-primary">
          {tx.busy ? "Opening..." : "Open poll"}
        </button>
        <button type="button" onClick={onClose} className="sd-btn sd-btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Poll card ───────────────────────────────────────────────────────

function pollStatusBadge(poll: Poll, now: number) {
  const pastDeadline = Number(poll.deadline) * 1000 < now;
  if (poll.status === PollStatus.OPEN && !pastDeadline) {
    return <span className="rounded bg-blue-900/30 px-2 py-0.5 text-xs text-blue-400">Open</span>;
  }
  if (poll.status === PollStatus.CANCELLED) {
    return <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">Cancelled</span>;
  }
  return <span className="rounded bg-emerald-900/30 px-2 py-0.5 text-xs text-emerald-400">Closed</span>;
}

function PollCard({ poll, isMember, onChanged }: { poll: Poll; isMember: boolean; onChanged: () => void }) {
  const { address, signAndBroadcast } = useWallet();
  const tx = useTxAction();
  const { submit: submitAnonymously, phase: anonPhase, shield } = useAnonymousSubmit();
  const canActAnonymously = shield.status === "ready" || shield.status === "locked";
  const [votes, setVotes] = useState<PollVote[] | null>(null);
  const [showVotes, setShowVotes] = useState(false);
  // Ticks so the countdown advances and voting closes on screen at the deadline.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const tallies = poll.options.map((_, i) => Number(poll.tallies?.[i] ?? 0));
  const total = tallies.reduce((a, b) => a + b, 0);
  const isOpen = poll.status === PollStatus.OPEN && Number(poll.deadline) * 1000 >= now;
  const isCreator = !!address && poll.creator === address;

  // Open polls list their voters; load them up front for an open poll so a
  // member who already voted doesn't get vote buttons again.
  useEffect(() => {
    if (poll.secret_ballot) return;
    if (!isOpen && !showVotes) return;
    let live = true;
    getPollVotes(poll.id, { limit: "200" })
      .then((r) => live && setVotes(r.votes || []))
      .catch(() => live && setVotes([]));
    return () => {
      live = false;
    };
  }, [poll.id, poll.secret_ballot, isOpen, showVotes]);

  const myVote = votes?.find((v) => v.voter === address);
  const canVote = isOpen && isMember && (poll.secret_ballot ? canActAnonymously : votes !== null && !myVote);

  const vote = (option: number) =>
    tx.run(
      `vote-${option}`,
      async () => {
        if (poll.secret_ballot) {
          await submitAnonymously(
            CommonsMsgTypeUrls.AnonymousVotePoll,
            (shieldAddress) => ({ voter: shieldAddress, pollId: BigInt(poll.id), option: BigInt(option) }),
            undefined,
            () => getPollVoterTree(poll.id).then((r) => r.tree),
          );
        } else {
          await signAndBroadcast([
            {
              typeUrl: CommonsMsgTypeUrls.VotePoll,
              value: { voter: address, pollId: BigInt(poll.id), option: BigInt(option) },
            },
          ]);
        }
        onChanged();
      },
      (raw) => `Vote on poll #${poll.id} failed: ${raw}`,
    );

  const cancel = () =>
    tx.run(
      "cancel",
      async () => {
        await signAndBroadcast([
          { typeUrl: CommonsMsgTypeUrls.CancelPoll, value: { creator: address, pollId: BigInt(poll.id) } },
        ]);
        onChanged();
      },
      (raw) => `Cancelling poll #${poll.id} failed: ${raw}`,
    );

  const remaining = isOpen ? timeRemaining(poll.deadline, now) : null;

  return (
    <article className="rounded-xl sd-hull-tile p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">#{poll.id}</span>
        {pollStatusBadge(poll, now)}
        {poll.secret_ballot && (
          <span className="rounded bg-violet-900/30 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
            Secret ballot
          </span>
        )}
        {remaining && <span className="text-xs font-medium text-blue-400">{remaining}</span>}
      </div>

      <p className="mb-3 whitespace-pre-wrap text-sm text-zinc-200">{poll.question}</p>

      <div className="space-y-2">
        {poll.options.map((opt, i) => {
          const pct = total > 0 ? (tallies[i] / total) * 100 : 0;
          const mine = myVote && Number(myVote.option) === i;
          return (
            <div key={i}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className={mine ? "font-medium text-indigo-300" : "text-zinc-300"}>
                  {opt}
                  {mine && <span className="ml-1.5 text-[10px] text-indigo-400">your vote</span>}
                </span>
                <span className="shrink-0 text-zinc-500">
                  {tallies[i]} {total > 0 && <span className="text-zinc-600">({pct.toFixed(0)}%)</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
                {canVote && (
                  <button
                    type="button"
                    onClick={() => vote(i)}
                    disabled={tx.busy}
                    className="shrink-0 rounded-lg border border-indigo-700/50 px-2.5 py-0.5 text-xs text-indigo-300 transition-colors hover:border-indigo-500 hover:bg-indigo-900/20 disabled:opacity-50"
                  >
                    {tx.pending === `vote-${i}` ? "Voting..." : "Vote"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          by <NameOrAddress address={poll.creator} />
        </span>
        <span>{formatTime(poll.opened_at)}</span>
        <span>
          {total} of {poll.eligible_voters || "?"} {poll.secret_ballot ? "eligible voters" : "members"} voted
        </span>
        {isOpen ? (
          <span>Closes {formatTime(poll.deadline)}</span>
        ) : poll.closed_at && poll.closed_at !== "0" ? (
          <span>
            {poll.status === PollStatus.CANCELLED ? "Cancelled" : "Closed"} {formatTime(poll.closed_at)}
          </span>
        ) : null}
        {!poll.secret_ballot && total > 0 && (
          <button type="button" onClick={() => setShowVotes(!showVotes)} className="text-zinc-500 hover:text-zinc-300">
            {showVotes ? "Hide votes" : "Show votes"}
          </button>
        )}
      </div>

      {showVotes && votes && votes.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-zinc-800 pt-3">
          {votes.map((v) => (
            <div key={v.voter} className="flex items-center gap-2 text-xs">
              <NameOrAddress address={v.voter} className="text-zinc-300" />
              <span className="text-zinc-500">{poll.options[Number(v.option)] ?? "?"}</span>
            </div>
          ))}
        </div>
      )}

      {isOpen && isMember && poll.secret_ballot && !canActAnonymously && shield.status !== "loading" && (
        <p className="mt-3 text-xs text-zinc-500">
          {"Secret polls are voted with your anonymous identity. "}
          {shield.status === "pending" ? (
            `Yours activates at epoch ${shield.activatesAtEpoch ?? "?"}; only keys active when a poll opens can vote on it.`
          ) : (
            <>
              Set one up on the{" "}
              <Link href="/permissions" className="text-indigo-400 hover:text-indigo-300">
                Permissions page
              </Link>
              .
            </>
          )}
        </p>
      )}
      {anonPhase && <p className="mt-2 text-xs text-zinc-400">{SHIELD_PHASE_LABELS[anonPhase]}</p>}

      {isOpen && isCreator && total === 0 && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={cancel}
            disabled={tx.busy}
            className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            {tx.pending === "cancel" ? "Cancelling..." : "Cancel poll"}
          </button>
          <span className="ml-2 text-xs text-zinc-600">Possible until the first vote.</span>
        </div>
      )}

      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </article>
  );
}
