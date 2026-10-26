"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import ActionBanner from "@/components/ActionBanner";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactChildren, getArtifactToken, listArtifactTokensByOwner } from "@/lib/artifactApi";
import { TokenLock, type ArtifactClass, type ArtifactParams, type TokenRef, type TokenView } from "@/types/artifact";
import type { MsgDetach, MsgNest } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import { fieldCls, isHarbergerClass, lockOf, shownToken, tokenRef, tokenTitle, useArtifactTx } from "./shared";

// Children tree reads are bounded by the chain's own caps (compiled
// ceilings: depth 8, 100 tokens per tree); these keep a broken view finite.
const MAX_TREE_NODES = 100;
const MAX_TREE_DEPTH = 8;

interface Node {
  ref: TokenRef;
  label: string;
  children: Node[];
}

async function loadTree(classId: string, tokenId: string, depth: number, budget: { n: number }): Promise<Node[]> {
  if (depth >= MAX_TREE_DEPTH || budget.n <= 0) return [];
  const res = await getArtifactChildren(classId, tokenId).catch(() => null);
  const out: Node[] = [];
  for (const c of res?.children || []) {
    if (budget.n-- <= 0) break;
    const t = await getArtifactToken(c.class_id, c.token_id).catch(() => null);
    out.push({
      ref: c,
      label: t ? tokenTitle(shownToken(t.token), t.token.withheld) : `Token #${c.token_id}`,
      children: await loadTree(c.class_id, c.token_id, depth + 1, budget),
    });
  }
  return out;
}

