// Client-side view of x/rep member key migration rules (x/rep/keeper/migration.go).
// The chain is the authority; these mirror the checks the UI can make up front
// so a request that will be refused says why before the wallet pops up.

import { getRepCanonical, getRepMember, getRepPendingMigration, getRepPendingMigrationByTarget } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import type { MemberMigration, RepMember, RepMigrationParams } from "@/types/rep";
import { MigrationPath, MigrationStatus } from "@/types/rep";

/** Compiled constants of x/rep/types/migration.go. */
export const MAX_RECENT_ALIASES = 8;
export const ALIAS_RECOVERY_RESERVE = 2;
export const MAX_LIFETIME_ALIASES = 64;

export interface MigrationParams {
  migrationEnabled: boolean;
  keyPathEnabled: boolean;
  keyDelay: number;
  recoveryDelay: number;
  councilDelay: number;
  acceptWindow: number;
  cooldown: number;
  maxKeyPerWindow: number;
  keyWindow: number;
  recoveryChangeDelay: number;
  /** Blocks. */
  revealMinBlocks: number;
  commitTtl: number;
  /** uspark. */
  commitDeposit: string;
  /** uspark. */
  objectionBond: string;
  /** Epochs. */
  zkActivationDelay: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
};

/** The migration slice of the rep params (RepParamsResponse.params). */
export function readMigrationParams(params: Record<string, unknown> | null | undefined): MigrationParams {
  const p = (params ?? {}) as RepMigrationParams;
  return {
    migrationEnabled: !!p.migration_enabled,
    keyPathEnabled: !!p.key_path_enabled,
    keyDelay: num(p.key_migration_delay),
    recoveryDelay: num(p.recovery_migration_delay),
    councilDelay: num(p.council_migration_delay),
    acceptWindow: num(p.migration_accept_window),
    cooldown: num(p.migration_cooldown),
    maxKeyPerWindow: num(p.max_key_migrations_per_window),
    keyWindow: num(p.key_migration_window),
    recoveryChangeDelay: num(p.recovery_change_delay),
    revealMinBlocks: num(p.recovery_reveal_min_blocks),
    commitTtl: num(p.recovery_commit_ttl),
    commitDeposit: String(p.recovery_commit_deposit ?? "0"),
    objectionBond: String(p.migration_objection_bond ?? "0"),
    zkActivationDelay: num(p.zk_key_activation_delay),
  };
}

/** The finalization delay that starts when the new address accepts. */
export function pathDelay(params: MigrationParams, path?: string): number {
  if (path === MigrationPath.RECOVERY) return params.recoveryDelay;
  if (path === MigrationPath.COUNCIL) return params.councilDelay;
  return params.keyDelay;
}

/** Unix seconds by which the new address must accept a REQUESTED migration. */
export function acceptDeadline(m: MemberMigration, params: MigrationParams): number {
  return num(m.requested_at) + params.acceptWindow;
}

/**
 * Why the chain would refuse a KEY-path request from this member right now,
 * or [] when nothing checkable stands in the way. Mirrors RequestKeyMigration
 * and checkAliasCaps; the open-report check and the new address's freshness
 * are only known to the chain (freshness is checked separately).
 */
export function keyRequestBlockers(
  params: MigrationParams,
  member: RepMember | null,
  aliases: { all: number; recent: number },
  now: number,
): string[] {
  const out: string[] = [];
  if (!params.migrationEnabled) out.push("Member migration is switched off on this chain.");
  else if (!params.keyPathEnabled)
    out.push("Key changes are switched off by governance. Recovery and committee migrations still work.");
  if (!member) {
    out.push("Only members can move their membership.");
    return out;
  }
  if (member.status === "MEMBER_STATUS_ZEROED") out.push("A zeroed membership can't be moved.");
  const last = num(member.last_migrated_at);
  if (last > 0 && now < last + params.cooldown) {
    out.push(`Your last move was recent. The next key change opens on ${new Date((last + params.cooldown) * 1000).toLocaleDateString()}.`);
  }
  const inWindow = (member.key_migration_times ?? []).filter((t) => num(t) > now - params.keyWindow).length;
  if (params.maxKeyPerWindow > 0 && inWindow >= params.maxKeyPerWindow) {
    out.push(`You've used all ${params.maxKeyPerWindow} key changes allowed in the rolling window.`);
  }
  // The alias lists include the canonical address; the chain counts predecessors.
  const total = Math.max(0, aliases.all - 1);
  const recent = Math.max(0, aliases.recent - 1);
  if (total >= MAX_LIFETIME_ALIASES) out.push("This membership has reached its lifetime limit of address changes.");
  else if (recent >= MAX_RECENT_ALIASES - ALIAS_RECOVERY_RESERVE) {
    out.push("Too many recent address changes. The remaining slots are kept for recovery.");
  }
  return out;
}

