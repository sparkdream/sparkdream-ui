"use client";

// The fields of the x/storage council proposals (docs/x-storage-spec.md in
// the chain repo: approved operators §3.5, scanners and flags §3.6, voiding
// §3.5, prices §4.2). NewCommunityProposal picks the kind and submits; this
// component owns the fields and hands back a draft: the message, the first
// thing wrong with the fields, and a one-line summary for the proposal note.
//
// Two kinds of feedback, kept apart on purpose. A field the chain could
// never accept (a malformed address or hash, a price outside the backend's
// bounds) blocks the submit. What the chain would refuse as things stand
// today (an operator that has not registered, a request in the wrong state)
// is shown as a warning only, because a proposal executes after its vote and
// the state may be different by then.

import { useEffect, useMemo, useState } from "react";
import { listServiceOperatorsByServiceType } from "@/lib/api";
import { getStorageParams, getStorageRequest, listStorageBackends } from "@/lib/storageApi";
import {
  getOperatorStanding,
  getRemovedHash,
  listApprovedOperators,
  listApprovedScanners,
} from "@/lib/storageCouncilApi";
import {
  StorageCouncilMsgTypeUrls,
  addressProblem,
  approveOperatorMsg,
  approveScannerMsg,
  displayAmountToMicro,
  parseHashes,
  pricesProblem,
  reasonProblem,
  removeOperatorMsg,
  removeScannerMsg,
  requestIdProblem,
  unflagRemovedMsg,
  updateStoragePricesMsg,
  voidCompletionMsg,
} from "@/lib/storageCouncilMsgs";
import type { StorageMsg } from "@/lib/storageMsgs";
import { isMissingEndpoint } from "@/lib/errors";
import { formatSpark, truncateAddress } from "@/lib/utils";
import { CONTENT_SCANNER_SERVICE_TYPE, OPERATOR_STATUS_LABELS, type Operator } from "@/types/service";
import {
  REQUEST_STATUS_LABELS,
  RequestStatus,
  type ApprovedOperator,
  type ApprovedScanner,
  type RemovedHash,
  type StorageBackendWithBounds,
  type StorageCouncilLimits,
  type StorageRequestResponse,
} from "@/types/storage";

export type StorageProposalKind =
  | "storage-approve-operator"
  | "storage-remove-operator"
  | "storage-approve-scanner"
  | "storage-remove-scanner"
  | "storage-void"
  | "storage-unflag"
  | "storage-prices";

export const STORAGE_PROPOSAL_TYPES: { value: StorageProposalKind; label: string; description: string }[] = [
  { value: "storage-approve-operator", label: "Approve storage operator", description: "Let one of this council's operators make permanent copies" },
  { value: "storage-remove-operator", label: "Remove storage operator", description: "Withdraw this council's approval of a storage operator" },
  { value: "storage-approve-scanner", label: "Approve storage scanner", description: "Make a content scanner's flags and verdicts count for permanent copies" },
  { value: "storage-remove-scanner", label: "Remove storage scanner", description: "Withdraw this council's approval of a content scanner" },
  { value: "storage-void", label: "Void a permanent copy", description: "Reopen a request whose copy is missing or wrong" },
  { value: "storage-unflag", label: "Lift removed-content flags", description: "Remove wrong flags set by this council's scanners" },
  { value: "storage-prices", label: "Storage prices", description: "Change a backend's price per byte and minimum fee" },
];

/** The inner message each kind carries, for the AllowedMessages filter. */
export const STORAGE_REQUIRED_MESSAGES: Record<StorageProposalKind, string[]> = {
  "storage-approve-operator": [StorageCouncilMsgTypeUrls.ApproveOperator],
  "storage-remove-operator": [StorageCouncilMsgTypeUrls.RemoveOperator],
  "storage-approve-scanner": [StorageCouncilMsgTypeUrls.ApproveScanner],
  "storage-remove-scanner": [StorageCouncilMsgTypeUrls.RemoveScanner],
  "storage-void": [StorageCouncilMsgTypeUrls.VoidCompletion],
  "storage-unflag": [StorageCouncilMsgTypeUrls.UnflagRemoved],
  "storage-prices": [StorageCouncilMsgTypeUrls.UpdateOperationalParams],
};

