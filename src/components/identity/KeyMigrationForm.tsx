"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { RepIdentityMsgTypeUrls } from "@/lib/tx";
import { freshnessProblems, keyRequestBlockers } from "@/lib/migration";
import { formatDurationApprox } from "@/lib/utils";
import type { MigrationState } from "@/hooks/useMigrationState";
import ActionBanner from "@/components/ActionBanner";
import { Field, INPUT_CLASS } from "@/components/permissions/fields";
import FundAddressHint from "./FundAddressHint";
import { Panel, useIsAddress } from "./shared";

export default function KeyMigrationForm({
  state,
  nowMs,
  onDone,
}: {
  state: MigrationState;
  nowMs: number;
  onDone: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const isAddress = useIsAddress();
  const tx = useTxAction();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [check, setCheck] = useState<{ for: string; problems: string[] } | null>(null);

  const p = state.params;
  const blockers = keyRequestBlockers(
    p,
    state.member,
    { all: state.aliases.length, recent: state.recentAliases.length },
    Math.floor(nowMs / 1000),
  );
  const to = target.trim();
  const valid = isAddress(to);

  useEffect(() => {
    if (!valid || !signerAddress) return;
    let live = true;
    const t = setTimeout(() => {
      freshnessProblems(signerAddress, to).then((problems) => live && setCheck({ for: to, problems }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [valid, to, signerAddress]);

  const problems = check?.for === to ? check.problems : null;

  const request = () =>
    tx.run("request", async () => {
      await signAndBroadcast([
        { typeUrl: RepIdentityMsgTypeUrls.RequestMigration, value: { member: signerAddress, newAddress: to } },
      ]);
      setOpen(false);
      setTarget("");
      onDone();
    });

  return (
    <Panel
      title="Move your membership to a new address"
      intro={
        <>
          For a new wallet, a hardware wallet or a multisig. You request from this address, the new address accepts
          within {formatDurationApprox(p.acceptWindow)}, and the move happens {formatDurationApprox(p.keyDelay)} later.
          Either address can cancel until then.
        </>
      }
    >
      {blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-400">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="sd-btn sd-btn-secondary">
          Start a key change
        </button>
      ) : (
        <div className="space-y-3">
          <Field
            id="migration-target"
            label="New address"
            help="A fresh address: not a member, not invited, with no names, season profile, session keys it gave or federation links. Use the address itself, not a name."
          >
            <input
              id="migration-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
            />
          </Field>
          {to && !valid && <p className="text-xs text-red-400">Not a valid address</p>}
          {problems && problems.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-red-400">
              {problems.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {valid && problems?.length === 0 && <FundAddressHint target={to} />}
          <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500">
            <li>
              After the move, this address can only withdraw staking rewards, undelegate, redelegate and send SPARK.
              Delegations stay here.
            </li>
            <li>
              The next key change opens {formatDurationApprox(p.cooldown)} after this one, at most{" "}
              {p.maxKeyPerWindow} per {formatDurationApprox(p.keyWindow)}.
            </li>
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={request}
              disabled={tx.busy || !valid || !problems || problems.length > 0}
              className="sd-btn sd-btn-primary"
            >
              {tx.busy ? "Signing…" : "Request the move"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="sd-btn sd-btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </Panel>
  );
}