/**
 * Why the chain would find `to` not fresh, as far as the public queries can
 * tell (keeper checkTargetFresh). Module-held identity (names, a season
 * profile, session grants it gave, federation links, an operator record) is
 * only checked by the chain's hooks, so a clean result here is not a promise.
 */
export async function freshnessProblems(from: string, to: string): Promise<string[]> {
  if (to === from) return ["The new address is the same as the old one."];
  const out: string[] = [];
  const [canon, member, pending] = await Promise.all([
    getRepCanonical(to).catch(() => null),
    getRepMember(to).catch(() => null),
    getRepPendingMigrationByTarget(to).catch(() => null),
  ]);
  if (canon?.tombstoned) out.push("That address is an old address of another membership.");
  else if (member?.member) out.push("That address is already a member.");
  if (pending) out.push("That address is already the target of another migration.");
  return out;
}

/**
 * Why the chain would refuse a committee move (MsgForceMigration) away from
 * `member`, as far as the public queries can tell (keeper checkMigrationSource
 * and the precedence rule of openMigration). A pending key change is not a
 * problem: the committee move supersedes it. A read that fails is skipped
 * rather than reported, so a flaky node never blames the member.
 */
export async function forceSourceProblems(member: string): Promise<string[]> {
  const [canon, found, pending] = await Promise.all([
    getRepCanonical(member).catch(() => null),
    getRepMember(member).then(
      (r) => r.member ?? null,
      (err) => (err instanceof ApiError && err.status === 404 ? null : undefined),
    ),
    getRepPendingMigration(member).catch(() => null),
  ]);
  const out: string[] = [];
  if (canon?.tombstoned) out.push("That membership has already moved to another address.");
  else if (found === null) out.push("That address is not a member.");
  else if (found?.status === "MEMBER_STATUS_ZEROED") out.push("A zeroed membership can't be moved.");
  if (pending && (pending.path === MigrationPath.COUNCIL || pending.path === MigrationPath.RECOVERY)) {
    const what = pending.path === MigrationPath.COUNCIL ? "committee move" : "recovery";
    out.push(`That member already has a pending ${what} (#${pending.id}).`);
  }
  return out;
}

/** An objection the jury left undecided, now waiting on x/gov (keeper isEscalatedObjection). */
export function isEscalatedObjection(m: MemberMigration): boolean {
  return m.status === MigrationStatus.OBJECTED && !!m.escalated_until && m.escalated_until !== "0";
}

export interface ForceMoveCheck {
  problems: string[];
  /**
   * Id of the escalated migration this move would decide. Signed by x/gov for
   * the same member and new address, MsgForceMigration rejects the objection
   * (the move finalizes, the bond goes to the new address) instead of opening
   * a new migration.
   */
  rulesOn?: string;
}

/**
 * Chain-side check of one forced move. Only x/gov decides an escalated
 * objection, so with `byGov` a row matching one is a ruling, not a new move,
 * and the checks for opening a migration do not apply to it.
 */
export async function forceMoveCheck(member: string, newAddress: string, byGov: boolean): Promise<ForceMoveCheck> {
  if (byGov) {
    const pending = await getRepPendingMigration(member).catch(() => null);
    if (pending && isEscalatedObjection(pending)) {
      if (pending.to_address === newAddress) return { problems: [], rulesOn: pending.id };
      return {
        problems: [
          `Migration #${pending.id} of this member to ${pending.to_address} is waiting on a governance decision. Enter that new address to reject the objection. Another target needs that migration cancelled first.`,
        ],
      };
    }
  }
  const [source, target] = await Promise.all([forceSourceProblems(member), freshnessProblems(member, newAddress)]);
  return { problems: [...source, ...target] };
}
