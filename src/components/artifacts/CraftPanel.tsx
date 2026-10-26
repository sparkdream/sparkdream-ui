"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useContentLicense } from "@/hooks/useContentLicense";
import ActionBanner from "@/components/ActionBanner";
import ContentLicenseNotice from "@/components/license/ContentLicenseNotice";
import { ArtifactMsgTypeUrls } from "@/lib/tx";
import { getArtifactBalance, getArtifactCraftRecipes, listArtifactTokensByOwner } from "@/lib/artifactApi";
import { TokenLock, type ArtifactClass, type ArtifactParams, type CraftRecipe, type TokenView } from "@/types/artifact";
import type { MsgAddCraftRecipe, MsgCraft, MsgRemoveCraftRecipe } from "@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx";
import {
  ActionSection,
  MetadataEditor,
  Note,
  emptyMetadataForm,
  fieldCls,
  isEditionsClass,
  isHidden,
  lockOf,
  metadataFormToMsg,
  shownToken,
  tokenTitle,
  useArtifactTx,
  validateMetadataForm,
  type MetadataForm,
} from "./shared";

const MAX_INPUTS = 8;

interface Props {
  cls: ArtifactClass;
  params: ArtifactParams | null;
  /** "manage": the owner's recipe editor. "craft": recipes and a craft button for holders. */
  mode: "manage" | "craft";
  onChanged: () => void;
  /** Opens a class (input ingredient links). */
  onOpenClass?: (classId: string) => void;
}

interface InputRow {
  classId: string;
  editionId: string;
  quantity: string;
}

/** "3 × class #4" or "2 units of edition 4/9". */
function inputLabel(i: { class_id: string; edition_id: string; quantity?: string }): string {
  const q = i.quantity || "1";
  return i.edition_id && i.edition_id !== "0"
    ? `${q} unit${q === "1" ? "" : "s"} of edition ${i.class_id}/${i.edition_id}`
    : `${q} token${q === "1" ? "" : "s"} of class #${i.class_id}`;
}

function outputLabel(r: CraftRecipe, editions: boolean): string {
  if (editions) {
    const q = r.output_quantity || "1";
    return `${q} unit${q === "1" ? "" : "s"} of edition ${r.class_id}/${r.output_edition_id}`;
  }
  return r.output_metadata?.name?.trim() ? `"${r.output_metadata.name.trim()}"` : "a new token";
}

/** Crafting: burn a recipe's inputs to mint its output into this class. */
export default function CraftPanel({ cls, params, mode, onChanged, onOpenClass }: Props) {
  const [recipes, setRecipes] = useState<CraftRecipe[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    getArtifactCraftRecipes(cls.id)
      .then((r) => setRecipes(r.recipes || []))
      .catch(() => setRecipes([]));
  }, [cls.id]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(() => {
    load();
    onChanged();
  }, [load, onChanged]);

  const editions = isEditionsClass(cls);

  if (mode === "craft") {
    if (!recipes || recipes.length === 0) return null;
    return (
      <div className="sd-hull-tile mt-4 space-y-2 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white">Crafting</h3>
        <p className="text-xs text-zinc-500">
          Burn the ingredients to mint the result into this class. Burned tokens&apos; deposits come back to you.
          {cls.crafting_locked ? " These recipes are fixed: no new ones can be added." : " The owner can still add recipes until the first craft."}
        </p>
        {recipes.map((r) => (
          <CraftRecipeCard key={r.id} cls={cls} recipe={r} editions={editions} onChanged={changed} onOpenClass={onOpenClass} />
        ))}
      </div>
    );
  }

  return (
    <ActionSection title={`Crafting recipes (${recipes?.length ?? 0})`} open={open} onToggle={() => setOpen((o) => !o)}>
      <RecipeEditor cls={cls} params={params} recipes={recipes || []} editions={editions} onChanged={changed} />
    </ActionSection>
  );
}

