"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { hasShieldVerificationKey } from "@/lib/api";
import { anonymousOp } from "@/lib/shieldClient";
import type { ShieldedOpRegistration } from "@/types/shield";
import type { ShieldIdentityStatus } from "@/hooks/useShieldIdentity";

const TRUST_NAMES = ["New", "Provisional", "Established", "Trusted", "Core"];

interface AnonymousToggleProps {
  /** The message that would be sent anonymously. */
  typeUrl: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** From useAnonymousSubmit().shield */
  shield: { status: ShieldIdentityStatus; trustLevel: number | null };
  label?: string;
  /** Extra limits of this form when anonymous (e.g. "Author bonds and new tags aren't available."). */
  note?: string;
}

/** "Post anonymously" switch. Renders nothing when the action can't be done
 *  anonymously on this chain or the wallet can't use it. */
export default function AnonymousToggle({
  typeUrl,
  checked,
  onChange,
  shield,
  label = "Post anonymously",
  note,
}: AnonymousToggleProps) {
  const [reg, setReg] = useState<ShieldedOpRegistration | null | undefined>(undefined);
  const [hasVk, setHasVk] = useState(true);

  useEffect(() => {
    let live = true;
    anonymousOp(typeUrl)
      .then((r) => live && setReg(r))
      .catch(() => live && setReg(null));
    return () => {
      live = false;
    };
  }, [typeUrl]);

  // Without a stored verifying key the chain rejects every anonymous exec. A
  // failed lookup leaves the switch on; the chain's own error still explains.
  useEffect(() => {
    let live = true;
    hasShieldVerificationKey()
      .then((v) => live && setHasVk(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!reg || shield.status === "unavailable" || shield.status === "loading") return null;

  const needsSetup = shield.status === "unregistered" || shield.status === "mismatch";
  const tooLow = shield.trustLevel !== null && shield.trustLevel < reg.min_trust_level;
  const disabled = !hasVk || needsSetup || tooLow;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
      <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          className="mt-1"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-zinc-200">{label}</span>
          <span className="block text-xs text-zinc-500">
            {"Shows as Anonymous. A zero-knowledge proof shows you're a member without revealing who you are."}
          </span>
          {checked && !disabled && note && <span className="mt-1 block text-xs text-zinc-500">{note}</span>}
          {!hasVk && (
            <span className="mt-1 block text-xs text-zinc-400">
              {"Anonymous actions aren't available on this chain yet. Its proof verification key hasn't been set up."}
            </span>
          )}
          {hasVk && needsSetup && (
            <span className="mt-1 block text-xs text-zinc-400">
              <Link href="/permissions#anonymous" className="underline hover:text-white">
                Set up an anonymous identity
              </Link>{" "}
              to use this.
            </span>
          )}
          {hasVk && !needsSetup && tooLow && (
            <span className="mt-1 block text-xs text-zinc-400">
              Needs trust level {TRUST_NAMES[reg.min_trust_level] ?? reg.min_trust_level} or higher.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
