// A batch of committee membership moves (x/rep MsgForceMigration) filed as one
// x/commons proposal. A proposal runs its messages all or nothing: one row the
// chain refuses reverts every move in it, so the form checks what it can before
// the proposal is submitted. This file is the part with no chain reads.

import { fromBech32 } from "@cosmjs/encoding";

/** x/commons MaxProposalMessages (x/commons/keeper/proposal_queue.go). */
export const MAX_PROPOSAL_MESSAGES = 20;

export interface ForceRow {
  /** The member's current (lost) address. */
  member: string;
  newAddress: string;
  /** Link to the off-chain evidence for this member; optional on chain. */
  evidence: string;
}

export const emptyForceRow = (): ForceRow => ({ member: "", newAddress: "", evidence: "" });

/** Trimmed, with addresses lowercased (bech32 is valid in either single case). */
export function normalizeForceRow(row: ForceRow): ForceRow {
  return {
    member: row.member.trim().toLowerCase(),
    newAddress: row.newAddress.trim().toLowerCase(),
    evidence: row.evidence.trim(),
  };
}

export function isBlankForceRow(row: ForceRow): boolean {
  return !row.member.trim() && !row.newAddress.trim() && !row.evidence.trim();
}

/** The rows that become messages: normalized, untouched rows dropped. */
export function filledForceRows(rows: ForceRow[]): ForceRow[] {
  return rows.filter((r) => !isBlankForceRow(r)).map(normalizeForceRow);
}

function isAccountAddress(value: string, prefix: string): boolean {
  try {
    const decoded = fromBech32(value);
    return decoded.prefix === prefix && (decoded.data.length === 20 || decoded.data.length === 32);
  } catch {
    return false;
  }
}

/**
 * What is wrong with each row, by index into `rows` (an untouched row has
 * none). Covers what the chain would refuse and one row can tell from the
 * others: a member or a new address used twice, and an address on both sides.
 */
export function forceRowProblems(rows: ForceRow[], prefix: string): string[][] {
  const norm = rows.map(normalizeForceRow);
  const memberRows = new Map<string, number[]>();
  const targetRows = new Map<string, number[]>();
  norm.forEach((r, i) => {
    if (r.member) memberRows.set(r.member, [...(memberRows.get(r.member) ?? []), i]);
    if (r.newAddress) targetRows.set(r.newAddress, [...(targetRows.get(r.newAddress) ?? []), i]);
  });
  const others = (list: number[] | undefined, self: number) =>
    (list ?? []).filter((i) => i !== self).map((i) => i + 1);
  const rowList = (ns: number[]) => `row${ns.length > 1 ? "s" : ""} ${ns.join(", ")}`;

  return norm.map((r, i) => {
    if (isBlankForceRow(rows[i])) return [];
    const out: string[] = [];
    if (!r.member) out.push("Enter the member's address.");
    else if (!isAccountAddress(r.member, prefix)) out.push("The member address is not a valid address on this chain.");
    if (!r.newAddress) out.push("Enter the new address.");
    else if (!isAccountAddress(r.newAddress, prefix)) out.push("The new address is not a valid address on this chain.");
    if (r.member && r.member === r.newAddress) {
      out.push("The new address must differ from the member's address.");
      return out;
    }
    const sameMember = others(memberRows.get(r.member), i);
    if (r.member && sameMember.length > 0) out.push(`This member is also in ${rowList(sameMember)}.`);
    const sameTarget = others(targetRows.get(r.newAddress), i);
    if (r.newAddress && sameTarget.length > 0) out.push(`This new address is also used in ${rowList(sameTarget)}.`);
    const targetIsMember = others(memberRows.get(r.newAddress), i);
    if (r.newAddress && targetIsMember.length > 0) {
      out.push(`The new address is the member being moved in ${rowList(targetIsMember)}.`);
    }
    const memberIsTarget = others(targetRows.get(r.member), i);
    if (r.member && memberIsTarget.length > 0) {
      out.push(`This member's address is the new address in ${rowList(memberIsTarget)}.`);
    }
    return out;
  });
}

/**
 * Rows from pasted text, one move per line: member, new address and an
 * optional evidence link, separated by commas, tabs or spaces. Blank lines and
 * lines starting with # are skipped. A line without two fields is reported.
 */
export function parseForceRows(text: string): { rows: ForceRow[]; problems: string[] } {
  const rows: ForceRow[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sep = line.includes("\t") ? /\t+/ : line.includes(",") ? /\s*,\s*/ : /\s+/;
    const parts = line.split(sep).map((p) => p.trim());
    const [member, newAddress] = parts;
    if (!member || !newAddress) {
      problems.push(`Line ${i + 1} needs a member address and a new address.`);
      return;
    }
    // An evidence link may itself contain the separator (a comma in a URL).
    const joiner = line.includes("\t") ? "\t" : line.includes(",") ? "," : " ";
    rows.push(normalizeForceRow({ member, newAddress, evidence: parts.slice(2).join(joiner) }));
  });
  return { rows, problems };
}

/** The default proposal description for a batch. */
export function forceBatchSummary(rows: ForceRow[], short: (address: string) => string): string {
  if (rows.length === 1) return `Move membership ${short(rows[0].member)} to ${short(rows[0].newAddress)}`;
  return `Move ${rows.length} memberships to new addresses`;
}
