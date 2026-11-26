// How the Status page judges the archive mirror (chain repo:
// deploy/docs/archival-strategy.md, "Off-Fleet Mirror"): the machine outside
// the deployment that copies every block from a public RPC endpoint into a
// vault each hour, and each week proves the vault is enough to rebuild the
// chain by replaying it. The permanent copy on Arweave is made from that
// vault.
//
// The mirror writes the result of its last sync and its last rebuild check
// to status.json and rebuild-status.json in the vault. This file judges
// those two documents; lib/siteStatus.ts reads them from wherever the
// mirror's operator publishes them (ARCHIVE_MIRROR_STATUS_URL).
//
// A run that fails before it has a result of its own republishes the last
// document with last_failed_at added; one that can't even publish leaves the
// old document in place, so age is part of the judgement too. The documents
// are the mirror's own account: free text in them is never shown.

import { formatAge, type ServiceFact, type ServiceReport } from "./serviceStatus";

/** status.json, as archive-mirror.sh writes it after a sync. */
export interface MirrorSync {
  finished_at?: string;
  chain_id?: string;
  chain_height?: number;
  /** Last block of the last complete range. */
  complete_to?: number;
  /** Last block held, the tail included. */
  tip?: number;
  lag_blocks?: number;
  archiver_ok?: boolean;
  vault_ok?: boolean;
  /** When a later sync failed before it had a result (no endpoint, a vault that doesn't verify). */
  last_failed_at?: string;
}

/** rebuild-status.json, as archive-mirror.sh writes it after a rebuild check. */
export interface MirrorRebuild {
  finished_at?: string;
  ok?: boolean;
  /** "full" replays from genesis, "checkpoint" from the last check that passed. */
  mode?: string;
  rebuilt_height?: number;
  /** "match", "MISMATCH" or "unavailable": the rebuilt app hash against the live chain's. */
  network_check?: string;
  /** When a later check failed before it had a result (a failed build, a vault that doesn't verify). */
  last_failed_at?: string;
}

export interface MirrorInput {
  chainId: string;
  sync: MirrorSync;
  /** Null when the mirror has published none: no rebuild check has run yet. */
  rebuild: MirrorRebuild | null;
  now: number;
}

// The sync runs hourly and the rebuild check weekly (setup-archive-mirror.sh
// defaults). Three missed runs of either is a mirror that has stopped.
export const SYNC_STALE_MS = 3 * 3_600_000;
export const REBUILD_STALE_MS = 21 * 86_400_000;

const n = (v: number) => v.toLocaleString("en-US");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function age(at: string | undefined, now: number): number | null {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** How long ago a run failed without a result, if that was after the result shown. */
function failedSince(doc: { finished_at?: string; last_failed_at?: string }, now: number): number | null {
  const failed = age(doc.last_failed_at, now);
  const finished = age(doc.finished_at, now);
  return failed !== null && (finished === null || failed < finished) ? failed : null;
}

export function assessMirror(input: MirrorInput): ServiceReport {
  const { sync, rebuild } = input;
  const issues: string[] = [];
  const facts: ServiceFact[] = [];

  if (sync.chain_id && sync.chain_id !== input.chainId) {
    issues.push(`The published status is for ${sync.chain_id}, not ${input.chainId}.`);
  }

  const synced = age(sync.finished_at, input.now);
  facts.push({ label: "Last sync", value: synced === null ? "Unknown" : `${formatAge(synced)} ago` });
  if (synced === null) {
    issues.push("The mirror's status doesn't say when it last synced.");
  } else if (synced > SYNC_STALE_MS) {
    issues.push(`The mirror hasn't finished a sync for ${formatAge(synced)}. It runs every hour.`);
  }
  const syncFailed = failedSince(sync, input.now);
  if (syncFailed !== null) {
    facts.push({ label: "Last sync attempt", value: `Failed ${formatAge(syncFailed)} ago` });
    issues.push(`A sync failed ${formatAge(syncFailed)} ago before it could fetch anything. What is shown is the last sync that finished.`);
  }
  if (sync.archiver_ok === false) issues.push("The last sync couldn't fetch the chain's new blocks.");
  if (sync.vault_ok === false) {
    issues.push("The last sync found the vault damaged or incomplete: a checksum that no longer matches, or a gap in the blocks.");
  }

  const tip = num(sync.tip);
  const complete = num(sync.complete_to);
  if (tip !== null) facts.push({ label: "Mirrored through block", value: n(tip) });
  if (complete !== null) facts.push({ label: "Complete ranges through", value: n(complete) });
  const lag = num(sync.lag_blocks);
  if (lag !== null) facts.push({ label: "Behind the chain", value: `${n(lag)} ${lag === 1 ? "block" : "blocks"} at the last sync` });

  if (!rebuild) {
    facts.push({ label: "Rebuild check", value: "Not run yet" });
  } else {
    const checked = age(rebuild.finished_at, input.now);
    const when = checked === null ? "" : ` ${formatAge(checked)} ago`;
    const through = num(rebuild.rebuilt_height);
    facts.push({
      label: "Rebuild check",
      value: `${rebuild.ok ? "Passed" : "Failed"}${when}${rebuild.ok && through !== null ? `, through block ${n(through)}` : ""}`,
    });
    if (rebuild.ok) {
      facts.push({
        label: "Rebuilt state",
        value:
          rebuild.network_check === "match"
            ? "Matches the chain"
            : "Not compared with the chain",
      });
    }
    const rebuildFailed = failedSince(rebuild, input.now);
    if (rebuildFailed !== null) {
      facts.push({ label: "Last rebuild attempt", value: `Failed ${formatAge(rebuildFailed)} ago` });
      issues.push(`A rebuild check failed ${formatAge(rebuildFailed)} ago before it could replay anything. What is shown is the last check that finished.`);
    }
    if (rebuild.network_check === "MISMATCH") {
      issues.push("The last rebuild check replayed the vault to a state that differs from the chain's.");
    } else if (!rebuild.ok) {
      issues.push("The last rebuild check failed, so the vault isn't proven to be enough to rebuild the chain.");
    } else if (checked !== null && checked > REBUILD_STALE_MS) {
      issues.push(`No rebuild check has finished for ${formatAge(checked)}. It runs every week.`);
    }
  }

  return { id: "mirror", state: issues.length ? "degraded" : "ok", issues, latency_ms: null, facts };
}
