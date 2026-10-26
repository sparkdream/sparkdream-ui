"use client";

import { useEffect, useState } from "react";
import { useCopy } from "@/hooks/useCopy";
import {
  formatRecoveryCode,
  randomPreimage,
  recoveryBackupText,
  recoveryCommitment,
} from "@/lib/recovery";

/**
 * Generates a recovery code in the browser and walks the user through backing
 * it up. Reports the commitment (never the code) once the user confirms the
 * backup, and null until then. The code is regenerated on remount, so an
 * abandoned setup leaves nothing behind.
 */
export default function RecoveryCodeSetup({
  member,
  onReady,
}: {
  /** The member address the code will recover, written into the backup. */
  member: string;
  onReady: (commitment: Uint8Array | null) => void;
}) {
  const [preimage] = useState(randomPreimage);
  const [commitment, setCommitment] = useState<Uint8Array | null>(null);
  const [saved, setSaved] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    let live = true;
    recoveryCommitment(preimage).then((c) => live && setCommitment(c));
    return () => {
      live = false;
    };
  }, [preimage]);

  useEffect(() => {
    onReady(saved && commitment ? commitment : null);
  }, [saved, commitment, onReady]);

  const code = formatRecoveryCode(preimage);

  const download = () => {
    if (!commitment) return;
    const blob = new Blob([recoveryBackupText(member, preimage, commitment)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sparkdream-recovery-${member.slice(-6)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-800/60 bg-amber-900/10 p-4 text-sm">
      <p className="text-amber-300">
        This recovery code can move your membership to a new address if you lose this wallet. Anyone who has it can do
        the same, so treat it like a seed phrase. It isn&apos;t shown again and isn&apos;t stored anywhere.
      </p>
      <code className="block break-all rounded bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200">{code}</code>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={download} disabled={!commitment} className="sd-btn sd-btn-secondary">
          {downloaded ? "Downloaded" : "Download backup"}
        </button>
        <button type="button" onClick={() => void copy(code)} className="sd-btn sd-btn-secondary">
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        Keep it offline: on paper, or in a password manager you trust. It doesn&apos;t unlock your wallet or your
        SPARK, only the membership.
      </p>
      <label className="flex cursor-pointer items-start gap-2 text-zinc-300">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />
        <span>I saved this code somewhere safe</span>
      </label>
    </div>
  );
}
