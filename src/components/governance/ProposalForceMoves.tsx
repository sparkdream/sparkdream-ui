"use client";

import { useEffect, useState } from "react";
import { RepIdentityMsgTypeUrls } from "@/lib/tx";
import NameOrAddress from "@/components/NameOrAddress";

interface Move {
  member: string;
  newAddress: string;
  evidence: string;
}

// The LCD renders an inner message as JSON ("@type" plus its fields); a
// proposal read from elsewhere may carry the packed form (type_url + base64).
type InnerMessage = Record<string, unknown>;

const typeOf = (m: InnerMessage) => String(m["@type"] ?? m.type_url ?? "");

async function readMoves(messages: InnerMessage[]): Promise<Move[]> {
  const forced = messages.filter((m) => typeOf(m) === RepIdentityMsgTypeUrls.ForceMigration);
  if (forced.length === 0) return [];
  const packed = forced.some((m) => typeof m.value === "string" && !m["@type"]);
  const codec = packed ? (await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx")).MsgForceMigration : null;
  return forced.map((m) => {
    if (codec && typeof m.value === "string" && !m["@type"]) {
      const msg = codec.decode(Uint8Array.from(atob(m.value), (c) => c.charCodeAt(0)));
      return { member: msg.member, newAddress: msg.newAddress, evidence: msg.evidenceUri };
    }
    return {
      member: String(m.member ?? ""),
      newAddress: String(m.new_address ?? ""),
      evidence: String(m.evidence_uri ?? ""),
    };
  });
}

/**
 * The membership moves a proposal would start, read from its messages rather
 * than its description: the description is free text the proposer wrote, and
 * a vote on a batch approves every move in it.
 */
export default function ProposalForceMoves({ messages }: { messages: InnerMessage[] }) {
  const [moves, setMoves] = useState<Move[]>([]);
  useEffect(() => {
    let live = true;
    readMoves(messages ?? [])
      .then((m) => live && setMoves(m))
      .catch(() => live && setMoves([]));
    return () => {
      live = false;
    };
  }, [messages]);

  if (moves.length === 0) return null;
  return (
    <div className="mb-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="mb-1.5 text-xs font-medium text-zinc-400">
        {moves.length === 1 ? "Moves 1 membership" : `Moves ${moves.length} memberships, all or nothing`}
      </p>
      <ol className="space-y-1 text-xs text-zinc-300">
        {moves.map((m, i) => (
          <li key={`${m.member}|${m.newAddress}|${i}`} className="flex flex-wrap items-center gap-x-1.5">
            <span className="text-zinc-500">{i + 1}.</span>
            <NameOrAddress address={m.member} full />
            <span className="text-zinc-500">to</span>
            <NameOrAddress address={m.newAddress} full />
            {m.evidence &&
              (/^https?:\/\//i.test(m.evidence) ? (
                <a
                  href={m.evidence}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300"
                >
                  evidence
                </a>
              ) : (
                <span className="break-all text-zinc-500">evidence: {m.evidence}</span>
              ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
