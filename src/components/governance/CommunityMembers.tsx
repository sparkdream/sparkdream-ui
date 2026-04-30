"use client";

import Link from "next/link";
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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">
          Members
          <span className="ml-2 text-sm font-normal text-zinc-500">
            {members.length} in {group.index}
          </span>
        </h2>
        {group.index === "Commons Council" && (
          <Link
            href="/contribute?view=invitations"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Invite Member
          </Link>
        )}
      </div>

      {members.length === 0 ? (
        <div className="rounded-xl sd-hull-tile p-12 text-center">
          <p className="text-zinc-400">No members</p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.address}
              className={`flex items-center justify-between rounded-xl p-4 ${
                m.address === address
                  ? "border border-indigo-500/30 bg-indigo-900/10"
                  : "sd-hull-tile"
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
                      {/* Full address on desktop, truncated on mobile */}
                      <span className="hidden text-zinc-500 sm:inline">{m.address}</span>
                      <span className="text-zinc-500 sm:hidden">{truncateAddress(m.address)}</span>
                    </>
                  ) : (
                    <>
                      {/* Full address on desktop, truncated on mobile */}
                      <span className="hidden sm:inline">{m.address}</span>
                      <span className="sm:hidden">{truncateAddress(m.address)}</span>
                    </>
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
