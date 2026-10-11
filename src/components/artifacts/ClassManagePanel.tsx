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
import type { ArtifactClass, ArtifactParams } from "@/types/artifact";
import type {
  MsgCloseMinting,
  MsgDeleteClass,
  MsgFreezeClassMetadata,
  MsgMint,
  MsgProposeClassOwner,
  MsgRevoke,
  MsgSetMaxSupply,
  MsgSetMintPolicy,
  MsgSetMinters,
  MsgUpdateClass,
} from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import { MintPolicyFields, mintPolicyToMsg, type MintPolicyState } from "./CreateClassForm";
import {
  ActionSection,
  FieldLabel,
  MetadataEditor,
  RoyaltySplitEditor,
  bpsToPercent,
  emptyMetadataForm,
  fieldCls,
  isHidden,
  isTransferable,
  issuedCount,
  issuerCanRevoke,
  looksLikeAddress,
  metadataFormToMsg,
  royaltyRowsToShares,
  txFailure,
  unixToLocalInput,
  validateMetadataForm,
  type MetadataForm,
  type RoyaltyRow,
} from "./shared";

interface Props {
  cls: ArtifactClass;
  params: ArtifactParams | null;
  /** True for the class owner; false for a listed minter (who may only mint). */
  isOwner: boolean;
  onChanged: () => void;
  onDeleted: () => void;
}

type Section =
  | "mint"
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
}

export default function ClassManagePanel({ cls, params, isOwner, onChanged, onDeleted }: Props) {
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

  const send = async (key: string, typeUrl: string, value: unknown, fail: string, after?: () => void) =>
    run(key, async () => {
      await signAndBroadcast([{ typeUrl, value }]);
      invalidateArtifacts();
      after?.();
      onChanged();
    }, txFailure(fail));

  // ---- Mint ----
  const [mintRows, setMintRows] = useState<MintRow[]>([{ recipient: "", metadata: emptyMetadataForm() }]);
  const [mintAgreed, setMintAgreed] = useState(false);
  const mint = () => {
    if (!address) return;
    for (const r of mintRows) {
      if (r.recipient.trim() && !looksLikeAddress(r.recipient, prefix)) return setError(`"${r.recipient}" isn't a valid address.`);
      const bad = validateMetadataForm(r.metadata);
      if (bad) return setError(bad);
    }
    if (!mintAgreed) return setError("Confirm the public domain dedication first.");
    const value: MsgMint = {
      minter: address,
      classId,
      entries: mintRows.map((r) => ({ recipient: r.recipient.trim(), metadata: metadataFormToMsg(r.metadata) })),
      acceptedContentLicense: license.license,
    };
    return send("mint", ArtifactMsgTypeUrls.Mint, value, "Mint failed", () => {
      setMintRows([{ recipient: "", metadata: emptyMetadataForm() }]);
      setMintAgreed(false);
    });
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
  const [policy, setPolicy] = useState<MintPolicyState>(() => ({
    enabled: !!cls.mint_policy?.public_mint_enabled,
    price: formatSpark(cls.mint_policy?.price?.amount || "0").replace(/,/g, ""),
    start: unixToLocalInput(cls.mint_policy?.start_time),
    end: unixToLocalInput(cls.mint_policy?.end_time),
    limit: String(cls.mint_policy?.per_address_limit ?? 0),
  }));
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
    const value: MsgSetMaxSupply = { owner: address, classId, maxSupply: cap };
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
  const btn = "sd-btn sd-btn-primary";
  const btnSecondary = "sd-btn sd-btn-secondary";
  const deposit = params?.token_deposit;

  return (
    <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white">{isOwner ? "Manage this class" : "Mint as a minter"}</h3>
      <ActionBanner message={error} onDismiss={clearError} />

      {!cls.minting_closed && !hidden && (
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
              <MetadataEditor
                value={r.metadata}
                onChange={(m) => setMintRows(mintRows.map((x, j) => (j === i ? { ...x, metadata: m } : x)))}
              />
            </div>
          ))}
          {mintRows.length < maxBatch && (
            <button
              type="button"
              onClick={() => setMintRows([...mintRows, { recipient: "", metadata: emptyMetadataForm() }])}
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
            {!soulbound && (
              <>
                <FieldLabel label="Royalty (%)" hint={`Currently ${bpsToPercent(cls.royalty_bps)}. It can only go down.`}>
                  <input value={edit.royaltyPct} onChange={(e) => setEdit({ ...edit, royaltyPct: e.target.value })} inputMode="decimal" className={`${fieldCls} w-24`} />
                </FieldLabel>
                <span className="block text-xs font-medium text-zinc-400">Royalty split</span>
                <RoyaltySplitEditor rows={edit.royaltyRows} onChange={(rows) => setEdit({ ...edit, royaltyRows: rows })} />
              </>
            )}
            <button onClick={updateClass} disabled={busy || hidden} className={btn}>
              {pending === "edit" ? "Saving…" : "Save changes"}
            </button>
          </ActionSection>

          {!cls.minting_closed && (
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

          {issuerCanRevoke(cls) && (
            <ActionSection title="Revoke tokens" open={open === "revoke"} onToggle={() => toggle("revoke")} tone="danger">
              <p className="text-xs text-zinc-500">Burns holders&apos; tokens. Each deposit goes back to its holder, not to you.</p>
              <input value={revokeIds} onChange={(e) => setRevokeIds(e.target.value)} placeholder="Token ids, e.g. 3, 7, 12" className={fieldCls} />
              <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Reason (shown to holders)" maxLength={256} className={fieldCls} />
              <button onClick={revoke} disabled={busy || !revokeIds.trim()} className="rounded-lg border border-red-800/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/20 disabled:opacity-50">
                {pending === "revoke" ? "Revoking…" : "Revoke"}
              </button>
            </ActionSection>
          )}

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
