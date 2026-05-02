"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { listNamesByOwner, reverseResolveName, getNameParams, getOwnerInfo } from "@/lib/api";
import { NameMsgTypeUrls } from "@/lib/tx";
import type { NameRecord, NameParams } from "@/types/name";

const DISPLAY_NAME_MAX_CODEPOINTS = 32;
const codepointLength = (s: string) => Array.from(s).length;

export default function MyNames() {
  const { address, signAndBroadcast } = useWallet();
  const [names, setNames] = useState<NameRecord[]>([]);
  const [primaryName, setPrimaryName] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [params, setParams] = useState<NameParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Registration form
  const [showRegister, setShowRegister] = useState(false);
  const [newName, setNewName] = useState("");
  const [newData, setNewData] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Update form
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editData, setEditData] = useState("");

  // Display name form
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [savingDisplayName, setSavingDisplayName] = useState(false);

  const fetchNames = useCallback(async () => {
    if (!address) return;
    try {
      setLoading(true);
      setError(null);
      const [namesRes, reverseRes, ownerRes, paramsRes] = await Promise.all([
        listNamesByOwner(address),
        reverseResolveName(address).catch(() => ({ name: "" })),
        getOwnerInfo(address).catch(() => null),
        getNameParams(),
      ]);
      setNames(namesRes.names || []);
      setPrimaryName(reverseRes.name || "");
      setDisplayName(ownerRes?.owner_info?.display_name || "");
      setParams(paramsRes.params);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load names";
      if (msg.includes("404") || msg.includes("not found")) {
        setNames([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchNames();
  }, [fetchNames]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!address || !newName.trim()) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.RegisterName,
          value: { authority: address, name: newName.trim(), data: newData.trim() },
        },
      ]);
      setNewName("");
      setNewData("");
      setShowRegister(false);
      fetchNames();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDisplayName(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;
    const next = displayNameDraft.trim();
    if (next === displayName) {
      setEditingDisplayName(false);
      return;
    }
    if (codepointLength(next) > DISPLAY_NAME_MAX_CODEPOINTS) return;
    setSavingDisplayName(true);
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.SetDisplayName,
          value: { authority: address, displayName: next },
        },
      ]);
      setEditingDisplayName(false);
      fetchNames();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save display name");
    } finally {
      setSavingDisplayName(false);
    }
  }

  async function handleClearDisplayName() {
    if (!address || !displayName) return;
    setSavingDisplayName(true);
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.SetDisplayName,
          value: { authority: address, displayName: "" },
        },
      ]);
      setEditingDisplayName(false);
      fetchNames();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to clear display name");
    } finally {
      setSavingDisplayName(false);
    }
  }

  async function handleSetPrimary(name: string) {
    if (!address) return;
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.SetPrimary,
          value: { authority: address, name },
        },
      ]);
      fetchNames();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to set primary");
    }
  }

  async function handleUpdate(name: string) {
    if (!address) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await signAndBroadcast([
        {
          typeUrl: NameMsgTypeUrls.UpdateName,
          value: { creator: address, name, data: editData.trim() },
        },
      ]);
      setEditingName(null);
      setEditData("");
      fetchNames();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
      </div>
    );
  }

  const maxNames = params ? parseInt(params.max_names_per_address || "5", 10) : 5;
  const regFee = params?.registration_fee
    ? `${parseInt(params.registration_fee.amount, 10) / 1_000_000} ${params.registration_fee.denom === "usparkdream" ? "SPARK" : params.registration_fee.denom}`
    : "";

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">My Names</h2>
        {names.length < maxNames && !showRegister && (
          <button
            type="button"
            onClick={() => setShowRegister(true)}
            className="sd-btn sd-btn-primary"
          >
            Register Name
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <button onClick={fetchNames} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {submitError}
        </div>
      )}

      {/* Display name card */}
      <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-zinc-200">Display name</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Free-form, not unique. Shown alongside your primary name. Up to {DISPLAY_NAME_MAX_CODEPOINTS} characters.
            </p>
            {!editingDisplayName && (
              <p className="mt-2 break-all text-sm text-white">
                {displayName || <span className="text-zinc-600">— not set —</span>}
              </p>
            )}
          </div>
          {!editingDisplayName && (
            <button
              type="button"
              onClick={() => {
                setDisplayNameDraft(displayName);
                setEditingDisplayName(true);
              }}
              className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
            >
              {displayName ? "Edit" : "Set"}
            </button>
          )}
        </div>

        {editingDisplayName && (
          <form onSubmit={handleSaveDisplayName} className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
            <input
              type="text"
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
              placeholder="Your display name"
              maxLength={DISPLAY_NAME_MAX_CODEPOINTS * 4}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              autoFocus
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={
                  savingDisplayName ||
                  codepointLength(displayNameDraft.trim()) > DISPLAY_NAME_MAX_CODEPOINTS
                }
                className="sd-btn sd-btn-primary"
              >
                {savingDisplayName ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditingDisplayName(false)}
                className="sd-btn sd-btn-secondary"
              >
                Cancel
              </button>
              {displayName && (
                <button
                  type="button"
                  onClick={handleClearDisplayName}
                  disabled={savingDisplayName}
                  className="ml-auto rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-400"
                >
                  Clear
                </button>
              )}
            </div>
            <p
              className={`text-xs ${
                codepointLength(displayNameDraft.trim()) > DISPLAY_NAME_MAX_CODEPOINTS
                  ? "text-red-400"
                  : "text-zinc-500"
              }`}
            >
              {codepointLength(displayNameDraft.trim())} / {DISPLAY_NAME_MAX_CODEPOINTS} characters
            </p>
          </form>
        )}
      </div>

      {/* Registration form */}
      {showRegister && (
        <form onSubmit={handleRegister} className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-200">Register a new name</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="my-name"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                minLength={params ? parseInt(params.min_name_length || "3", 10) : 3}
                maxLength={params ? parseInt(params.max_name_length || "30", 10) : 30}
              />
              {params && (
                <p className="mt-1 text-xs text-zinc-600">
                  {params.min_name_length}&ndash;{params.max_name_length} characters
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Data (optional metadata)</label>
              <input
                type="text"
                value={newData}
                onChange={(e) => setNewData(e.target.value)}
                placeholder="Profile URL, bio, etc."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={submitting || !newName.trim()}
                className="sd-btn sd-btn-primary"
              >
                {submitting ? "Registering..." : "Register"}
              </button>
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="sd-btn sd-btn-secondary"
              >
                Cancel
              </button>
              {regFee && (
                <span className="text-xs text-zinc-500">Registration fee: {regFee}</span>
              )}
            </div>
          </div>
        </form>
      )}

      {/* Names list */}
      {names.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <p className="text-sm text-zinc-500">No names registered yet</p>
          <p className="mt-1 text-xs text-zinc-600">
            Council members can register up to {maxNames} names
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            {names.length} / {maxNames} names used
          </p>
          {names.map((nr) => (
            <div
              key={nr.name}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{nr.name}</span>
                    {nr.name === primaryName && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400 border border-emerald-500/30">
                        Primary
                      </span>
                    )}
                  </div>
                  {nr.data && (
                    <p className="mt-1 break-all text-xs text-zinc-400">{nr.data}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {nr.name !== primaryName && (
                    <button
                      onClick={() => handleSetPrimary(nr.name)}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
                    >
                      Set Primary
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (editingName === nr.name) {
                        setEditingName(null);
                      } else {
                        setEditingName(nr.name);
                        setEditData(nr.data || "");
                      }
                    }}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
                  >
                    {editingName === nr.name ? "Cancel" : "Edit"}
                  </button>
                </div>
              </div>

              {/* Inline edit form */}
              {editingName === nr.name && (
                <div className="mt-3 flex gap-2 border-t border-zinc-800 pt-3">
                  <input
                    type="text"
                    value={editData}
                    onChange={(e) => setEditData(e.target.value)}
                    placeholder="Update metadata..."
                    className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleUpdate(nr.name)}
                    disabled={submitting}
                    className="sd-btn sd-btn-primary"
                  >
                    {submitting ? "..." : "Save"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
