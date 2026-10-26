"use client";

import type { ReactNode } from "react";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { fmtDate } from "@/components/permissions/fields";
import { formatDurationApprox } from "@/lib/utils";

export const CARD = "rounded-xl border border-zinc-800 bg-zinc-900/50 p-5";
export const SUBCARD = "rounded-lg border border-zinc-800 bg-zinc-950/40 p-4";

/** A titled card inside the identity section. */
export function Panel({
  title,
  intro,
  id,
  children,
  tone,
}: {
  title: string;
  intro?: ReactNode;
  id?: string;
  children: ReactNode;
  tone?: "warn";
}) {
  return (
    <section
      id={id}
      className={tone === "warn" ? "rounded-xl border border-amber-800/60 bg-amber-900/10 p-5" : CARD}
    >
      <h3 className="text-base font-semibold text-white">{title}</h3>
      {intro && <div className="mt-1 text-sm text-zinc-400">{intro}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** "Mar 3, 10:00 AM (in 2d 4h)" for a unix-seconds deadline; "passed" once it has. */
export function Deadline({ at, nowMs }: { at: number; nowMs: number }) {
  if (!at) return <>unknown</>;
  const left = at - Math.floor(nowMs / 1000);
  return (
    <>
      {fmtDate(at)}{" "}
      <span className="text-zinc-500">({left > 0 ? `in ${formatDurationApprox(left)}` : "passed"})</span>
    </>
  );
}

/** A bech32 shape check against the chain's prefix. */
export function useIsAddress(): (v: string) => boolean {
  const { config } = useChainConfig();
  return (v: string) => new RegExp(`^${config.bech32Prefix}1[02-9ac-hj-np-z]{38}$`).test(v.trim());
}

/** Shown instead of the action buttons while session mode is on: the chain refuses identity messages from a session key. */
export function SessionModeNote() {
  return (
    <p className="rounded-lg border border-amber-800/60 bg-amber-900/10 px-3 py-2 text-xs text-amber-300">
      Membership address and recovery actions can&apos;t be signed with a session key. Switch off session mode to use
      them.
    </p>
  );
}
