import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { Agent } from "../agent.types";
import { AgentFormView } from "./editor/form-view";
import { useAgentEditorModel } from "./editor/use-model";
import type { AgentEditorModel } from "./editor/use-model";

function getApplyButtonLabel(model: AgentEditorModel): string {
  if (model.saving) {
    return "Applying…";
  }

  if (
    model.changePlan.requiresRuntimeOperation &&
    model.changePlan.action === "recreate-preserving-state"
  ) {
    return "Recreate now";
  }

  return model.changePlan.requiresRuntimeOperation ? "Apply now" : "Save changes";
}

function getApplyDialogSubtitle(model: AgentEditorModel): string {
  if (
    model.changePlan.requiresRuntimeOperation &&
    model.changePlan.action === "recreate-preserving-state"
  ) {
    return "Short downtime expected · agent-state restored from backup";
  }

  return "Existing sessions keep their frozen config. In-flight sessions will see Agent is updating until the runtime is ready.";
}

function getPendingChangeCopy(model: AgentEditorModel): string {
  if (model.changePlan.action === "fork-agent") {
    return "Fork Agent to change type or runtime on a published Agent.";
  }

  if (!model.changePlan.requiresRuntimeOperation) {
    return model.changePlan.actionLabel;
  }

  return `${model.changePlan.actionLabel} to apply`;
}

function ConfigPanelContent({
  agent,
  externalModel,
  readOnly = false,
}: {
  agent: Agent;
  externalModel: AgentEditorModel | undefined;
  readOnly?: boolean;
}) {
  const { activeOrganization } = useAppSession();
  const internalModel = useAgentEditorModel({ agent, readOnly });
  const model = externalModel ?? internalModel;
  const organizationId = activeOrganization?.id ?? null;
  const [confirmingApply, setConfirmingApply] = useState(false);
  const editedFieldText =
    model.changePlan.fieldLabels.length === 1
      ? "1 field edited"
      : `${model.changePlan.fieldLabels.length} fields edited`;
  const saveButtonLabel =
    model.dirty && model.changePlan.requiresRuntimeOperation
      ? "Apply changes"
      : model.dirty && model.changePlan.requiresDeploymentVersion
        ? model.changePlan.actionLabel
        : "Save changes";
  const saveDisabled = !model.dirty || model.saving || model.changePlan.action === "fork-agent";

  async function handleSaveClick(): Promise<void> {
    if (model.changePlan.requiresRuntimeOperation) {
      setConfirmingApply(true);
      return;
    }

    await model.save();
  }

  async function handleConfirmApply(): Promise<void> {
    const saved = await model.save();

    if (saved) {
      setConfirmingApply(false);
    }
  }

  function handleDiscard(): void {
    model.discard();
    setConfirmingApply(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {!readOnly && model.dirty ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-[12px] leading-relaxed text-amber-950">
              <span className="font-medium">{editedFieldText}</span>
              <span className="text-amber-900/80"> · {getPendingChangeCopy(model)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button disabled={model.saving} onClick={handleDiscard} size="xs" variant="ghost">
                Discard
              </Button>
              <Button
                disabled={saveDisabled}
                onClick={() => void handleSaveClick()}
                size="xs"
                variant="outline"
              >
                {saveButtonLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4" data-agent-editor-scroll>
        <AgentFormView
          agent={agent}
          focusSection={model.focusSection}
          highlightedSections={model.highlightedSections}
          model={model}
          readOnly={readOnly}
          organizationId={organizationId}
        />
      </div>

      {!readOnly ? (
        <div className="border-border-subtle flex items-center justify-between gap-3 border-t bg-white px-4 py-3">
          <div className="text-[12px]">
            {isTruthy(model.saveError) ? (
              <span className="text-destructive">{model.saveError}</span>
            ) : model.changePlan.action === "fork-agent" ? (
              <span className="text-muted-foreground">
                Fork Agent to change type or runtime on a published Agent.
              </span>
            ) : model.dirty ? (
              <span className="text-muted-foreground">
                {agent.status === "published"
                  ? `${editedFieldText} · ${getPendingChangeCopy(model)}`
                  : "Unsaved changes"}
              </span>
            ) : (
              <span className="text-muted-foreground">All changes saved</span>
            )}
          </div>

          <Button disabled={saveDisabled} onClick={() => void handleSaveClick()} size="sm">
            {model.saving ? "Applying…" : saveButtonLabel}
          </Button>
        </div>
      ) : null}

      {confirmingApply ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="border-border w-full max-w-[480px] rounded-lg border bg-white p-5 shadow-xl">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[12px] font-medium text-green-700">
              <CheckCircle2 className="size-3.5" />
              agent-state preserved · login, cache, memory, native sessions stay
            </div>
            <div className="text-foreground mt-4 text-[16px] font-semibold">
              Apply changes · {model.changePlan.actionLabel}
            </div>
            <div className="text-muted-foreground mt-1 text-[12px] leading-relaxed">
              {getApplyDialogSubtitle(model)}
            </div>
            {model.changePlan.action === "recreate-preserving-state" ? (
              <div className="text-muted-foreground mt-4 space-y-2 text-[12px] leading-relaxed">
                <p>
                  Spaces, network policy, and setup script can only change at container creation
                  time.
                </p>
                <p>
                  In-flight sessions will see Agent is updating until the runtime is ready. Existing
                  sessions keep their frozen config.
                </p>
                <p>
                  Preserved: agent-state is backed up before rebuild and restored after. Space files
                  are unchanged.
                </p>
              </div>
            ) : null}
            <div className="border-border-subtle bg-muted/30 mt-4 rounded-md border p-3">
              <div className="text-foreground text-[12px] font-medium">Changed fields</div>
              <ul className="text-muted-foreground mt-2 space-y-1 text-[12px]">
                {model.changePlan.fieldLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                disabled={model.saving}
                onClick={() => {
                  setConfirmingApply(false);
                }}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={model.saving} onClick={() => void handleConfirmApply()} size="sm">
                {getApplyButtonLabel(model)}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ConfigPanel({
  agent,
  model,
  readOnly = false,
}: {
  agent: Agent;
  model?: AgentEditorModel;
  readOnly?: boolean;
}) {
  return (
    <ConfigPanelContent
      agent={agent}
      externalModel={model ?? undefined}
      key={agent.id}
      readOnly={readOnly}
    />
  );
}
