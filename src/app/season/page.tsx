"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getCurrentSeason,
  getSeasonStats,
  getMemberProfile,
  listAchievements,
  listTitles,
  listQuests,
  listMemberQuestProgress,
  getSeasonParams,
  listGuilds,
  listGuildMemberships,
  listNominations,
  listRetroRewardHistory,
} from "@/lib/api";
import { SeasonMsgTypeUrls } from "@/lib/tx";
import { useWallet } from "@/contexts/WalletContext";
import CopyableAddress from "@/components/CopyableAddress";
import type {
  Achievement,
  Title,
  MemberProfile,
  CurrentSeasonResponse,
  SeasonStatsResponse,
  Rarity,
  RequirementType,
  Quest,
  MemberQuestProgress,
  SeasonParams,
  Guild,
  GuildMembership,
  Nomination,
  RetroRewardRecord,
} from "@/types/season";

type View =
  | "overview"
  | "achievements"
  | "titles"
  | "quests"
  | "identity"
  | "guild"
  | "nominations";
type RarityFilter = "all" | Rarity;
type QuestFilter = "all" | "available" | "in_progress" | "completed";
type GuildSubview = "mine" | "browse" | "invites" | "create";
type NominationSubview = "all" | "mine" | "rewards" | "create";

const RARITY_ORDER: Rarity[] = [
  "RARITY_COMMON",
  "RARITY_UNCOMMON",
  "RARITY_RARE",
  "RARITY_EPIC",
  "RARITY_LEGENDARY",
  "RARITY_UNIQUE",
];

const RARITY_META: Record<Rarity, { label: string; cls: string }> = {
  RARITY_UNSPECIFIED: { label: "—", cls: "rarity-common" },
  RARITY_COMMON: { label: "Common", cls: "rarity-common" },
  RARITY_UNCOMMON: { label: "Uncommon", cls: "rarity-uncommon" },
  RARITY_RARE: { label: "Rare", cls: "rarity-rare" },
  RARITY_EPIC: { label: "Epic", cls: "rarity-epic" },
  RARITY_LEGENDARY: { label: "Legendary", cls: "rarity-legendary" },
  RARITY_UNIQUE: { label: "Unique", cls: "rarity-unique" },
};

const REQUIREMENT_LABEL: Record<RequirementType, string> = {
  REQUIREMENT_TYPE_UNSPECIFIED: "—",
  REQUIREMENT_TYPE_INITIATIVES_COMPLETED: "Initiatives completed",
  REQUIREMENT_TYPE_REPUTATION_EARNED: "Reputation earned",
  REQUIREMENT_TYPE_INVITATIONS_SUCCESSFUL: "Successful invitations",
  REQUIREMENT_TYPE_CHALLENGES_WON: "Challenges won",
  REQUIREMENT_TYPE_JURY_DUTY: "Jury duties completed",
  REQUIREMENT_TYPE_SEASONS_ACTIVE: "Seasons active",
  REQUIREMENT_TYPE_VOTES_CAST: "Votes cast",
  REQUIREMENT_TYPE_FORUM_HELPFUL: "Swarm helpful marks",
  REQUIREMENT_TYPE_TOP_XP: "Top XP rank",
  REQUIREMENT_TYPE_MIN_LEVEL: "Minimum level",
  REQUIREMENT_TYPE_ACHIEVEMENT_COUNT: "Achievements earned",
  REQUIREMENT_TYPE_GENESIS: "Genesis seed",
};

function memberProgressFor(
  type: RequirementType,
  profile: MemberProfile | null
): number | null {
  if (!profile) return null;
  switch (type) {
    case "REQUIREMENT_TYPE_INVITATIONS_SUCCESSFUL":
      return Number(profile.invitations_successful || 0);
    case "REQUIREMENT_TYPE_CHALLENGES_WON":
      return Number(profile.challenges_won || 0);
    case "REQUIREMENT_TYPE_JURY_DUTY":
      return Number(profile.jury_duties_completed || 0);
    case "REQUIREMENT_TYPE_VOTES_CAST":
      return Number(profile.votes_cast || 0);
    case "REQUIREMENT_TYPE_FORUM_HELPFUL":
      return Number(profile.forum_helpful_count || 0);
    case "REQUIREMENT_TYPE_MIN_LEVEL":
      return Number(profile.season_level || 0);
    case "REQUIREMENT_TYPE_ACHIEVEMENT_COUNT":
      return (profile.achievements || []).length;
    default:
      return null;
  }
}

function seasonStatusLabel(status: string): string {
  switch (status) {
    case "1":
    case "SEASON_STATUS_ACTIVE":
      return "Active";
    case "2":
    case "SEASON_STATUS_ENDING":
      return "Ending";
    case "3":
    case "SEASON_STATUS_MAINTENANCE":
      return "Maintenance";
    case "4":
    case "SEASON_STATUS_COMPLETED":
      return "Completed";
    case "5":
    case "SEASON_STATUS_NOMINATION":
      return "Nomination";
    default:
      return "—";
  }
}

function formatNum(n: string | number | undefined): string {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString();
}

