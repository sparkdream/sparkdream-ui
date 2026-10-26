"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useMyAliases } from "@/hooks/useMyAliases";
import ActionBanner from "@/components/ActionBanner";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactMediaProposals } from "@/lib/artifactApi";
import { formatTime } from "@/lib/utils";
import type { ArtifactClass, ArtifactParams, MediaProposal, TokenMetadata, TokenView } from "@/types/artifact";
import type {
  MsgAcceptMedia,
  MsgProposeMedia,
  MsgRejectMedia,
  MsgSetDisplayedMedia,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  MetadataEditor,
  emptyMetadataForm,
  isHidden,
  metadataFormToMsg,
  useArtifactTx,
  validateMetadataForm,
  type MetadataForm,
} from "./shared";

function summary(m: TokenMetadata | undefined): string {
  const parts = [m?.name?.trim(), m?.uri?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : "(no name or media)";
}

/**
 * Media versions: the issuer proposes alternatives, the holder accepts or
 * rejects them and picks which one the token shows. The stored metadata
 * never changes, so sale pins are unaffected.
 */
export default function MediaVersions({
  cls,
  view,
  params,
  isHolder,
  isClassOwner,
  onChanged,
}: {
  cls: ArtifactClass;
  view: TokenView;
  params: ArtifactParams | null;
  isHolder: boolean;
  isClassOwner: boolean;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const { isMine } = useMyAliases();
  const t = view.token;
  const [proposals, setProposals] = useState<MediaProposal[]>([]);
  const [draft, setDraft] = useState<MetadataForm | null>(null);
  const [displayOnAccept, setDisplayOnAccept] = useState(true);

  const load = useCallback(() => {
    getArtifactMediaProposals(t.class_id, t.id)
      .then((r) => setProposals(r.proposals || []))
      .catch(() => setProposals([]));
  }, [t.class_id, t.id]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);

  const versions = t.media_versions || [];
  const displayed = t.displayed_version ?? 0;
  const maxProposals = params?.max_media_proposals_per_token ?? 0;
  const maxVersions = params?.max_media_versions_per_token ?? 0;
  const hidden = !!view.withheld || isHidden(t.status) || isHidden(cls.status);
  const canPropose = isClassOwner && !t.unrevealed && !hidden && maxProposals > 0 && proposals.length < maxProposals;
  const refBase = { classId: BigInt(t.class_id), tokenId: BigInt(t.id) };
  const busy = pending !== null;

  if (versions.length === 0 && proposals.length === 0 && !canPropose) return null;

  const show = (version: number) => {
    if (!address) return;
    const value: MsgSetDisplayedMedia = { owner: address, ...refBase, version };
    return send(`show-${version}`, { typeUrl: ArtifactMsgTypeUrls.SetDisplayedMedia, value }, "Couldn't change the displayed version");
  };

  const accept = (p: MediaProposal) => {
    if (!address) return;
    const value: MsgAcceptMedia = { owner: address, ...refBase, proposalId: BigInt(p.id), display: displayOnAccept };
    return send(`accept-${p.id}`, { typeUrl: ArtifactMsgTypeUrls.AcceptMedia, value }, "Couldn't accept the version");
  };

  const reject = (p: MediaProposal) => {
    if (!address) return;
    const value: MsgRejectMedia = { signer: address, ...refBase, proposalId: BigInt(p.id) };
    return send(`reject-${p.id}`, { typeUrl: ArtifactMsgTypeUrls.RejectMedia, value }, isHolder ? "Couldn't reject the version" : "Couldn't withdraw the proposal");
  };

  const propose = () => {
    if (!address || !draft) return;
    const bad = validateMetadataForm(draft);
    if (bad) return setError(bad);
    const value: MsgProposeMedia = { owner: address, ...refBase, metadata: metadataFormToMsg(draft) };
    return send("propose", { typeUrl: ArtifactMsgTypeUrls.ProposeMedia, value }, "Couldn't propose the version", () => setDraft(null));
  };

  return (
    <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white">Media versions</h3>
      <p className="text-xs text-zinc-500">
        The issuer can offer alternative versions. Only the holder chooses which one the token shows, and the original metadata never
        changes.
      </p>

      {versions.length > 0 && (
        <div className="space-y-1.5">
          {[{ n: 0, m: t.metadata, label: "Original" }, ...versions.map((m, i) => ({ n: i + 1, m, label: `Version ${i + 1}` }))].map((v) => (
            <div key={v.n} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs">
              <span className="min-w-0 text-zinc-300">
                <span className="text-zinc-500">{v.label}:</span> {summary(v.m)}
                {displayed === v.n && <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 text-[10px] text-emerald-300">Shown</span>}
              </span>
              {isHolder && displayed !== v.n && (
                <button onClick={() => show(v.n)} disabled={busy} className="sd-btn sd-btn-secondary">
                  {pending === `show-${v.n}` ? "Saving…" : "Show this"}
                </button>
              )}
            </div>
          ))}
          {maxVersions > 0 && <p className="text-[11px] text-zinc-600">{versions.length} of {maxVersions} versions kept.</p>}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-zinc-400">Proposed</span>
          {proposals.map((p) => (
            <div key={p.id} className="space-y-1 rounded-lg border border-sky-800/40 bg-sky-900/10 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-zinc-300">{summary(p.metadata)}</span>
                <span className="flex gap-2">
                  {isHolder && (
                    <button onClick={() => accept(p)} disabled={busy || (maxVersions > 0 && versions.length >= maxVersions)} className="sd-btn sd-btn-verdigris">
                      {pending === `accept-${p.id}` ? "Accepting…" : "Accept"}
                    </button>
                  )}
                  {(isHolder || isMine(p.proposer) || isClassOwner) && (
                    <button onClick={() => reject(p)} disabled={busy} className="sd-btn sd-btn-secondary">
                      {pending === `reject-${p.id}` ? "Removing…" : isHolder ? "Reject" : "Withdraw"}
                    </button>
                  )}
                </span>
              </div>
              {p.metadata?.description && <p className="whitespace-pre-wrap text-zinc-500">{p.metadata.description}</p>}
              {p.created_at && p.created_at !== "0" && <p className="text-[11px] text-zinc-600">Proposed {formatTime(p.created_at)}</p>}
            </div>
          ))}
          {isHolder && (
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={displayOnAccept} onChange={(e) => setDisplayOnAccept(e.target.checked)} />
              Show a version as soon as I accept it
            </label>
          )}
        </div>
      )}

      {canPropose &&
        (draft ? (
          <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
            <MetadataEditor value={draft} onChange={setDraft} />
            <div className="flex gap-2">
              <button onClick={propose} disabled={busy} className="sd-btn sd-btn-verdigris">
                {pending === "propose" ? "Proposing…" : "Propose version"}
              </button>
              <button onClick={() => setDraft(null)} className="sd-btn sd-btn-secondary">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setDraft(emptyMetadataForm())} className="sd-btn sd-btn-secondary">
            Propose a new version
          </button>
        ))}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
