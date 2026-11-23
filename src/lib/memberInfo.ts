import { getBondedRole, getOwnerInfo, listNamesByOwner, listTargetsForAddress } from "@/lib/api";
import { isMissingEndpoint } from "@/lib/errors";
import type { ListNamesResponse, NameRecord } from "@/types/name";
import type { BondedRole, RoleTypeValue } from "@/types/rep";
import { RoleType } from "@/types/rep";

// Per-member reads shared by the member page and the season profile.

/** Resolve to `empty` when the chain has no such record or endpoint. */
export async function orEmpty<T>(p: Promise<T>, empty: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (isMissingEndpoint(err)) return empty;
    throw err;
  }
}

/** Roles a member holds by locking a DREAM bond (x/rep bonded roles). */
const BONDED_ROLES: { type: RoleTypeValue; label: string }[] = [
  { type: RoleType.CONTENT_SENTINEL, label: "Content sentinel" },
  { type: RoleType.COLLECT_CURATOR, label: "Collection curator" },
  { type: RoleType.FEDERATION_VERIFIER, label: "Federation verifier" },
  { type: RoleType.INITIATIVE_REVIEWER, label: "Initiative reviewer" },
];

export interface RoleBond {
  label: string;
  role: BondedRole;
}

export async function loadRoleBonds(address: string): Promise<RoleBond[]> {
  const roles = await Promise.all(
    BONDED_ROLES.map(async ({ type, label }) => {
      const res = await orEmpty(getBondedRole(type, address), null);
      const role = res?.bonded_role;
      return role?.address && /^\d+$/.test(role.current_bond || "") && role.current_bond !== "0" ? { label, role } : null;
    }),
  );
  return roles.filter((r): r is RoleBond => r !== null);
}

export interface Names {
  /** Every name this address owns. */
  owned: NameRecord[];
  /** Names other addresses own that resolve here. */
  pointed: NameRecord[];
  primary: string;
  /** Zeroed by x/rep: the names are released and anyone can claim them. */
  released: boolean;
}

export async function loadNames(address: string): Promise<Names> {
  const owned: NameRecord[] = [];
  let key: string | null = null;
  // The chain caps names per address, so this is a page or two at most.
  for (let page = 0; page < 20; page++) {
    const res: ListNamesResponse | null = await orEmpty(listNamesByOwner(address, key ? { limit: "200", key } : { limit: "200" }), null);
    owned.push(...(res?.names || []));
    key = res?.pagination?.next_key || null;
    if (!key) break;
  }
  const [info, targets] = await Promise.all([
    getOwnerInfo(address).catch(() => null),
    listTargetsForAddress(address, { limit: "200" }).catch(() => null),
  ]);
  const primary = info?.owner_info?.primary_name || "";
  owned.sort((a, b) => Number(b.name === primary) - Number(a.name === primary) || a.name.localeCompare(b.name));
  return {
    owned,
    pointed: (targets?.names || []).filter((n) => n.owner !== address).sort((a, b) => a.name.localeCompare(b.name)),
    primary,
    released: !!info?.owner_info?.scavengeable,
  };
}