export default function SeasonPage() {
  const { connected, address, ready, signAndBroadcast } = useWallet();
  const [view, setView] = useState<View>("overview");
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("all");
  const [questFilter, setQuestFilter] = useState<QuestFilter>("all");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [rarityCollapsed, setRarityCollapsed] = useState(false);
  const [questNavCollapsed, setQuestNavCollapsed] = useState(false);

  const [season, setSeason] = useState<CurrentSeasonResponse | null>(null);
  const [stats, setStats] = useState<SeasonStatsResponse | null>(null);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [titles, setTitles] = useState<Title[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [questProgress, setQuestProgress] = useState<MemberQuestProgress[]>([]);
  const [params, setParams] = useState<SeasonParams | null>(null);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [memberships, setMemberships] = useState<GuildMembership[]>([]);
  const [guildSubview, setGuildSubview] = useState<GuildSubview>("mine");
  const [guildNavCollapsed, setGuildNavCollapsed] = useState(false);
  const [nominations, setNominations] = useState<Nomination[]>([]);
  const [retroRewards, setRetroRewards] = useState<RetroRewardRecord[]>([]);
  const [nominationSubview, setNominationSubview] = useState<NominationSubview>("all");
  const [nominationNavCollapsed, setNominationNavCollapsed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [txPending, setTxPending] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reloadProfile = useCallback(async () => {
    if (!connected || !address) return;
    const prof = await getMemberProfile(address).catch(() => null);
    setProfile(prof?.member_profile || null);
  }, [connected, address]);

  const reloadQuestProgress = useCallback(async () => {
    const qp = await listMemberQuestProgress({ limit: "500" }).catch(
      () => ({ member_quest_progress: [] } as { member_quest_progress: MemberQuestProgress[] })
    );
    setQuestProgress(qp.member_quest_progress || []);
  }, []);

  const reloadGuilds = useCallback(async () => {
    const [g, m] = await Promise.all([
      listGuilds({ limit: "500" }).catch(() => ({ guild: [] })),
      listGuildMemberships({ limit: "500" }).catch(() => ({ guild_membership: [] })),
    ]);
    setGuilds(g.guild || []);
    setMemberships(m.guild_membership || []);
  }, []);

  const reloadNominations = useCallback(async (seasonNumber?: string) => {
    const n = await listNominations({ limit: "500" }).catch(() => ({ nominations: [] }));
    setNominations(n.nominations || []);
    if (seasonNumber) {
      const r = await listRetroRewardHistory(seasonNumber, { limit: "500" }).catch(() => ({
        records: [],
      }));
      setRetroRewards(r.records || []);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const seasonRes = await getCurrentSeason();
      setSeason(seasonRes);

      const [
        statsRes,
        achRes,
        titleRes,
        questRes,
        progressRes,
        paramsRes,
        guildRes,
        membershipRes,
        nominationRes,
        retroRes,
      ] = await Promise.all([
        getSeasonStats(seasonRes.number).catch(() => null),
        listAchievements({ limit: "500" }).catch(() => ({ achievements: [] })),
        listTitles({ limit: "500" }).catch(() => ({ titles: [] })),
        listQuests({ limit: "500" }).catch(() => ({ quest: [] })),
        listMemberQuestProgress({ limit: "500" }).catch(
          () => ({ member_quest_progress: [] } as { member_quest_progress: MemberQuestProgress[] })
        ),
        getSeasonParams().catch(() => null),
        listGuilds({ limit: "500" }).catch(() => ({ guild: [] })),
        listGuildMemberships({ limit: "500" }).catch(() => ({ guild_membership: [] })),
        listNominations({ limit: "500" }).catch(() => ({ nominations: [] })),
        listRetroRewardHistory(seasonRes.number, { limit: "500" }).catch(() => ({ records: [] })),
      ]);
      setStats(statsRes);
      setAchievements(achRes.achievements || []);
      setTitles(titleRes.titles || []);
      setQuests(questRes.quest || []);
      setQuestProgress(progressRes.member_quest_progress || []);
      setParams(paramsRes?.params || null);
      setGuilds(guildRes.guild || []);
      setMemberships(membershipRes.guild_membership || []);
      setNominations(nominationRes.nominations || []);
      setRetroRewards(retroRes.records || []);

      if (connected && address) {
        const prof = await getMemberProfile(address).catch(() => null);
        setProfile(prof?.member_profile || null);
      } else {
        setProfile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load season data");
    } finally {
      setLoading(false);
    }
  }, [connected, address]);

  useEffect(() => {
    if (!ready) return;
    loadAll();
  }, [ready, loadAll]);

  const earnedAchievements = useMemo(
    () => new Set(profile?.achievements || []),
    [profile]
  );
  const unlockedTitles = useMemo(
    () => new Set(profile?.unlocked_titles || []),
    [profile]
  );

  const filteredAchievements = useMemo(() => {
    const sorted = [...achievements].sort((a, b) => {
      const ra = RARITY_ORDER.indexOf(a.rarity);
      const rb = RARITY_ORDER.indexOf(b.rarity);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
    if (rarityFilter === "all") return sorted;
    return sorted.filter((a) => a.rarity === rarityFilter);
  }, [achievements, rarityFilter]);

  const filteredTitles = useMemo(() => {
    const sorted = [...titles].sort((a, b) => {
      const ra = RARITY_ORDER.indexOf(a.rarity);
      const rb = RARITY_ORDER.indexOf(b.rarity);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
    if (rarityFilter === "all") return sorted;
    return sorted.filter((t) => t.rarity === rarityFilter);
  }, [titles, rarityFilter]);

  const earnedCountByRarity = useMemo(() => {
    const map = new Map<Rarity, number>();
    for (const a of achievements) {
      if (earnedAchievements.has(a.achievement_id)) {
        map.set(a.rarity, (map.get(a.rarity) || 0) + 1);
      }
    }
    return map;
  }, [achievements, earnedAchievements]);

  const totalCountByRarity = useMemo(() => {
    const map = new Map<Rarity, number>();
    for (const a of achievements) {
      map.set(a.rarity, (map.get(a.rarity) || 0) + 1);
    }
    return map;
  }, [achievements]);

  const handleSetTitle = async (titleId: string) => {
    if (!address) return;
    try {
      setTxPending(titleId);
      setToast(null);
      await signAndBroadcast([
        {
          typeUrl: SeasonMsgTypeUrls.SetDisplayTitle,
          value: { creator: address, titleId: titleId },
        },
      ]);
      setToast(`Display title set`);
      const prof = await getMemberProfile(address).catch(() => null);
      setProfile(prof?.member_profile || null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to set title");
    } finally {
      setTxPending(null);
    }
  };

  const handleClearTitle = async () => {
    if (!address) return;
    try {
      setTxPending("__clear__");
      setToast(null);
      await signAndBroadcast([
        {
          typeUrl: SeasonMsgTypeUrls.SetDisplayTitle,
          value: { creator: address, titleId: "" },
        },
      ]);
      setToast("Display title cleared");
      const prof = await getMemberProfile(address).catch(() => null);
      setProfile(prof?.member_profile || null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to clear title");
    } finally {
      setTxPending(null);
    }
  };

  const handleQuestAction = async (
    typeUrl: string,
    questId: string,
    successMsg: string
  ) => {
    if (!address) return;
    try {
      setTxPending(`${typeUrl}:${questId}`);
      setToast(null);
      await signAndBroadcast([
        { typeUrl, value: { creator: address, questId: questId } },
      ]);
      setToast(successMsg);
      await Promise.all([reloadProfile(), reloadQuestProgress()]);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Quest action failed");
    } finally {
      setTxPending(null);
    }
  };

  const handleSetDisplayName = async (name: string) => {
    if (!address) return;
    try {
      setTxPending("__display_name__");
      setToast(null);
      await signAndBroadcast([
        {
          typeUrl: SeasonMsgTypeUrls.SetDisplayName,
          value: { creator: address, name },
        },
      ]);
      setToast("Display name updated");
      await reloadProfile();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to set display name");
    } finally {
      setTxPending(null);
    }
  };

  const handleSetUsername = async (username: string) => {
    if (!address) return;
    try {
      setTxPending("__username__");
      setToast(null);
      await signAndBroadcast([
        {
          typeUrl: SeasonMsgTypeUrls.SetUsername,
          value: { creator: address, username },
        },
      ]);
      setToast("Username updated");
      await reloadProfile();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to set username");
    } finally {
      setTxPending(null);
    }
  };

  const handleGuildTx = async (
    typeUrl: string,
    value: Record<string, unknown>,
    pendingKey: string,
    successMsg: string
  ) => {
    try {
      setTxPending(pendingKey);
      setToast(null);
      await signAndBroadcast([{ typeUrl, value }]);
      setToast(successMsg);
      await Promise.all([reloadGuilds(), reloadProfile()]);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Guild action failed");
    } finally {
      setTxPending(null);
    }
  };

  const handleNominationTx = async (
    typeUrl: string,
    value: Record<string, unknown>,
    pendingKey: string,
    successMsg: string
  ) => {
    try {
      setTxPending(pendingKey);
      setToast(null);
      await signAndBroadcast([{ typeUrl, value }]);
      setToast(successMsg);
      await reloadNominations(season?.number);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Nomination action failed");
    } finally {
      setTxPending(null);
    }
  };

  const myProgressByQuest = useMemo(() => {
    if (!address) return new Map<string, MemberQuestProgress>();
    const prefix = `${address}/`;
    const map = new Map<string, MemberQuestProgress>();
    for (const p of questProgress) {
      if (p.member_quest && p.member_quest.startsWith(prefix)) {
        const questId = p.member_quest.slice(prefix.length);
        map.set(questId, p);
      }
    }
    return map;
  }, [questProgress, address]);

  const questCounts = useMemo(() => {
    let avail = 0;
    let inProgress = 0;
    let completed = 0;
    for (const q of quests) {
      const p = myProgressByQuest.get(q.quest_id);
      if (p?.completed) completed += 1;
      else if (p) inProgress += 1;
      else if (q.active) avail += 1;
    }
    return { avail, inProgress, completed };
  }, [quests, myProgressByQuest]);

  const filteredQuests = useMemo(() => {
    const sorted = [...quests].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (questFilter === "all") return sorted;
    return sorted.filter((q) => {
      const p = myProgressByQuest.get(q.quest_id);
      if (questFilter === "completed") return !!p?.completed;
      if (questFilter === "in_progress") return !!p && !p.completed;
      if (questFilter === "available") return !p && q.active;
      return true;
    });
  }, [quests, questFilter, myProgressByQuest]);

  const myMembership = useMemo(() => {
    if (!address) return null;
    return (
      memberships.find(
        (m) => m.member === address && (!m.left_epoch || m.left_epoch === "0")
      ) || null
    );
  }, [memberships, address]);

  const myGuild = useMemo(() => {
    if (!myMembership || !myMembership.guild_id || myMembership.guild_id === "0") return null;
    return guilds.find((g) => g.id === myMembership.guild_id) || null;
  }, [guilds, myMembership]);

  const myRole = useMemo<"founder" | "officer" | "member" | null>(() => {
    if (!myGuild || !address) return null;
    if (myGuild.founder === address) return "founder";
    if ((myGuild.officers || []).includes(address)) return "officer";
    return "member";
  }, [myGuild, address]);

  const myInvites = useMemo(() => {
    if (!address) return [] as Guild[];
    return guilds.filter(
      (g) =>
        g.status !== "GUILD_STATUS_DISSOLVED" && (g.pending_invites || []).includes(address)
    );
  }, [guilds, address]);

  const membersByGuild = useMemo(() => {
    const map = new Map<string, GuildMembership[]>();
    for (const m of memberships) {
      if (!m.guild_id || m.guild_id === "0") continue;
      if (m.left_epoch && m.left_epoch !== "0") continue;
      const list = map.get(m.guild_id) || [];
      list.push(m);
      map.set(m.guild_id, list);
    }
    return map;
  }, [memberships]);

  const collapseHead = (label: string, collapsed: boolean, toggle: () => void) => (
    <button
      type="button"
      className="sd-side-group-head"
      aria-expanded={!collapsed}
      onClick={toggle}
    >
      {label}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );

  const sidebar = (
    <>
      <div className={`sd-side-group${navCollapsed ? " collapsed" : ""}`}>
        {collapseHead("Season", navCollapsed, () => setNavCollapsed((v) => !v))}
        {!navCollapsed && (
          <>
            <button
              type="button"
              className={`sd-side-item${view === "overview" ? " active" : ""}`}
              onClick={() => setView("overview")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              Overview
            </button>
            <button
              type="button"
              className={`sd-side-item${view === "achievements" ? " active" : ""}`}
              onClick={() => setView("achievements")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M8 21h8M12 17v4M17 4h3v4a5 5 0 0 1-5 5M7 4H4v4a5 5 0 0 0 5 5M7 4h10v5a5 5 0 0 1-10 0V4z" />
              </svg>
              Achievements
              <span className="badge">
                {earnedAchievements.size}/{achievements.length}
              </span>
            </button>
            <button
              type="button"
              className={`sd-side-item${view === "titles" ? " active" : ""}`}
              onClick={() => setView("titles")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 7h18M5 7v13h14V7M9 3h6v4H9z" />
              </svg>
              Titles
              <span className="badge">
                {unlockedTitles.size}/{titles.length}
              </span>
            </button>
            <button
              type="button"
              className={`sd-side-item${view === "quests" ? " active" : ""}`}
              onClick={() => setView("quests")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 4h12l4 4v12H4zM14 4v6h6M8 14h8M8 18h5" />
              </svg>
              Quests
              <span className="badge">
                {questCounts.completed}/{quests.length}
              </span>
            </button>
            <button
              type="button"
              className={`sd-side-item${view === "identity" ? " active" : ""}`}
              onClick={() => setView("identity")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21a8 8 0 0 1 16 0" />
              </svg>
              Identity
            </button>
            <button
              type="button"
              className={`sd-side-item${view === "guild" ? " active" : ""}`}
              onClick={() => setView("guild")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87" />
                <circle cx="9" cy="7" r="4" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Guild
              <span className="badge">{guilds.filter((g) => g.status !== "GUILD_STATUS_DISSOLVED").length}</span>
            </button>
            <button
              type="button"
              className={`sd-side-item${view === "nominations" ? " active" : ""}`}
              onClick={() => setView("nominations")}
            >
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
              </svg>
              Nominations
              <span className="badge">{nominations.length}</span>
            </button>
          </>
        )}
      </div>

      {(view === "achievements" || view === "titles") && (
        <div className={`sd-side-group${rarityCollapsed ? " collapsed" : ""}`}>
          {collapseHead("Rarity", rarityCollapsed, () => setRarityCollapsed((v) => !v))}
          {!rarityCollapsed && (
            <div className="sd-side-pills">
              <button
                type="button"
                className={`sd-pill tag-neutral${rarityFilter === "all" ? " on" : ""}`}
                onClick={() => setRarityFilter("all")}
                style={rarityFilter === "all" ? { color: "var(--violet-hi)", borderColor: "var(--violet-ring)" } : undefined}
              >
                All
              </button>
              {RARITY_ORDER.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`sd-pill tag-neutral${rarityFilter === r ? " on" : ""}`}
                  onClick={() => setRarityFilter(r)}
                  style={
                    rarityFilter === r
                      ? { color: "var(--violet-hi)", borderColor: "var(--violet-ring)" }
                      : undefined
                  }
                >
                  {RARITY_META[r].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "nominations" && (
        <div className={`sd-side-group${nominationNavCollapsed ? " collapsed" : ""}`}>
          {collapseHead("Filter", nominationNavCollapsed, () => setNominationNavCollapsed((v) => !v))}
          {!nominationNavCollapsed && (
            <>
              <button
                type="button"
                className={`sd-side-item${nominationSubview === "all" ? " active" : ""}`}
                onClick={() => setNominationSubview("all")}
              >
                All <span className="badge">{nominations.length}</span>
              </button>
              <button
                type="button"
                className={`sd-side-item${nominationSubview === "mine" ? " active" : ""}`}
                onClick={() => setNominationSubview("mine")}
              >
                Mine
                <span className="badge">
                  {address ? nominations.filter((n) => n.nominator === address).length : 0}
                </span>
              </button>
              <button
                type="button"
                className={`sd-side-item${nominationSubview === "rewards" ? " active" : ""}`}
                onClick={() => setNominationSubview("rewards")}
              >
                Rewards <span className="badge">{retroRewards.length}</span>
              </button>
              <button
                type="button"
                className={`sd-side-item${nominationSubview === "create" ? " active" : ""}`}
                onClick={() => setNominationSubview("create")}
              >
                Nominate
              </button>
            </>
          )}
        </div>
      )}

      {view === "guild" && (
        <div className={`sd-side-group${guildNavCollapsed ? " collapsed" : ""}`}>
          {collapseHead("Guild", guildNavCollapsed, () => setGuildNavCollapsed((v) => !v))}
          {!guildNavCollapsed && (
            <>
              <button
                type="button"
                className={`sd-side-item${guildSubview === "mine" ? " active" : ""}`}
                onClick={() => setGuildSubview("mine")}
              >
                Your guild
                {myGuild && <span className="badge">{myGuild.name}</span>}
              </button>
              <button
                type="button"
                className={`sd-side-item${guildSubview === "browse" ? " active" : ""}`}
                onClick={() => setGuildSubview("browse")}
              >
                Browse
                <span className="badge">
                  {guilds.filter((g) => g.status === "GUILD_STATUS_ACTIVE").length}
                </span>
              </button>
              <button
                type="button"
                className={`sd-side-item${guildSubview === "invites" ? " active" : ""}`}
                onClick={() => setGuildSubview("invites")}
              >
                Invites
                <span className="badge">{myInvites.length}</span>
              </button>
              <button
                type="button"
                className={`sd-side-item${guildSubview === "create" ? " active" : ""}`}
                onClick={() => setGuildSubview("create")}
              >
                Create
              </button>
            </>
          )}
        </div>
      )}

      {view === "quests" && (
        <div className={`sd-side-group${questNavCollapsed ? " collapsed" : ""}`}>
          {collapseHead("Filter", questNavCollapsed, () => setQuestNavCollapsed((v) => !v))}
          {!questNavCollapsed && (
            <>
              <button
                type="button"
                className={`sd-side-item${questFilter === "all" ? " active" : ""}`}
                onClick={() => setQuestFilter("all")}
              >
                All <span className="badge">{quests.length}</span>
              </button>
              <button
                type="button"
                className={`sd-side-item${questFilter === "available" ? " active" : ""}`}
                onClick={() => setQuestFilter("available")}
              >
                Available <span className="badge">{questCounts.avail}</span>
              </button>
              <button
                type="button"
                className={`sd-side-item${questFilter === "in_progress" ? " active" : ""}`}
                onClick={() => setQuestFilter("in_progress")}
              >
                In progress <span className="badge">{questCounts.inProgress}</span>
              </button>
              <button
                type="button"
                className={`sd-side-item${questFilter === "completed" ? " active" : ""}`}
                onClick={() => setQuestFilter("completed")}
              >
                Completed <span className="badge">{questCounts.completed}</span>
              </button>
            </>
          )}
        </div>
      )}
    </>
  );

  if (!ready || loading) {
    return (
      <div className="sd-page">
        <header className="sd-page-header">
          <h1>Season</h1>
          <p>XP, achievements, and titles earned across onchain activity</p>
        </header>
        <div className="sd-page-grid with-rail">
          <aside className="sd-side">
            <div style={{ height: 220, borderRadius: "var(--r-md)", background: "var(--panel-2)", opacity: 0.5 }} />
          </aside>
          <section>
            <div style={{ height: 180, marginBottom: 16, borderRadius: "var(--r-lg)", backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)", border: "1px solid var(--rule)" }} />
            <div style={{ height: 320, borderRadius: "var(--r-lg)", backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)", border: "1px solid var(--rule)" }} />
          </section>
          <aside className="sd-rail">
            <div className="sd-rail-card" style={{ height: 140 }} />
            <div className="sd-rail-card" style={{ height: 180 }} />
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="sd-page">
      <header className="sd-page-header">
        <h1>Season{season ? ` ${season.number} · ${season.name}` : ""}</h1>
        <p>{season?.theme || "XP, achievements, and titles earned across onchain activity"}</p>
      </header>

      <div className="sd-page-grid with-rail">
        <aside className="sd-side">{sidebar}</aside>

        <section>
          {error && (
            <div
              style={{
                marginBottom: 20,
                padding: "10px 14px",
                borderRadius: "var(--r-sm)",
                border: "1px solid rgba(244,63,94,0.35)",
                background: "rgba(244,63,94,0.08)",
                color: "#fb7185",
                fontSize: 13,
              }}
            >
              {error}
              <button
                onClick={loadAll}
                style={{
                  marginLeft: 10,
                  background: "transparent",
                  border: 0,
                  color: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </div>
          )}

          {toast && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--violet-ring)",
                background: "var(--violet-soft)",
                color: "var(--violet-hi)",
                fontSize: 13,
              }}
            >
              {toast}
            </div>
          )}

          <div className="sd-blog-toolbar" style={{ marginBottom: 20 }}>
            <div className="sd-seg wrap">
              <button className={view === "overview" ? "on" : ""} onClick={() => setView("overview")}>
                Overview
              </button>
              <button className={view === "achievements" ? "on" : ""} onClick={() => setView("achievements")}>
                Achievements
              </button>
              <button className={view === "titles" ? "on" : ""} onClick={() => setView("titles")}>
                Titles
              </button>
              <button className={view === "quests" ? "on" : ""} onClick={() => setView("quests")}>
                Quests
              </button>
              <button className={view === "identity" ? "on" : ""} onClick={() => setView("identity")}>
                Identity
              </button>
              <button className={view === "guild" ? "on" : ""} onClick={() => setView("guild")}>
                Guild
              </button>
              <button className={view === "nominations" ? "on" : ""} onClick={() => setView("nominations")}>
                Nominations
              </button>
            </div>
          </div>

          {view === "overview" && (
            <OverviewView
              season={season}
              stats={stats}
              profile={profile}
              connected={connected}
              earnedCount={earnedAchievements.size}
              totalAchievements={achievements.length}
              unlockedCount={unlockedTitles.size}
              totalTitles={titles.length}
              displayTitle={titles.find((t) => t.title_id === profile?.display_title) || null}
            />
          )}

          {view === "achievements" && (
            <AchievementsView
              achievements={filteredAchievements}
              earned={earnedAchievements}
              profile={profile}
              connected={connected}
            />
          )}

          {view === "titles" && (
            <TitlesView
              titles={filteredTitles}
              unlocked={unlockedTitles}
              archived={new Set(profile?.archived_titles || [])}
              displayTitleId={profile?.display_title || ""}
              profile={profile}
              connected={connected}
              onSet={handleSetTitle}
              onClear={handleClearTitle}
              txPending={txPending}
            />
          )}

          {view === "quests" && (
            <QuestsView
              quests={filteredQuests}
              progressByQuest={myProgressByQuest}
              profile={profile}
              connected={connected}
              txPending={txPending}
              onStart={(id) =>
                handleQuestAction(SeasonMsgTypeUrls.StartQuest, id, "Quest started")
              }
              onClaim={(id) =>
                handleQuestAction(
                  SeasonMsgTypeUrls.ClaimQuestReward,
                  id,
                  "Reward claimed"
                )
              }
              onAbandon={(id) =>
                handleQuestAction(SeasonMsgTypeUrls.AbandonQuest, id, "Quest abandoned")
              }
            />
          )}

          {view === "identity" && (
            <IdentityView
              key={profile?.address || "disconnected"}
              profile={profile}
              params={params}
              connected={connected}
              txPending={txPending}
              onSetDisplayName={handleSetDisplayName}
              onSetUsername={handleSetUsername}
            />
          )}

          {view === "guild" && (
            <GuildView
              subview={guildSubview}
              setSubview={setGuildSubview}
              guilds={guilds}
              myGuild={myGuild}
              myRole={myRole}
              myInvites={myInvites}
              membersByGuild={membersByGuild}
              address={address}
              connected={connected}
              txPending={txPending}
              onCreate={(name, description, inviteOnly) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.CreateGuild,
                  { creator: address!, name, description, inviteOnly },
                  "__create_guild__",
                  "Guild created"
                )
              }
              onJoin={(guildId) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.JoinGuild,
                  { creator: address!, guildId: BigInt(guildId) },
                  `__join__:${guildId}`,
                  "Joined guild"
                )
              }
              onAccept={(guildId) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.AcceptGuildInvite,
                  { creator: address!, guildId: BigInt(guildId) },
                  `__accept__:${guildId}`,
                  "Invite accepted"
                )
              }
              onLeave={() =>
                handleGuildTx(
                  SeasonMsgTypeUrls.LeaveGuild,
                  { creator: address! },
                  "__leave__",
                  "Left guild"
                )
              }
              onInvite={(guildId, invitee) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.InviteToGuild,
                  { creator: address!, guildId: BigInt(guildId), invitee },
                  `__invite__:${invitee}`,
                  "Invite sent"
                )
              }
              onRevoke={(guildId, invitee) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.RevokeGuildInvite,
                  { creator: address!, guildId: BigInt(guildId), invitee },
                  `__revoke__:${invitee}`,
                  "Invite revoked"
                )
              }
              onKick={(guildId, member, reason) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.KickFromGuild,
                  { creator: address!, guildId: BigInt(guildId), member, reason },
                  `__kick__:${member}`,
                  "Member kicked"
                )
              }
              onPromote={(guildId, member) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.PromoteToOfficer,
                  { creator: address!, guildId: BigInt(guildId), member },
                  `__promote__:${member}`,
                  "Promoted to officer"
                )
              }
              onDemote={(guildId, officer) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.DemoteOfficer,
                  { creator: address!, guildId: BigInt(guildId), officer },
                  `__demote__:${officer}`,
                  "Demoted officer"
                )
              }
              onTransferFounder={(guildId, newFounder) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.TransferGuildFounder,
                  { creator: address!, guildId: BigInt(guildId), newFounder: newFounder },
                  "__transfer__",
                  "Founder transferred"
                )
              }
              onDissolve={(guildId) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.DissolveGuild,
                  { creator: address!, guildId: BigInt(guildId) },
                  "__dissolve__",
                  "Guild dissolved"
                )
              }
              onSetInviteOnly={(guildId, inviteOnly) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.SetGuildInviteOnly,
                  { creator: address!, guildId: BigInt(guildId), inviteOnly: inviteOnly },
                  "__invite_only__",
                  "Visibility updated"
                )
              }
              onUpdateDescription={(guildId, description) =>
                handleGuildTx(
                  SeasonMsgTypeUrls.UpdateGuildDescription,
                  { creator: address!, guildId: BigInt(guildId), description },
                  "__update_desc__",
                  "Description updated"
                )
              }
            />
          )}

          {view === "nominations" && (
            <NominationsView
              subview={nominationSubview}
              setSubview={setNominationSubview}
              nominations={nominations}
              retroRewards={retroRewards}
              currentSeason={season?.number || ""}
              params={params}
              address={address}
              connected={connected}
              txPending={txPending}
              onNominate={(contentRef, rationale) =>
                handleNominationTx(
                  SeasonMsgTypeUrls.Nominate,
                  { creator: address!, contentRef, rationale },
                  "__nominate__",
                  "Nomination submitted"
                )
              }
              onStake={(id, amount) =>
                handleNominationTx(
                  SeasonMsgTypeUrls.StakeNomination,
                  { creator: address!, nominationId: BigInt(id), amount },
                  `__stake__:${id}`,
                  "Stake added"
                )
              }
              onUnstake={(id) =>
                handleNominationTx(
                  SeasonMsgTypeUrls.UnstakeNomination,
                  { creator: address!, nominationId: BigInt(id) },
                  `__unstake__:${id}`,
                  "Stake withdrawn"
                )
              }
            />
          )}
        </section>

        <aside className="sd-rail">
          <div className="sd-rail-filters">{sidebar}</div>
          <SeasonCard season={season} stats={stats} />
          {connected && profile ? (
            <ProfileCard profile={profile} displayTitle={titles.find((t) => t.title_id === profile.display_title)?.name || null} />
          ) : (
            <ConnectCard connected={connected} />
          )}
          <RaritySummaryCard
            earned={earnedCountByRarity}
            total={totalCountByRarity}
          />
        </aside>
      </div>
    </div>
  );
}

function OverviewView({
  season,
  stats,
  profile,
  connected,
  earnedCount,
  totalAchievements,
  unlockedCount,
  totalTitles,
  displayTitle,
}: {
  season: CurrentSeasonResponse | null;
  stats: SeasonStatsResponse | null;
  profile: MemberProfile | null;
  connected: boolean;
  earnedCount: number;
  totalAchievements: number;
  unlockedCount: number;
  totalTitles: number;
  displayTitle: Title | null;
}) {
  return (
    <>
      <div
        className="sd-featured"
        style={{ cursor: "default", display: "grid", gridTemplateColumns: "220px 1fr" }}
      >
        <div className="art">
          <div className="glyph">
            <div className="frame">
              <b>◆ Season {season?.number || "—"}</b>
              <span className="hash">{seasonStatusLabel(season?.status || "")}</span>
            </div>
          </div>
        </div>
        <div className="body">
          <div className="meta-row">
            <span className="pin">◆ {seasonStatusLabel(season?.status || "")}</span>
            <span>·</span>
            <span>
              block {formatNum(season?.start_block)} → {formatNum(season?.end_block)}
            </span>
            {stats && (
              <>
                <span>·</span>
                <span>{formatNum(stats.blocks_remaining)} blocks remaining</span>
              </>
            )}
          </div>
          <h2>{season?.name || "Current season"}</h2>
          <p>{season?.theme || "—"}</p>
          <div className="foot">
            <StatBlock label="Active members" value={formatNum(stats?.active_members)} />
            <StatBlock label="Total XP" value={formatNum(stats?.total_xp_earned)} />
            <StatBlock label="Quests" value={formatNum(stats?.quests_completed)} />
            <StatBlock label="Guilds" value={formatNum(stats?.guilds_active)} />
          </div>
        </div>
      </div>

      {!connected ? (
        <div
          style={{
            marginTop: 20,
            padding: "48px 24px",
            textAlign: "center",
            backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
            border: "1px dashed var(--rule-strong)",
            borderRadius: "var(--r-lg)",
            color: "var(--ink-mute)",
          }}
        >
          Connect your wallet to see your season profile, achievements, and titles.
        </div>
      ) : !profile ? (
        <div
          style={{
            marginTop: 20,
            padding: "48px 24px",
            textAlign: "center",
            backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
            border: "1px dashed var(--rule-strong)",
            borderRadius: "var(--r-lg)",
            color: "var(--ink-mute)",
          }}
        >
          No season profile yet. Start participating onchain to begin earning XP.
        </div>
      ) : (
        <>
          <div
            style={{
              marginTop: 20,
              padding: 20,
              backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-lg)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 16,
            }}
          >
            <BigStat label="Level" value={formatNum(profile.season_level)} accent />
            <BigStat label="Season XP" value={formatNum(profile.season_xp)} />
            <BigStat label="Lifetime XP" value={formatNum(profile.lifetime_xp)} />
            <BigStat
              label="Achievements"
              value={`${earnedCount}/${totalAchievements}`}
            />
            <BigStat
              label="Titles"
              value={`${unlockedCount}/${totalTitles}`}
            />
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 20,
              backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-lg)",
            }}
          >
            <h3 style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
              Your contribution
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 14,
              }}
            >
              <MiniStat label="Votes cast" value={formatNum(profile.votes_cast)} />
              <MiniStat label="Swarm helpful" value={formatNum(profile.forum_helpful_count)} />
              <MiniStat label="Challenges won" value={formatNum(profile.challenges_won)} />
              <MiniStat label="Jury duties" value={formatNum(profile.jury_duties_completed)} />
              <MiniStat label="Invites landed" value={formatNum(profile.invitations_successful)} />
            </div>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 20,
              backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-lg)",
            }}
          >
            <h3 style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
              Identity
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              <IdentityRow label="Display name" value={profile.display_name || "—"} />
              <IdentityRow label="Username" value={profile.username || "—"} />
              <IdentityRow
                label="Display title"
                value={
                  displayTitle ? (
                    <span className={`sd-pill ${RARITY_META[displayTitle.rarity]?.cls || ""}`}>
                      {displayTitle.name}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <IdentityRow
                label="Guild"
                value={profile.guild_id && profile.guild_id !== "0" ? `#${profile.guild_id}` : "—"}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function AchievementsView({
  achievements,
  earned,
  profile,
  connected,
}: {
  achievements: Achievement[];
  earned: Set<string>;
  profile: MemberProfile | null;
  connected: boolean;
}) {
  if (achievements.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        No achievements defined for this season yet.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
      {achievements.map((a) => {
        const isEarned = earned.has(a.achievement_id);
        const current = memberProgressFor(a.requirement_type, profile);
        const threshold = Number(a.requirement_threshold || 0);
        const pct =
          current !== null && threshold > 0
            ? Math.min(100, Math.round((current / threshold) * 100))
            : null;
        return (
          <div
            key={a.achievement_id}
            style={{
              padding: 16,
              backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
              border: "1px solid " + (isEarned ? "var(--violet-ring)" : "var(--rule)"),
              borderRadius: "var(--r-lg)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              opacity: isEarned || !connected ? 1 : 0.82,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span className={`sd-pill ${RARITY_META[a.rarity]?.cls || ""}`}>
                {RARITY_META[a.rarity]?.label || "—"}
              </span>
              {isEarned ? (
                <span className="sd-pill trust-trusted">✓ Earned</span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600 }}>
                  +{formatNum(a.xp_reward)} XP
                </span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{a.name}</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {a.description}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
              {REQUIREMENT_LABEL[a.requirement_type]}: {formatNum(a.requirement_threshold)}
              {current !== null && ` · you: ${formatNum(current)}`}
            </div>
            {pct !== null && !isEarned && (
              <div style={{ height: 4, background: "var(--panel-2)", borderRadius: 999, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: "var(--violet)",
                    transition: "width 0.3s",
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TitlesView({
  titles,
  unlocked,
  archived,
  displayTitleId,
  profile,
  connected,
  onSet,
  onClear,
  txPending,
}: {
  titles: Title[];
  unlocked: Set<string>;
  archived: Set<string>;
  displayTitleId: string;
  profile: MemberProfile | null;
  connected: boolean;
  onSet: (id: string) => void;
  onClear: () => void;
  txPending: string | null;
}) {
  if (titles.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        No titles defined yet.
      </div>
    );
  }
  return (
    <>
      {displayTitleId && connected && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--r-sm)",
            fontSize: 13,
            color: "var(--ink-soft)",
          }}
        >
          <span>
            Current display title:{" "}
            <b style={{ color: "var(--ink)" }}>
              {titles.find((t) => t.title_id === displayTitleId)?.name || displayTitleId}
            </b>
          </span>
          <button
            type="button"
            className="sd-btn-ghost"
            onClick={onClear}
            disabled={txPending === "__clear__"}
          >
            {txPending === "__clear__" ? "Clearing…" : "Clear"}
          </button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {titles.map((t) => {
          const isUnlocked = unlocked.has(t.title_id);
          const isArchived = archived.has(t.title_id);
          const isActive = t.title_id === displayTitleId;
          const current = memberProgressFor(t.requirement_type, profile);
          const threshold = Number(t.requirement_threshold || 0);
          const pct =
            current !== null && threshold > 0 && !isUnlocked
              ? Math.min(100, Math.round((current / threshold) * 100))
              : null;
          return (
            <div
              key={t.title_id}
              style={{
                padding: 16,
                backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
                border: "1px solid " + (isActive ? "var(--violet-hi)" : isUnlocked ? "var(--violet-ring)" : "var(--rule)"),
                borderRadius: "var(--r-lg)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                opacity: isUnlocked || !connected ? 1 : 0.82,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span className={`sd-pill ${RARITY_META[t.rarity]?.cls || ""}`}>
                  {RARITY_META[t.rarity]?.label || "—"}
                </span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {t.seasonal && (
                    <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>
                      Seasonal
                    </span>
                  )}
                  {isArchived && (
                    <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>
                      Archived
                    </span>
                  )}
                  {isActive ? (
                    <span className="sd-pill trust-core">◆ Active</span>
                  ) : isUnlocked ? (
                    <span className="sd-pill trust-trusted">✓ Unlocked</span>
                  ) : null}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{t.name}</div>
                <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                  {t.description}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                {REQUIREMENT_LABEL[t.requirement_type]}: {formatNum(t.requirement_threshold)}
                {Number(t.requirement_season) > 0 && ` · season ${t.requirement_season}`}
                {current !== null && ` · you: ${formatNum(current)}`}
              </div>
              {pct !== null && (
                <div style={{ height: 4, background: "var(--panel-2)", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: "var(--violet)",
                      transition: "width 0.3s",
                    }}
                  />
                </div>
              )}
              {isUnlocked && connected && !isActive && !isArchived && (
                <button
                  type="button"
                  className="sd-btn sd-btn-secondary"
                  onClick={() => onSet(t.title_id)}
                  disabled={txPending === t.title_id}
                  style={{ alignSelf: "flex-start" }}
                >
                  {txPending === t.title_id ? "Setting…" : "Set as display"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function SeasonCard({
  season,
  stats,
}: {
  season: CurrentSeasonResponse | null;
  stats: SeasonStatsResponse | null;
}) {
  return (
    <div className="sd-rail-card">
      <h5>
        Current season
        <span className="live">
          <span className="d" />
          {seasonStatusLabel(season?.status || "")}
        </span>
      </h5>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
        #{season?.number || "—"} · {season?.name || "—"}
      </div>
      <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.5 }}>
        {season?.theme || "—"}
      </div>
      {stats && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--rule)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            fontSize: 12,
          }}
        >
          <div>
            <div style={{ color: "var(--ink-mute)" }}>Blocks left</div>
            <div style={{ color: "var(--ink)", fontWeight: 600 }}>
              {formatNum(stats.blocks_remaining)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--ink-mute)" }}>Active members</div>
            <div style={{ color: "var(--ink)", fontWeight: 600 }}>
              {formatNum(stats.active_members)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  displayTitle,
}: {
  profile: MemberProfile;
  displayTitle: string | null;
}) {
  return (
    <div className="sd-rail-card">
      <h5>Your profile</h5>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div className="sd-avatar lg">
          {(profile.display_name || profile.address).charAt(profile.display_name ? 0 : 8).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--ink)" }}>
            {profile.display_name || profile.username || "Unnamed"}
          </div>
          {displayTitle && (
            <div style={{ fontSize: 11, color: "var(--violet-hi)" }}>◆ {displayTitle}</div>
          )}
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          fontSize: 12,
        }}
      >
        <div>
          <div style={{ color: "var(--ink-mute)" }}>Level</div>
          <div style={{ color: "var(--ink)", fontWeight: 600, fontSize: 16 }}>
            {formatNum(profile.season_level)}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--ink-mute)" }}>Season XP</div>
          <div style={{ color: "var(--ink)", fontWeight: 600, fontSize: 16 }}>
            {formatNum(profile.season_xp)}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--ink-mute)" }}>Lifetime XP</div>
          <div style={{ color: "var(--ink)", fontWeight: 600 }}>
            {formatNum(profile.lifetime_xp)}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--ink-mute)" }}>Guild</div>
          <div style={{ color: "var(--ink)", fontWeight: 600 }}>
            {profile.guild_id && profile.guild_id !== "0" ? `#${profile.guild_id}` : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectCard({ connected }: { connected: boolean }) {
  return (
    <div className="sd-rail-card">
      <h5>Your profile</h5>
      <div style={{ fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.55 }}>
        {connected
          ? "Loading your season profile…"
          : "Connect your wallet to see your XP, achievements, and titles."}
      </div>
    </div>
  );
}

function RaritySummaryCard({
  earned,
  total,
}: {
  earned: Map<Rarity, number>;
  total: Map<Rarity, number>;
}) {
  const rows = RARITY_ORDER.filter((r) => (total.get(r) || 0) > 0);
  if (rows.length === 0) return null;
  return (
    <div className="sd-rail-card">
      <h5>Achievements by rarity</h5>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const e = earned.get(r) || 0;
          const t = total.get(r) || 0;
          const pct = t > 0 ? Math.round((e / t) * 100) : 0;
          return (
            <div key={r} style={{ fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span className={`sd-pill ${RARITY_META[r].cls}`}>{RARITY_META[r].label}</span>
                <span style={{ color: "var(--ink-soft)" }}>
                  {e}/{t}
                </span>
              </div>
              <div style={{ height: 3, background: "var(--panel-2)", borderRadius: 999, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: "var(--violet)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }}>{value}</div>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 28,
          fontWeight: 700,
          color: accent ? "var(--violet-hi)" : "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{label}</div>
      <div style={{ fontSize: 18, color: "var(--ink)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <span style={{ color: "var(--ink-mute)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ color: "var(--ink)", fontSize: 14 }}>{value}</span>
    </div>
  );
}

function QuestsView({
  quests,
  progressByQuest,
  profile,
  connected,
  txPending,
  onStart,
  onClaim,
  onAbandon,
}: {
  quests: Quest[];
  progressByQuest: Map<string, MemberQuestProgress>;
  profile: MemberProfile | null;
  connected: boolean;
  txPending: string | null;
  onStart: (questId: string) => void;
  onClaim: (questId: string) => void;
  onAbandon: (questId: string) => void;
}) {
  if (quests.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        No quests match this filter.
      </div>
    );
  }
  const level = Number(profile?.season_level || 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
      {quests.map((q) => {
        const progress = progressByQuest.get(q.quest_id);
        const isCompleted = !!progress?.completed;
        const isInProgress = !!progress && !progress.completed;
        const minLevel = Number(q.min_level || 0);
        const levelMet = level >= minLevel;
        const prereqMet = !q.prerequisite_quest || !!progressByQuest.get(q.prerequisite_quest)?.completed;
        const locked = !q.active || !levelMet || !prereqMet;
        const startKey = `${SeasonMsgTypeUrls.StartQuest}:${q.quest_id}`;
        const claimKey = `${SeasonMsgTypeUrls.ClaimQuestReward}:${q.quest_id}`;
        const abandonKey = `${SeasonMsgTypeUrls.AbandonQuest}:${q.quest_id}`;
        return (
          <div
            key={q.quest_id}
            style={{
              padding: 16,
              backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
              border:
                "1px solid " +
                (isCompleted
                  ? "var(--violet-ring)"
                  : isInProgress
                    ? "var(--amber)"
                    : "var(--rule)"),
              borderRadius: "var(--r-lg)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              opacity: !connected || !locked || isCompleted || isInProgress ? 1 : 0.82,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {q.repeatable && (
                  <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>
                    Repeatable
                  </span>
                )}
                {q.quest_chain && (
                  <span className="sd-pill tag" style={{ fontSize: 10 }}>
                    {q.quest_chain}
                  </span>
                )}
                {!q.active && (
                  <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>
                    Inactive
                  </span>
                )}
              </div>
              {isCompleted ? (
                <span className="sd-pill trust-trusted">✓ Completed</span>
              ) : isInProgress ? (
                <span className="sd-pill trust-core">◴ In progress</span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600 }}>
                  +{formatNum(q.xp_reward)} XP
                </span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{q.name}</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {q.description}
              </div>
            </div>
            {q.objectives.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {q.objectives.map((o, i) => {
                  const cur = Number(progress?.objective_progress?.[i] || 0);
                  const tgt = Number(o.target || 0);
                  const pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
                  return (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-mute)", marginBottom: 3 }}>
                        <span>{o.description}</span>
                        <span>
                          {formatNum(cur)}/{formatNum(o.target)}
                        </span>
                      </div>
                      <div style={{ height: 3, background: "var(--panel-2)", borderRadius: 999, overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: isCompleted ? "var(--green)" : "var(--violet)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 11, color: "var(--ink-mute)", lineHeight: 1.7 }}>
              {minLevel > 0 && (
                <span style={{ color: levelMet ? "var(--ink-mute)" : "var(--amber)" }}>
                  Min level {minLevel} (you: {level})
                </span>
              )}
              {q.prerequisite_quest && (
                <>
                  {minLevel > 0 && " · "}
                  <span style={{ color: prereqMet ? "var(--ink-mute)" : "var(--amber)" }}>
                    After: {q.prerequisite_quest}
                  </span>
                </>
              )}
              {q.required_achievement && (
                <>
                  {(minLevel > 0 || q.prerequisite_quest) && " · "}
                  Needs achievement: {q.required_achievement}
                </>
              )}
            </div>
            {connected && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!progress && q.active && (
                  <button
                    type="button"
                    className="sd-btn sd-btn-primary"
                    onClick={() => onStart(q.quest_id)}
                    disabled={locked || txPending === startKey}
                  >
                    {txPending === startKey ? "Starting…" : "Start quest"}
                  </button>
                )}
                {isInProgress && (
                  <>
                    <button
                      type="button"
                      className="sd-btn sd-btn-primary"
                      onClick={() => onClaim(q.quest_id)}
                      disabled={txPending === claimKey}
                    >
                      {txPending === claimKey ? "Claiming…" : "Claim reward"}
                    </button>
                    <button
                      type="button"
                      className="sd-btn-ghost"
                      onClick={() => onAbandon(q.quest_id)}
                      disabled={txPending === abandonKey}
                    >
                      {txPending === abandonKey ? "Abandoning…" : "Abandon"}
                    </button>
                  </>
                )}
                {isCompleted && q.repeatable && (
                  <button
                    type="button"
                    className="sd-btn sd-btn-secondary"
                    onClick={() => onStart(q.quest_id)}
                    disabled={txPending === startKey}
                  >
                    {txPending === startKey ? "Starting…" : "Repeat"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IdentityView({
  profile,
  params,
  connected,
  txPending,
  onSetDisplayName,
  onSetUsername,
}: {
  profile: MemberProfile | null;
  params: SeasonParams | null;
  connected: boolean;
  txPending: string | null;
  onSetDisplayName: (name: string) => void;
  onSetUsername: (username: string) => void;
}) {
  const [name, setName] = useState(profile?.display_name || "");
  const [uname, setUname] = useState(profile?.username || "");

  if (!connected) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        Connect your wallet to manage your season identity.
      </div>
    );
  }

  const nameMin = params?.display_name_min_length ?? 1;
  const nameMax = params?.display_name_max_length ?? 50;
  const nameCooldown = params?.display_name_change_cooldown_epochs ?? "0";
  const unameMin = params?.username_min_length ?? 3;
  const unameMax = params?.username_max_length ?? 20;
  const unameCooldown = params?.username_change_cooldown_epochs ?? "0";
  const unameCost = params?.username_cost_dream ?? "0";

  const nameValid = name.length >= nameMin && name.length <= nameMax;
  const unameValid = uname.length >= unameMin && uname.length <= unameMax;
  const nameChanged = name !== (profile?.display_name || "");
  const unameChanged = uname !== (profile?.username || "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FormCard
        title="Display name"
        hint={`${nameMin}–${nameMax} chars · cooldown ${nameCooldown} epoch${nameCooldown === "1" ? "" : "s"} between changes`}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input
            className="sd-input-like"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            style={identityInputStyle}
            maxLength={nameMax}
          />
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            onClick={() => onSetDisplayName(name)}
            disabled={!nameValid || !nameChanged || txPending === "__display_name__"}
          >
            {txPending === "__display_name__" ? "Saving…" : "Save"}
          </button>
        </div>
        <IdentityMeta
          rows={[
            ["Current", profile?.display_name || "—"],
            ["Last changed", formatNum(profile?.last_display_name_change_epoch) + " (epoch)"],
          ]}
        />
      </FormCard>

      <FormCard
        title="Username"
        hint={`${unameMin}–${unameMax} chars · cooldown ${unameCooldown} epochs · costs ${formatNum(unameCost)} DREAM to change`}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input
            className="sd-input-like"
            value={uname}
            onChange={(e) => setUname(e.target.value.toLowerCase())}
            placeholder="username"
            style={identityInputStyle}
            maxLength={unameMax}
          />
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            onClick={() => onSetUsername(uname)}
            disabled={!unameValid || !unameChanged || txPending === "__username__"}
          >
            {txPending === "__username__" ? "Saving…" : "Save"}
          </button>
        </div>
        <IdentityMeta
          rows={[
            ["Current", profile?.username || "—"],
            ["Last changed", formatNum(profile?.last_username_change_epoch) + " (epoch)"],
          ]}
        />
      </FormCard>

      <FormCard title="Display title" hint="Managed on the Titles tab">
        <div style={{ fontSize: 14, color: "var(--ink-soft)" }}>
          {profile?.display_title ? (
            <span className="sd-pill tag">{profile.display_title}</span>
          ) : (
            "None set"
          )}
        </div>
      </FormCard>
    </div>
  );
}

const identityInputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  background: "var(--panel-2)",
  border: "1px solid var(--rule-strong)",
  borderRadius: "var(--r-sm)",
  color: "var(--ink)",
  fontSize: 14,
  outline: "none",
};

function FormCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 20,
        backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
      }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
        {title}
      </h3>
      {hint && (
        <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 14 }}>{hint}</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function IdentityMeta({ rows }: { rows: [string, string][] }) {
  return (
    <div
      style={{
        marginTop: 6,
        paddingTop: 10,
        borderTop: "1px solid var(--rule)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 10,
        fontSize: 12,
      }}
    >
      {rows.map(([label, value]) => (
        <div key={label}>
          <div style={{ color: "var(--ink-mute)" }}>{label}</div>
          <div style={{ color: "var(--ink)", fontWeight: 500 }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function GuildView({
  subview,
  setSubview,
  guilds,
  myGuild,
  myRole,
  myInvites,
  membersByGuild,
  address,
  connected,
  txPending,
  onCreate,
  onJoin,
  onAccept,
  onLeave,
  onInvite,
  onRevoke,
  onKick,
  onPromote,
  onDemote,
  onTransferFounder,
  onDissolve,
  onSetInviteOnly,
  onUpdateDescription,
}: {
  subview: GuildSubview;
  setSubview: (s: GuildSubview) => void;
  guilds: Guild[];
  myGuild: Guild | null;
  myRole: "founder" | "officer" | "member" | null;
  myInvites: Guild[];
  membersByGuild: Map<string, GuildMembership[]>;
  address: string | null;
  connected: boolean;
  txPending: string | null;
  onCreate: (name: string, description: string, inviteOnly: boolean) => void;
  onJoin: (guildId: string) => void;
  onAccept: (guildId: string) => void;
  onLeave: () => void;
  onInvite: (guildId: string, invitee: string) => void;
  onRevoke: (guildId: string, invitee: string) => void;
  onKick: (guildId: string, member: string, reason: string) => void;
  onPromote: (guildId: string, member: string) => void;
  onDemote: (guildId: string, officer: string) => void;
  onTransferFounder: (guildId: string, newFounder: string) => void;
  onDissolve: (guildId: string) => void;
  onSetInviteOnly: (guildId: string, inviteOnly: boolean) => void;
  onUpdateDescription: (guildId: string, description: string) => void;
}) {
  if (!connected) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        Connect your wallet to join or manage a guild.
      </div>
    );
  }

  if (subview === "create") {
    return (
      <GuildCreateForm
        txPending={txPending === "__create_guild__"}
        onCreate={onCreate}
        existingNames={new Set(guilds.map((g) => g.name.toLowerCase()))}
      />
    );
  }

  if (subview === "invites") {
    return (
      <GuildInvitesView
        invites={myInvites}
        onAccept={onAccept}
        txPending={txPending}
      />
    );
  }

  if (subview === "browse") {
    return (
      <GuildBrowseView
        guilds={guilds}
        myGuild={myGuild}
        membersByGuild={membersByGuild}
        onJoin={onJoin}
        txPending={txPending}
        address={address}
        onOpenCreate={() => setSubview("create")}
      />
    );
  }

  // mine
  if (!myGuild) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        <p style={{ margin: 0 }}>You&apos;re not in a guild.</p>
        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center" }}>
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            onClick={() => setSubview("browse")}
          >
            Browse guilds
          </button>
          <button
            type="button"
            className="sd-btn sd-btn-secondary"
            onClick={() => setSubview("create")}
          >
            Create a guild
          </button>
          {myInvites.length > 0 && (
            <button
              type="button"
              className="sd-btn-ghost"
              onClick={() => setSubview("invites")}
            >
              {myInvites.length} pending invite{myInvites.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <GuildDetailView
      guild={myGuild}
      members={membersByGuild.get(myGuild.id) || []}
      role={myRole}
      address={address}
      txPending={txPending}
      onLeave={onLeave}
      onInvite={onInvite}
      onRevoke={onRevoke}
      onKick={onKick}
      onPromote={onPromote}
      onDemote={onDemote}
      onTransferFounder={onTransferFounder}
      onDissolve={onDissolve}
      onSetInviteOnly={onSetInviteOnly}
      onUpdateDescription={onUpdateDescription}
    />
  );
}

function GuildCreateForm({
  txPending,
  onCreate,
  existingNames,
}: {
  txPending: boolean;
  onCreate: (name: string, description: string, inviteOnly: boolean) => void;
  existingNames: Set<string>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inviteOnly, setInviteOnly] = useState(false);
  const nameTaken = name.length > 0 && existingNames.has(name.toLowerCase());
  const nameValid = name.length >= 3 && !nameTaken;
  return (
    <div
      style={{
        padding: 20,
        backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
        Create a guild
      </h3>
      <div>
        <label style={formLabelStyle}>Guild name</label>
        <input
          style={identityInputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Dreamforge"
          maxLength={40}
        />
        {nameTaken && (
          <div style={{ marginTop: 4, fontSize: 12, color: "#fb7185" }}>Name already taken</div>
        )}
      </div>
      <div>
        <label style={formLabelStyle}>Description</label>
        <textarea
          style={{ ...identityInputStyle, minHeight: 80, resize: "vertical" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's your guild about?"
          maxLength={240}
        />
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={inviteOnly}
          onChange={(e) => setInviteOnly(e.target.checked)}
        />
        Invite-only (members must be invited by a founder or officer)
      </label>
      <div>
        <button
          type="button"
          className="sd-btn sd-btn-primary"
          onClick={() => onCreate(name, description, inviteOnly)}
          disabled={!nameValid || txPending}
        >
          {txPending ? "Creating…" : "Create guild"}
        </button>
      </div>
    </div>
  );
}

function GuildInvitesView({
  invites,
  onAccept,
  txPending,
}: {
  invites: Guild[];
  onAccept: (guildId: string) => void;
  txPending: string | null;
}) {
  if (invites.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        No pending invites.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
      {invites.map((g) => (
        <GuildCard key={g.id} guild={g}>
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            onClick={() => onAccept(g.id)}
            disabled={txPending === `__accept__:${g.id}`}
          >
            {txPending === `__accept__:${g.id}` ? "Accepting…" : "Accept invite"}
          </button>
        </GuildCard>
      ))}
    </div>
  );
}

function GuildBrowseView({
  guilds,
  myGuild,
  membersByGuild,
  onJoin,
  txPending,
  address,
  onOpenCreate,
}: {
  guilds: Guild[];
  myGuild: Guild | null;
  membersByGuild: Map<string, GuildMembership[]>;
  onJoin: (id: string) => void;
  txPending: string | null;
  address: string | null;
  onOpenCreate: () => void;
}) {
  const active = guilds.filter((g) => g.status === "GUILD_STATUS_ACTIVE");
  if (active.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        <p style={{ margin: 0 }}>No guilds yet.</p>
        <button
          type="button"
          className="sd-btn sd-btn-primary"
          onClick={onOpenCreate}
          style={{ marginTop: 14 }}
        >
          Create the first one
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
      {active.map((g) => {
        const memberCount = (membersByGuild.get(g.id) || []).length;
        const isInvited = address ? (g.pending_invites || []).includes(address) : false;
        const isMyGuild = myGuild?.id === g.id;
        return (
          <GuildCard key={g.id} guild={g} memberCount={memberCount}>
            {isMyGuild ? (
              <span style={{ fontSize: 12, color: "var(--violet-hi)" }}>Your guild</span>
            ) : myGuild ? (
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>
                Leave your current guild to join
              </span>
            ) : isInvited ? (
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                disabled
              >
                Invited — check Invites tab
              </button>
            ) : g.invite_only ? (
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>Invite-only</span>
            ) : (
              <button
                type="button"
                className="sd-btn sd-btn-primary"
                onClick={() => onJoin(g.id)}
                disabled={txPending === `__join__:${g.id}`}
              >
                {txPending === `__join__:${g.id}` ? "Joining…" : "Join"}
              </button>
            )}
          </GuildCard>
        );
      })}
    </div>
  );
}

function GuildCard({
  guild,
  memberCount,
  children,
}: {
  guild: Guild;
  memberCount?: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 16,
        backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {guild.invite_only && (
            <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>
              Invite-only
            </span>
          )}
          {guild.status === "GUILD_STATUS_FROZEN" && (
            <span className="sd-pill trust-core">Frozen</span>
          )}
          {guild.status === "GUILD_STATUS_DISSOLVED" && (
            <span className="sd-pill tag-neutral">Dissolved</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>
          #{guild.id}
          {typeof memberCount === "number" && ` · ${memberCount} members`}
        </span>
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>{guild.name}</div>
        <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {guild.description || <span style={{ color: "var(--ink-mute)" }}>No description</span>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
        Founder: <CopyableAddress style={{ fontFamily: "var(--font-mono), monospace" }} address={guild.founder} />
      </div>
      {children && <div>{children}</div>}
    </div>
  );
}

function GuildDetailView({
  guild,
  members,
  role,
  address,
  txPending,
  onLeave,
  onInvite,
  onRevoke,
  onKick,
  onPromote,
  onDemote,
  onTransferFounder,
  onDissolve,
  onSetInviteOnly,
  onUpdateDescription,
}: {
  guild: Guild;
  members: GuildMembership[];
  role: "founder" | "officer" | "member" | null;
  address: string | null;
  txPending: string | null;
  onLeave: () => void;
  onInvite: (guildId: string, invitee: string) => void;
  onRevoke: (guildId: string, invitee: string) => void;
  onKick: (guildId: string, member: string, reason: string) => void;
  onPromote: (guildId: string, member: string) => void;
  onDemote: (guildId: string, officer: string) => void;
  onTransferFounder: (guildId: string, newFounder: string) => void;
  onDissolve: (guildId: string) => void;
  onSetInviteOnly: (guildId: string, inviteOnly: boolean) => void;
  onUpdateDescription: (guildId: string, description: string) => void;
}) {
  const [inviteAddr, setInviteAddr] = useState("");
  const [newDescription, setNewDescription] = useState(guild.description);
  const [transferTo, setTransferTo] = useState("");
  const canManage = role === "founder" || role === "officer";
  const isFounder = role === "founder";
  const officers = new Set(guild.officers || []);
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.member === guild.founder) return -1;
      if (b.member === guild.founder) return 1;
      const ao = officers.has(a.member) ? 0 : 1;
      const bo = officers.has(b.member) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.member.localeCompare(b.member);
    });
  // officers is derived from guild.officers — depending on guild.officers is sufficient
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, guild.founder, guild.officers]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          padding: 20,
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--r-lg)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="sd-pill tag">#{guild.id}</span>
            <span className="sd-pill trust-trusted">{role === "founder" ? "Founder" : role === "officer" ? "Officer" : "Member"}</span>
            {guild.invite_only && (
              <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>Invite-only</span>
            )}
            {guild.status === "GUILD_STATUS_FROZEN" && <span className="sd-pill trust-core">Frozen</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
            Created at block {formatNum(guild.created_block)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "var(--ink)" }}>{guild.name}</div>
          <div style={{ marginTop: 4, fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.5 }}>
            {guild.description || <span style={{ color: "var(--ink-mute)" }}>No description</span>}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>
          Founder: <CopyableAddress style={{ fontFamily: "var(--font-mono), monospace" }} address={guild.founder} />
          {" · "}
          Members: {members.length}
        </div>
        {role !== "founder" && (
          <div>
            <button
              type="button"
              className="sd-btn-ghost"
              onClick={onLeave}
              disabled={txPending === "__leave__"}
            >
              {txPending === "__leave__" ? "Leaving…" : "Leave guild"}
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          padding: 20,
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--r-lg)",
        }}
      >
        <h3 style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
          Members ({members.length})
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sortedMembers.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>No members yet.</div>
          )}
          {sortedMembers.map((m) => {
            const isFounderMember = m.member === guild.founder;
            const isOfficer = officers.has(m.member);
            const isSelf = m.member === address;
            return (
              <div
                key={m.member}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  background: "var(--panel-2)",
                  borderRadius: "var(--r-sm)",
                }}
              >
                <div className="sd-avatar sm">{m.member.charAt(8).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--ink)", fontFamily: "var(--font-mono), monospace" }}>
                    <CopyableAddress address={m.member} />
                    {isSelf && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--ink-mute)" }}>(you)</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                    Joined epoch {formatNum(m.joined_epoch)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {isFounderMember && <span className="sd-pill trust-core">Founder</span>}
                  {isOfficer && !isFounderMember && (
                    <span className="sd-pill trust-trusted">Officer</span>
                  )}
                  {isFounder && !isSelf && !isFounderMember && (
                    <>
                      {isOfficer ? (
                        <button
                          type="button"
                          className="sd-btn-ghost"
                          onClick={() => onDemote(guild.id, m.member)}
                          disabled={txPending === `__demote__:${m.member}`}
                        >
                          Demote
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="sd-btn-ghost"
                          onClick={() => onPromote(guild.id, m.member)}
                          disabled={txPending === `__promote__:${m.member}`}
                        >
                          Promote
                        </button>
                      )}
                    </>
                  )}
                  {canManage && !isSelf && !isFounderMember && (!isOfficer || isFounder) && (
                    <button
                      type="button"
                      className="sd-btn-ghost"
                      onClick={() => {
                        const reason = prompt("Reason for kick?") || "";
                        if (reason) onKick(guild.id, m.member, reason);
                      }}
                      disabled={txPending === `__kick__:${m.member}`}
                    >
                      Kick
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canManage && (
        <div
          style={{
            padding: 20,
            backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--r-lg)",
          }}
        >
          <h3 style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
            Invite member
          </h3>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              style={identityInputStyle}
              value={inviteAddr}
              onChange={(e) => setInviteAddr(e.target.value.trim())}
              placeholder="sprkdrm1…"
            />
            <button
              type="button"
              className="sd-btn sd-btn-primary"
              onClick={() => {
                onInvite(guild.id, inviteAddr);
                setInviteAddr("");
              }}
              disabled={!inviteAddr.startsWith("sprkdrm1") || txPending?.startsWith("__invite__")}
            >
              Invite
            </button>
          </div>
          {guild.pending_invites && guild.pending_invites.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 6 }}>
                Pending invites ({guild.pending_invites.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {guild.pending_invites.map((inv) => (
                  <div
                    key={inv}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 10px",
                      background: "var(--panel-2)",
                      borderRadius: "var(--r-sm)",
                      fontSize: 12,
                    }}
                  >
                    <CopyableAddress style={{ flex: 1, fontFamily: "var(--font-mono), monospace", color: "var(--ink-soft)" }} address={inv} />
                    <button
                      type="button"
                      className="sd-btn-ghost"
                      onClick={() => onRevoke(guild.id, inv)}
                      disabled={txPending === `__revoke__:${inv}`}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isFounder && (
        <div
          style={{
            padding: 20,
            backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--r-lg)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
            Founder controls
          </h3>

          <div>
            <label style={formLabelStyle}>Description</label>
            <textarea
              style={{ ...identityInputStyle, minHeight: 70, resize: "vertical" }}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              maxLength={240}
            />
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                onClick={() => onUpdateDescription(guild.id, newDescription)}
                disabled={newDescription === guild.description || txPending === "__update_desc__"}
              >
                {txPending === "__update_desc__" ? "Saving…" : "Save description"}
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: "var(--ink-soft)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={guild.invite_only}
                onChange={(e) => onSetInviteOnly(guild.id, e.target.checked)}
                disabled={txPending === "__invite_only__"}
              />
              Invite-only (members must be invited)
            </label>
          </div>

          <div>
            <label style={formLabelStyle}>Transfer founder</label>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                style={identityInputStyle}
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value.trim())}
                placeholder="sprkdrm1… (must be a current officer)"
              />
              <button
                type="button"
                className="sd-btn sd-btn-secondary"
                onClick={() => {
                  if (confirm(`Transfer founder role to ${transferTo}?`)) {
                    onTransferFounder(guild.id, transferTo);
                    setTransferTo("");
                  }
                }}
                disabled={!transferTo.startsWith("sprkdrm1") || txPending === "__transfer__"}
              >
                Transfer
              </button>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
            <button
              type="button"
              className="sd-btn-ghost"
              style={{ color: "#fb7185", borderColor: "rgba(244,63,94,0.35)" }}
              onClick={() => {
                if (confirm(`Dissolve guild "${guild.name}"? This cannot be undone.`)) {
                  onDissolve(guild.id);
                }
              }}
              disabled={txPending === "__dissolve__"}
            >
              {txPending === "__dissolve__" ? "Dissolving…" : "Dissolve guild"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const formLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--ink-mute)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 6,
};

function formatDec(d: string | undefined): string {
  if (!d) return "0";
  const n = Number(d);
  if (!Number.isFinite(n)) return d;
  if (n >= 1000000) return (n / 1000000).toFixed(2) + "M";
  if (n >= 1000) return (n / 1000).toFixed(2) + "K";
  if (Math.abs(n) < 0.01 && n !== 0) return n.toExponential(2);
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}

function NominationsView({
  subview,
  setSubview,
  nominations,
  retroRewards,
  currentSeason,
  params,
  address,
  connected,
  txPending,
  onNominate,
  onStake,
  onUnstake,
}: {
  subview: NominationSubview;
  setSubview: (s: NominationSubview) => void;
  nominations: Nomination[];
  retroRewards: RetroRewardRecord[];
  currentSeason: string;
  params: SeasonParams | null;
  address: string | null;
  connected: boolean;
  txPending: string | null;
  onNominate: (contentRef: string, rationale: string) => void;
  onStake: (id: string, amount: string) => void;
  onUnstake: (id: string) => void;
}) {
  if (subview === "create") {
    return (
      <NominateForm
        params={params}
        connected={connected}
        txPending={txPending === "__nominate__"}
        onNominate={onNominate}
      />
    );
  }

  if (subview === "rewards") {
    return (
      <RetroRewardsView records={retroRewards} currentSeason={currentSeason} />
    );
  }

  const list =
    subview === "mine" && address
      ? nominations.filter((n) => n.nominator === address)
      : nominations;

  const sorted = [...list].sort(
    (a, b) => Number(b.conviction || 0) - Number(a.conviction || 0)
  );

  if (sorted.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        <p style={{ margin: 0 }}>
          {subview === "mine"
            ? "You haven't nominated anyone this season."
            : "No nominations yet."}
        </p>
        {connected && (
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            style={{ marginTop: 14 }}
            onClick={() => setSubview("create")}
          >
            Nominate a contribution
          </button>
        )}
      </div>
    );
  }

  const minConviction = Number(params?.retro_reward_min_conviction || 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
      {sorted.map((n) => (
        <NominationCard
          key={n.id}
          nomination={n}
          minConviction={minConviction}
          address={address}
          connected={connected}
          txPending={txPending}
          onStake={onStake}
          onUnstake={onUnstake}
        />
      ))}
    </div>
  );
}

function NominationCard({
  nomination,
  minConviction,
  address,
  connected,
  txPending,
  onStake,
  onUnstake,
}: {
  nomination: Nomination;
  minConviction: number;
  address: string | null;
  connected: boolean;
  txPending: string | null;
  onStake: (id: string, amount: string) => void;
  onUnstake: (id: string) => void;
}) {
  const [stakeInput, setStakeInput] = useState("");
  const conviction = Number(nomination.conviction || 0);
  const pct = minConviction > 0 ? Math.min(100, Math.round((conviction / minConviction) * 100)) : 0;
  const isMine = address === nomination.nominator;
  const stakeKey = `__stake__:${nomination.id}`;
  const unstakeKey = `__unstake__:${nomination.id}`;

  return (
    <div
      style={{
        padding: 16,
        backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
        border: "1px solid " + (nomination.rewarded ? "var(--violet-ring)" : "var(--rule)"),
        borderRadius: "var(--r-lg)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="sd-pill tag">#{nomination.id}</span>
          <span className="sd-pill tag-neutral" style={{ fontSize: 10 }}>
            S{nomination.season}
          </span>
          {nomination.rewarded && (
            <span className="sd-pill trust-trusted">
              ✓ Rewarded · {formatDec(nomination.reward_amount)}
            </span>
          )}
          {isMine && <span className="sd-pill trust-core">Yours</span>}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>
          block {formatNum(nomination.created_at_block)}
        </span>
      </div>
      <div>
        <div
          style={{
            fontSize: 13,
            fontFamily: "var(--font-mono), monospace",
            color: "var(--violet-hi)",
            wordBreak: "break-all",
          }}
        >
          {nomination.content_ref}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {nomination.rationale}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
        Nominated by{" "}
        <CopyableAddress style={{ fontFamily: "var(--font-mono), monospace" }} address={nomination.nominator} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
        <div>
          <div style={{ color: "var(--ink-mute)" }}>Staked</div>
          <div style={{ color: "var(--ink)", fontWeight: 600 }}>
            {formatDec(nomination.total_staked)} DREAM
          </div>
        </div>
        <div>
          <div style={{ color: "var(--ink-mute)" }}>
            Conviction{minConviction > 0 && ` · min ${formatDec(String(minConviction))}`}
          </div>
          <div style={{ color: "var(--ink)", fontWeight: 600 }}>
            {formatDec(nomination.conviction)}
          </div>
        </div>
      </div>
      {minConviction > 0 && !nomination.rewarded && (
        <div style={{ height: 3, background: "var(--panel-2)", borderRadius: 999, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: conviction >= minConviction ? "var(--green)" : "var(--violet)",
            }}
          />
        </div>
      )}
      {connected && !nomination.rewarded && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
          <input
            style={{ ...identityInputStyle, flex: 1, minWidth: 100 }}
            placeholder="Amount"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            inputMode="decimal"
          />
          <button
            type="button"
            className="sd-btn sd-btn-primary"
            onClick={() => {
              onStake(nomination.id, stakeInput);
              setStakeInput("");
            }}
            disabled={!stakeInput || Number(stakeInput) <= 0 || txPending === stakeKey}
          >
            {txPending === stakeKey ? "Staking…" : "Stake"}
          </button>
          <button
            type="button"
            className="sd-btn-ghost"
            onClick={() => onUnstake(nomination.id)}
            disabled={txPending === unstakeKey}
          >
            {txPending === unstakeKey ? "Unstaking…" : "Unstake"}
          </button>
        </div>
      )}
    </div>
  );
}

function NominateForm({
  params,
  connected,
  txPending,
  onNominate,
}: {
  params: SeasonParams | null;
  connected: boolean;
  txPending: boolean;
  onNominate: (contentRef: string, rationale: string) => void;
}) {
  const [contentRef, setContentRef] = useState("");
  const [rationale, setRationale] = useState("");
  const maxLen = Number(params?.nomination_rationale_max_length || 500);
  const minTrust = params?.nomination_min_trust_level;
  const maxPerMember = params?.max_nominations_per_member;
  const minStake = params?.nomination_min_stake;

  if (!connected) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        Connect your wallet to nominate a contribution.
      </div>
    );
  }

  const valid = contentRef.length > 0 && rationale.length > 0 && rationale.length <= maxLen;

  return (
    <div
      style={{
        padding: 20,
        backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <h3 style={{ margin: 0, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-mute)" }}>
        Nominate a contribution
      </h3>
      <div style={{ fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.55 }}>
        Point to a past contribution that deserves retroactive DREAM rewards. Other members stake
        conviction on nominations; top-conviction picks share the season&apos;s retro budget.
      </div>

      <div>
        <label style={formLabelStyle}>Content reference</label>
        <input
          style={identityInputStyle}
          value={contentRef}
          onChange={(e) => setContentRef(e.target.value.trim())}
          placeholder="e.g. blog/post/42  ·  forum/post/7  ·  rep/initiative/5"
        />
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-mute)" }}>
          Path to the contribution: <code>&lt;module&gt;/&lt;kind&gt;/&lt;id&gt;</code>.
        </div>
      </div>

      <div>
        <label style={formLabelStyle}>Rationale</label>
        <textarea
          style={{ ...identityInputStyle, minHeight: 100, resize: "vertical" }}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why does this contribution deserve retroactive rewards?"
          maxLength={maxLen}
        />
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--ink-mute)" }}>
          {rationale.length}/{maxLen}
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--rule)",
          paddingTop: 10,
          fontSize: 11,
          color: "var(--ink-mute)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        {minTrust !== undefined && (
          <div>
            <div>Min trust level</div>
            <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>{String(minTrust)}</div>
          </div>
        )}
        {maxPerMember !== undefined && (
          <div>
            <div>Max per season</div>
            <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>{String(maxPerMember)}</div>
          </div>
        )}
        {minStake !== undefined && minStake !== null && (
          <div>
            <div>Min stake (for stakers)</div>
            <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>
              {formatDec(String(minStake))} DREAM
            </div>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          className="sd-btn sd-btn-primary"
          onClick={() => onNominate(contentRef, rationale)}
          disabled={!valid || txPending}
        >
          {txPending ? "Submitting…" : "Submit nomination"}
        </button>
      </div>
    </div>
  );
}

function RetroRewardsView({
  records,
  currentSeason,
}: {
  records: RetroRewardRecord[];
  currentSeason: string;
}) {
  if (records.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
          border: "1px dashed var(--rule-strong)",
          borderRadius: "var(--r-lg)",
          color: "var(--ink-mute)",
        }}
      >
        No retro rewards distributed for season {currentSeason} yet.
      </div>
    );
  }
  const sorted = [...records].sort(
    (a, b) => Number(b.reward_amount || 0) - Number(a.reward_amount || 0)
  );
  return (
    <div
      style={{
        backgroundColor: "var(--panel)", backgroundImage: "var(--hull-texture)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--rule)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink)",
        }}
      >
        Retro rewards · season {currentSeason}
      </div>
      <div>
        {sorted.map((r, i) => (
          <div
            key={`${r.nomination_id}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr auto auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 18px",
              borderTop: i === 0 ? undefined : "1px solid var(--rule)",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--ink-mute)", fontFamily: "var(--font-mono), monospace" }}>
              #{r.nomination_id}
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-mono), monospace",
                  color: "var(--violet-hi)",
                  wordBreak: "break-all",
                }}
              >
                {r.content_ref}
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                to <CopyableAddress address={r.recipient} /> · block {formatNum(r.distributed_at_block)}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: "var(--ink-mute)" }}>
              <div>Conviction</div>
              <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>
                {formatDec(r.conviction)}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>Reward</div>
              <div style={{ color: "var(--green)", fontWeight: 600 }}>
                {formatDec(r.reward_amount)} DREAM
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
