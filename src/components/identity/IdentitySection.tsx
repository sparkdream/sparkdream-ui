"use client";

import { useWallet } from "@/contexts/WalletContext";
import { useMigrationState, useNow } from "@/hooks/useMigrationState";
import ErrorState from "@/components/ErrorState";
import CopyableAddress from "@/components/CopyableAddress";
import KeyMigrationForm from "./KeyMigrationForm";
import MigrationCard from "./MigrationCard";
import MigrationHistory from "./MigrationHistory";
import MultisigAccountPanel from "./MultisigAccountPanel";
import RecoveryCommitmentsPanel from "./RecoveryCommitmentsPanel";
import RecoveryWizard from "./RecoveryWizard";
import SweepPanel from "./SweepPanel";
import { Panel, SessionModeNote } from "./shared";

/**
 * Membership address and recovery (x/rep member key migration), for the
 * connected wallet itself: these messages are refused through a session key,
 * a shield proof or a vault, so everything here uses signerAddress.
 */
export default function IdentitySection() {
  const { address, signerAddress, sessionActive } = useWallet();
  // In session mode the wallet is a hot key acting for its granter (address);
  // nothing here can be signed that way, so only the granter's keys are shown.
  const { state, loading, error, refresh } = useMigrationState(sessionActive ? null : signerAddress);
  const nowMs = useNow();

  if (!signerAddress) return null;

  return (
    <section id="identity" className="mt-10 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Membership address and recovery</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Move your membership to a new wallet, or set up a way back in if you lose this one.
        </p>
      </div>

      {sessionActive && <SessionModeNote />}
      {error ? <ErrorState error={error} onRetry={refresh} /> : null}
      {loading && <div className="h-24 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />}

      <MultisigAccountPanel address={(sessionActive ? address : null) ?? signerAddress} />

      {state && !state.unsupported && (
        <>
          {state.tombstoned && (
            <Panel title="This address moved" tone="warn">
              <p className="text-sm text-zinc-300">
                The membership that was here now lives at{" "}
                <CopyableAddress address={state.canonical} className="font-mono" />. Connect that address to manage it
                and to sweep SPARK left here.
              </p>
            </Panel>
          )}

          {state.incoming && (
            <MigrationCard
              migration={state.incoming}
              side="to"
              params={state.params}
              nowMs={nowMs}
              disabled={sessionActive}
              onChanged={refresh}
            />
          )}
          {state.outgoing && (
            <MigrationCard
              migration={state.outgoing}
              side="from"
              params={state.params}
              nowMs={nowMs}
              disabled={sessionActive}
              onChanged={refresh}
            />
          )}

          {state.member && !state.outgoing && !sessionActive && (
            <KeyMigrationForm state={state} nowMs={nowMs} onDone={refresh} />
          )}
          {state.member && (
            <RecoveryCommitmentsPanel state={state} nowMs={nowMs} disabled={sessionActive} onChanged={refresh} />
          )}
          {state.member && (
            <SweepPanel aliases={state.aliases.filter((a) => a !== signerAddress)} disabled={sessionActive} />
          )}
          {!state.member && !state.tombstoned && state.params.migrationEnabled && (
            <RecoveryWizard params={state.params} nowMs={nowMs} disabled={sessionActive} onChanged={refresh} />
          )}

          <MigrationHistory migrations={state.history} />
        </>
      )}
    </section>
  );
}
