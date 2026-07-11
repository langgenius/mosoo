import { ShieldCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";
import { isAutoSaveEligible } from "../components/editor/use-auto-save";
import type { AgentEditorModel } from "../components/editor/use-model";
import { LiveConfigActionDialog } from "./live-config-action-dialog";
import type { LifecycleActionKind } from "./live-config-action-dialog";

export interface PendingChangesBannerProps {
  agent: Agent;
  model: AgentEditorModel;
  onAfterApply?: (kind: LifecycleActionKind | "direct-update") => void;
  onDiscard: () => void;
}

// Sticky banner for unsaved live-config edits.
// It owns confirmation orchestration around the editor model's save action.
export function PendingChangesBanner({
  agent,
  model,
  onAfterApply,
  onDiscard,
}: PendingChangesBannerProps): ReactElement | null {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!model.dirty || model.changePlan.fieldLabels.length === 0) {
    return null;
  }

  // Auto-save handles these silently in Preview; the banner would just flicker
  // for the debounce window before the save lands. Restart/recreate/fork still
  // need explicit confirmation, so the banner stays for those.
  if (isAutoSaveEligible(model.changePlan)) {
    return null;
  }

  const { action } = model.changePlan;
  const forkBlocked = action === "fork-agent";
  // Drafts don't run drivers yet — saving propagates to the next test session
  // Automatically, so we skip the runtime-op dialog and just save. Live agents
  // (where requiresRuntimeOperation flips on) see the appropriate dialog.
  const dialogEnabled =
    forkBlocked || (model.changePlan.requiresRuntimeOperation && action !== "direct-update");

  async function applySaved(reportedKind: LifecycleActionKind | "direct-update") {
    const ok = await model.save();
    if (ok) {
      onAfterApply?.(reportedKind);
    }
  }

  async function applyWithDialog() {
    setDialogOpen(false);
    if (action === "direct-update") {
      return;
    }
    await applySaved(action);
  }

  function handleApplyClick() {
    if (dialogEnabled) {
      setDialogOpen(true);
      return;
    }
    void applySaved("direct-update");
  }

  const fieldCount = model.changePlan.fieldLabels.length;

  return (
    <>
      <div className="border-amber/30 bg-amber-bg/95 shrink-0 border-b px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-amber-fg flex min-w-0 items-center gap-2 text-[12.5px]">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {fieldCount} field{fieldCount === 1 ? "" : "s"} edited ·{" "}
              <span className="font-medium">{model.changePlan.actionLabel}</span>
              {model.changePlan.agentStatePreserved && action !== "direct-update" ? (
                <span className="text-amber-fg/70">
                  {action === "recreate-preserving-state"
                    ? " · checkpointed paths restored"
                    : action === "fork-agent"
                      ? " · original Agent state unchanged"
                      : " · current Sandbox retained"}
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              className="text-amber-fg gap-1"
              disabled={model.saving}
              onClick={onDiscard}
              size="xs"
              variant="ghost"
            >
              <Undo2 className="size-3" />
              Discard
            </Button>
            <Button
              className="bg-amber hover:bg-amber/85"
              disabled={model.saving}
              onClick={handleApplyClick}
              size="xs"
            >
              {model.saving ? "Applying…" : "Apply changes"}
            </Button>
          </div>
        </div>
        <p className="text-amber-fg/80 mt-1 pl-[22px] text-[12px] leading-relaxed">
          The preview chat keeps using the saved config until you apply.
          {agent.status === "published"
            ? " After applying, Re-publish to roll the new version out."
            : null}
        </p>
      </div>

      {dialogEnabled ? (
        <LiveConfigActionDialog
          affectedFields={model.changePlan.fieldLabels}
          agentName={agent.name}
          busy={model.saving}
          kind={action}
          onCancel={() => {
            setDialogOpen(false);
          }}
          onConfirm={() => void applyWithDialog()}
          open={dialogOpen}
        />
      ) : null}
    </>
  );
}