function Tree({ nodes, onOpen }: { nodes: Node[]; onOpen: (classId: string, tokenId: string) => void }) {
  return (
    <ul className="space-y-1 border-l border-zinc-800 pl-3">
      {nodes.map((n) => (
        <li key={tokenRef(n.ref.class_id, n.ref.token_id)} className="text-xs">
          <button type="button" onClick={() => onOpen(n.ref.class_id, n.ref.token_id)} className="sd-artifact-link">
            {n.label}
          </button>{" "}
          <span className="font-mono text-zinc-600">{tokenRef(n.ref.class_id, n.ref.token_id)}</span>
          {n.children.length > 0 && (
            <div className="mt-1">
              <Tree nodes={n.children} onOpen={onOpen} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Nesting: a token can hold other tokens (a character and its equipment).
 * The whole tree shares one owner and moves as one.
 */
export default function NestPanel({
  cls,
  view,
  params,
  isHolder,
  onChanged,
  onOpenToken,
}: {
  cls: ArtifactClass;
  view: TokenView;
  params: ArtifactParams | null;
  isHolder: boolean;
  onChanged: () => void;
  onOpenToken: (classId: string, tokenId: string) => void;
}) {
  const { address } = useWallet();
  const t = view.token;
  const [tree, setTree] = useState<Node[]>([]);
  const [parentLabel, setParentLabel] = useState<string | null>(null);
  const [mine, setMine] = useState<TokenView[]>([]);
  const [pickChild, setPickChild] = useState("");
  const [pickParent, setPickParent] = useState("");

  const parent = t.parent?.token_id && t.parent.token_id !== "0" ? t.parent : null;
  const descendants = t.descendants ?? 0;
  const maxNested = params?.max_nested_tokens ?? 20;
  const maxDepth = params?.max_nest_depth ?? 3;
  const harberger = isHarbergerClass(cls);

  const load = useCallback(() => {
    if (descendants > 0) loadTree(t.class_id, t.id, 0, { n: MAX_TREE_NODES }).then(setTree).catch(() => setTree([]));
    else setTree([]);
    if (parent) {
      getArtifactToken(parent.class_id, parent.token_id)
        .then((r) => setParentLabel(tokenTitle(shownToken(r.token), r.token.withheld)))
        .catch(() => setParentLabel(null));
    }
    if (isHolder && address && !harberger) {
      listArtifactTokensByOwner(address, { limit: "100" })
        .then((r) => setMine((r.tokens || []).filter((v) => !(v.token.class_id === t.class_id && v.token.id === t.id))))
        .catch(() => setMine([]));
    }
  }, [t.class_id, t.id, descendants, parent, isHolder, address, harberger]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);
  const { pending, error, clearError, setError, send } = useArtifactTx(changed);

  if (harberger) return null;
  if (!parent && descendants === 0 && !isHolder) return null;

  const lock = lockOf(t);
  // Children must be free roots; the receiving tree's root must be free or rented.
  const childOptions = mine.filter((v) => lockOf(v.token) === TokenLock.NONE && !v.token.parent?.token_id);
  const parentOptions = mine.filter((v) => {
    const l = lockOf(v.token);
    return (l === TokenLock.NONE || l === TokenLock.RENTED || l === TokenLock.NESTED) && (v.token.descendants ?? 0) + descendants + 1 <= maxNested;
  });
  const busy = pending !== null;
  const ref = (classId: string, tokenId: string) => ({ classId: BigInt(classId), tokenId: BigInt(tokenId) });

  const nest = (child: { classId: bigint; tokenId: bigint }, into: { classId: bigint; tokenId: bigint }, key: string) => {
    if (!address) return;
    const value: MsgNest = { owner: address, child, parent: into };
    return send(key, { typeUrl: ArtifactMsgTypeUrls.Nest, value }, "Couldn't nest the token", () => {
      setPickChild("");
      setPickParent("");
    });
  };

  const addChild = () => {
    const [c, id] = pickChild.split("/");
    if (!c || !id) return setError("Pick a token to put inside.");
    if (descendants + 1 > maxNested) return setError(`A tree can hold at most ${maxNested} tokens.`);
    return nest(ref(c, id), ref(t.class_id, t.id), "add-child");
  };

  const moveInto = () => {
    const [c, id] = pickParent.split("/");
    if (!c || !id) return setError("Pick the token to put this one inside.");
    return nest(ref(t.class_id, t.id), ref(c, id), "move-into");
  };

  const detach = () => {
    if (!address) return;
    const value: MsgDetach = { owner: address, child: ref(t.class_id, t.id) };
    return send("detach", { typeUrl: ArtifactMsgTypeUrls.Detach, value }, "Couldn't take the token out");
  };

  const option = (v: TokenView) => (
    <option key={tokenRef(v.token.class_id, v.token.id)} value={tokenRef(v.token.class_id, v.token.id)}>
      {tokenTitle(shownToken(v), v.withheld)} ({tokenRef(v.token.class_id, v.token.id)})
    </option>
  );

  return (
    <div className="sd-hull-tile mt-4 space-y-3 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-white">Nested tokens</h3>
      {parent && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>
            Inside{" "}
            <button type="button" onClick={() => onOpenToken(parent.class_id, parent.token_id)} className="sd-artifact-link">
              {parentLabel || `Token #${parent.token_id}`}
            </button>{" "}
            <span className="font-mono text-zinc-600">{tokenRef(parent.class_id, parent.token_id)}</span>. It moves with its parent.
          </span>
          {isHolder && (
            <button onClick={detach} disabled={busy} className="sd-btn sd-btn-secondary">
              {pending === "detach" ? "Taking out…" : "Take out"}
            </button>
          )}
        </div>
      )}
      {descendants > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-zinc-500">
            Holds {descendants} token{descendants === 1 ? "" : "s"}. Buyers and renters pin these contents, so a change voids their offers.
          </p>
          <Tree nodes={tree} onOpen={onOpenToken} />
        </div>
      ) : (
        !parent && <p className="text-xs text-zinc-500">Holds no tokens.</p>
      )}

      {isHolder && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <p className="text-xs text-zinc-500">
            Trees can be {maxDepth} levels deep and hold up to {maxNested}{" "}tokens. A soulbound token can only sit inside tokens that
            can&apos;t be transferred either.
          </p>
          {(lock === TokenLock.NONE || lock === TokenLock.RENTED || lock === TokenLock.NESTED) && childOptions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <select value={pickChild} onChange={(e) => setPickChild(e.target.value)} className={`${fieldCls} min-w-0 flex-1`}>
                <option value="">Put one of your tokens inside this one…</option>
                {childOptions.map(option)}
              </select>
              <button onClick={addChild} disabled={busy || !pickChild} className="sd-btn sd-btn-secondary">
                {pending === "add-child" ? "Nesting…" : "Put inside"}
              </button>
            </div>
          )}
          {!parent && lock === TokenLock.NONE && parentOptions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <select value={pickParent} onChange={(e) => setPickParent(e.target.value)} className={`${fieldCls} min-w-0 flex-1`}>
                <option value="">Put this token inside another of yours…</option>
                {parentOptions.map(option)}
              </select>
              <button onClick={moveInto} disabled={busy || !pickParent} className="sd-btn sd-btn-secondary">
                {pending === "move-into" ? "Nesting…" : "Nest"}
              </button>
            </div>
          )}
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}