function RecipeEditor({
  cls,
  params,
  recipes,
  editions,
  onChanged,
}: {
  cls: ArtifactClass;
  params: ArtifactParams | null;
  recipes: CraftRecipe[];
  editions: boolean;
  onChanged: () => void;
}) {
  const { address } = useWallet();
  const license = useContentLicense();
  const { pending, error, clearError, setError, send } = useArtifactTx(onChanged);
  const [inputs, setInputs] = useState<InputRow[]>([{ classId: "", editionId: "0", quantity: "1" }]);
  const [meta, setMeta] = useState<MetadataForm>(emptyMetadataForm);
  const [outEdition, setOutEdition] = useState("");
  const [outQty, setOutQty] = useState("1");
  const [agreed, setAgreed] = useState(false);
  const maxRecipes = params?.max_craft_recipes_per_class ?? 10;
  const blind = !!cls.reveal?.kind && cls.reveal.kind !== "REVEAL_KIND_NONE";
  const canAdd = !cls.crafting_locked && !isHidden(cls.status) && recipes.length < maxRecipes && !(blind && !editions);

  const setRow = (i: number, patch: Partial<InputRow>) => setInputs(inputs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const add = () => {
    if (!address) return;
    const seen = new Set<string>();
    const msgInputs = [];
    for (const r of inputs) {
      if (!/^\d+$/.test(r.classId) || r.classId === "0") return setError("Each ingredient needs a class id.");
      if (!/^\d+$/.test(r.editionId || "0")) return setError("Edition ids are numbers (0 for unique tokens).");
      if (!/^\d+$/.test(r.quantity) || r.quantity === "0") return setError("Each ingredient needs a quantity above 0.");
      const key = `${r.classId}/${r.editionId || "0"}`;
      if (seen.has(key)) return setError(`Ingredient ${key} is listed twice.`);
      seen.add(key);
      msgInputs.push({ classId: BigInt(r.classId), editionId: BigInt(r.editionId || "0"), quantity: BigInt(r.quantity) });
    }
    let outputMetadata = metadataFormToMsg(emptyMetadataForm());
    let outputEditionId = BigInt(0);
    let outputQuantity = BigInt(0);
    if (editions) {
      if (!/^\d+$/.test(outEdition) || outEdition === "0") return setError("Pick the edition the recipe makes units of.");
      if (!/^\d+$/.test(outQty) || outQty === "0") return setError("Enter how many units a craft makes.");
      outputEditionId = BigInt(outEdition);
      outputQuantity = BigInt(outQty);
    } else {
      const bad = validateMetadataForm(meta);
      if (bad) return setError(bad);
      outputMetadata = metadataFormToMsg(meta);
    }
    if (!agreed) return setError("Confirm the public domain dedication first.");
    const value: MsgAddCraftRecipe = {
      owner: address,
      classId: BigInt(cls.id),
      inputs: msgInputs,
      outputMetadata,
      outputEditionId,
      outputQuantity,
      acceptedContentLicense: license.license,
    };
    return send("add", { typeUrl: ArtifactMsgTypeUrls.AddCraftRecipe, value }, "Couldn't add the recipe", () => {
      setInputs([{ classId: "", editionId: "0", quantity: "1" }]);
      setMeta(emptyMetadataForm());
      setAgreed(false);
    });
  };

  const remove = (id: string) => {
    if (!address) return;
    if (!confirm(`Remove recipe #${id}? ${cls.crafting_locked ? "Recipes can't be added back once crafting has started." : ""}`)) return;
    const value: MsgRemoveCraftRecipe = { owner: address, classId: BigInt(cls.id), recipeId: BigInt(id) };
    return send(`remove-${id}`, { typeUrl: ArtifactMsgTypeUrls.RemoveCraftRecipe, value }, "Couldn't remove the recipe");
  };

  const busy = pending !== null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Holders burn the ingredients to mint the result into this class. Recipes can be added only until the first craft, so holders know
        what their tokens can become. Ingredient classes must let holders burn.
      </p>
      {recipes.length === 0 && <p className="text-xs text-zinc-600">No recipes yet.</p>}
      {recipes.map((r) => (
        <div key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs">
          <div className="min-w-0 text-zinc-300">
            <span className="font-mono text-zinc-500">#{r.id}</span> {(r.inputs || []).map(inputLabel).join(" + ")} → {outputLabel(r, editions)}
            {r.crafts && r.crafts !== "0" && <span className="text-zinc-500"> · crafted {r.crafts}×</span>}
          </div>
          <button onClick={() => remove(r.id)} disabled={busy} className="shrink-0 text-zinc-500 hover:text-red-400 disabled:opacity-50">
            {pending === `remove-${r.id}` ? "Removing…" : "Remove"}
          </button>
        </div>
      ))}
      {cls.crafting_locked && <Note>Crafting has started, so no new recipes can be added. Existing ones can still be removed.</Note>}
      {blind && !editions && <Note>Commit-reveal classes can&apos;t be crafted into.</Note>}
      {!cls.crafting_locked && recipes.length >= maxRecipes && <Note>This class has the most recipes allowed ({maxRecipes}).</Note>}

      {canAdd && (
        <div className="space-y-2 border-t border-zinc-800 pt-3">
          <span className="block text-xs font-medium text-zinc-400">Ingredients</span>
          {inputs.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={r.classId} onChange={(e) => setRow(i, { classId: e.target.value })} placeholder="Class id" inputMode="numeric" className={`${fieldCls} w-24`} />
              <input
                value={r.editionId}
                onChange={(e) => setRow(i, { editionId: e.target.value })}
                placeholder="Edition"
                title="0 for unique tokens, or an edition id"
                inputMode="numeric"
                className={`${fieldCls} w-24`}
              />
              <input value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} placeholder="Qty" inputMode="numeric" className={`${fieldCls} w-20`} />
              {inputs.length > 1 && (
                <button type="button" onClick={() => setInputs(inputs.filter((_, j) => j !== i))} className="px-1 text-xs text-zinc-500 hover:text-red-400" aria-label="Remove ingredient">
                  ✕
                </button>
              )}
            </div>
          ))}
          <p className="text-[11px] text-zinc-500">Edition 0 means unique tokens of that class; any other number is an edition&apos;s units.</p>
          {inputs.length < MAX_INPUTS && (
            <button type="button" onClick={() => setInputs([...inputs, { classId: "", editionId: "0", quantity: "1" }])} className="text-xs text-zinc-400 hover:text-zinc-200">
              + Add ingredient
            </button>
          )}
          <span className="block text-xs font-medium text-zinc-400">Result</span>
          {editions ? (
            <div className="flex flex-wrap gap-2">
              <input value={outEdition} onChange={(e) => setOutEdition(e.target.value)} placeholder="Edition id" inputMode="numeric" className={`${fieldCls} w-28`} />
              <input value={outQty} onChange={(e) => setOutQty(e.target.value)} placeholder="Units" inputMode="numeric" className={`${fieldCls} w-24`} />
            </div>
          ) : (
            <MetadataEditor value={meta} onChange={setMeta} />
          )}
          <ContentLicenseNotice what="The crafted token's metadata" />
          <label className="flex items-start gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>I dedicate this content to the public domain (CC0), and it&apos;s mine to dedicate or already public domain.</span>
          </label>
          <button onClick={add} disabled={busy} className="sd-btn sd-btn-verdigris">
            {pending === "add" ? "Adding…" : "Add recipe"}
          </button>
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} />
    </div>
  );
}

