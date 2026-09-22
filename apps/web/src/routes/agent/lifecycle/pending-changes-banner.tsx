import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

import type { AgentEditorModel } from "../components/editor/use-model";

// Autosave failures stay visible and retryable without changing the draft.
export function PendingChangesBanner({
  model,
  onDiscard,
}: {
  model: AgentEditorModel;
  onDiscard: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!model.dirty || !model.saveError) return null;
  return (
    <div
      className="border-destructive/30 bg-destructive/5 shrink-0 border-b px-4 py-2.5"
      role="alert"
    >
      <p className="text-destructive text-xs">{model.saveError}</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button disabled={model.saving} onClick={onDiscard} size="xs" variant="ghost">
          {t("agentLifecycle.discard")}
        </Button>
        <Button disabled={model.saving} onClick={() => void model.save()} size="xs">
          {t("agent.retry")}
        </Button>
      </div>
    </div>
  );
}
