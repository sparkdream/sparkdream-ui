"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useTxAction } from "@/hooks/useTxAction";
import { formatBlockEta, useBlockClock } from "@/hooks/useBlockClock";
import {
  getRepRecoveryCommit,
  getRepRecoveryCommitments,
  getTxMsgResponses,
  listRepRecoveryCommitsBySubmitter,
} from "@/lib/api";
import { RepIdentityMsgTypeUrls } from "@/lib/tx";
import { freshnessProblems, type MigrationParams } from "@/lib/migration";
import {
  base64ToBytes,
  bytesEqual,
  parseBackupMember,
  parseRecoveryCode,
  recoveryCommitment,
  recoverySeal,
  toHex,
} from "@/lib/recovery";
import type { RecoveryCommit } from "@/types/rep";
import { formatDurationApprox, formatSpark, truncateAddress } from "@/lib/utils";
import ActionBanner from "@/components/ActionBanner";
import { Field, INPUT_CLASS } from "@/components/permissions/fields";
import { Deadline, Panel, SUBCARD, useIsAddress } from "./shared";

interface Prepared {
  key: string;
  preimage: Uint8Array;
  sealedHex: string;
  sealed: Uint8Array;
  /** Problems the chain would refuse the reveal for, as far as queries tell. */
  problems: string[];
  /** The unexpired seal already on chain for this (code, member, new address), if any. */
  seal: RecoveryCommit | null;
}

/**
 * Recover a membership with a recovery code: commit a seal binding (code,
 * member, new address), wait recovery_reveal_min_blocks, reveal, then the new
 * address accepts. Two steps instead of one so nobody watching the mempool can
 * take the code from a reveal and race their own: the seal already names the
 * new address, and it had to land blocks earlier.
 *
 * Any funded account may commit and reveal; the new address only has to
 * accept. Usually that is all the same connected wallet.
 */
