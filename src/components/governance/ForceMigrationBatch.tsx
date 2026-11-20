"use client";

import { useEffect, useMemo, useState } from "react";
import { forceMoveCheck, type ForceMoveCheck } from "@/lib/migration";
import {
  MAX_PROPOSAL_MESSAGES,
  emptyForceRow,
  forceRowProblems,
  isBlankForceRow,
  normalizeForceRow,
  parseForceRows,
  type ForceRow,
} from "@/lib/forceMigrationBatch";
import { INPUT_CLASS } from "@/components/permissions/fields";

const checkKey = (row: ForceRow) => `${row.member}|${row.newAddress}`;

export interface ForceBatchChecks {
  /** Problems per row, by index: what the form can tell, then what the chain reports. */
  problems: string[][];
  /** Rows whose chain check came back clean, by index. */
  clean: boolean[];
  /** By index: the escalated migration a row would decide rather than open (x/gov only). */
  rulings: (string | undefined)[];
  /** A chain check is still running. */
  checking: boolean;
  /** Rows that would become messages. */
  count: number;
  /** Nothing to submit, too many rows, or a row the chain would refuse. */
  blocked: boolean;
}

/**
 * Checks a batch of committee moves. A commons proposal runs all or nothing,
 * so a single row the chain refuses would revert every other move at
 * execution: rows are checked against each other and, once well formed,
 * against the chain (the member exists and can be moved, the new address is
 * fresh). The chain checks describe now, not the block the proposal executes.
 * `byGov` is a chain (x/gov) proposal, which may also decide an escalated
 * objection.
 */
