/* eslint-disable @typescript-eslint/no-explicit-any */
// Capture a complete, read-only snapshot of the current LCD state into
// public/archive/<snapshotId>/. The /archive route tree reads these files
// instead of hitting a live LCD so we can browse past testnets after a reset.
//
// Run via: npm run snapshot:capture -- --lcd <url> [--label <slug>]
//                                       [--resume] [--force] [--out <dir>]
//
// The script monkey-patches globalThis.fetch so every LCD response that api.ts
// fetches is written to disk at the same path it would be served from in
// archive mode. The only thing the script has to spell out is which functions
// to call — never paths.

import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { argv, env, exit, cwd } from "node:process";

interface Args {
  lcd?: string;
  label?: string;
  out?: string;
  id?: string;
  resume: boolean;
  force: boolean;
}

function parseArgs(): Args {
  const a: Args = { resume: false, force: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--lcd") a.lcd = next();
    else if (t === "--label") a.label = next();
    else if (t === "--out") a.out = next();
    else if (t === "--id") a.id = next();
    else if (t === "--resume") a.resume = true;
    else if (t === "--force") a.force = true;
    else if (t === "--help" || t === "-h") {
      console.log(
        "snapshot-chain --lcd <url> [--label <slug>] [--id <override>]\n" +
          "               [--out public/archive] [--resume] [--force]",
      );
      exit(0);
    } else {
      console.error(`Unknown arg: ${t}`);
      exit(2);
    }
  }
  return a;
}

const args = parseArgs();
if (args.lcd) env.NEXT_PUBLIC_LCD_ENDPOINT = args.lcd;
const LCD = args.lcd ?? env.NEXT_PUBLIC_LCD_ENDPOINT ?? "https://api-test.sparkdream.io";
const OUT_BASE = args.out ?? join(cwd(), "public", "archive");

// ---------------------------------------------------------------------------
// fetch interceptor — records every successful LCD response to disk

let snapshotDir = "";
let lastLcdPath: string | null = null;
let lastLcdQs: string | null = null;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Apply the patch BEFORE importing api.ts so every fetch goes through us.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (!url.startsWith(LCD)) return originalFetch(input, init);

  const rest = url.slice(LCD.length);
  const qi = rest.indexOf("?");
  const lcdPath = qi >= 0 ? rest.slice(0, qi) : rest;
  const lcdQs = qi >= 0 ? rest.slice(qi + 1) : null;
  lastLcdPath = lcdPath;
  lastLcdQs = lcdQs;

  if (args.resume && snapshotDir) {
    const dest = join(snapshotDir, "lcd", archiveKey(lcdPath, lcdQs));
    if (await fileExists(dest)) {
      const body = await readFile(dest, "utf8");
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
  }
  const res = await originalFetch(input, init);
  if (res.ok && snapshotDir) {
    try {
      const clone = res.clone();
      const body = await clone.text();
      const dest = join(snapshotDir, "lcd", archiveKey(lcdPath, lcdQs));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, body);
    } catch (err) {
      console.warn(`  [warn] interceptor write failed for ${lcdPath}:`, err);
    }
  }
  return res;
};

// Local mirror of archiveKey so we don't have to round-trip through api.ts
// just to compute file paths. Must stay in sync with src/lib/api.ts.
function archiveKey(path: string, qs: string | null): string {
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  if (!qs) return `${trimmed}.json`;
  const stripped = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(qs)) {
    if (!k.startsWith("pagination.")) stripped.append(k, v);
  }
  stripped.sort();
  const remaining = stripped.toString();
  if (!remaining) return `${trimmed}.json`;
  return `${trimmed}__qs__${encodeURIComponent(remaining)}.json`;
}

// Import api.ts AFTER setting the env and the interceptor.
const api = await import("../src/lib/api");

// ---------------------------------------------------------------------------
// Helpers

async function writeIndex(name: string, body: unknown): Promise<void> {
  const dest = join(snapshotDir, "index", `${name}.json`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(body));
}

// Write the merged paginated response at the same key the archive UI will
// look up — preserving non-pagination qs (e.g. listReactions's reply_id) so
// the merged file overrides the per-page intercept writes that share the key.
async function writeMergedAtLastPath(merged: unknown): Promise<void> {
  if (!lastLcdPath) return;
  const dest = join(snapshotDir, "lcd", archiveKey(lastLcdPath, lastLcdQs));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(merged));
}

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    console.warn(`  [skip] ${label}: ${err?.message ?? err}`);
    return null;
  }
}

