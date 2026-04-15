"use client";

import type { Group, Member } from "@/types/commons";
import { useWallet } from "@/contexts/WalletContext";
import { truncateAddress } from "@/lib/utils";

interface CommunityMembersProps {
  group: Group;
  members: Member[];
}

export default function CommunityMembers({ group, members }: CommunityMembersProps) {
  const { address } = useWallet();

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-white">
        Members
        <span className="ml-2 text-sm font-normal text-zinc-500">
          {members.length} in {group.index}
        </span>
      </h2>

      {members.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
          <p className="text-zinc-400">No members</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.address}
              className={`flex items-center justify-between rounded-xl border p-4 ${
                m.address === address
                  ? "border-indigo-500/30 bg-indigo-900/10"
                  : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-sm ${
                    m.address === address ? "text-indigo-400" : "text-zinc-300"
                  }`}
                >
                  {m.metadata && m.metadata !== "N/A" ? (
                    <>
                      <span className="font-sans font-medium">{m.metadata}</span>{" "}
                      <span className="text-zinc-500">{truncateAddress(m.address)}</span>
                    </>
                  ) : (
                    truncateAddress(m.address)
                  )}
                </span>
              </div>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                weight: {m.weight}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
