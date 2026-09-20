"use client";

import { useEffect, useState } from "react";
import { listGroups, getCouncilMembers } from "@/lib/api";
import type { Group } from "@/types/commons";

export const COUNCIL_NAME = "Commons Council";
export const COMMITTEE_NAME = "Commons Operations Committee";

/**
 * Which body a federation peer message can be executed by.
 *
 * Two independent grants decide this and they do not agree, which is why this
 * cannot be a single constant:
 *
 *  - The x/federation keeper decides who may SIGN. Four of the five peer
 *    messages use IsCouncilAuthorized, which accepts gov, the council policy,
 *    the committee policy, OR any individual Operations Committee member.
 *    MsgResumePeer uses IsCouncilOrCommitteePolicy, which drops the
 *    individual: activation is the trust decision and takes a passed vote.
 *  - x/commons decides which POLICY may carry the message in a proposal, via
 *    that policy's allowed_messages. RegisterPeer / RemovePeer / SuspendPeer
 *    sit only on the council; UpdatePeerPolicy and ResumePeer sit on the
 *    committee.
 *
 * So "open a vote" has a different destination per message, and sending one to
 * the wrong body produces a proposal that sits SUBMITTED until its voting
 * period lapses and then does nothing.
 */
export type PeerMsgKind =
  | "register"
  | "resume"
  | "suspend"
  | "remove"
  | "policy";

/** The policy whose allowed_messages carries each message. */
export const VOTE_TARGET: Record<PeerMsgKind, "council" | "committee"> = {
  register: "council",
  remove: "council",
  suspend: "council",
  policy: "committee",
  resume: "committee",
};

/** Messages the chain will not accept from an individual signature. */
export const FORCES_VOTE: Record<PeerMsgKind, boolean> = {
  register: false,
  remove: false,
  suspend: false,
  policy: false,
  resume: true,
};

export type PeerRoute =
  /** Still resolving membership. Render nothing decisive yet. */
  | { kind: "loading" }
  /** Sign as the connected address; the keeper accepts an individual member. */
  | { kind: "direct" }
  /** Submit a proposal to this policy, which the address may vote on. */
  | { kind: "vote"; body: "council" | "committee"; policyAddress: string; isMemberOfBody: boolean }
  /** Connected address is on neither body; the chain would reject anything. */
  | { kind: "blocked" }
  /** Groups could not be read, so nothing can be routed. */
  | { kind: "unavailable" };

/**
 * The routing decision, with no React and no network in it, so the table it
 * encodes can be exercised directly.
 */
export function decideRoute(input: {
  kind: PeerMsgKind;
  ready: boolean;
  onCouncil: boolean | null;
  onCommittee: boolean | null;
  preferVote: boolean;
  councilPolicy: string | null;
  committeePolicy: string | null;
}): PeerRoute {
  const { kind, ready, onCouncil, onCommittee, preferVote } = input;
  if (!ready) return { kind: "loading" };

  const body = VOTE_TARGET[kind];
  const policyAddress =
    body === "council" ? input.councilPolicy : input.committeePolicy;
  const vote = (): PeerRoute =>
    policyAddress
      ? {
          kind: "vote",
          body,
          policyAddress,
          isMemberOfBody: (body === "council" ? onCouncil : onCommittee) === true,
        }
      : { kind: "unavailable" };

  // Activation is never signable by an individual, whatever else is true.
  if (FORCES_VOTE[kind]) return vote();
  // A member who could sign directly may still ask for deliberation.
  if (preferVote) return vote();
  // The keeper accepts an individual Operations Committee member for the rest.
  if (onCommittee === true) return { kind: "direct" };
  // Council members cannot sign these individually, but can propose.
  if (onCouncil === true) return vote();
  return { kind: "blocked" };
}

/**
 * Resolve how the connected address should submit a given peer message.
 *
 * Deliberately NOT driven by a deployment env flag. Whether direct signing is
 * available is a property of WHO IS CONNECTED, not of the deployment: an
 * Operations Committee member may sign these directly on any chain including
 * mainnet, and a council member who is not on the committee may not, on any
 * chain including a devnet. A deployment-wide toggle gets both of those wrong
 * half the time -- it offered direct signing to members who could not use it,
 * and hid it from members for whom it is the only available route.
 *
 * `preferVote` lets a member who COULD sign directly choose deliberation
 * anyway, which is a real want for a destructive action like remove.
 */
export function usePeerAuthRoute(
  kind: PeerMsgKind,
  address: string | null | undefined,
  preferVote = false
) {
  const [council, setCouncil] = useState<Group | null>(null);
  const [committee, setCommittee] = useState<Group | null>(null);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  // Keyed by the address it was resolved for, so a stale answer from a
  // previous wallet is never read as the current one's permissions. Set only
  // from the async callbacks -- clearing it synchronously when `address` goes
  // away would be a setState inside an effect body.
  const [membership, setMembership] = useState<{
    address: string;
    onCouncil: boolean | null;
    onCommittee: boolean | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listGroups()
      .then((res) => {
        if (cancelled) return;
        const groups = res.group || [];
        setCouncil(groups.find((g) => g.index === COUNCIL_NAME) ?? null);
        setCommittee(groups.find((g) => g.index === COMMITTEE_NAME) ?? null);
        setGroupsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCouncil(null);
        setCommittee(null);
        setGroupsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    // Null means "unknown", never "not a member" -- a failed lookup must not
    // present as a permission problem.
    const check = (name: string) =>
      getCouncilMembers(name)
        .then((res) => (res.members || []).some((m) => m.address === address))
        .catch(() => null);
    Promise.all([check(COUNCIL_NAME), check(COMMITTEE_NAME)]).then(
      ([onCouncil, onCommittee]) => {
        if (cancelled) return;
        setMembership({ address, onCouncil, onCommittee });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Only trust a result resolved for the currently connected address.
  const resolved = address && membership?.address === address ? membership : null;
  const onCouncil = resolved ? resolved.onCouncil : null;
  const onCommittee = resolved ? resolved.onCommittee : null;

  const route: PeerRoute = decideRoute({
    kind,
    ready: groupsLoaded && !(address && (onCouncil === null || onCommittee === null)),
    onCouncil,
    onCommittee,
    preferVote,
    councilPolicy: council?.policy_address ?? null,
    committeePolicy: committee?.policy_address ?? null,
  });

  return { route, council, committee, onCouncil, onCommittee };
}
