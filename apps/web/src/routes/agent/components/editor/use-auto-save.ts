import { useEffect, useRef } from "react";

import type { AgentEditorModel } from "./use-model";

const AUTO_SAVE_DEBOUNCE_MS = 400;

// Debounced synchronization with the saved preset. Existing Sessions retain their
// admitted configuration; this does not perform runtime maintenance.
export function useAgentEditorAutoSave(model: AgentEditorModel): void {
  const { snapshotHash, dirty, saving, readOnly, save } = model;
  const saveRef = useRef(save);
  saveRef.current = save;
  // Tracks the snapshot we last attempted to flush. A retry of the exact same
  // draft after a failure would just refire the same validation/network error,
  // so we wait for the user to type something else before trying again.
  const lastAttemptedHashRef = useRef<string | null>(null);

  useEffect(() => {
    if (readOnly || !dirty || saving) {
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
  }, [snapshotHash, dirty, saving, readOnly]);
}