export function useForceBatchChecks(
  rows: ForceRow[],
  prefix: string,
  enabled: boolean,
  byGov = false,
): ForceBatchChecks {
  const local = useMemo(() => forceRowProblems(rows, prefix), [rows, prefix]);
  const [chain, setChain] = useState<Record<string, ForceMoveCheck>>({});

  // Well-formed rows not looked up yet.
  const pending = useMemo(() => {
    if (!enabled) return [];
    const keys = new Map<string, ForceRow>();
    rows.forEach((raw, i) => {
      if (isBlankForceRow(raw) || local[i].length > 0) return;
      const row = normalizeForceRow(raw);
      if (!(checkKey(row) in chain)) keys.set(checkKey(row), row);
    });
    return [...keys.values()];
  }, [rows, local, chain, enabled]);
  const pendingKeys = pending.map(checkKey).join(" ");

  useEffect(() => {
    if (pending.length === 0) return;
    let live = true;
    const timer = setTimeout(() => {
      Promise.all(
        pending.map(
          async (row) =>
            [checkKey(row), await forceMoveCheck(row.member, row.newAddress, byGov)] as [string, ForceMoveCheck],
        ),
      ).then((results) => {
        if (live) setChain((prev) => ({ ...prev, ...Object.fromEntries(results) }));
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `pendingKeys` stands for `pending`, which is rebuilt on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKeys]);

  const filled = rows.filter((r) => !isBlankForceRow(r));
  const chainFor = (i: number): ForceMoveCheck | undefined =>
    isBlankForceRow(rows[i]) || local[i].length > 0 ? undefined : chain[checkKey(normalizeForceRow(rows[i]))];
  const problems = rows.map((_, i) => [...local[i], ...(chainFor(i)?.problems ?? [])]);
  return {
    problems,
    clean: rows.map((_, i) => chainFor(i)?.problems.length === 0 && !chainFor(i)?.rulesOn),
    rulings: rows.map((_, i) => chainFor(i)?.rulesOn),
    checking: pending.length > 0,
    count: filled.length,
    blocked:
      filled.length === 0 || filled.length > MAX_PROPOSAL_MESSAGES || problems.some((p) => p.length > 0),
  };
}

export default function ForceMigrationBatch({
  rows,
  onChange,
  checks,
  prefix,
  byGov = false,
}: {
  rows: ForceRow[];
  onChange: (rows: ForceRow[]) => void;
  checks: ForceBatchChecks;
  prefix: string;
  /** A chain (x/gov) proposal rather than a committee one. */
  byGov?: boolean;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteProblems, setPasteProblems] = useState<string[]>([]);

  const full = rows.length >= MAX_PROPOSAL_MESSAGES;
  const setRow = (i: number, patch: Partial<ForceRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    onChange(next.length > 0 ? next : [emptyForceRow()]);
  };

  const addPasted = () => {
    const parsed = parseForceRows(pasteText);
    const kept = rows.filter((r) => !isBlankForceRow(r));
    const room = MAX_PROPOSAL_MESSAGES - kept.length;
    const problems = [...parsed.problems];
    if (parsed.rows.length > room) {
      problems.push(
        `A proposal carries at most ${MAX_PROPOSAL_MESSAGES} moves. ${parsed.rows.length - Math.max(room, 0)} pasted ${
          parsed.rows.length - Math.max(room, 0) === 1 ? "line was" : "lines were"
        } left out.`,
      );
    }
    const added = parsed.rows.slice(0, Math.max(room, 0));
    if (added.length > 0) onChange([...kept, ...added]);
    setPasteProblems(problems);
    if (problems.length === 0) {
      setPasteText("");
      setPasteOpen(false);
    }
  };

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Move {i + 1}</span>
            {(rows.length > 1 || !isBlankForceRow(row)) && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="text-xs text-zinc-500 hover:text-red-400"
              >
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">Member address</label>
              <input
                type="text"
                value={row.member}
                onChange={(e) => setRow(i, { member: e.target.value })}
                placeholder={`${prefix}1...`}
                spellCheck={false}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">New address</label>
              <input
                type="text"
                value={row.newAddress}
                onChange={(e) => setRow(i, { newAddress: e.target.value })}
                placeholder={`${prefix}1...`}
                spellCheck={false}
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Evidence link</label>
            <input
              type="text"
              value={row.evidence}
              onChange={(e) => setRow(i, { evidence: e.target.value })}
              placeholder="https://..."
              spellCheck={false}
              className={INPUT_CLASS}
            />
          </div>
          {/* A half-typed row only shows what is wrong once both addresses are in. */}
          {row.member.trim() && row.newAddress.trim() && checks.problems[i]?.length > 0 && (
            <ul className="space-y-0.5 text-xs text-red-400">
              {checks.problems[i].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {checks.clean[i] && <p className="text-xs text-emerald-400">Checked against the chain: nothing in the way.</p>}
          {checks.rulings[i] && (
            <p className="text-xs text-amber-400">
              This decides the objection to migration #{checks.rulings[i]}, which a jury left undecided. If the
              proposal passes, the objection is rejected: the move goes through and the objection bond is paid to the
              new address.
            </p>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onChange([...rows, emptyForceRow()])}
          disabled={full}
          className="sd-btn sd-btn-secondary"
        >
          Add another member
        </button>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          disabled={full && !pasteOpen}
          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600"
        >
          {pasteOpen ? "Close the list" : "Paste a list"}
        </button>
        <span className="text-xs text-zinc-500">
          {checks.count} of {MAX_PROPOSAL_MESSAGES} moves
          {checks.checking ? ", checking..." : ""}
        </span>
      </div>

      {pasteOpen && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={`${prefix}1member..., ${prefix}1new..., https://evidence...`}
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="text-xs text-zinc-500">
            One move per line: member address, new address and an optional evidence link, separated by commas, tabs
            or spaces.
          </p>
          {pasteProblems.length > 0 && (
            <ul className="space-y-0.5 text-xs text-red-400">
              {pasteProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={addPasted} disabled={!pasteText.trim()} className="sd-btn sd-btn-secondary">
            Add these moves
          </button>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        For members who lost their key and have no recovery code. One proposal can move up to {MAX_PROPOSAL_MESSAGES}{" "}
        memberships, decided by a single vote. It executes all or nothing: if the chain refuses one move, none of
        them start, so put a doubtful case in its own proposal. Once executed, each new address must accept, and each
        move happens after the committee delay. A member can object during that delay and a jury decides. A new
        address must be fresh: not a member, no names.
        {byGov &&
          " A chain proposal also settles an objection a jury could not decide: enter the same member and new address as the objected move, and passing it rejects the objection."}
      </p>
    </div>
  );
}