export function isStorageProposalKind(type: string): type is StorageProposalKind {
  return type in STORAGE_REQUIRED_MESSAGES;
}

export interface StorageDraft {
  /** Null while `problem` is set. */
  msg: StorageMsg | null;
  /** The first thing wrong with the fields, as a sentence. */
  problem: string | null;
  /** Default proposal note. */
  summary: string;
}

// Chain defaults (x/storage/types/params.go), used until params load.
const DEFAULT_MAX_REASON_BYTES = 256;
const DEFAULT_MAX_HASHES = 50;

const OTHER = "__other__";
const INPUT_CLASS =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none";
const LABEL_CLASS = "mb-1.5 block text-sm font-medium text-zinc-300";
const BYTES_PER_MIB = BigInt(1024 * 1024);

/** Base units as plain input text in the display denom ("1000000" is "1"). */
function microToInput(micro: string): string {
  try {
    const n = BigInt(micro);
    const frac = (n % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
    return frac ? `${n / BigInt(1_000_000)}.${frac}` : `${n / BigInt(1_000_000)}`;
  } catch {
    return "";
  }
}

function opLabel(o: Operator): string {
  return `${truncateAddress(o.address)} (${(OPERATOR_STATUS_LABELS[o.status] ?? "Unknown").toLowerCase()})`;
}

function approvalLabel(address: string, stale?: boolean): string {
  return stale ? `${truncateAddress(address)} (approval no longer counts)` : truncateAddress(address);
}

interface PickerOption {
  value: string;
  label: string;
}

/** A list of known addresses, with a way to type one that is not listed. */
function AddressPicker({
  label,
  options,
  pick,
  typed,
  onPick,
  onTyped,
  prefix,
  emptyText,
}: {
  label: string;
  /** Null while loading or when the list could not be read. */
  options: PickerOption[] | null;
  pick: string;
  typed: string;
  onPick: (v: string) => void;
  onTyped: (v: string) => void;
  prefix: string;
  emptyText: string;
}) {
  const listed = options !== null && options.length > 0;
  return (
    <div className="space-y-2">
      <label className={LABEL_CLASS}>{label}</label>
      {listed ? (
        <select value={pick} onChange={(e) => onPick(e.target.value)} className="sd-select w-full">
          <option value="">Choose an address</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={OTHER}>Another address</option>
        </select>
      ) : (
        options !== null && <p className="text-xs text-zinc-500">{emptyText}</p>
      )}
      {(!listed || pick === OTHER) && (
        <input
          type="text"
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          placeholder={`${prefix}1...`}
          spellCheck={false}
          className={`${INPUT_CLASS} font-mono`}
        />
      )}
    </div>
  );
}

function Notes({ problem, warnings, infos }: { problem: string | null; warnings: string[]; infos: string[] }) {
  return (
    <>
      {problem && <p className="text-xs text-red-400">{problem}</p>}
      {warnings.map((w) => (
        <p key={w} className="text-xs text-amber-400">
          {w}
        </p>
      ))}
      {infos.map((n) => (
        <p key={n} className="text-xs text-zinc-500">
          {n}
        </p>
      ))}
    </>
  );
}

export default function StorageProposalFields({
  kind,
  policyAddress,
  prefix,
  displayDenom,
  onDraft,
}: {
  kind: StorageProposalKind;
  /** The council's policy address: the `authority` of every message. */
  policyAddress: string;
  prefix: string;
  displayDenom: string;
  /** Called whenever the draft changes. Pass a stable function (a state setter). */
  onDraft: (draft: StorageDraft) => void;
}) {
  const operatorKind = kind === "storage-approve-operator" || kind === "storage-remove-operator";
  const scannerKind = kind === "storage-approve-scanner" || kind === "storage-remove-scanner";
  const needsBackend = operatorKind || kind === "storage-prices";
  const needsScanners = scannerKind || kind === "storage-unflag";

  const [backends, setBackends] = useState<StorageBackendWithBounds[] | null>(null);
  const [limits, setLimits] = useState<StorageCouncilLimits>({});
  const [backendName, setBackendName] = useState("");
  useEffect(() => {
    let live = true;
    listStorageBackends()
      .then((list) => {
        if (!live) return;
        setBackends(list);
        setBackendName((prev) => prev || list[0]?.name || "");
      })
      .catch(() => live && setBackends([]));
    getStorageParams()
      .then((l) => live && setLimits(l))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const backend = backends?.find((b) => b.name === backendName) ?? null;

  // The address picked or typed, for the four approval kinds.
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  useEffect(() => {
    setPick("");
    setTyped("");
  }, [kind, backendName]);

  // x/service operators of the backend's service type, and its approvals.
  const serviceType = backend?.service_type ?? "";
  const [serviceOps, setServiceOps] = useState<Operator[] | null>(null);
  const [approvedOps, setApprovedOps] = useState<ApprovedOperator[] | null>(null);
  useEffect(() => {
    if (!operatorKind || !backendName || !serviceType) return;
    let live = true;
    setServiceOps(null);
    setApprovedOps(null);
    listServiceOperatorsByServiceType(serviceType, { limit: "200" })
      .then((res) => live && setServiceOps(res.operators || []))
      .catch(() => {});
    listApprovedOperators(backendName)
      .then((list) => live && setApprovedOps(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [operatorKind, backendName, serviceType]);

  // Content scanners (x/service) and the approved list, one for every backend.
  const [scannerOps, setScannerOps] = useState<Operator[] | null>(null);
  const [approvedScanners, setApprovedScanners] = useState<ApprovedScanner[] | null>(null);
  useEffect(() => {
    if (!needsScanners) return;
    let live = true;
    listServiceOperatorsByServiceType(CONTENT_SCANNER_SERVICE_TYPE, { limit: "200" })
      .then((res) => live && setScannerOps(res.operators || []))
      .catch(() => {});
    listApprovedScanners()
      .then((list) => live && setApprovedScanners(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [needsScanners]);

  // What the picker offers. Approving: the operators that name this council
  // as controller and hold no counting approval. Removing: the approvals this
  // council gave (only the approving controller or governance removes).
  const options: PickerOption[] | null = useMemo(() => {
    switch (kind) {
      case "storage-approve-operator": {
        if (!serviceOps || !approvedOps) return null;
        const counting = new Set(approvedOps.filter((a) => !a.stale).map((a) => a.operator));
        return serviceOps
          .filter((o) => o.controller === policyAddress && !counting.has(o.address))
          .map((o) => ({ value: o.address, label: opLabel(o) }));
      }
      case "storage-remove-operator":
        return approvedOps
          ? approvedOps.filter((a) => a.controller === policyAddress).map((a) => ({ value: a.operator, label: approvalLabel(a.operator, a.stale) }))
          : null;
      case "storage-approve-scanner": {
        if (!scannerOps || !approvedScanners) return null;
        const counting = new Set(approvedScanners.filter((a) => !a.stale).map((a) => a.scanner));
        return scannerOps
          .filter((o) => o.controller === policyAddress && !counting.has(o.address))
          .map((o) => ({ value: o.address, label: opLabel(o) }));
      }
      case "storage-remove-scanner":
        return approvedScanners
          ? approvedScanners.filter((a) => a.controller === policyAddress).map((a) => ({ value: a.scanner, label: approvalLabel(a.scanner, a.stale) }))
          : null;
      default:
        return null;
    }
  }, [kind, serviceOps, approvedOps, scannerOps, approvedScanners, policyAddress]);
  const listed = options !== null && options.length > 0;
  const address = listed && pick !== OTHER ? pick : typed.trim();

  // Open claims of the operator about to be removed.
  const [openClaims, setOpenClaims] = useState<{ key: string; count: number } | null>(null);
  const standingKey = kind === "storage-remove-operator" && backendName && address && !addressProblem(address, prefix, "operator") ? `${backendName}|${address}` : "";
  useEffect(() => {
    if (!standingKey) return;
    let live = true;
    const [b, op] = standingKey.split("|");
    getOperatorStanding(b, op)
      .then((res) => live && setOpenClaims({ key: standingKey, count: Number(res.open_claims ?? 0) }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [standingKey]);

  // Void: the request as it stands.
  const [voidId, setVoidId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [lookup, setLookup] = useState<{ id: string; res: StorageRequestResponse | null } | null>(null);
  const voidIdOk = kind === "storage-void" && requestIdProblem(voidId.trim()) === null ? voidId.trim() : "";
  useEffect(() => {
    if (!voidIdOk) return;
    let live = true;
    const timer = setTimeout(() => {
      getStorageRequest(voidIdOk)
        .then((res) => live && setLookup({ id: voidIdOk, res }))
        .catch((err) => {
          if (live && isMissingEndpoint(err)) setLookup({ id: voidIdOk, res: null });
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [voidIdOk]);

  // Unflag: the flags on each hash entered.
  const [hashesText, setHashesText] = useState("");
  const maxHashes = limits.max_hashes_per_unflag || DEFAULT_MAX_HASHES;
  const parsed = useMemo(() => parseHashes(hashesText, maxHashes), [hashesText, maxHashes]);
  const hashKey = kind === "storage-unflag" ? parsed.hashes.join(" ") : "";
  const [flags, setFlags] = useState<Record<string, RemovedHash | null>>({});
  useEffect(() => {
    if (!hashKey) return;
    let live = true;
    const timer = setTimeout(() => {
      Promise.all(
        hashKey.split(" ").map((h) =>
          getRemovedHash(h)
            .then((rec) => [h, rec] as const)
            .catch(() => null)
        )
      ).then((results) => {
        if (!live) return;
        const found = results.filter((r): r is readonly [string, RemovedHash | null] => r !== null);
        setFlags((prev) => ({ ...prev, ...Object.fromEntries(found) }));
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [hashKey]);

  // Prices, typed in the display denom and prefilled with the current ones.
  const [priceInput, setPriceInput] = useState("");
  const [minFeeInput, setMinFeeInput] = useState("");
  const currentPrice = backend?.price_per_byte ?? "";
  const currentMinFee = backend?.min_fee ?? "";
  useEffect(() => {
    setPriceInput(currentPrice ? microToInput(currentPrice) : "");
    setMinFeeInput(currentMinFee ? microToInput(currentMinFee) : "");
  }, [backendName, currentPrice, currentMinFee]);
  const priceMicro = displayAmountToMicro(priceInput);
  const minFeeMicro = displayAmountToMicro(minFeeInput);

  const maxReason = limits.max_reason_bytes || DEFAULT_MAX_REASON_BYTES;
  const draft: StorageDraft = useMemo(() => {
    const blocked = (problem: string, summary = ""): StorageDraft => ({ msg: null, problem, summary });
    const backendProblem = !backendName ? "Choose a storage backend." : null;
    switch (kind) {
      case "storage-approve-operator":
      case "storage-remove-operator": {
        const approve = kind === "storage-approve-operator";
        const problem = backendProblem ?? addressProblem(address, prefix, "operator");
        if (problem) return blocked(problem);
        return {
          msg: approve ? approveOperatorMsg(policyAddress, backendName, address) : removeOperatorMsg(policyAddress, backendName, address),
          problem: null,
          summary: `${approve ? "Approve" : "Remove"} storage operator ${truncateAddress(address)} ${approve ? "for" : "from"} ${backendName}`,
        };
      }
      case "storage-approve-scanner":
      case "storage-remove-scanner": {
        const approve = kind === "storage-approve-scanner";
        const problem = addressProblem(address, prefix, "scanner");
        if (problem) return blocked(problem);
        return {
          msg: approve ? approveScannerMsg(policyAddress, address) : removeScannerMsg(policyAddress, address),
          problem: null,
          summary: `${approve ? "Approve" : "Remove"} storage scanner ${truncateAddress(address)}`,
        };
      }
      case "storage-void": {
        const id = voidId.trim();
        const problem = requestIdProblem(id) ?? reasonProblem(voidReason, maxReason);
        if (problem) return blocked(problem);
        return {
          msg: voidCompletionMsg(policyAddress, id, voidReason.trim()),
          problem: null,
          summary: `Void the permanent copy of storage request #${id}`,
        };
      }
      case "storage-unflag": {
        if (parsed.problem) return blocked(parsed.problem);
        const n = parsed.hashes.length;
        return {
          msg: unflagRemovedMsg(policyAddress, parsed.hashes),
          problem: null,
          summary: n === 1 ? `Lift the removed-content flags on file ${parsed.hashes[0].slice(0, 12)}...` : `Lift the removed-content flags on ${n} files`,
        };
      }
      case "storage-prices": {
        if (backendProblem || !backend) return blocked(backendProblem ?? "Choose a storage backend.");
        const problem = pricesProblem(backend, priceMicro, minFeeMicro, displayDenom);
        if (problem || priceMicro === null || minFeeMicro === null) return blocked(problem ?? "Enter both prices.");
        if (priceMicro === backend.price_per_byte && minFeeMicro === backend.min_fee) {
          return blocked("These are the backend's current prices. Change at least one.");
        }
        return {
          msg: updateStoragePricesMsg(policyAddress, backend.name, priceMicro, minFeeMicro),
          problem: null,
          summary: `Set ${backend.name} storage prices: ${formatSpark(priceMicro)} ${displayDenom} per byte, minimum fee ${formatSpark(minFeeMicro)} ${displayDenom}`,
        };
      }
    }
  }, [kind, backendName, backend, address, prefix, policyAddress, voidId, voidReason, maxReason, parsed, priceMicro, minFeeMicro, displayDenom]);
  useEffect(() => {
    onDraft(draft);
  }, [draft, onDraft]);

  // What the chain would refuse as things stand, and what the vote will do.
  const warnings: string[] = [];
  const infos: string[] = [];
  const typedByHand = !listed || pick === OTHER;
  if (draft.msg && kind === "storage-approve-operator" && serviceOps && approvedOps) {
    const op = serviceOps.find((o) => o.address === address);
    const approval = approvedOps.find((a) => a.operator === address);
    if (!op) warnings.push(`No ${serviceType} operator is registered at this address. The chain refuses the approval until the operator registers.`);
    else if (op.controller !== policyAddress) warnings.push("This operator names another council as its controller. Only that council or governance can approve it.");
    else if (approval && !approval.stale) infos.push("This operator is already approved for the backend.");
    const max = limits.max_operators_per_backend;
    if (max && !approval && approvedOps.length >= max) warnings.push(`This backend already has its maximum of ${max} approved operators. One has to be removed first.`);
    infos.push("The approval is this council's consent to be paid the operator's completed copies and to answer for them. The operator also has to be an active member to take requests.");
  }
  if (draft.msg && kind === "storage-remove-operator" && approvedOps) {
    const approval = approvedOps.find((a) => a.operator === address);
    if (typedByHand && !approval) warnings.push("This address is not approved for the backend.");
    else if (approval && approval.controller !== policyAddress) warnings.push("Another council approved this operator. Only that council or governance can remove it.");
    if (openClaims && openClaims.key === standingKey && openClaims.count > 0) {
      infos.push(`This operator holds ${openClaims.count} open ${openClaims.count === 1 ? "claim" : "claims"}. Removal stops it from taking new requests.`);
    }
  }
  if (draft.msg && kind === "storage-approve-scanner" && scannerOps && approvedScanners) {
    const op = scannerOps.find((o) => o.address === address);
    const approval = approvedScanners.find((a) => a.scanner === address);
    if (!op) warnings.push("No content scanner is registered at this address. The chain refuses the approval until the scanner registers.");
    else if (op.controller !== policyAddress) warnings.push("This scanner names another council as its controller. Only that council or governance can approve it.");
    else if (approval && !approval.stale) infos.push("This scanner is already approved.");
    const max = limits.max_approved_scanners;
    if (max && !approval && approvedScanners.length >= max) warnings.push(`The chain already has its maximum of ${max} approved scanners. One has to be removed first.`);
    infos.push("An approved scanner can flag files as removed content, and its verdicts count toward completed copies. Approve one only if it is independent of the other approved scanners.");
  }
  if (draft.msg && kind === "storage-remove-scanner" && approvedScanners) {
    const approval = approvedScanners.find((a) => a.scanner === address);
    if (typedByHand && !approval) warnings.push("This address is not an approved scanner.");
    else if (approval && approval.controller !== policyAddress) warnings.push("Another council approved this scanner. Only that council or governance can remove it.");
    infos.push("The scanner's existing flags stay. They are lifted separately.");
  }
  if (kind === "storage-void" && voidIdOk && lookup?.id === voidIdOk) {
    const r = lookup.res?.request;
    if (!r) warnings.push(`There is no storage request #${voidIdOk}.`);
    else if (lookup.res?.withheld) warnings.push("This file is flagged as removed content. The chain refuses to void its copy while the flag stands.");
    else if (r.status === RequestStatus.COMPLETED) {
      if (r.controller !== policyAddress) warnings.push("Another council is this request's controller. Only that council or governance can void the completion.");
      else infos.push("The request goes back to waiting for an operator, with its fee still in escrow. The operator that made this copy cannot claim it again.");
    } else if (r.status === RequestStatus.SETTLED) {
      if (r.paid_to !== policyAddress) warnings.push("This copy is settled and another council was paid for it. Only that council or governance can void it.");
      else infos.push(`This copy is settled. Voiding it returns the ${formatSpark(r.paid_amount || "0")} ${displayDenom} this council was paid, from its treasury, and reopens the request.`);
    } else {
      warnings.push(`Only a completed or settled copy can be voided. This request is: ${(REQUEST_STATUS_LABELS[r.status] ?? "unknown").toLowerCase()}.`);
    }
  }
  if (kind === "storage-unflag" && !parsed.problem && scannerOps) {
    const mine = new Set(scannerOps.filter((o) => o.controller === policyAddress).map((o) => o.address));
    for (const h of parsed.hashes) {
      if (!(h in flags)) continue;
      const short = `${h.slice(0, 12)}...`;
      const list = flags[h]?.flags ?? [];
      const liftable = list.filter((f) => mine.has(f.scanner)).length;
      if (list.length === 0) warnings.push(`${short} is not flagged. The chain refuses the whole message if any hash is not flagged.`);
      else if (liftable === 0) warnings.push(`${short}: none of its flags are from scanners this council controls. Only governance can lift them.`);
      else if (liftable < list.length) {
        const rest = list.length - liftable;
        infos.push(`${short}: ${rest} ${rest === 1 ? "flag" : "flags"} from other councils' scanners will stay, so the file stays withheld.`);
      }
    }
  }

  const backendSelect = needsBackend && (
    <div>
      <label className={LABEL_CLASS}>Storage backend</label>
      {backends === null ? (
        <p className="text-sm text-zinc-500">Loading backends...</p>
      ) : backends.length === 0 ? (
        <p className="text-sm text-zinc-500">No storage backends could be loaded.</p>
      ) : (
        <select value={backendName} onChange={(e) => setBackendName(e.target.value)} className="sd-select w-full">
          {backends.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {b.enabled ? "" : " (not taking new requests)"}
            </option>
          ))}
        </select>
      )}
    </div>
  );
  // A field's problem shows once something has been entered in it.
  const shownProblem = (entered: boolean) => (entered ? draft.problem : null);

  return (
    <div className="space-y-3">
      {backendSelect}

      {(operatorKind || scannerKind) && (
        <>
          <AddressPicker
            label={operatorKind ? "Operator" : "Scanner"}
            options={options}
            pick={pick}
            typed={typed}
            onPick={setPick}
            onTyped={setTyped}
            prefix={prefix}
            emptyText={
              kind === "storage-approve-operator"
                ? `No ${serviceType || "storage"} operator that names this council as its controller is waiting for approval. An operator registers first, naming this council.`
                : kind === "storage-approve-scanner"
                  ? "No content scanner that names this council as its controller is waiting for approval. A scanner registers first, naming this council."
                  : `This council has approved no ${operatorKind ? "operators for this backend" : "scanners"}.`
            }
          />
          <Notes problem={shownProblem(typedByHand && typed.trim() !== "")} warnings={warnings} infos={infos} />
        </>
      )}

      {kind === "storage-void" && (
        <>
          <div>
            <label className={LABEL_CLASS}>Request number</label>
            <input
              type="text"
              inputMode="numeric"
              value={voidId}
              onChange={(e) => setVoidId(e.target.value)}
              placeholder="e.g. 42"
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Reason</label>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={2}
              placeholder="What is wrong with the copy"
              className={INPUT_CLASS}
            />
          </div>
          <Notes problem={shownProblem(voidId.trim() !== "" && voidReason.trim() !== "")} warnings={warnings} infos={infos} />
          <p className="text-xs text-zinc-500">
            Voiding is the remedy when a copy is missing or wrong. The reason is recorded with the voided completion, which is
            the evidence for a report against the operator.
          </p>
        </>
      )}

      {kind === "storage-unflag" && (
        <>
          <div>
            <label className={LABEL_CLASS}>File hashes</label>
            <textarea
              value={hashesText}
              onChange={(e) => setHashesText(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="One sha256 per line"
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
          <Notes problem={shownProblem(hashesText.trim() !== "")} warnings={warnings} infos={infos} />
          <p className="text-xs text-zinc-500">
            Up to {maxHashes} hashes, all or nothing. A council lifts the flags of scanners it controls. When the last flag on a
            file is lifted, requests whose fee was held are reopened. A fee that was already burned is gone.
          </p>
        </>
      )}

      {kind === "storage-prices" && backend && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Price per byte ({displayDenom})</label>
              <input
                type="text"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Allowed: {formatSpark(backend.min_price_per_byte)} to {formatSpark(backend.max_price_per_byte)}. Now:{" "}
                {formatSpark(backend.price_per_byte)}.
                {priceMicro !== null && ` About ${formatSpark(BigInt(priceMicro) * BYTES_PER_MIB, { maxFractionDigits: 2 })} ${displayDenom} per MiB.`}
              </p>
            </div>
            <div>
              <label className={LABEL_CLASS}>Minimum fee ({displayDenom})</label>
              <input
                type="text"
                inputMode="decimal"
                value={minFeeInput}
                onChange={(e) => setMinFeeInput(e.target.value)}
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Allowed: {formatSpark(backend.min_min_fee)} to {formatSpark(backend.max_min_fee)}. Now: {formatSpark(backend.min_fee)}.
              </p>
            </div>
          </div>
          <Notes problem={draft.problem} warnings={warnings} infos={infos} />
          <p className="text-xs text-zinc-500">
            A copy costs its size times the price per byte, and never less than the minimum fee. Requests already open keep the
            fee they were created with.
          </p>
        </>
      )}
    </div>
  );
}