async function attemptList<T extends Record<string, any>>(
  label: string,
  listFn: (req?: any) => Promise<T>,
  itemsKey: keyof T,
): Promise<T | null> {
  let merged: any = null;
  let key: string | undefined = undefined;
  for (let i = 0; i < 200; i++) {
    let page: T;
    try {
      page = await listFn({ key, limit: "1000", countTotal: true });
    } catch (err: any) {
      if (i === 0) {
        console.warn(`  [skip] ${label}: ${err?.message ?? "endpoint unsupported"}`);
        return null;
      }
      console.warn(`  [warn] ${label} pagination stopped: ${err?.message ?? err}`);
      break;
    }
    const pageItems = (page as any)[itemsKey];
    if (pageItems !== undefined && !Array.isArray(pageItems)) {
      console.warn(
        `  [skip] ${label}: response field "${String(itemsKey)}" is not an array — wrong items-key?`,
      );
      return null;
    }
    if (!merged) {
      merged = page;
      if (pageItems === undefined) (merged as any)[itemsKey] = [];
    } else {
      (merged as any)[itemsKey] = [
        ...((merged[itemsKey] as any[]) ?? []),
        ...((pageItems as any[]) ?? []),
      ];
    }
    const nextKey = (page as any).pagination?.next_key;
    if (!nextKey) break;
    key = nextKey;
  }
  if (!merged) return null;
  if (merged.pagination) {
    merged.pagination.next_key = "";
    merged.pagination.total = String(((merged[itemsKey] as any[]) ?? []).length);
  }
  await writeMergedAtLastPath(merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Manifest

interface ManifestEntry {
  id: string;
  chainId: string;
  capturedAtIso: string;
  capturedHeight: string;
  label?: string;
  location: "local" | "remote";
  remoteBase?: string;
}

async function appendManifest(entry: ManifestEntry): Promise<void> {
  const path = join(OUT_BASE, "manifests.json");
  let current: { snapshots: ManifestEntry[] } = { snapshots: [] };
  if (await fileExists(path)) {
    try {
      current = JSON.parse(await readFile(path, "utf8"));
    } catch {
      // ignore; rewrite cleanly
    }
  }
  // Drop any local entries whose snapshot directory was deleted manually so
  // manifests.json stays in sync with what's actually on disk. Remote
  // entries are passed through untouched.
  const reconciled: ManifestEntry[] = [];
  for (const s of current.snapshots) {
    if (s.id === entry.id) continue;
    if (s.location === "remote") {
      reconciled.push(s);
      continue;
    }
    if (await fileExists(join(OUT_BASE, s.id, "manifest.json"))) {
      reconciled.push(s);
    }
  }
  reconciled.push(entry);
  reconciled.sort((a, b) => b.capturedAtIso.localeCompare(a.capturedAtIso));
  await mkdir(OUT_BASE, { recursive: true });
  await writeFile(path, JSON.stringify({ snapshots: reconciled }, null, 2));
}

// ---------------------------------------------------------------------------
// Phases

async function phase0Meta(): Promise<void> {
  console.log("Phase 0 — meta");
  await attempt("blog params", () => api.getParams());
  await attempt("commons params", () => api.getCommonsParams());
  await attempt("session params", () => api.getSessionParams());
  await attempt("session allowed-msg-types", () => api.getAllowedMsgTypes());
  await attempt("gov params (tallying)", () => api.getGovParams());
  await attempt("gov params (deposit)", () => api.getGovDepositParams());
  await attempt("rep params", () => api.getRepParams());
  await attempt("collect params", () => api.getCollectParams());
  await attempt("name params", () => api.getNameParams());
  await attempt("forum params", () => api.getForumParams());
  await attempt("season params", () => api.getSeasonParams());
  await attempt("reveal params", () => api.getRevealParams());
  await attempt("futarchy params", () => api.getFutarchyParams());
  await attempt("staking params", () => api.getStakingParams());
  await attempt("staking pool", () => api.getStakingPool());
  await attempt("current upgrade plan", () => api.getCurrentUpgradePlan());
  await attempt("forum status", () => api.getForumStatus());
  await attempt("current season", () => api.getCurrentSeason());
  // collectTags composes from rep projects+initiatives — no LCD endpoint of its own.
}

async function phase1Identities(): Promise<void> {
  console.log("Phase 1 — identity + names");
  const groups = await attemptList("groups", () => api.listGroups(), "group" as any);
  const members = new Set<string>();
  if (groups && Array.isArray((groups as any).group)) {
    for (const g of (groups as any).group) {
      const policyId = g.index ?? g.id ?? g.group_id;
      const cm = await attempt(
        `council members ${policyId}`,
        () => api.getCouncilMembers(policyId),
      );
      if (cm && Array.isArray((cm as any).members)) {
        for (const m of (cm as any).members) members.add(m.address);
      }
      await attempt(
        `policy permissions ${policyId}`,
        () => api.getPolicyPermissions(policyId),
      );
    }
  }
  const repMembers = await attemptList("rep members", () => api.listRepMembers(), "member" as any);
  if (repMembers && Array.isArray((repMembers as any).member)) {
    for (const m of (repMembers as any).member) members.add(m.address);
  }
  for (const addr of members) {
    await attempt(`owner info ${addr}`, () => api.getOwnerInfo(addr));
    await attempt(`names by owner ${addr}`, () => api.listNamesByOwner(addr));
    await attempt(`reverse resolve ${addr}`, () => api.reverseResolveName(addr));
    await attempt(`member profile ${addr}`, () => api.getMemberProfile(addr));
    await attempt(`rep member ${addr}`, () => api.getRepMember(addr));
  }
  await writeIndex("members", [...members].sort());
}

interface DiscoveredIds {
  postIds: string[];
  collectionIds: string[];
  forumPostIds: string[];
  forumThreadIds: string[];
  categoryIds: string[];
  govProposalIds: string[];
  commonsProposalIds: string[];
  guildIds: string[];
  marketIds: string[];
  tagBudgetIds: string[];
}

async function phase2Lists(): Promise<DiscoveredIds> {
  console.log("Phase 2 — top-level lists");
  const out: DiscoveredIds = {
    postIds: [],
    collectionIds: [],
    forumPostIds: [],
    forumThreadIds: [],
    categoryIds: [],
    govProposalIds: [],
    commonsProposalIds: [],
    guildIds: [],
    marketIds: [],
    tagBudgetIds: [],
  };

  const posts = await attemptList("blog posts", () => api.listPosts(), "post" as any);
  if (posts) {
    out.postIds = ((posts as any).post as any[]).map((p) => String(p.id));
  }

  const collections = await attemptList(
    "public collections",
    () => api.listPublicCollections(),
    "collections" as any,
  );
  if (collections) {
    out.collectionIds = ((collections as any).collections as any[]).map((c) => String(c.id));
  }

  const forumPosts = await attemptList("forum posts", () => api.listForumPosts(), "post" as any);
  if (forumPosts) {
    const items = ((forumPosts as any).post ?? []) as any[];
    out.forumPostIds = items.map((p) => String(p.post_id));
    // Thread roots: post_id === root_id (or root_id missing/zero, parent_id "0").
    out.forumThreadIds = items
      .filter(
        (p) => !p.root_id || p.root_id === "0" || p.root_id === p.post_id || !p.parent_id || p.parent_id === "0",
      )
      .map((p) => String(p.post_id));
  }

  const categories = await attemptList("forum categories", () => api.listCategories(), "Category" as any);
  if (categories) {
    const items = ((categories as any).Category ?? (categories as any).category ?? []) as any[];
    out.categoryIds = items.map((c) => String(c.id));
  }

  await attemptList("locked threads", () => api.getLockedThreads(), "threads" as any);
  await attemptList("forum bounties", () => api.listForumBounties(), "bounty" as any);

  const tagBudgets = await attemptList("tag budgets", () => api.listTagBudgets(), "tag_budget" as any);
  if (tagBudgets) {
    const items = ((tagBudgets as any).tag_budget ?? []) as any[];
    out.tagBudgetIds = items.map((t) => String(t.id));
  }
  await attemptList("hide records", () => api.listHideRecords(), "hide_record" as any);

  const govProposals = await attemptList(
    "gov proposals",
    () => api.listGovProposals(),
    "proposals" as any,
  );
  if (govProposals) {
    out.govProposalIds = ((govProposals as any).proposals as any[]).map((p) => String(p.id));
  }

  const commonsProposals = await attemptList(
    "commons proposals",
    () => api.listProposals(),
    "proposals" as any,
  );
  if (commonsProposals) {
    out.commonsProposalIds = ((commonsProposals as any).proposals as any[]).map((p) => String(p.id));
  }

  await attemptList("rep projects", () => api.listRepProjects(), "project" as any);
  await attemptList("rep initiatives", () => api.listRepInitiatives(), "initiative" as any);
  await attemptList("available initiatives", () => api.availableInitiatives(), "initiative" as any);
  await attemptList("rep invitations", () => api.listRepInvitations(), "invitation" as any);
  await attemptList("rep tags", () => api.listTags(), "tag" as any);

  const guilds = await attemptList("guilds", () => api.listGuilds(), "guild" as any);
  if (guilds) {
    out.guildIds = ((guilds as any).guild as any[]).map((g) => String(g.id));
  }

  await attemptList("achievements", () => api.listAchievements(), "achievements" as any);
  await attemptList("titles", () => api.listTitles(), "titles" as any);
  await attemptList("quests", () => api.listQuests(), "quest" as any);
  await attemptList("nominations", () => api.listNominations(), "nominations" as any);
  await attemptList("guild memberships", () => api.listGuildMemberships(), "guild_membership" as any);
  await attemptList("guild invites", () => api.listGuildInvites(), "guild_invite" as any);
  await attemptList(
    "sponsorship requests",
    () => api.listSponsorshipRequests(),
    "sponsorship_requests" as any,
  );
  await attemptList("contributions", () => api.listContributions(), "contributions" as any);

  const markets = await attemptList(
    "futarchy markets",
    () => api.listFutarchyMarkets(),
    "market" as any,
  );
  if (markets) {
    out.marketIds = ((markets as any).market as any[]).map((m) => String(m.index ?? m.id));
  }

  await attempt("all validators", () => api.listAllValidators(""));

  await attemptList("federation peers", () => api.listFederationPeers(), "peers" as any);
  await attemptList(
    "federation bridge operators",
    () => api.listFederationBridgeOperators(),
    "operators" as any,
  );
  await attemptList("federated content", () => api.listFederatedContent(), "content" as any);
  await attemptList(
    "federation identity links",
    () => api.listFederationIdentityLinks(),
    "links" as any,
  );

  await attemptList("name disputes", () => api.listDisputes(), "dispute" as any);

  return out;
}

async function phase3FanOut(ids: DiscoveredIds): Promise<void> {
  console.log("Phase 3 — per-parent fan-out");

  for (const id of ids.postIds) {
    await attempt(`post ${id}`, () => api.getPost(id));
    await attemptList(`replies for ${id}`, () => api.listReplies(id), "replies" as any);
    await attempt(`reaction counts ${id}`, () => api.getReactionCounts(id));
    await attemptList(`reactions for ${id}`, () => api.listReactions(id), "reactions" as any);
    await attempt(`post flags ${id}`, () => api.getPostFlags(id));
  }

  for (const id of ids.collectionIds) {
    await attempt(`collection ${id}`, () => api.getCollection(id));
    await attemptList(`collection items ${id}`, () => api.listCollectionItems(id), "items" as any);
    await attemptList(`collaborators ${id}`, () => api.getCollaborators(id), "collaborators" as any);
    await attempt(`collection conviction ${id}`, () => api.getCollectionConviction(id));
    await attempt(`curation summary ${id}`, () => api.getCurationSummary(id));
    await attemptList(`curation reviews ${id}`, () => api.listCurationReviews(id), "reviews" as any);
    await attempt(`endorsement ${id}`, () => api.getEndorsement(id));
  }

  for (const id of ids.forumPostIds) {
    await attempt(`forum post ${id}`, () => api.getForumPost(id));
  }
  for (const id of ids.forumThreadIds) {
    await attempt(`forum thread ${id}`, () => api.getForumThread(id));
    await attempt(`thread metadata ${id}`, () => api.getForumThreadMetadata(id));
    await attempt(`thread follow count ${id}`, () => api.getThreadFollowCount(id));
    await attemptList(`thread followers ${id}`, () => api.getThreadFollowers(id), "followers" as any);
    await attempt(`bounty by thread ${id}`, () => api.getBountyByThread(id));
  }
  for (const id of ids.categoryIds) {
    await attempt(`pinned posts cat ${id}`, () => api.getPinnedForumPosts(id));
  }

  for (const id of ids.govProposalIds) {
    await attempt(`gov proposal ${id}`, () => api.getGovProposal(id));
    await attemptList(`gov votes ${id}`, () => api.getGovProposalVotes(id), "votes" as any);
    await attempt(`gov tally ${id}`, () => api.getGovProposalTally(id));
    await attemptList(`gov deposits ${id}`, () => api.getGovProposalDeposits(id), "deposits" as any);
  }

  for (const id of ids.commonsProposalIds) {
    await attempt(`commons proposal ${id}`, () => api.getProposal(id));
  }

  for (const id of ids.guildIds) {
    await attempt(`guild ${id}`, () => api.getGuild(id));
  }

  for (const id of ids.marketIds) {
    await attempt(`futarchy market ${id}`, () => api.getFutarchyMarket(id));
    await attempt(`futarchy price ${id} YES`, () => api.getFutarchyMarketPrice(id, true));
    await attempt(`futarchy price ${id} NO`, () => api.getFutarchyMarketPrice(id, false));
  }

  for (const id of ids.tagBudgetIds) {
    await attempt(`tag budget ${id}`, () => api.getTagBudget(id));
    await attempt(`tag budget awards ${id}`, () => api.getTagBudgetAwards(id));
  }
}

async function phase4Indexes(ids: DiscoveredIds): Promise<void> {
  console.log("Phase 4 — emit indexes");
  await writeIndex("posts", ids.postIds);
  await writeIndex("collections", ids.collectionIds);
  await writeIndex("forum-posts", ids.forumPostIds);
  await writeIndex("forum-threads", ids.forumThreadIds);
  await writeIndex("forum-categories", ids.categoryIds);
  await writeIndex("gov-proposals", ids.govProposalIds);
  await writeIndex("commons-proposals", ids.commonsProposalIds);
  await writeIndex("guilds", ids.guildIds);
  await writeIndex("futarchy-markets", ids.marketIds);
  await writeIndex("tag-budgets", ids.tagBudgetIds);
}

// ---------------------------------------------------------------------------
// Main

async function main(): Promise<void> {
  console.log(`LCD: ${LCD}`);

  // Resolve chain-id + height via direct fetches (these go through the
  // interceptor too, but we can't use api.ts before snapshotDir is set).
  const nodeInfoRes = await originalFetch(`${LCD}/cosmos/base/tendermint/v1beta1/node_info`);
  const nodeInfo: any = await nodeInfoRes.json();
  const chainId: string = nodeInfo?.default_node_info?.network ?? "unknown";
  const heightRes = await originalFetch(`${LCD}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  const heightInfo: any = await heightRes.json();
  const height: string = heightInfo?.block?.header?.height ?? "0";

  const now = new Date();
  const stamp = now
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, "")
    .replace(/(\d{8})(\d{4})/, "$1-$2");
  const id = args.id ?? `${chainId}-${stamp}${args.label ? `-${args.label}` : ""}`;
  snapshotDir = join(OUT_BASE, id);

  if (!args.resume && !args.force && (await fileExists(snapshotDir))) {
    console.error(
      `Snapshot directory already exists: ${snapshotDir}\n` +
        `Pass --resume to continue an interrupted run or --force to overwrite.`,
    );
    exit(1);
  }
  await mkdir(snapshotDir, { recursive: true });
  console.log(`Snapshot id: ${id}`);
  console.log(`Output dir:  ${snapshotDir}`);

  await phase0Meta();
  await phase1Identities();
  const ids = await phase2Lists();
  await phase3FanOut(ids);
  await phase4Indexes(ids);

  const entry: ManifestEntry = {
    id,
    chainId,
    capturedAtIso: now.toISOString(),
    capturedHeight: height,
    label: args.label,
    location: "local",
  };
  await writeFile(join(snapshotDir, "manifest.json"), JSON.stringify(entry, null, 2));
  await appendManifest(entry);
  console.log(`\nDone. Snapshot ${id} written.`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
