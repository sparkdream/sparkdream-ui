"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import ActionBanner from "@/components/ActionBanner";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { listArtifactTokens } from "@/lib/artifactApi";
import {
  checkLeaf,
  downloadJson,
  loadCommitTree,
  loadSeedSecret,
  parseCommitTree,
  saveCommitTree,
  saveSeedSecret,
  seedCommitment,
  toProtoMetadata,
  type CommitLeaf,
  type CommitTree,
} from "@/lib/artifactCommit";
import { formatTime, timeRemaining } from "@/lib/utils";
import { RevealKind, type ArtifactClass, type TokenMetadata } from "@/types/artifact";
import type { MsgReveal, MsgRevealSeed } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  ActionSection,
  FieldLabel,
  MetadataEditor,
  Note,
  emptyMetadataForm,
  fieldCls,
  metadataFormToMsg,
  useArtifactTx,
  type MetadataForm,
} from "./shared";

// Reveals per transaction: each one carries metadata and a proof, so keep
// the tx comfortably inside the block gas limit.
const REVEALS_PER_TX = 20;
// Token pages scanned for unrevealed tokens (100 each).
const SCAN_PAGES = 10;

interface Props {
  cls: ArtifactClass;
  /** Only the owner reveals a generative seed; minters can reveal blind tokens. */
  isOwner: boolean;
  onChanged: () => void;
}