export default function RecoveryWizard({
  params,
  nowMs,
  disabled,
  onChanged,
}: {
  params: MigrationParams;
  nowMs: number;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const { signerAddress, signAndBroadcast } = useWallet();
  const isAddress = useIsAddress();
  const clock = useBlockClock();
  const tx = useTxAction();
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [target, setTarget] = useState(signerAddress ?? "");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  // Seals live on chain (queryable by seal and by submitter), so a recovery
  // resumes from any device. Bumped to refetch after a commit or reveal.
  const [reload, setReload] = useState(0);
  const [mySeals, setMySeals] = useState<RecoveryCommit[]>([]);
  // failure: the reveal checked out and used the code up, but the chain could
  // not open the migration (MsgRevealRecoveryResponse.failure_reason).
  const [revealed, setRevealed] = useState<{ member: string; to: string; failure?: string } | null>(null);

  useEffect(() => {
    if (!signerAddress) return;
    let live = true;
    listRepRecoveryCommitsBySubmitter(signerAddress)
      .then((list) => live && setMySeals(list))
      .catch(() => live && setMySeals([]));
    return () => {
      live = false;
    };
  }, [signerAddress, reload]);

  const preimage = useMemo(() => parseRecoveryCode(codeInput), [codeInput]);
  const from = member.trim();
  const to = target.trim();
  const ready = isAddress(from) && isAddress(to) && !!preimage;
  const key = ready ? `${from}|${to}|${toHex(preimage!)}` : "";

  // Seal, plus the checks that can be made before spending a deposit.
  useEffect(() => {
    if (!key || !preimage) return;
    let live = true;
    (async () => {
      const [sealed, commitment, set, fresh] = await Promise.all([
        recoverySeal(preimage, from, to),
        recoveryCommitment(preimage),
        getRepRecoveryCommitments(from).catch(() => null),
        freshnessProblems(from, to),
      ]);
      const seal = await getRepRecoveryCommit(toHex(sealed)).catch(() => null);
      const now = Math.floor(Date.now() / 1000);
      const problems = [...fresh];
      const match = (set?.commitments ?? []).find((c) => bytesEqual(base64ToBytes(c.commitment), commitment));
      if (!match) problems.unshift("This code doesn't match any recovery code of that member.");
      else if (Number(match.effective_at ?? 0) > now) {
        problems.unshift(`This code isn't active yet. It becomes usable ${new Date(Number(match.effective_at) * 1000).toLocaleString()}.`);
      }
      if (live) setPrepared({ key, preimage, sealed, sealedHex: toHex(sealed), problems, seal });
    })();
    return () => {
      live = false;
    };
  }, [key, preimage, from, to, reload]);

  const prep = prepared?.key === key ? prepared : null;
  const seal = prep?.seal ?? null;

  const sealHeight = seal ? BigInt(seal.height) : null;
  const revealAt = sealHeight !== null ? sealHeight + BigInt(params.revealMinBlocks) : null;
  const blocksLeft = revealAt !== null && clock ? Number(revealAt - clock.height) : null;
  const expiresAt = seal ? Number(seal.expires_at) : 0;
  // The chain stops returning a seal once it expires; this covers the gap
  // until the next refetch.
  const expired = seal ? Math.floor(nowMs / 1000) >= expiresAt : false;

  const commit = () =>
    tx.run("commit", async () => {
      if (!prep || !signerAddress) return;
      await signAndBroadcast([
        { typeUrl: RepIdentityMsgTypeUrls.CommitRecovery, value: { submitter: signerAddress, sealed: prep.sealed } },
      ]);
      setReload((n) => n + 1);
    });

  const reveal = () => {
    if (!prep || !signerAddress) return;
    if (!confirm("Reveal the recovery code? From this moment it is public and used up, even if the move then fails.")) return;
    void tx.run("reveal", async () => {
      const hash = await signAndBroadcast([
        {
          typeUrl: RepIdentityMsgTypeUrls.RevealRecovery,
          value: { revealer: signerAddress, member: from, newAddress: to, preimage: prep.preimage },
        },
      ]);
      let failure: string | undefined;
      try {
        const { MsgRevealRecoveryResponse } = await import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx");
        for (const r of await getTxMsgResponses(hash)) {
          if (r.typeUrl !== "/sparkdream.rep.v1.MsgRevealRecoveryResponse") continue;
          const res = MsgRevealRecoveryResponse.decode(r.value);
          if (res.migrationId === BigInt(0)) failure = res.failureReason || "the chain did not say why";
        }
      } catch {
        // Unreadable response: the migration list below still shows the outcome.
      }
      setReload((n) => n + 1);
      setRevealed({ member: from, to, failure });
      setCodeInput("");
      onChanged();
    });
  };

  return (
    <Panel
      id="recover"
      title="Recover a membership"
      intro={
        <>
          Lost the wallet that holds your membership? With one of its recovery codes you can move it to a new address.
          The move happens {formatDurationApprox(params.recoveryDelay)} after the new address accepts.
        </>
      }
    >
      {revealed?.failure && (
        <p className="mb-3 rounded-lg border border-red-800 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          The code was valid and is now used up, but the recovery for {truncateAddress(revealed.member)} could not be
          opened: {revealed.failure}. Use another recovery code, or ask governance for a forced migration.
        </p>
      )}
      {revealed && !revealed.failure && (
        <p className="mb-3 rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-400">
          Recovery opened for {truncateAddress(revealed.member)}.{" "}
          {revealed.to === signerAddress
            ? "Accept it above to start the delay."
            : `Connect ${truncateAddress(revealed.to)} and accept it on this page.`}
        </p>
      )}

      {mySeals.length > 0 && !prep && (
        <div className="mb-3 space-y-2">
          {mySeals.map((s) => (
            <div key={s.sealed} className={`${SUBCARD} text-xs text-zinc-400`}>
              A recovery you sealed at block {s.height} is waiting for its reveal, until{" "}
              <Deadline at={Number(s.expires_at)} nowMs={nowMs} />. Enter the code, membership address and new address
              again to continue.
            </div>
          ))}
        </div>
      )}

      {!open && !mySeals.length ? (
        <button type="button" onClick={() => setOpen(true)} className="sd-btn sd-btn-secondary">
          Use a recovery code
        </button>
      ) : (
        <div className="space-y-3">
          <Field id="recover-code" label="Recovery code" help="Paste the code, or the whole backup file.">
            <textarea
              id="recover-code"
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value);
                const m = parseBackupMember(e.target.value);
                if (m && !member) setMember(m);
              }}
              rows={3}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
            />
          </Field>
          {codeInput && !preimage && <p className="text-xs text-red-400">That doesn&apos;t look like a recovery code</p>}
          <Field id="recover-member" label="Membership address" help="The lost wallet's address.">
            <input
              id="recover-member"
              value={member}
              onChange={(e) => setMember(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
            />
          </Field>
          <Field
            id="recover-target"
            label="New address"
            help="A fresh address you control. It has to accept the move itself, so the connected wallet is simplest."
          >
            <input
              id="recover-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono`}
            />
          </Field>

          {prep && prep.problems.length > 0 && !seal && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-red-400">
              {prep.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {prep && !seal && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                Step 1 of 3: seal the recovery. This locks a deposit of {formatSpark(params.commitDeposit)}{" "}
                SPARK from the connected wallet, refunded when you reveal and burned if you don&apos;t within{" "}
                {formatDurationApprox(params.commitTtl)}. The seal doesn&apos;t reveal the code.
              </p>
              {!disabled && (
                <button
                  type="button"
                  onClick={commit}
                  disabled={tx.busy || prep.problems.length > 0}
                  className="sd-btn sd-btn-primary"
                >
                  {tx.pending === "commit" ? "Signing…" : "Seal recovery"}
                </button>
              )}
            </div>
          )}

          {prep && seal && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                Step 2 of 3: sealed at block {seal.height}. The code can be revealed{" "}
                {blocksLeft !== null && blocksLeft > 0
                  ? `after ${blocksLeft} more blocks (${formatBlockEta(clock, revealAt!.toString()) || "soon"})`
                  : "now"}
                , until <Deadline at={expiresAt} nowMs={nowMs} />.
              </p>
              {revealAt !== null && clock && params.revealMinBlocks > 0 && (
                <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                  <div
                    className="h-full bg-indigo-500"
                    style={{
                      width: `${Math.min(100, Math.max(0, (1 - Math.max(0, blocksLeft ?? 0) / params.revealMinBlocks) * 100))}%`,
                    }}
                  />
                </div>
              )}
              {expired ? (
                <p className="text-xs text-red-400">
                  This seal expired and its deposit is burned. You can seal again.
                </p>
              ) : (
                !disabled && (
                  <button
                    type="button"
                    onClick={reveal}
                    disabled={tx.busy || blocksLeft === null || blocksLeft > 0}
                    className="sd-btn sd-btn-primary"
                  >
                    {tx.pending === "reveal" ? "Signing…" : "Reveal and open the recovery"}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      )}
      <ActionBanner message={tx.error} onDismiss={tx.clearError} className="mt-3" />
    </Panel>
  );
}
