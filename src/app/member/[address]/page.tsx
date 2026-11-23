"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getBankBalance,
  getDelegatorRewards,
  getForumPost,
  getGuild,
  getMemberProfile,
  getRepAliases,
  getRepMember,
  initiativesByAssignee,
  listDelegationsByDelegator,
  listStakingValidators,
  listTitles,
  stakesByStaker,
} from "@/lib/api";
import { loadNames, loadRoleBonds, orEmpty } from "@/lib/memberInfo";
import type { Names, RoleBond } from "@/lib/memberInfo";
import { formatDream } from "@/lib/reveal-fmt";
import { isAnonymousAddress } from "@/lib/shield";
import { decCoinToBaseDenom, formatSpark, formatTime, truncateAddress } from "@/lib/utils";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useDreamDenom } from "@/hooks/useDreamDenom";
import { useMyAliases } from "@/hooks/useMyAliases";
import CopyableAddress from "@/components/CopyableAddress";
import ErrorState from "@/components/ErrorState";
import MemberAvatar, { memberHref } from "@/components/MemberAvatar";
import type { Initiative, InitiativesByAssigneeResponse, RepMember, RepStake, StakesByStakerResponse } from "@/types/rep";
import {
  BONDED_ROLE_STATUS_LABELS,
  BondedRoleStatus,
  MEMBER_STATUS_LABELS,
  STAKE_TARGET_LABELS,
  StakeTargetType,
  TRUST_LEVEL_LABELS,
  TrustLevel,
} from "@/types/rep";
import type { MemberProfile } from "@/types/season";
import type { DelegationResponse } from "@/types/staking";

/** One independently loaded section: a failed read only blanks its own card. */
type Loaded<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; error: unknown };

const LOADING = { state: "loading" } as const;

function settle<T>(p: Promise<T>, set: (v: Loaded<T>) => void, live: () => boolean) {
  p.then(
    (data) => live() && set({ state: "ok", data }),
    (error) => live() && set({ state: "error", error }),
  );
}

