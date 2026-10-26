"use client";

import { useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useChainConfig } from "@/contexts/ChainConfigContext";
import { useContentLicense } from "@/hooks/useContentLicense";
import { useTxAction } from "@/hooks/useTxAction";
import ActionBanner from "@/components/ActionBanner";
import ContentLicenseNotice from "@/components/license/ContentLicenseNotice";
import CopyableAddress from "@/components/CopyableAddress";
import NumberInput from "@/components/NumberInput";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { invalidateArtifacts } from "@/lib/artifactApi";
import { formatSpark } from "@/lib/utils";
import { RevealKind, type ArtifactClass, type ArtifactParams } from "@/types/artifact";
import type {
  MsgCloseMinting,
  MsgCreateEdition,
  MsgDeleteClass,
  MsgFreezeClassMetadata,
  MsgIssue,
  MsgLockRoyalty,
  MsgMint,
  MsgProposeClassOwner,
  MsgRevoke,
  MsgSetMaxSupply,
  MsgSetMintPolicy,
  MsgSetMinters,
  MsgUpdateClass,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import { MintPolicyFields, mintPolicyStateFrom, mintPolicyToMsg, type MintPolicyState } from "./CreateClassForm";
import CraftPanel from "./CraftPanel";
import RevealTools from "./RevealTools";
import {
  ActionSection,
  FieldLabel,
  MetadataEditor,
  RoyaltySplitEditor,
  ScheduleEditor,
  bpsToPercent,
  emptyMetadataForm,
  fieldCls,
  isEditionsClass,
  isHidden,
  isTransferable,
  issuedCount,
  issuerCanRevoke,
  localInputToUnix,
  looksLikeAddress,
  metadataFormToMsg,
  parseAddressList,
  royaltyRowsToShares,
  stagesToMsg,
  txFailure,
  validateMetadataForm,
  type MetadataForm,
  type RoyaltyRow,
  type StageForm,
} from "./shared";

interface Props {
  cls: ArtifactClass;
  params: ArtifactParams | null;
  /** True for the class owner; false for a listed minter (who may only mint). */
  isOwner: boolean;
  onChanged: () => void;
  onDeleted: () => void;
  /** Opens the door scanner for a redeemable class. */
  onOpenRedeem?: () => void;
}

type Section =
  | "mint"
  | "issue"
  | "edition"
  | "royalty-lock"
  | "edit"
  | "policy"
  | "minters"
  | "supply"
  | "freeze"
  | "owner"
  | "revoke"
  | "delete";

interface MintRow {
  recipient: string;
  metadata: MetadataForm;
  stages: StageForm[];
}

const emptyRow = (): MintRow => ({ recipient: "", metadata: emptyMetadataForm(), stages: [] });

export default function ClassManagePanel({ cls, params, isOwner, onChanged, onDeleted, onOpenRedeem }: Props) {
  const { address, signAndBroadcast } = useWallet();
  const { config } = useChainConfig();
  const license = useContentLicense();
  const { pending, error, clearError, setError, run } = useTxAction();
  const [open, setOpen] = useState<Section | null>(null);
  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const classId = BigInt(cls.id);
  const hidden = isHidden(cls.status);
  const soulbound = !isTransferable(cls);
  const prefix = config.bech32Prefix;
  const maxBatch = params?.max_batch_size || 50;
  const maxIssue = params?.max_issue_batch_size || maxBatch;
  const maxStages = params?.max_schedule_stages ?? 0;
  const editions = isEditionsClass(cls);
  // Blind-mint classes mint empty metadata (no schedule) and reveal it later.
  const blind = cls.reveal?.kind === RevealKind.BLIND_METADATA;

  const send = async (key: string, typeUrl: string, value: unknown, fail: string, after?: () => void) =>
    run(key, async () => {
      await signAndBroadcast([{ typeUrl, value }]);
      invalidateArtifacts();
      after?.();
      onChanged();
    }, txFailure(fail));

  // ---- Mint ----
  const [mintRows, setMintRows] = useState<MintRow[]>([emptyRow()]);
  const [mintAgreed, setMintAgreed] = useState(false);
  const mint = () => {
    if (!address) return;
    const entries = [];
    for (const r of mintRows) {
      if (r.recipient.trim() && !looksLikeAddress(r.recipient, prefix)) return setError(`"${r.recipient}" isn't a valid address.`);
      const bad = blind ? null : validateMetadataForm(r.metadata);
      if (bad) return setError(bad);
      const st = blind ? { stages: [], error: null } : stagesToMsg(r.stages);
      if (st.error) return setError(st.error);
      entries.push({
        recipient: r.recipient.trim(),
        metadata: blind ? metadataFormToMsg(emptyMetadataForm()) : metadataFormToMsg(r.metadata),
        schedule: st.stages,
      });
    }
    if (!mintAgreed) return setError("Confirm the public domain dedication first.");
    const value: MsgMint = { minter: address, classId, entries, acceptedContentLicense: license.license };
    return send("mint", ArtifactMsgTypeUrls.Mint, value, "Mint failed", () => {
      setMintRows([emptyRow()]);
      setMintAgreed(false);
    });
  };

  // ---- Issue (one metadata, many recipients) ----
  const [issueTo, setIssueTo] = useState("");
  const [issueMeta, setIssueMeta] = useState<MetadataForm>(emptyMetadataForm);
  const [issueAgreed, setIssueAgreed] = useState(false);
  const recipients = parseAddressList(issueTo);
  const issue = () => {
    if (!address) return;
    if (recipients.length === 0) return setError("Add at least one recipient.");
    if (recipients.length > maxIssue) return setError(`At most ${maxIssue} recipients at a time.`);
    const badAddr = recipients.find((r) => !looksLikeAddress(r, prefix));
    if (badAddr) return setError(`"${badAddr}" isn't a valid address.`);
    const bad = blind ? null : validateMetadataForm(issueMeta);
    if (bad) return setError(bad);
    if (!issueAgreed) return setError("Confirm the public domain dedication first.");
    const value: MsgIssue = {
      minter: address,
      classId,
      recipients,
      metadata: metadataFormToMsg(blind ? emptyMetadataForm() : issueMeta),
      acceptedContentLicense: license.license,
    };
    return send("issue", ArtifactMsgTypeUrls.Issue, value, "Issue failed", () => {
      setIssueTo("");
      setIssueMeta(emptyMetadataForm());
      setIssueAgreed(false);
    });
  };

  // ---- Editions ----
  const [edMeta, setEdMeta] = useState<MetadataForm>(emptyMetadataForm);
  const [edCap, setEdCap] = useState("0");
  const [edClaim, setEdClaim] = useState(false);
  const [claim, setClaim] = useState({ scope: "", contributors: "", start: "", end: "", initiative: "" });
  const [edAgreed, setEdAgreed] = useState(false);
  const createEdition = () => {
    if (!address) return;
    const bad = validateMetadataForm(edMeta);
    if (bad) return setError(bad);
    if (!/^\d+$/.test(edCap || "0")) return setError("The unit cap must be a whole number.");
    let c = { scope: "", contributors: [] as string[], workStart: BigInt(0), workEnd: BigInt(0), initiativeId: BigInt(0) };
    if (edClaim) {
      const contributors = parseAddressList(claim.contributors);
      const badC = contributors.find((a) => !looksLikeAddress(a, prefix));
      if (badC) return setError(`"${badC}" isn't a valid contributor address.`);
      if (contributors.length > 20) return setError("An impact claim names at most 20 contributors.");
      if (!claim.scope.trim()) return setError("Describe the work the certificate covers.");
      if (claim.initiative.trim() && !/^\d+$/.test(claim.initiative.trim())) return setError("The initiative id must be a number.");
      const workStart = localInputToUnix(claim.start ? `${claim.start}T00:00` : "");
      const workEnd = localInputToUnix(claim.end ? `${claim.end}T23:59` : "");
      if (workStart > BigInt(0) && workEnd > BigInt(0) && workEnd < workStart) return setError("The work can't end before it starts.");
      c = { scope: claim.scope.trim(), contributors, workStart, workEnd, initiativeId: BigInt(claim.initiative.trim() || "0") };
    }
    if (!edAgreed) return setError("Confirm the public domain dedication first.");
    const value: MsgCreateEdition = {
      minter: address,
      classId,
      metadata: metadataFormToMsg(edMeta),
      maxSupply: BigInt(edCap || "0"),
      claim: c,
      acceptedContentLicense: license.license,
    };
    return send("edition", ArtifactMsgTypeUrls.CreateEdition, value, "Couldn't create the edition", () => {
      setEdMeta(emptyMetadataForm());
      setEdCap("0");
      setEdClaim(false);
      setClaim({ scope: "", contributors: "", start: "", end: "", initiative: "" });
      setEdAgreed(false);
    });
  };

  // ---- Royalty lock ----
  const lockRoyalty = () => {
    if (!address) return;
    if (!confirm("Lock the royalty and its split for good? Not even you can lower or reroute it after this.")) return;
    const value: MsgLockRoyalty = { owner: address, classId };
    return send("royalty-lock", ArtifactMsgTypeUrls.LockRoyalty, value, "Couldn't lock the royalty");
  };

  // ---- Edit class ----
  const [edit, setEdit] = useState(() => ({
    name: cls.name || "",
    description: cls.description || "",
    uri: cls.uri || "",
    uriHash: cls.uri_hash || "",
    tokenUriBase: cls.token_uri_base || "",
    payout: cls.payout_address || "",
    royaltyPct: String((cls.royalty_bps ?? 0) / 100),
    royaltyRows: (cls.royalty_recipients || []).map((r) => ({
      address: r.address,
      percent: String((r.weight_bps ?? 0) / 100),
    })) as RoyaltyRow[],
  }));
  const updateClass = () => {
    if (!address) return;
    const mask: string[] = [];
    if (edit.name.trim() !== (cls.name || "")) mask.push("name");
    if (edit.description.trim() !== (cls.description || "")) mask.push("description");
    if (edit.uri.trim() !== (cls.uri || "")) mask.push("uri");
    if (edit.uriHash.trim().toLowerCase() !== (cls.uri_hash || "")) mask.push("uri_hash");
    if (edit.tokenUriBase.trim() !== (cls.token_uri_base || "")) mask.push("token_uri_base");
    if (edit.payout.trim() !== (cls.payout_address || "")) {
      if (!looksLikeAddress(edit.payout, prefix)) return setError("The payout address isn't valid.");
      mask.push("payout_address");
    }
    const bps = Math.round(Number(edit.royaltyPct || "0") * 100);
    if (!Number.isFinite(bps) || bps < 0) return setError("Enter a valid royalty.");
    if (bps !== (cls.royalty_bps ?? 0)) {
      if (bps > (cls.royalty_bps ?? 0)) return setError("The royalty can only be lowered.");
      mask.push("royalty_bps");
    }
    const split = royaltyRowsToShares(edit.royaltyRows, prefix);
    if (split.error) return setError(split.error);
    const before = JSON.stringify((cls.royalty_recipients || []).map((r) => [r.address, r.weight_bps ?? 0]));
    const after = JSON.stringify(split.shares.map((r) => [r.address, r.weightBps]));
    if (before !== after) {
      if (split.shares.length === 0) return setError("Name at least one royalty address.");
      mask.push("royalty_recipients");
    }
    if (mask.length === 0) return setError("Nothing changed.");
    if (edit.uriHash.trim() && !/^[0-9a-f]{64}$/i.test(edit.uriHash.trim())) return setError("The URI hash must be a 64 character hex SHA-256.");
    const value: MsgUpdateClass = {
      owner: address,
      classId,
      name: edit.name.trim(),
      description: edit.description.trim(),
      uri: edit.uri.trim(),
      uriHash: edit.uriHash.trim().toLowerCase(),
      tokenUriBase: edit.tokenUriBase.trim(),
      payoutAddress: edit.payout.trim(),
      royaltyRecipients: mask.includes("royalty_recipients") ? split.shares : [],
      royaltyBps: bps,
      updateMask: mask,
    };
    return send("edit", ArtifactMsgTypeUrls.UpdateClass, value, "Update failed");
  };

  // ---- Mint policy ----
  const [policy, setPolicy] = useState<MintPolicyState>(() => mintPolicyStateFrom(cls.mint_policy));
  const savePolicy = () => {
    if (!address) return;
    const mp = mintPolicyToMsg(policy, soulbound, cls.mint_policy?.price?.denom || config.denom);
    if (!mp.policy) return setError(mp.error);
    const value: MsgSetMintPolicy = { owner: address, classId, mintPolicy: mp.policy };
    return send("policy", ArtifactMsgTypeUrls.SetMintPolicy, value, "Couldn't save the mint policy");
  };

  // ---- Minters ----
  const [newMinter, setNewMinter] = useState("");
  const setMinters = (add: string[], remove: string[]) => {
    if (!address) return;
    const value: MsgSetMinters = { owner: address, classId, add, remove };
    return send(`minters-${add[0] || remove[0]}`, ArtifactMsgTypeUrls.SetMinters, value, "Couldn't update minters", () =>
      setNewMinter("")
    );
  };

  // ---- Supply ----
  const [newCap, setNewCap] = useState("");
  const issued = issuedCount(cls);
  const currentCap = BigInt(cls.max_supply || "0");
  const setCap = () => {
    if (!address) return;
    if (!/^\d+$/.test(newCap)) return setError("Enter a whole number.");
    const cap = BigInt(newCap);
    if (cap === BigInt(0)) return setError("A cap can't be removed once set.");
    if (cap < issued) return setError(`The cap can't be below the ${issued} tokens already issued.`);
    if (currentCap !== BigInt(0) && cap >= currentCap) return setError("The cap can only be lowered.");
    const value: MsgSetMaxSupply = { owner: address, classId, maxSupply: cap, editionId: BigInt(0) };
    return send("cap", ArtifactMsgTypeUrls.SetMaxSupply, value, "Couldn't set the cap", () => setNewCap(""));
  };
  const closeMinting = () => {
    if (!address) return;
    if (!confirm("Close minting for good? No more tokens can ever be minted in this class.")) return;
    const value: MsgCloseMinting = { owner: address, classId };
    return send("close", ArtifactMsgTypeUrls.CloseMinting, value, "Couldn't close minting");
  };

  // ---- Freeze ----
  const freeze = () => {
    if (!address) return;
    if (!confirm("Freeze metadata for good? The class and all its tokens' metadata can never be edited again.")) return;
    const value: MsgFreezeClassMetadata = { owner: address, classId };
    return send("freeze", ArtifactMsgTypeUrls.FreezeClassMetadata, value, "Couldn't freeze metadata");
  };

  // ---- Ownership ----
  const [proposed, setProposed] = useState("");
  const propose = () => {
    if (!address) return;
    if (!looksLikeAddress(proposed, prefix)) return setError("Enter a valid address.");
    if (proposed.trim() === address) return setError("You already own this class.");
    const value: MsgProposeClassOwner = { owner: address, classId, proposedOwner: proposed.trim() };
    return send("propose", ArtifactMsgTypeUrls.ProposeClassOwner, value, "Couldn't propose the handover", () =>
      setProposed("")
    );
  };

  // ---- Revoke ----
  const [revokeIds, setRevokeIds] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const revoke = () => {
    if (!address) return;
    const ids = Array.from(new Set(revokeIds.split(/[\s,]+/).filter(Boolean)));
    if (ids.length === 0 || ids.some((i) => !/^\d+$/.test(i))) return setError("Enter token ids, separated by commas.");
    if (!confirm(`Revoke ${ids.length} token${ids.length === 1 ? "" : "s"}? Their deposits go back to the holders.`)) return;
    const value: MsgRevoke = { owner: address, classId, tokenIds: ids.map((i) => BigInt(i)), reason: revokeReason.trim() };
    return send("revoke", ArtifactMsgTypeUrls.Revoke, value, "Revoke failed", () => {
      setRevokeIds("");
      setRevokeReason("");
    });
  };

  // ---- Delete ----
  const canDelete = (cls.supply || "0") === "0" && (cls.reserved_supply || "0") === "0";
  const del = () => {
    if (!address) return;
    if (!confirm("Delete this class? The creation fee stays burned and the id is never reused.")) return;
    const value: MsgDeleteClass = { owner: address, classId };
    return run("delete", async () => {
      await signAndBroadcast([{ typeUrl: ArtifactMsgTypeUrls.DeleteClass, value }]);
      invalidateArtifacts();
      onDeleted();
    }, txFailure("Couldn't delete the class"));
  };

  const busy = pending !== null;
  const btn = "sd-btn sd-btn-verdigris";
  const btnSecondary = "sd-btn sd-btn-secondary";
  const deposit = params?.token_deposit;

  return (
    <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white">{isOwner ? "Manage this class" : "Mint as a minter"}</h3>
      <ActionBanner message={error} onDismiss={clearError} />

      {cls.flags?.redeemable && onOpenRedeem && !editions && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
          <span>Redeem tickets at the door. Works with a session key too.</span>
          <button type="button" onClick={onOpenRedeem} className="sd-btn sd-btn-verdigris shrink-0">Open door scanner</button>
        </div>
      )}

      {!cls.minting_closed && !hidden && editions && (
        <ActionSection title="New edition" open={open === "edition"} onToggle={() => toggle("edition")}>
          <p className="text-xs text-zinc-500">
            An edition is a run of identical units. Creating one burns
            {deposit && deposit !== "0" ? ` ${formatSpark(deposit)} ${config.displayDenom}` : " a token deposit"}{" "}as a fee. Mint its units from the
            edition&apos;s page.
          </p>
          <MetadataEditor value={edMeta} onChange={setEdMeta} />
          <FieldLabel label="Unit cap" hint="0 for no cap. It can be lowered later, never raised.">
            <NumberInput value={edCap} min={0} onChange={(e) => setEdCap(e.target.value)} className={fieldCls} />
          </FieldLabel>
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={edClaim} onChange={(e) => setEdClaim(e.target.checked)} className="mt-0.5" />
            <span>
              Make it an impact certificate
              <span className="block text-zinc-500">A record of a piece of work that funders can buy units of, and that anyone can reward later.</span>
            </span>
          </label>
          {edClaim && (
            <div className="space-y-2 rounded-lg border border-zinc-800 p-3">
              <FieldLabel label="Scope" hint="What work the certificate covers.">
                <textarea value={claim.scope} onChange={(e) => setClaim({ ...claim, scope: e.target.value })} rows={2} className={fieldCls} />
              </FieldLabel>
              <FieldLabel label="Contributors" hint="Addresses, one per line. Up to 20.">
                <textarea value={claim.contributors} onChange={(e) => setClaim({ ...claim, contributors: e.target.value })} rows={2} className={`${fieldCls} font-mono text-xs`} />
              </FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <FieldLabel label="Work started">
                  <input type="date" value={claim.start} onChange={(e) => setClaim({ ...claim, start: e.target.value })} className={fieldCls} />
                </FieldLabel>
                <FieldLabel label="Work ended">
                  <input type="date" value={claim.end} onChange={(e) => setClaim({ ...claim, end: e.target.value })} className={fieldCls} />
                </FieldLabel>
              </div>
              <FieldLabel label="Initiative id" hint="Optional. A completed initiative you were assigned. Each initiative gets one certificate.">
                <input value={claim.initiative} onChange={(e) => setClaim({ ...claim, initiative: e.target.value })} inputMode="numeric" className={fieldCls} />
              </FieldLabel>
            </div>
          )}
          <ContentLicenseNotice what="Edition metadata and media" />
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={edAgreed} onChange={(e) => setEdAgreed(e.target.checked)} className="mt-0.5" />
            <span>I dedicate this content to the public domain (CC0), and it&apos;s mine to dedicate or already public domain.</span>
          </label>
          <button onClick={createEdition} disabled={busy} className={btn}>
            {pending === "edition" ? "Creating…" : "Create edition"}
          </button>
        </ActionSection>
      )}

      {!cls.minting_closed && !hidden && !editions && (
        <ActionSection title="Mint tokens" open={open === "mint"} onToggle={() => toggle("mint")}>
          <p className="text-xs text-zinc-500">
            {deposit && deposit !== "0" ? `Each token holds a ${formatSpark(deposit)} ${config.displayDenom} deposit from you, refunded to whoever burns it. ` : ""}
            Recipients who don&apos;t accept tokens directly get them in their inbox, which costs a small fee.
            {!isOwner && " Each recipient's inbox also counts mints from this class together."}
          </p>
          {mintRows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-zinc-800 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-400">Token {i + 1}</span>
                {mintRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMintRows(mintRows.filter((_, j) => j !== i))}
                    className="text-xs text-zinc-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input
                value={r.recipient}
                onChange={(e) => setMintRows(mintRows.map((x, j) => (j === i ? { ...x, recipient: e.target.value } : x)))}
                placeholder="Recipient address (blank for yourself)"
                className={`${fieldCls} font-mono text-xs`}
              />
              {!blind && (
                <MetadataEditor
                  value={r.metadata}
                  onChange={(m) => setMintRows(mintRows.map((x, j) => (j === i ? { ...x, metadata: m } : x)))}
                />
              )}
              {!blind && maxStages > 0 && (
                <details className="text-xs text-zinc-400" open={r.stages.length > 0}>
                  <summary className="cursor-pointer select-none text-zinc-300">Metadata schedule ({r.stages.length}/{maxStages})</summary>
                  <p className="my-2 text-zinc-500">
                    Later stages replace what the token shows, from their start time. They&apos;re fixed at mint and can&apos;t be changed.
                  </p>
                  <ScheduleEditor
                    stages={r.stages}
                    max={maxStages}
                    onChange={(st) => setMintRows(mintRows.map((x, j) => (j === i ? { ...x, stages: st } : x)))}
                  />
                </details>
              )}
            </div>
          ))}
          {blind && (
            <p className="text-xs text-zinc-500">Blind mint: tokens are minted with no metadata. Reveal each one later from Reveal below.</p>
          )}
          {mintRows.length < maxBatch && (
            <button
              type="button"
              onClick={() => setMintRows([...mintRows, emptyRow()])}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              + Add another token
            </button>
          )}
          <ContentLicenseNotice what="Token metadata and media" />
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={mintAgreed} onChange={(e) => setMintAgreed(e.target.checked)} className="mt-0.5" />
            <span>I dedicate this content to the public domain (CC0), and it&apos;s mine to dedicate or already public domain.</span>
          </label>
          <button onClick={mint} disabled={busy} className={btn}>
            {pending === "mint" ? "Minting…" : `Mint ${mintRows.length} token${mintRows.length === 1 ? "" : "s"}`}
          </button>
        </ActionSection>
      )}

      {!cls.minting_closed && !hidden && !editions && (
        <ActionSection title="Issue to many" open={open === "issue"} onToggle={() => toggle("issue")}>
          <p className="text-xs text-zinc-500">
            One token each, all with the same metadata, for attendance or participation badges. Up to {maxIssue} recipients at a time.
            {deposit && deposit !== "0" ? ` Each token holds a ${formatSpark(deposit)} ${config.displayDenom} deposit from you.` : ""}
          </p>
          <FieldLabel label={`Recipients (${recipients.length})`} hint="Addresses, one per line or separated by commas.">
            <textarea value={issueTo} onChange={(e) => setIssueTo(e.target.value)} rows={4} className={`${fieldCls} font-mono text-xs`} />
          </FieldLabel>
          {blind ? (
            <p className="text-xs text-zinc-500">Blind mint: the tokens are issued with no metadata and revealed later.</p>
          ) : (
            <MetadataEditor value={issueMeta} onChange={setIssueMeta} />
          )}
          <ContentLicenseNotice what="Token metadata and media" />
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={issueAgreed} onChange={(e) => setIssueAgreed(e.target.checked)} className="mt-0.5" />
            <span>I dedicate this content to the public domain (CC0), and it&apos;s mine to dedicate or already public domain.</span>
          </label>
          <button onClick={issue} disabled={busy || recipients.length === 0} className={btn}>
            {pending === "issue" ? "Issuing…" : `Issue ${recipients.length} token${recipients.length === 1 ? "" : "s"}`}
          </button>
        </ActionSection>
      )}

      {!editions && cls.reveal?.kind && cls.reveal.kind !== RevealKind.NONE && <RevealTools cls={cls} isOwner={isOwner} onChanged={onChanged} />}

      {isOwner && (
        <>
          <ActionSection title="Edit class" open={open === "edit"} onToggle={() => toggle("edit")}>
            {hidden && <p className="text-xs text-amber-300">A hidden class can&apos;t be edited.</p>}
            {cls.metadata_frozen && (
              <p className="text-xs text-zinc-500">Metadata is frozen. Only the payout address and royalty can change.</p>
            )}
            <FieldLabel label="Name">
              <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={fieldCls} disabled={cls.metadata_frozen} />
            </FieldLabel>
            <FieldLabel label="Description">
              <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={3} className={fieldCls} disabled={cls.metadata_frozen} />
            </FieldLabel>
            <FieldLabel label="Cover media URI">
              <input value={edit.uri} onChange={(e) => setEdit({ ...edit, uri: e.target.value })} className={fieldCls} disabled={cls.metadata_frozen} />
            </FieldLabel>
            <FieldLabel label="Cover media SHA-256">
              <input value={edit.uriHash} onChange={(e) => setEdit({ ...edit, uriHash: e.target.value })} className={`${fieldCls} font-mono text-xs`} disabled={cls.metadata_frozen} />
            </FieldLabel>
            <FieldLabel label="Token URI base">
              <input value={edit.tokenUriBase} onChange={(e) => setEdit({ ...edit, tokenUriBase: e.target.value })} className={fieldCls} disabled={cls.metadata_frozen} />
            </FieldLabel>
            <FieldLabel label="Payout address">
              <input value={edit.payout} onChange={(e) => setEdit({ ...edit, payout: e.target.value })} className={`${fieldCls} font-mono text-xs`} />
            </FieldLabel>
            {!soulbound && !cls.royalty_locked && (
              <>
                <FieldLabel label="Royalty (%)" hint={`Currently ${bpsToPercent(cls.royalty_bps)}. It can only go down.`}>
                  <input value={edit.royaltyPct} onChange={(e) => setEdit({ ...edit, royaltyPct: e.target.value })} inputMode="decimal" className={`${fieldCls} w-24`} />
                </FieldLabel>
                <span className="block text-xs font-medium text-zinc-400">Royalty split</span>
                <RoyaltySplitEditor rows={edit.royaltyRows} onChange={(rows) => setEdit({ ...edit, royaltyRows: rows })} />
              </>
            )}
            {!soulbound && cls.royalty_locked && (
              <p className="text-xs text-zinc-500">The royalty ({bpsToPercent(cls.royalty_bps)}) and its split are locked.</p>
            )}
            <button onClick={updateClass} disabled={busy || hidden} className={btn}>
              {pending === "edit" ? "Saving…" : "Save changes"}
            </button>
          </ActionSection>

          {!soulbound && !cls.royalty_locked && (
            <ActionSection title="Lock royalty" open={open === "royalty-lock"} onToggle={() => toggle("royalty-lock")}>
              <p className="text-xs text-zinc-500">
                Freezes the {bpsToPercent(cls.royalty_bps)}{" "}royalty and its split for good, so buyers and royalty recipients know it can&apos;t
                be lowered or rerouted. One way.
              </p>
              <button onClick={lockRoyalty} disabled={busy} className="rounded-lg border border-emerald-700/50 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/20 disabled:opacity-50">
                {pending === "royalty-lock" ? "Locking…" : "Lock royalty"}
              </button>
            </ActionSection>
          )}

          {!cls.minting_closed && !editions && !cls.flags?.mutual && (
            <ActionSection title="Public mint" open={open === "policy"} onToggle={() => toggle("policy")}>
              <MintPolicyFields value={policy} onChange={setPolicy} soulbound={soulbound} displayDenom={config.displayDenom} disabled={hidden} />
              <p className="text-xs text-zinc-500">A price change applies right away. Buyers are protected by the price they saw.</p>
              <button onClick={savePolicy} disabled={busy || hidden} className={btn}>
                {pending === "policy" ? "Saving…" : "Save mint policy"}
              </button>
            </ActionSection>
          )}

          <ActionSection title={`Minters (${cls.minters?.length || 0})`} open={open === "minters"} onToggle={() => toggle("minters")}>
            <p className="text-xs text-zinc-500">
              Minters can mint into this class and pay their own deposits. You can always mint as the owner.
            </p>
            {(cls.minters || []).length === 0 && <p className="text-xs text-zinc-600">No minters.</p>}
            {(cls.minters || []).map((m) => (
              <div key={m} className="flex items-center justify-between gap-2 text-xs">
                <CopyableAddress address={m} resolveName className="font-mono text-zinc-300" />
                <button onClick={() => setMinters([], [m])} disabled={busy} className="text-zinc-500 hover:text-red-400 disabled:opacity-50">
                  {pending === `minters-${m}` ? "Removing…" : "Remove"}
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input value={newMinter} onChange={(e) => setNewMinter(e.target.value)} placeholder="Address" className={`${fieldCls} font-mono text-xs`} />
              <button
                onClick={() =>
                  looksLikeAddress(newMinter, prefix) ? setMinters([newMinter.trim()], []) : setError("Enter a valid address.")
                }
                disabled={busy || !newMinter.trim()}
                className={btnSecondary}
              >
                Add
              </button>
            </div>
          </ActionSection>

          {!cls.minting_closed && (
            <ActionSection title="Supply" open={open === "supply"} onToggle={() => toggle("supply")}>
              <p className="text-xs text-zinc-500">
                {currentCap === BigInt(0) ? "No cap yet." : `Capped at ${currentCap}.`} {issued.toString()} issued so far, counting burned and pending tokens.
                A cap can only go down.
              </p>
              <div className="flex gap-2">
                <NumberInput value={newCap} min={0} onChange={(e) => setNewCap(e.target.value)} placeholder="New cap" className={fieldCls} />
                <button onClick={setCap} disabled={busy || !newCap} className={btnSecondary}>
                  {pending === "cap" ? "Saving…" : "Set cap"}
                </button>
              </div>
              <div className="border-t border-zinc-800 pt-2">
                <p className="text-xs text-zinc-500">Closing minting is permanent. Pending mints can still be accepted.</p>
                <button onClick={closeMinting} disabled={busy} className="mt-2 rounded-lg border border-amber-700/50 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/20 disabled:opacity-50">
                  {pending === "close" ? "Closing…" : "Close minting"}
                </button>
              </div>
            </ActionSection>
          )}

          {!cls.metadata_frozen && (
            <ActionSection title="Freeze metadata" open={open === "freeze"} onToggle={() => toggle("freeze")}>
              <p className="text-xs text-zinc-500">
                Locks the class metadata, the token URI base and every token&apos;s metadata for good. Payout and royalty stay editable.
              </p>
              <button onClick={freeze} disabled={busy} className="rounded-lg border border-emerald-700/50 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-900/20 disabled:opacity-50">
                {pending === "freeze" ? "Freezing…" : "Freeze metadata"}
              </button>
            </ActionSection>
          )}

          <ActionSection title="Transfer ownership" open={open === "owner"} onToggle={() => toggle("owner")}>
            <p className="text-xs text-zinc-500">
              The new owner has to accept. When they do, minters are cleared, public minting turns off, and payout and royalty go to them.
            </p>
            <div className="flex gap-2">
              <input value={proposed} onChange={(e) => setProposed(e.target.value)} placeholder="New owner address" className={`${fieldCls} font-mono text-xs`} />
              <button onClick={propose} disabled={busy || !proposed.trim()} className={btnSecondary}>
                {pending === "propose" ? "Proposing…" : "Propose"}
              </button>
            </div>
          </ActionSection>

          {issuerCanRevoke(cls) && !editions && (
            <ActionSection title="Revoke tokens" open={open === "revoke"} onToggle={() => toggle("revoke")} tone="danger">
              <p className="text-xs text-zinc-500">Burns holders&apos; tokens. Each deposit goes back to its holder, not to you.</p>
              <input value={revokeIds} onChange={(e) => setRevokeIds(e.target.value)} placeholder="Token ids, e.g. 3, 7, 12" className={fieldCls} />
              <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Reason (shown to holders)" maxLength={256} className={fieldCls} />
              <button onClick={revoke} disabled={busy || !revokeIds.trim()} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                {pending === "revoke" ? "Revoking…" : "Revoke"}
              </button>
            </ActionSection>
          )}

          <CraftPanel cls={cls} params={params} mode="manage" onChanged={onChanged} />

          <ActionSection title="Delete class" open={open === "delete"} onToggle={() => toggle("delete")} tone="danger">
            {canDelete ? (
              <p className="text-xs text-zinc-500">The class has no live or pending tokens, so it can be deleted.</p>
            ) : (
              <p className="text-xs text-zinc-500">A class can only be deleted once every token is burned and no mints are pending.</p>
            )}
            <button onClick={del} disabled={busy || !canDelete} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
              {pending === "delete" ? "Deleting…" : "Delete class"}
            </button>
          </ActionSection>
        </>
      )}
    </div>
  );
}