function CraftRecipeCard({
  cls,
  recipe,
  editions,
  onChanged,
  onOpenClass,
}: {
  cls: ArtifactClass;
  recipe: CraftRecipe;
  editions: boolean;
  onChanged: () => void;
  onOpenClass?: (classId: string) => void;
}) {
  const { address } = useWallet();
  const { pending, error, clearError, setError, send } = useArtifactTx(onChanged);
  const [open, setOpen] = useState(false);
  // Free tokens the crafter holds per unique input class, and the picks.
  const [held, setHeld] = useState<Record<string, TokenView[]>>({});
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [unitBalances, setUnitBalances] = useState<Record<string, string>>({});
  const inputs = recipe.inputs || [];

  useEffect(() => {
    if (!open || !address) return;
    let live = true;
    for (const i of inputs) {
      if (i.edition_id && i.edition_id !== "0") {
        const k = `${i.class_id}/${i.edition_id}`;
        getArtifactBalance(i.class_id, i.edition_id, address)
          .then((b) => live && setUnitBalances((prev) => ({ ...prev, [k]: b?.balance.amount || "0" })))
          .catch(() => {});
      } else {
        listArtifactTokensByOwner(address, { limit: "100" }, i.class_id)
          .then((r) => {
            if (!live) return;
            const free = (r.tokens || []).filter((v) => lockOf(v.token) === TokenLock.NONE);
            setHeld((prev) => ({ ...prev, [i.class_id]: free }));
            setPicked((prev) => ({ ...prev, [i.class_id]: free.slice(0, Number(i.quantity || "1")).map((v) => v.token.id) }));
          })
          .catch(() => {});
      }
    }
    return () => {
      live = false;
    };
    // inputs come from the recipe, which is stable for this card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, address, recipe.id]);

  const toggle = (classId: string, tokenId: string, max: number) => {
    setPicked((prev) => {
      const cur = prev[classId] || [];
      if (cur.includes(tokenId)) return { ...prev, [classId]: cur.filter((x) => x !== tokenId) };
      if (cur.length >= max) return prev;
      return { ...prev, [classId]: [...cur, tokenId] };
    });
  };

  const craft = () => {
    if (!address) return;
    const refs = [];
    for (const i of inputs) {
      const q = Number(i.quantity || "1");
      if (i.edition_id && i.edition_id !== "0") {
        const have = BigInt(unitBalances[`${i.class_id}/${i.edition_id}`] || "0");
        if (have < BigInt(i.quantity || "1")) return setError(`You need ${inputLabel(i)}.`);
        continue;
      }
      const ids = picked[i.class_id] || [];
      if (ids.length !== q) return setError(`Pick exactly ${q} token${q === 1 ? "" : "s"} of class #${i.class_id}.`);
      for (const id of ids) refs.push({ classId: BigInt(i.class_id), tokenId: BigInt(id) });
    }
    if (!confirm("Craft? The ingredients are burned for good.")) return;
    const value: MsgCraft = { crafter: address, classId: BigInt(cls.id), recipeId: BigInt(recipe.id), inputTokens: refs };
    return send("craft", { typeUrl: ArtifactMsgTypeUrls.Craft, value }, "Craft failed", () => setOpen(false));
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-zinc-300">
          {inputs.map((i, n) => (
            <span key={n}>
              {n > 0 && " + "}
              {onOpenClass ? (
                <button type="button" onClick={() => onOpenClass(i.class_id)} className="sd-artifact-link">{inputLabel(i)}</button>
              ) : (
                inputLabel(i)
              )}
            </span>
          ))}{" "}
          → <span className="text-zinc-100">{outputLabel(recipe, editions)}</span>
        </span>
        {address && !cls.minting_closed && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="sd-btn sd-btn-secondary">
            {open ? "Close" : "Craft"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
          {inputs.map((i, n) =>
            i.edition_id && i.edition_id !== "0" ? (
              <p key={n} className="text-zinc-400">
                {inputLabel(i)}: you hold {unitBalances[`${i.class_id}/${i.edition_id}`] ?? "…"} free.
              </p>
            ) : (
              <div key={n} className="space-y-1">
                <p className="text-zinc-400">
                  Pick {i.quantity || "1"} of class #{i.class_id} ({(picked[i.class_id] || []).length} picked):
                </p>
                {(held[i.class_id] || []).length === 0 && <p className="text-zinc-600">You hold no free tokens of this class.</p>}
                <div className="flex flex-wrap gap-1.5">
                  {(held[i.class_id] || []).map((v) => {
                    const on = (picked[i.class_id] || []).includes(v.token.id);
                    return (
                      <button
                        key={v.token.id}
                        type="button"
                        onClick={() => toggle(i.class_id, v.token.id, Number(i.quantity || "1"))}
                        className={`rounded-md border px-2 py-1 ${on ? "border-[var(--verdigris-ring)] bg-[var(--verdigris-soft)] text-zinc-100" : "border-zinc-800 text-zinc-400 hover:border-zinc-700"}`}
                      >
                        {tokenTitle(shownToken(v), v.withheld)} <span className="font-mono text-zinc-500">#{v.token.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )
          )}
          <button onClick={craft} disabled={pending !== null} className="sd-btn sd-btn-verdigris">
            {pending === "craft" ? "Crafting…" : "Burn ingredients and craft"}
          </button>
        </div>
      )}
      <ActionBanner message={error} onDismiss={clearError} className="mt-2" />
    </div>
  );
}