/** Issuer reveal tools for a commit-reveal class: blind token reveals, or the generative seed. */
export default function RevealTools({ cls, isOwner, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const kind = cls.reveal?.kind;
  const deadline = cls.reveal?.deadline && cls.reveal.deadline !== "0" ? cls.reveal.deadline : null;
  return (
    <ActionSection title="Reveal" open={open} onToggle={() => setOpen((o) => !o)}>
      {deadline && (
        <p className="text-xs text-zinc-500">
          Reveal deadline {formatTime(deadline)} ({timeRemaining(deadline)}). After it, holders of unrevealed tokens can burn them for a full
          refund.
        </p>
      )}
      {kind === RevealKind.BLIND_METADATA && open && <BlindReveal cls={cls} onChanged={onChanged} />}
      {kind === RevealKind.GENERATIVE_SEED && open && <SeedReveal cls={cls} isOwner={isOwner} onChanged={onChanged} />}
    </ActionSection>
  );
}

function BlindReveal({ cls, onChanged }: { cls: ArtifactClass; onChanged: () => void }) {
  const { address } = useWallet();
  const { pending, error, clearError, setError, send } = useArtifactTx(onChanged);
  const [tree, setTree] = useState<CommitTree | null>(() => loadCommitTree(cls.id));
  const [unrevealed, setUnrevealed] = useState<string[] | null>(null);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualMeta, setManualMeta] = useState<MetadataForm>(emptyMetadataForm);
  const commitment = cls.reveal?.commitment || "";
  const classId = BigInt(cls.id);

  const scan = useCallback(async () => {
    const found: string[] = [];
    let key: string | undefined;
    let pages = 0;
    try {
      do {
        const res = await listArtifactTokens(cls.id, { limit: "100", key });
        for (const v of res.tokens || []) if (v.token.unrevealed) found.push(v.token.id);
        key = res.pagination?.next_key || undefined;
        pages++;
      } while (key && pages < SCAN_PAGES);
      setScanTruncated(!!key);
      setUnrevealed(found);
    } catch {
      setUnrevealed(null);
    }
  }, [cls.id]);

  useEffect(() => {
    scan();
  }, [scan]);

  const adopt = (t: CommitTree) => {
    if (t.root !== commitment) return setError("That file's root doesn't match this class's commitment.");
    if (t.class_id && t.class_id !== cls.id) return setError(`That file was built for class #${t.class_id}.`);
    setTree(t);
    saveCommitTree(cls.id, t);
    clearError();
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      adopt(parseCommitTree(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file didn't load.");
    }
  };

  const leafFor = (id: string): CommitLeaf | undefined => tree?.leaves.find((l) => l.token_id === id);

  const revealMsg = (leaf: CommitLeaf, metadata: TokenMetadata | undefined) => {
    const value: MsgReveal = {
      signer: address!,
      classId,
      tokenId: BigInt(leaf.token_id),
      metadata: toProtoMetadata(metadata),
      salt: leaf.salt,
      proof: leaf.proof,
    };
    return { typeUrl: ArtifactMsgTypeUrls.Reveal, value };
  };

  // Unrevealed tokens whose committed metadata is in the file.
  const ready = (unrevealed || []).filter((id) => leafFor(id)?.metadata);
  const batch = ready.slice(0, REVEALS_PER_TX);

  const revealReady = () => {
    if (!address || !tree || batch.length === 0) return;
    for (const id of batch) {
      const leaf = leafFor(id)!;
      const bad = checkLeaf(classId, commitment, leaf, leaf.metadata);
      if (bad) return setError(`Token #${id}: ${bad}`);
    }
    return send("reveal-batch", batch.map((id) => revealMsg(leafFor(id)!, leafFor(id)!.metadata)), "Reveal failed", () => scan());
  };

  const manualLeaf = leafFor(manualId.trim());
  const revealOne = () => {
    if (!address) return;
    const id = manualId.trim();
    if (!/^\d+$/.test(id)) return setError("Enter a token id.");
    if (!manualLeaf) return setError(`The reveal file has no entry for token #${id}.`);
    // artifactcommit's output omits metadata: use what was typed, which must hash to the committed value.
    const md: TokenMetadata | undefined = manualLeaf.metadata ?? (() => {
      const m = metadataFormToMsg(manualMeta);
      return { name: m.name, description: m.description, uri: m.uri, uri_hash: m.uriHash, attributes: m.attributes };
    })();
    const bad = checkLeaf(classId, commitment, manualLeaf, md);
    if (bad) return setError(bad);
    return send("reveal-one", revealMsg(manualLeaf, md), "Reveal failed", () => {
      setManualId("");
      setManualMeta(emptyMetadataForm());
      scan();
    });
  };

  const busy = pending !== null;

  return (
    <div className="space-y-3">
      {!tree ? (
        <Note tone="warn">
          This browser doesn&apos;t have the reveal file for this class. Upload the file you downloaded when you created it (or the output of{" "}
          <span className="font-mono">artifactcommit tree</span>).
        </Note>
      ) : (
        <p className="text-xs text-zinc-500">
          Reveal file loaded: {tree.leaves.length} committed token{tree.leaves.length === 1 ? "" : "s"}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="sd-btn sd-btn-secondary cursor-pointer">
          {tree ? "Replace reveal file" : "Upload reveal file"}
          <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {tree && (
          <button type="button" onClick={() => downloadJson(`artifact-reveal-class-${cls.id}.json`, tree)} className="sd-btn sd-btn-secondary">
            Download a copy
          </button>
        )}
      </div>

      {unrevealed && (
        <p className="text-xs text-zinc-400">
          {unrevealed.length === 0
            ? "Every minted token is revealed."
            : `${unrevealed.length} minted token${unrevealed.length === 1 ? " is" : "s are"} unrevealed${scanTruncated ? " in the first pages" : ""}, ${ready.length} ready to reveal from the file.`}{" "}
          Tokens still waiting in an inbox don&apos;t show here; reveal them by id below.
        </p>
      )}
      {tree && batch.length > 0 && (
        <button onClick={revealReady} disabled={busy} className="sd-btn sd-btn-verdigris">
          {pending === "reveal-batch" ? "Revealing…" : `Reveal ${batch.length} token${batch.length === 1 ? "" : "s"}`}
        </button>
      )}

      {tree && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <FieldLabel label="Reveal one token" hint="Any committed token, including one still waiting in an inbox.">
            <input value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="Token id" inputMode="numeric" className={fieldCls} />
          </FieldLabel>
          {manualLeaf && !manualLeaf.metadata && (
            <>
              <p className="text-xs text-zinc-500">The file doesn&apos;t include this token&apos;s metadata. Enter exactly what was committed.</p>
              <MetadataEditor value={manualMeta} onChange={setManualMeta} />
            </>
          )}
          {manualLeaf?.metadata && (
            <p className="text-xs text-zinc-500">
              Reveals as <span className="text-zinc-300">{manualLeaf.metadata.name || "(no name)"}</span>.
            </p>
          )}
          <button onClick={revealOne} disabled={busy || !manualId.trim()} className="sd-btn sd-btn-secondary">
            {pending === "reveal-one" ? "Revealing…" : "Reveal"}
          </button>
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}

function SeedReveal({ cls, isOwner, onChanged }: { cls: ArtifactClass; isOwner: boolean; onChanged: () => void }) {
  const { address } = useWallet();
  const { pending, error, clearError, setError, send } = useArtifactTx(onChanged);
  const [seed, setSeed] = useState(() => loadSeedSecret(cls.id) || "");
  const revealed = cls.reveal?.revealed_at && cls.reveal.revealed_at !== "0";

  if (revealed) {
    return (
      <p className="text-xs text-zinc-400">
        Seed revealed {formatTime(cls.reveal!.revealed_at!)}: <span className="break-all font-mono text-zinc-300">{cls.reveal?.seed}</span>
      </p>
    );
  }
  if (!isOwner) return <p className="text-xs text-zinc-500">Only the class owner can reveal the seed.</p>;

  let matches = false;
  try {
    matches = !!seed && seedCommitment(seed.trim()) === cls.reveal?.commitment;
  } catch {
    matches = false;
  }

  const reveal = () => {
    if (!address) return;
    if (!matches) return setError("That seed doesn't match the class commitment.");
    if (!confirm("Reveal the seed? Every token's seed becomes public, and escrowed mint payments are released to you.")) return;
    saveSeedSecret(cls.id, seed.trim());
    const value: MsgRevealSeed = { owner: address, classId: BigInt(cls.id), seed: seed.trim() };
    return send("reveal-seed", { typeUrl: ArtifactMsgTypeUrls.RevealSeed, value }, "Couldn't reveal the seed");
  };

  return (
    <div className="space-y-2">
      <FieldLabel label="Secret seed (hex)" hint={seed ? (matches ? "Matches the commitment." : "Doesn't match the commitment.") : "The seed you committed to."}>
        <input value={seed} onChange={(e) => setSeed(e.target.value.toLowerCase())} className={`${fieldCls} font-mono text-xs`} />
      </FieldLabel>
      <button onClick={reveal} disabled={pending !== null || !matches} className="sd-btn sd-btn-verdigris">
        {pending === "reveal-seed" ? "Revealing…" : "Reveal seed"}
      </button>
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