const TRUST_COLORS: Record<string, string> = {
  [TrustLevel.CORE]: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  [TrustLevel.TRUSTED]: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  [TrustLevel.ESTABLISHED]: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  [TrustLevel.PROVISIONAL]: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

interface SeasonInfo {
  profile: MemberProfile;
  title: string | null;
  guild: string | null;
}

interface Delegations {
  /** `previous` marks a delegation still held at an address the member moved away from. */
  rows: (DelegationResponse & { previous: boolean; reward: bigint })[];
  /** Unclaimed staking rewards across `rows`, in the bond denom's base unit. */
  pendingRewards: bigint;
  monikers: Record<string, string>;
}

/** Stakes are read in full so they can be ranked and totalled, up to this many. */
const STAKE_PAGE = 100;
const STAKE_CAP = 500;
/** How many of the largest stakes show before the list is expanded. */
const STAKE_PREVIEW = 5;

interface Stakes {
  rows: RepStake[];
  /** The member has more stakes than STAKE_CAP: totals and ranking cover only `rows`. */
  partial: boolean;
}

async function loadStakes(address: string): Promise<Stakes> {
  const rows: RepStake[] = [];
  let key: string | null = null;
  for (let page = 0; page < STAKE_CAP / STAKE_PAGE; page++) {
    const req: { limit: string; key?: string } = key ? { limit: String(STAKE_PAGE), key } : { limit: String(STAKE_PAGE) };
    const res: StakesByStakerResponse | null = await orEmpty(stakesByStaker(address, req), null);
    rows.push(...(res?.stakes || []));
    key = res?.pagination?.next_key || null;
    if (!key) break;
  }
  return { rows, partial: !!key };
}

interface AssignmentBonds {
  /** Initiatives this member is assigned to that still hold a self-assign bond. */
  rows: Initiative[];
  /** More assignments exist than were read, so `rows` may be missing bonds. */
  partial: boolean;
}

// The chain zeroes self_assign_bond when it releases or burns the bond, so a
// positive amount means DREAM is locked right now, whatever the status.
async function loadAssignmentBonds(address: string): Promise<AssignmentBonds> {
  const rows: Initiative[] = [];
  let key: string | null = null;
  for (let page = 0; page < 5; page++) {
    const req: { limit: string; key?: string } = key ? { limit: "200", key } : { limit: "200" };
    const res: InitiativesByAssigneeResponse | null = await orEmpty(initiativesByAssignee(address, req), null);
    rows.push(...(res?.initiatives || []).filter((i) => /^[1-9]\d*$/.test(i.self_assign_bond || "")));
    key = res?.pagination?.next_key || null;
    if (!key) break;
  }
  return { rows, partial: !!key };
}

function stakeAmount(st: RepStake): bigint {
  return /^\d+$/.test(st.amount || "") ? BigInt(st.amount) : BigInt(0);
}

function bySize(a: RepStake, b: RepStake): number {
  const x = stakeAmount(a);
  const y = stakeAmount(b);
  return x === y ? 0 : x < y ? 1 : -1;
}

async function loadSeason(address: string): Promise<SeasonInfo | null> {
  const res = await orEmpty(getMemberProfile(address), null);
  const profile = res?.member_profile;
  if (!profile?.address) return null;
  // Title and guild names are decoration: fall back to the bare ids.
  const [titles, guild] = await Promise.all([
    profile.display_title ? listTitles({ limit: "200" }).catch(() => null) : null,
    profile.guild_id && profile.guild_id !== "0" ? getGuild(profile.guild_id).catch(() => null) : null,
  ]);
  return {
    profile,
    title: titles?.titles?.find((t) => t.title_id === profile.display_title)?.name ?? null,
    guild: guild?.guild?.name ?? null,
  };
}

// A key migration leaves delegations at the address the member moved away
// from (the old key still manages them), so the member's current address is
// read together with every earlier one.
async function loadDelegations(address: string, denom: string): Promise<Delegations> {
  const aliases = await getRepAliases(address).catch(() => null);
  const earlier = aliases?.canonical === address ? (aliases.addresses || []).filter((a) => a !== address) : [];
  const perHolder = await Promise.all(
    [address, ...earlier].map(async (holder) => {
      const [res, rewards] = await Promise.all([
        orEmpty(listDelegationsByDelegator(holder, { limit: "200" }), null),
        // Rewards are a nicety: a failed read shows the delegations without them.
        getDelegatorRewards(holder).catch(() => null),
      ]);
      const rewardBy = new Map<string, bigint>();
      for (const r of rewards?.rewards || []) {
        rewardBy.set(r.validator_address, decCoinToBaseDenom(r.reward?.find((c) => c.denom === denom)?.amount));
      }
      return (res?.delegation_responses || [])
        .filter((d) => d.balance?.amount && d.balance.amount !== "0")
        .map((d) => ({
          ...d,
          previous: holder !== address,
          reward: rewardBy.get(d.delegation.validator_address) ?? BigInt(0),
        }));
    }),
  );
  const rows = perHolder.flat();
  const monikers: Record<string, string> = {};
  if (rows.length > 0) {
    const validators = await listStakingValidators("", { limit: "500" }).catch(() => null);
    for (const v of validators?.validators || []) monikers[v.operator_address] = v.description?.moniker || "";
  }
  return { rows, monikers, pendingRewards: rows.reduce((sum, r) => sum + r.reward, BigInt(0)) };
}

export default function MemberPage() {
  const params = useParams();
  const address = decodeURIComponent((params.address as string) || "");
  const { config, ready } = useChainConfig();

  const valid = new RegExp(`^${config.bech32Prefix}1[02-9ac-hj-np-z]{38,58}$`).test(address);

  if (!ready) {
    return (
      <div className="sd-page">
        <div className="h-32 animate-pulse rounded-xl sd-hull-tile" />
      </div>
    );
  }

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <h1>Member</h1>
        <p>Balances, names, staking positions and reputation</p>
      </header>
      {isAnonymousAddress(address) ? (
        <Notice title="Anonymous" body="Anonymous content is posted through a shared account, so there is no member profile behind it." />
      ) : !valid ? (
        <Notice title="Not a valid address" body={`Member pages are addressed by a ${config.bech32Prefix}1… account address.`} />
      ) : (
        <MemberView key={address} address={address} />
      )}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl sd-hull-tile p-12 text-center">
      <p className="text-zinc-300">{title}</p>
      <p className="mt-1 text-xs text-zinc-500">{body}</p>
    </div>
  );
}

