import { ArrowRight, Rocket } from "lucide-react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";

import { useAppSession } from "@/app/session-provider";
import { Button } from "@/shared/ui/button";

import type { Agent, AgentMode } from "../agent.types";
import { AgentBuilderPanel } from "../components/agent-builder/agent-builder-panel";
import { AgentKindSection } from "../components/agent-kind-section";
import { AgentFormView } from "../components/editor/form-view";
import { useAgentEditorModel } from "../components/editor/use-model";
import { PreviewMode } from "../components/preview-mode";
import { DistributionPanel } from "./distribution-panel";

export type LifecycleMode = Extract<AgentMode, "dev" | "preview"> | "publish";

export interface LifecycleShellProps {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
  mode: LifecycleMode;
  onSwitchMode: (mode: AgentMode | "logs") => void;
  organizationId: string | null;
}

interface ConfigureStageProps {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
  onSwitchMode: (mode: AgentMode | "logs") => void;
}

function editedFieldsText(fieldsEdited: number): string | null {
  if (fieldsEdited === 1) {
    return "1 field edited";
  }

  if (fieldsEdited > 1) {
    return `${fieldsEdited} fields edited`;
  }

  return null;
}

// Draft-state lifecycle shell.
// Live agents bypass this shell until Stage 3 becomes their home surface.
export function LifecycleShell({
  agent,
  headerActionTarget,
  mode,
  onSwitchMode,
  organizationId,
}: LifecycleShellProps): ReactElement {
  return (
    <div className="bg-bg-1 flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "dev" && (
          <ConfigureStage
            agent={agent}
            onSwitchMode={onSwitchMode}
            headerActionTarget={headerActionTarget}
          />
        )}
        {mode === "preview" && (
          <PreviewMode
            agent={agent}
            onSwitchMode={onSwitchMode}
            organizationId={organizationId}
            headerActionTarget={headerActionTarget}
          />
        )}
        {mode === "publish" && <DistributionPanel agent={agent} />}
      </div>
    </div>
  );
}

function ConfigureStage({
  agent,
  onSwitchMode,
  headerActionTarget,
}: ConfigureStageProps): ReactElement {
  const { activeOrganization } = useAppSession();
  const organizationId = activeOrganization?.id ?? null;
  const model = useAgentEditorModel({ agent });

  const readinessReady = agent.readiness?.ready ?? false;

  const fieldsEdited = model.changePlan.fieldLabels.length;
  const editedText = editedFieldsText(fieldsEdited);
  const saveDisabled = !model.dirty || model.saving || model.changePlan.action === "fork-agent";
  const testDisabled = !readinessReady || model.dirty || model.saving;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerActionTarget !== null
        ? createPortal(
            <Button
              disabled={testDisabled}
              onClick={() => {
                onSwitchMode("preview");
              }}
              size="sm"
            >
              <Rocket />
              Test in Chat
              <ArrowRight />
            </Button>,
            headerActionTarget,
          )
        : null}
      {model.dirty ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5">
          <div className="min-w-0 text-[12px] leading-relaxed text-amber-950">
            {editedText === null ? null : <span className="font-medium">{editedText}</span>}
            <span className="text-amber-900/80"> · Save changes before testing in chat.</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              disabled={model.saving}
              onClick={() => {
                model.discard();
              }}
              size="xs"
              variant="ghost"
            >
              Discard
            </Button>
            <Button
              disabled={saveDisabled}
              onClick={() => void model.save()}
              size="xs"
              variant="outline"
            >
              {model.saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="border-border-subtle min-h-0 w-[40%] min-w-[360px] shrink-0 border-r">
          <AgentBuilderPanel
            agent={agent}
            draftRevision={model.draftYamlHash}
            draftYaml={model.draftYaml}
            onDraftPatchAutoApply={model.applyAndSaveBuilderPatch}
            onDraftPatchFocus={model.focusBuilderPatchSection}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-agent-editor-scroll>
          <div className="mx-auto w-full max-w-[760px] space-y-4 p-5">
            <AgentKindSection
              agent={{ ...agent, kind: model.draft.kind }}
              onKindChange={model.setKind}
            />
            <AgentFormView
              agent={agent}
              focusSection={model.focusSection}
              highlightedSections={model.highlightedSections}
              mode="stacked"
              model={model}
              organizationId={organizationId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
