import type { AgentConfigChangePlan } from "@mosoo/contracts/agent-config-change-plan";
import { useEffect, useRef } from "react";

import type { AgentEditorModel } from "./use-model";

const AUTO_SAVE_DEBOUNCE_MS = 400;

// Changes that need an explicit Apply step: fork-agent (the API rejects in-place
// saves) and any restart/recreate that interrupts a running runtime. Everything
// else — name, description, draft-only edits — is safe to flush silently.
export function isAutoSaveEligible(changePlan: AgentConfigChangePlan): boolean {
  return changePlan.action !== "fork-agent" && !changePlan.requiresRuntimeOperation;
}

// Auto-flushes editor edits so the user can iterate against the live Preview
// session without round-tripping through the Apply button. Runtime-restarting
// and fork changes keep the explicit PendingChangesBanner flow.
export function useAgentEditorAutoSave(model: AgentEditorModel): void {
  const { snapshotHash, dirty, saving, changePlan, readOnly, save } = model;
  const eligible = isAutoSaveEligible(changePlan);
  const saveRef = useRef(save);
  saveRef.current = save;
  // Tracks the snapshot we last attempted to flush. A retry of the exact same
  // draft after a failure would just refire the same validation/network error,
  // so we wait for the user to type something else before trying again.
  const lastAttemptedHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (readOnly || !dirty || saving || !eligible) {
      return;
    }

    if (lastAttemptedHashRef.current === snapshotHash) {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      lastAttemptedHashRef.current = snapshotHash;
      void saveRef.current();
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [snapshotHash, dirty, saving, eligible, readOnly]);
}