function MemberView({ address }: { address: string }) {
  const { config } = useChainConfig();
  const dream = useDreamDenom();
  const spark = config.displayDenom;
  const { isMine } = useMyAliases();
  const { name: resolvedName } = useDisplayName(address);

  const [member, setMember] = useState<Loaded<RepMember | null>>(LOADING);
  const [season, setSeason] = useState<Loaded<SeasonInfo | null>>(LOADING);
  const [liquidSpark, setLiquidSpark] = useState<Loaded<string>>(LOADING);
  const [delegations, setDelegations] = useState<Loaded<Delegations>>(LOADING);
  const [stakes, setStakes] = useState<Loaded<Stakes>>(LOADING);
  const [names, setNames] = useState<Loaded<Names>>(LOADING);
  const [roleBonds, setRoleBonds] = useState<Loaded<RoleBond[]>>(LOADING);
  const [assignBonds, setAssignBonds] = useState<Loaded<AssignmentBonds>>(LOADING);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const live = () => alive;
    settle(
      orEmpty(getRepMember(address), null).then((res) => (res?.member?.address ? res.member : null)),
      setMember,
      live,
    );
    settle(loadSeason(address), setSeason, live);
    settle(
      getBankBalance(address, config.denom).then((res) => res.balance?.amount ?? "0"),
      setLiquidSpark,
      live,
    );
    settle(loadDelegations(address, config.denom), setDelegations, live);
    settle(loadNames(address), setNames, live);
    settle(loadRoleBonds(address), setRoleBonds, live);
    settle(loadAssignmentBonds(address), setAssignBonds, live);
    settle(loadStakes(address), setStakes, live);
    return () => {
      alive = false;
    };
  }, [address, config.denom, nonce]);

  const retry = useCallback(() => {
    setMember(LOADING);
    setSeason(LOADING);
    setLiquidSpark(LOADING);
    setDelegations(LOADING);
    setStakes(LOADING);
    setNames(LOADING);
    setRoleBonds(LOADING);
    setAssignBonds(LOADING);
    setNonce((n) => n + 1);
  }, []);

  // Nothing at all could be read: one error with a retry, not five.
  if (member.state === "error" && liquidSpark.state === "error") {
    return <ErrorState error={member.error} onRetry={retry} />;
  }

  const m = member.state === "ok" ? member.data : null;
  const s = season.state === "ok" ? season.data : null;
  const mine = isMine(address);
  // The chain answers an address the member moved away from with the moved record.
  const movedTo = m && m.address !== address ? m.address : null;

  const displayName = s?.profile.display_name || resolvedName || (s?.profile.username ? `@${s.profile.username}` : "");
  const delegated =
    delegations.state === "ok"
      ? delegations.data.rows.reduce((sum, d) => sum + BigInt(d.balance.amount), BigInt(0)).toString()
      : null;
  // Staked DREAM the lists below do not account for. Only known once every
  // list is read in full; other modules lock DREAM too (invitations,
  // nominations, challenges, reports) and have no per-member listing.
  let otherLocked: bigint | null = null;
  if (
    m &&
    stakes.state === "ok" &&
    !stakes.data.partial &&
    roleBonds.state === "ok" &&
    assignBonds.state === "ok" &&
    !assignBonds.data.partial &&
    /^\d+$/.test(m.staked_dream || "")
  ) {
    const listed =
      stakes.data.rows.reduce((sum, st) => sum + BigInt(st.amount || "0"), BigInt(0)) +
      roleBonds.data.reduce((sum, r) => sum + BigInt(r.role.current_bond), BigInt(0)) +
      assignBonds.data.rows.reduce((sum, i) => sum + BigInt(i.self_assign_bond || "0"), BigInt(0));
    const rest = BigInt(m.staked_dream) - listed;
    otherLocked = rest > BigInt(0) ? rest : null;
  }
  const repTags = Object.entries(m?.reputation_scores || {});

  return (
    <div className="space-y-4">
      {movedTo && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-900/10 p-4 text-sm text-amber-300">
          This membership moved to a new address. {dream} and reputation below belong to{" "}
          <Link href={memberHref(movedTo)} className="font-mono underline">
            {truncateAddress(movedTo)}
          </Link>
          .
        </div>
      )}

      {/* Identity */}
      <div className="rounded-xl sd-hull-tile p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <MemberAvatar address={address} size="lg" noLink />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-white">{displayName || "Unnamed"}</p>
              {s?.profile.username && displayName !== `@${s.profile.username}` && (
                <p className="text-xs text-zinc-500">@{s.profile.username}</p>
              )}
              {s?.title && (
                <p className="text-xs" style={{ color: "var(--violet-hi)" }}>
                  ◆ {s.title}
                </p>
              )}
              <CopyableAddress
                className="mt-0.5 font-mono text-xs text-zinc-400"
                address={address}
                prefixLen={14}
                suffixLen={6}
                style={{ display: "block" }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {member.state === "loading" ? null : m ? (
              <>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    TRUST_COLORS[m.trust_level] || "bg-zinc-800/50 text-zinc-400 border-zinc-700"
                  }`}
                >
                  {TRUST_LEVEL_LABELS[m.trust_level] || m.trust_level}
                </span>
                <span className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-xs text-zinc-400">
                  {MEMBER_STATUS_LABELS[m.status] || m.status}
                </span>
              </>
            ) : member.state === "ok" ? (
              <span className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-xs text-zinc-400">
                Not a member
              </span>
            ) : null}
          </div>
        </div>
        {mine && (
          <p className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
            This is you. Edit your name and title on{" "}
            <Link href="/season" className="text-indigo-400 hover:text-indigo-300">
              Season
            </Link>
            , and manage your stakes on{" "}
            <Link href="/contribute?view=staking" className="text-indigo-400 hover:text-indigo-300">
              Contribute
            </Link>
            .
          </p>
        )}
      </div>

      {/* Balances */}
      <div className="rounded-xl sd-hull-tile p-5">
        <h3 className="text-sm font-semibold text-zinc-200">Balances</h3>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label={`Liquid ${spark}`} value={amount(liquidSpark, (v) => formatSpark(v, { maxFractionDigits: 2 }))} />
          <Stat
            label={`Delegated ${spark}`}
            value={amount(delegations, () => formatSpark(delegated || "0", { maxFractionDigits: 2 }))}
          />
          <Stat label={`Liquid ${dream}`} value={amount(member, (v) => formatDream(v?.dream_balance))} />
          <Stat label={`Staked ${dream}`} value={amount(member, (v) => formatDream(v?.staked_dream))} />
        </div>
        {delegations.state === "ok" && delegations.data.pendingRewards > BigInt(0) && (
          <p className="mt-3 text-xs text-zinc-500">
            Plus {formatSpark(delegations.data.pendingRewards, { maxFractionDigits: 2 })} {spark} in unclaimed staking
            rewards.
          </p>
        )}
        {member.state === "ok" && !m && (
          <p className="mt-3 text-xs text-zinc-500">Only members hold {dream}. This address has not joined.</p>
        )}
      </div>

      {/* Names */}
      <Section title="Names" loaded={names} empty="No registered names">
        {(n) =>
          n.owned.length === 0 && n.pointed.length === 0 ? null : (
            <div className="space-y-2">
              {n.released && n.owned.length > 0 && (
                <p className="text-xs text-amber-400">These names were released and anyone can claim them.</p>
              )}
              {n.owned.map((nr) => (
                <div key={nr.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-zinc-800/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm text-zinc-200">{nr.name}</span>
                    {nr.name === n.primary && (
                      <span className="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">
                        Primary
                      </span>
                    )}
                  </div>
                  {nr.target && nr.target !== address && (
                    <span className="text-xs text-zinc-500">
                      {nr.target_accepted ? "Points to" : "Pending for"}{" "}
                      <Link href={memberHref(nr.target)} className="font-mono text-indigo-400 hover:text-indigo-300">
                        {truncateAddress(nr.target)}
                      </Link>
                    </span>
                  )}
                </div>
              ))}
              {n.pointed.map((nr) => (
                <div key={nr.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-zinc-800/30 px-3 py-2">
                  <span className="truncate font-mono text-sm text-zinc-200">{nr.name}</span>
                  <span className="text-xs text-zinc-500">
                    Points here, owned by{" "}
                    <Link href={memberHref(nr.owner)} className="font-mono text-indigo-400 hover:text-indigo-300">
                      {truncateAddress(nr.owner)}
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          )
        }
      </Section>

      {/* DREAM stakes */}
      <Section title={`${dream} stakes`} loaded={stakes} empty="No active stakes">
        {(d) => (d.rows.length === 0 ? null : <StakeList stakes={d} />)}
      </Section>

      {/* Role bonds */}
      <Section title="Role bonds" loaded={roleBonds} empty="No bonded roles">
        {(rows) =>
          rows.length === 0 ? null : (
            <div className="space-y-2">
              {rows.map(({ label, href, role }) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link href={href} className={`truncate text-sm text-zinc-300 ${LINK}`}>
                      {label}
                    </Link>
                    {role.bond_status !== BondedRoleStatus.NORMAL && (
                      <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
                        {BONDED_ROLE_STATUS_LABELS[role.bond_status] || role.bond_status}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-sm text-zinc-300">
                    {formatDream(role.current_bond)} {dream}
                  </span>
                </div>
              ))}
            </div>
          )
        }
      </Section>

      {/* Assignment bonds */}
      <Section title="Assignment bonds" loaded={assignBonds} empty="No assignment bonds">
        {(d) =>
          d.rows.length === 0 ? null : (
            <div className="space-y-2">
              {d.rows.map((ini) => (
                <div key={ini.id} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/30 px-3 py-2">
                  <Link
                    href={`/contribute?view=initiatives&initiative=${ini.id}`}
                    className={`min-w-0 truncate text-sm text-zinc-300 ${LINK}`}
                  >
                    #{ini.id} {ini.title}
                  </Link>
                  <span className="shrink-0 font-mono text-sm text-zinc-300">
                    {formatDream(ini.self_assign_bond)} {dream}
                  </span>
                </div>
              ))}
            </div>
          )
        }
      </Section>

      {otherLocked !== null && (
        <p className="px-1 text-xs text-zinc-500">
          Another {formatDream(otherLocked.toString())} {dream} is locked outside stakes and bonds, for example in invitations,
          nominations or challenges.
        </p>
      )}

      {/* SPARK delegations */}
      <Section title={`${spark} delegations`} loaded={delegations} empty="No delegations">
        {(d) =>
          d.rows.length === 0 ? null : (
            <div className="space-y-2">
              {d.rows.map((row) => {
                const val = row.delegation.validator_address;
                return (
                  <div
                    key={`${row.delegation.delegator_address}/${val}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/30 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-zinc-300">
                      {d.monikers[val] ? (
                        <Link href="/contribute?view=delegate" className={LINK}>
                          {d.monikers[val]}
                        </Link>
                      ) : (
                        <CopyableAddress className="font-mono text-xs" address={val} />
                      )}
                      {row.previous && (
                        <span className="ml-2 text-xs text-zinc-500">
                          held at previous address{" "}
                          <CopyableAddress className="font-mono" address={row.delegation.delegator_address} />
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right font-mono text-sm text-zinc-300">
                      {formatSpark(row.balance.amount, { maxFractionDigits: 2 })} {spark}
                      {row.reward > BigInt(0) && (
                        <span className="block text-xs text-zinc-500">
                          +{formatSpark(row.reward, { maxFractionDigits: 2 })} pending rewards
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        }
      </Section>

      {/* Season */}
      {s && (
        <div className="rounded-xl sd-hull-tile p-5">
          <h3 className="text-sm font-semibold text-zinc-200">Season</h3>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Level" value={num(s.profile.season_level)} />
            <Stat label="Season XP" value={num(s.profile.season_xp)} />
            <Stat label="Lifetime XP" value={num(s.profile.lifetime_xp)} />
            <Stat
              label="Guild"
              value={s.guild || (s.profile.guild_id && s.profile.guild_id !== "0" ? `#${s.profile.guild_id}` : "None")}
            />
          </div>
        </div>
      )}

      {/* Reputation and membership details */}
      {m && (
        <>
          <div className="rounded-xl sd-hull-tile p-5">
            <h3 className="text-sm font-semibold text-zinc-200">Reputation scores</h3>
            {repTags.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">No reputation scores yet</p>
            ) : (
              <div className="mt-3 space-y-2">
                {repTags.map(([tag, score]) => (
                  <div key={tag} className="flex items-center justify-between rounded-lg bg-zinc-800/30 px-3 py-2">
                    <span className="text-sm text-zinc-300">{tag}</span>
                    <span className="font-mono text-sm text-indigo-400">{parseFloat(score).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl sd-hull-tile p-5">
            <h3 className="text-sm font-semibold text-zinc-200">Details</h3>
            <dl className="mt-3 space-y-2 text-sm">
              {formatTime(m.joined_at) && <Detail label="Joined" value={formatTime(m.joined_at)} />}
              {m.invited_by && (
                <Detail
                  label="Invited by"
                  value={
                    <Link href={memberHref(m.invited_by)} className="font-mono text-xs text-indigo-400 hover:text-indigo-300">
                      <InviterName address={m.invited_by} />
                    </Link>
                  }
                />
              )}
              <Detail label={`Lifetime ${dream} earned`} value={formatDream(m.lifetime_earned)} />
              <Detail label="Completed initiatives" value={String(m.completed_initiatives_count ?? 0)} />
              <Detail label="Completed interims" value={String(m.completed_interims_count ?? 0)} />
              <Detail label="Season joined" value={String(m.joined_season ?? 0)} />
            </dl>
          </div>
        </>
      )}
    </div>
  );
}

function num(v: string | undefined): string {
  return /^\d+$/.test(v || "") ? Number(v).toLocaleString() : "0";
}

/** A balance cell: a placeholder while loading, a dash when the read failed. */
function amount<T>(loaded: Loaded<T>, format: (v: T) => string): string {
  if (loaded.state === "loading") return "…";
  if (loaded.state === "error") return "–";
  return format(loaded.data);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-300">{value}</dd>
    </div>
  );
}

function InviterName({ address }: { address: string }) {
  const { name } = useDisplayName(address);
  return <>{name || truncateAddress(address)}</>;
}

function StakeRow({ stake, showType }: { stake: RepStake; showType: boolean }) {
  const dream = useDreamDenom();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-800/30 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {showType && (
          <span className="shrink-0 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">
            {STAKE_TARGET_LABELS[stake.target_type] || stake.target_type}
          </span>
        )}
        <span className="truncate text-sm text-zinc-300">
          <StakeTarget stake={stake} />
        </span>
      </div>
      <span className="shrink-0 font-mono text-sm text-zinc-300">
        {formatDream(stake.amount)} {dream}
      </span>
    </div>
  );
}

/**
 * A member's DREAM stakes. A few render as a plain list. More than that
 * collapse to the largest ones under a count and total, and expand into
 * groups by target type, each with its own subtotal and largest first.
 */
function StakeList({ stakes }: { stakes: Stakes }) {
  const dream = useDreamDenom();
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => [...stakes.rows].sort(bySize), [stakes.rows]);
  const groups = useMemo(() => {
    const byType = new Map<string, { rows: RepStake[]; total: bigint }>();
    for (const st of sorted) {
      const g = byType.get(st.target_type) || { rows: [], total: BigInt(0) };
      g.rows.push(st);
      g.total += stakeAmount(st);
      byType.set(st.target_type, g);
    }
    return [...byType.entries()]
      .map(([type, g]) => ({ type, ...g }))
      .sort((a, b) => (a.total === b.total ? 0 : a.total < b.total ? 1 : -1));
  }, [sorted]);
  const total = groups.reduce((sum, g) => sum + g.total, BigInt(0));

  const partialNote = stakes.partial && (
    <p className="text-xs text-amber-400">
      This member has more than {STAKE_CAP} stakes. Only the first {STAKE_CAP} are counted and ranked here.
    </p>
  );

  if (sorted.length <= STAKE_PREVIEW) {
    return (
      <div className="space-y-2">
        {sorted.map((st) => (
          <StakeRow key={st.id} stake={st} showType />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {stakes.partial ? `${STAKE_CAP}+` : sorted.length} stakes, {formatDream(total.toString())} {dream} in total
      </p>
      {partialNote}
      {expanded ? (
        groups.map((g) => (
          <div key={g.type} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
              <span className="text-xs font-medium text-indigo-400">
                {STAKE_TARGET_LABELS[g.type] || g.type}{" "}
                <span className="font-normal text-zinc-500">({g.rows.length})</span>
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {formatDream(g.total.toString())} {dream}
              </span>
            </div>
            {g.rows.map((st) => (
              <StakeRow key={st.id} stake={st} showType={false} />
            ))}
          </div>
        ))
      ) : (
        <div className="space-y-2">
          {sorted.slice(0, STAKE_PREVIEW).map((st) => (
            <StakeRow key={st.id} stake={st} showType />
          ))}
        </div>
      )}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
      >
        {expanded ? `Show the ${STAKE_PREVIEW} largest` : `Show all ${stakes.partial ? STAKE_CAP : sorted.length} by type`}
      </button>
    </div>
  );
}

const LINK = "underline decoration-zinc-600 underline-offset-2 hover:text-white hover:decoration-zinc-300";

/**
 * A stake on a spark. The stake names a post id, which may be a reply, while
 * Swarm opens threads by their root post. The root is looked up on click, so
 * a long stake list costs no requests until a link is used.
 */
function SparkLink({ postId }: { postId: string }) {
  const router = useRouter();
  return (
    <a
      href={`/swarm?thread=${postId}`}
      className={LINK}
      onClick={async (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        let root = postId;
        try {
          const { post } = await getForumPost(postId);
          if (Number(post.root_id) > 0) root = post.root_id;
        } catch {
          // fall through to the id as given
        }
        router.push(`/swarm?thread=${root}`);
      }}
    >
      #{postId}
    </a>
  );
}

/** What a stake is on, linked where the target has a page of its own. */
function StakeTarget({ stake }: { stake: RepStake }) {
  const type = stake.target_type;
  const id = /^\d+$/.test(stake.target_id || "") ? stake.target_id : "";
  const { name } = useDisplayName(type === StakeTargetType.MEMBER ? stake.target_identifier : null);

  if (type === StakeTargetType.MEMBER && stake.target_identifier) {
    return (
      <Link href={memberHref(stake.target_identifier)} className={LINK}>
        {name || truncateAddress(stake.target_identifier)}
      </Link>
    );
  }
  if (id && (type === StakeTargetType.FORUM_CONTENT || type === StakeTargetType.FORUM_AUTHOR_BOND)) {
    return <SparkLink postId={id} />;
  }
  let href = "";
  if (id && type === StakeTargetType.INITIATIVE) href = `/contribute?view=initiatives&initiative=${id}`;
  else if (id && type === StakeTargetType.PROJECT) href = `/contribute?view=projects&project=${id}`;
  else if (id && (type === StakeTargetType.BLOG_CONTENT || type === StakeTargetType.BLOG_AUTHOR_BOND))
    href = `/imaginarium/${id}`;
  if (href) {
    return (
      <Link href={href} className={LINK}>
        #{id}
      </Link>
    );
  }
  // Tags, collections and dream replies have no page to link to.
  return <>{stake.target_identifier || `#${stake.target_id}`}</>;
}

function Section<T>({
  title,
  loaded,
  empty,
  children,
}: {
  title: string;
  loaded: Loaded<T>;
  empty: string;
  /** Returns null when the loaded data has nothing to list. */
  children: (data: T) => ReactNode;
}) {
  let body: ReactNode;
  if (loaded.state === "loading") {
    body = <div className="h-10 animate-pulse rounded-lg bg-zinc-800/40" />;
  } else if (loaded.state === "error") {
    body = <ErrorState error={loaded.error} compact />;
  } else {
    body = children(loaded.data) ?? <p className="text-sm text-zinc-500">{empty}</p>;
  }
  return (
    <div className="rounded-xl sd-hull-tile p-5">
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      <div className="mt-3">{body}</div>
    </div>
  );
}
