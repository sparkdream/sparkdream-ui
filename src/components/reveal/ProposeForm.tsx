"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { RevealMsgTypeUrls } from "@/lib/tx";
import { dreamToMicro } from "@/lib/reveal-fmt";
import NumberInput from "@/components/NumberInput";

interface TrancheInput {
  name: string;
  description: string;
  components: string;
  stake_threshold: string;
  preview_uri: string;
}

const blankTranche: TrancheInput = {
  name: "",
  description: "",
  components: "",
  stake_threshold: "",
  preview_uri: "",
};

export default function ProposeForm({
  onProposed,
  onCancel,
}: {
  onProposed: () => void;
  onCancel: () => void;
}) {
  const { address, signAndBroadcast } = useWallet();
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [totalValuation, setTotalValuation] = useState("");
  const [initialLicense, setInitialLicense] = useState("proprietary");
  const [finalLicense, setFinalLicense] = useState("apache-2.0");
  const [tranches, setTranches] = useState<TrancheInput[]>([{ ...blankTranche }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trancheSum = useMemo(() => {
    let sum = 0;
    for (const t of tranches) {
      const n = parseFloat(t.stake_threshold);
      if (isFinite(n)) sum += n;
    }
    return sum;
  }, [tranches]);

  const totalNum = parseFloat(totalValuation);
  const sumMatches = isFinite(totalNum) && Math.abs(trancheSum - totalNum) < 1e-9;

  const updateTranche = (idx: number, patch: Partial<TrancheInput>) => {
    setTranches((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const addTranche = () => setTranches((prev) => [...prev, { ...blankTranche }]);
  const removeTranche = (idx: number) =>
    setTranches((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!address) return;
    setError(null);
    if (!projectName.trim()) return setError("Project name is required");
    if (!description.trim()) return setError("Description is required");
    const totalMicro = dreamToMicro(totalValuation);
    if (!totalMicro) return setError("Enter a valid total valuation");
    if (tranches.length === 0) return setError("At least one tranche is required");

    const trancheDefs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < tranches.length; i++) {
      const t = tranches[i];
      if (!t.name.trim()) return setError(`Tranche ${i + 1}: name is required`);
      const micro = dreamToMicro(t.stake_threshold);
      if (!micro) return setError(`Tranche ${i + 1}: enter a valid stake threshold`);
      trancheDefs.push({
        name: t.name.trim(),
        description: t.description.trim(),
        components: t.components
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        stake_threshold: micro,
        preview_uri: t.preview_uri.trim(),
      });
    }

    if (!sumMatches) {
      return setError("Sum of tranche thresholds must equal total valuation");
    }

    setSubmitting(true);
    try {
      await signAndBroadcast([{
        typeUrl: RevealMsgTypeUrls.Propose,
        value: {
          contributor: address,
          project_name: projectName.trim(),
          description: description.trim(),
          total_valuation: totalMicro,
          tranches: trancheDefs,
          initial_license: initialLicense.trim(),
          final_license: finalLicense.trim(),
        },
      }]);
      onProposed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Propose failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="sd-hull-tile space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Project
        </h3>
        <Field label="Project name">
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <textarea
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Total valuation (DREAM)">
            <NumberInput
              step="any"
              min="0"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              value={totalValuation}
              onChange={(e) => setTotalValuation(e.target.value)}
            />
          </Field>
          <Field label="Initial license">
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              value={initialLicense}
              onChange={(e) => setInitialLicense(e.target.value)}
            />
          </Field>
          <Field label="Final license">
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              value={finalLicense}
              onChange={(e) => setFinalLicense(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="sd-hull-tile space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Tranches
          </h3>
          <div className="text-xs text-zinc-500">
            Sum: <span className={sumMatches ? "text-emerald-400" : "text-amber-400"}>{trancheSum}</span>{" "}
            / {totalValuation || "0"} DREAM
          </div>
        </div>

        {tranches.map((t, idx) => (
          <div key={idx} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-500">#{idx}</span>
              {tranches.length > 1 && (
                <button
                  type="button"
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                  onClick={() => removeTranche(idx)}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name">
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  value={t.name}
                  onChange={(e) => updateTranche(idx, { name: e.target.value })}
                />
              </Field>
              <Field label="Stake threshold (DREAM)">
                <NumberInput
                  step="any"
                  min="0"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  value={t.stake_threshold}
                  onChange={(e) => updateTranche(idx, { stake_threshold: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Description">
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                value={t.description}
                onChange={(e) => updateTranche(idx, { description: e.target.value })}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Components (comma-separated)">
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  value={t.components}
                  onChange={(e) => updateTranche(idx, { components: e.target.value })}
                  placeholder="renderer, parser, tests"
                />
              </Field>
              <Field label="Preview URI (optional)">
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                  value={t.preview_uri}
                  onChange={(e) => updateTranche(idx, { preview_uri: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addTranche}
          className="sd-btn-ghost text-xs"
        >
          + Add tranche
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          className="sd-btn sd-btn-primary"
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "Propose"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="sd-btn sd-btn-secondary"
          disabled={submitting}
        >
          Cancel
        </button>
        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-zinc-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
