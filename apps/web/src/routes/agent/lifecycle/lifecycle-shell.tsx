import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import type { McpServerWithCredential } from "@mosoo/contracts/mcp";
import { ArrowRight, Rocket } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";

import { CreateEnvironmentDialog } from "@/domains/environment/components/create-environment-dialog";
import type { McpConnectTargetServer } from "@/routes/integrations/mcp/oauth-connect-dialog";
import { Button } from "@/shared/ui/button";

import type { Agent, AgentMode } from "../agent.types";
import {
  createCreatedEnvironmentBuilderPatch,
  createCreatedMcpServerBuilderPatch,
} from "../components/agent-builder/agent-builder-auto-apply";
import { AgentBuilderPanel } from "../components/agent-builder/agent-builder-panel";
import { AgentBuilderRemoteMcpSecureDialog } from "../components/agent-builder/agent-builder-remote-mcp-secure-dialog";
import { useAgentBuilderControlPlaneActions } from "../components/agent-builder/use-agent-builder-control-plane-actions";
import { AgentKindSection } from "../components/agent-kind-section";
import { AgentFormView } from "../components/editor/form-view";
import { useAgentEditorModel } from "../components/editor/use-model";
import { PreviewMode } from "../components/preview-mode";
import { hasRequiredAgentDraftFields, listAgentDraftStages } from "../draft-stages";
import { DistributionPanel } from "./distribution-panel";
import { DraftStageIndicator } from "./draft-stage-indicator";

export type LifecycleMode = Extract<AgentMode, "dev" | "preview"> | "publish";

export interface LifecycleShellProps {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
  headerCenterTarget: HTMLDivElement | null;
  mode: LifecycleMode;
  onSwitchMode: (mode: AgentMode | "logs") => void;
}

interface ConfigureStageProps {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
  headerCenterTarget: HTMLDivElement | null;
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
  headerCenterTarget,
  mode,
  onSwitchMode,
}: LifecycleShellProps): ReactElement {
  return (
    <div className="bg-bg-1 flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "dev" && (
          <ConfigureStage
            agent={agent}
            onSwitchMode={onSwitchMode}
            headerActionTarget={headerActionTarget}
            headerCenterTarget={headerCenterTarget}
          />
        )}
        {mode === "preview" && (
          <PreviewMode
            agent={agent}
            onSwitchMode={onSwitchMode}
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
  headerCenterTarget,
}: ConfigureStageProps): ReactElement {
  const model = useAgentEditorModel({ agent });
  const [createEnvironmentOpen, setCreateEnvironmentOpen] = useState(false);
  const [createRemoteMcpOpen, setCreateRemoteMcpOpen] = useState(false);
  const [connectMcpServer, setConnectMcpServer] = useState<McpConnectTargetServer | null>(null);

  // Stages are soft guidance for the Builder path; the manual gate only
  // checks the fields persistDraft refuses to save without. Readiness issues
  // (provider keys, environment) are surfaced by the preview composer.
  const requiredComplete = hasRequiredAgentDraftFields(model.draft);
  const draftStages = listAgentDraftStages(model.draft);

  const fieldsEdited = model.changePlan.fieldLabels.length;
  const editedText = editedFieldsText(fieldsEdited);
  const saveDisabled = !model.dirty || model.saving || model.changePlan.action === "fork-agent";
  const testDisabled = !requiredComplete || model.saving;
  const builderActions = useAgentBuilderControlPlaneActions({
    agentId: agent.id,
    agentStatus: agent.status,
    draftYaml: model.draftYaml,
    draftYamlHash: model.draftYamlHash,
    markCurrentDraftSaved: model.markCurrentDraftSaved,
    onConnectMcpCredential: (server) => {
      setConnectMcpServer(server);
    },
    onCreateEnvironment: () => {
      setCreateEnvironmentOpen(true);
    },
    onCreateRemoteMcpServer: () => {
      setCreateRemoteMcpOpen(true);
    },
    onEnvironmentCreated: (environment) => {
      bindCreatedEnvironment(environment);
    },
    onMcpServerCreated: (server) => {
      bindCreatedMcpServer(server);
    },
    onOpenPreview: () => {
      onSwitchMode("preview");
    },
    previewDisabled: testDisabled,
    appId: agent.appId,
    saving: model.saving,
  });

  async function handleTestInChat(): Promise<void> {
    if (model.dirty) {
      const saved = await model.save();

      if (!saved) {
        return;
      }
    }

    builderActions.onAction("open_preview");
  }

  // Chat-rendered planner buttons share the same auto-save gate as the header
  // Test in Chat button; otherwise an open_preview click would unmount this
  // stage and silently drop unsaved edits.
  function handleBuilderAction(
    actionKey: string,
    payloads?: Parameters<typeof builderActions.onAction>[1],
  ): void {
    if (actionKey === "open_preview") {
      void handleTestInChat();
      return;
    }

    builderActions.onAction(actionKey, payloads);
  }

  function bindCreatedEnvironment(environment: Pick<EnvironmentSummary, "id" | "name">): void {
    void model.applyAndSaveBuilderPatch(
      createCreatedEnvironmentBuilderPatch({
        baseDraftRevision: model.draftYamlHash,
        baseEnvironmentDecision: model.draft.componentDecisions.environment ?? null,
        baseEnvironmentId: model.draft.environmentId,
        environment,
      }),
    );
  }

  function bindCreatedMcpServer(
    mcpServer: Pick<McpServerWithCredential, "id" | "name" | "url">,
  ): void {
    void model.applyAndSaveBuilderPatch(
      createCreatedMcpServerBuilderPatch({
        baseDraftRevision: model.draftYamlHash,
        baseMcpServerIds: model.draft.mcpServers.map((server) => server.id),
        mcpServer,
      }),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CreateEnvironmentDialog
        onCreated={bindCreatedEnvironment}
        onOpenChange={setCreateEnvironmentOpen}
        open={createEnvironmentOpen}
        appId={agent.appId}
      />
      <AgentBuilderRemoteMcpSecureDialog
        connectServer={connectMcpServer}
        onConnectServerClose={() => {
          setConnectMcpServer(null);
        }}
        onCreated={bindCreatedMcpServer}
        onOpenChange={setCreateRemoteMcpOpen}
        open={createRemoteMcpOpen}
        appId={agent.appId}
      />
      {headerCenterTarget !== null
        ? createPortal(<DraftStageIndicator stages={draftStages} />, headerCenterTarget)
        : null}
      {headerActionTarget !== null
        ? createPortal(
            <Button
              disabled={builderActions.isActionDisabled("open_preview")}
              onClick={() => {
                void handleTestInChat();
              }}
              size="sm"
              title={
                requiredComplete
                  ? undefined
                  : "Name, model, and provider are required before testing in chat."
              }
            >
              <Rocket />
              Test in Chat
              <ArrowRight />
            </Button>,
            headerActionTarget,
          )
        : null}
      {model.saveError !== null ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive shrink-0 border-b px-5 py-2 text-[12px]">
          {model.saveError}
        </div>
      ) : null}
      {model.dirty ? (
        <div className="border-amber/30 bg-amber-bg flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2.5">
          <div className="text-amber-fg min-w-0 text-[12px] leading-relaxed">
            {editedText === null ? null : <span className="font-medium">{editedText}</span>}
            <span className="text-amber-fg/80">
              {" "}
              · Changes save automatically when you test in chat.
            </span>
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
        <div className="border-border-subtle min-h-0 w-1/2 min-w-[360px] shrink-0 border-r">
          <AgentBuilderPanel
            agent={agent}
            actionDisabled={builderActions.isActionDisabled}
            actionError={builderActions.actionError}
            actionPending={builderActions.actionPending}
            draftRevision={model.draftYamlHash}
            draftYaml={model.draftYaml}
            onAction={handleBuilderAction}
            onDraftPatchAutoApply={model.applyAndSaveBuilderPatch}
            onDraftPatchFocus={model.focusBuilderPatchSection}
          />
        </div>
        <div
          className="min-h-0 w-1/2 shrink-0 overflow-y-auto bg-white p-5"
          data-agent-editor-scroll
        >
          <AgentKindSection
            agent={{ ...agent, kind: model.draft.kind }}
            onKindChange={model.setKind}
          />
          <AgentFormView
            agent={agent}
            focusSection={model.focusSection}
            highlightedSections={model.highlightedSections}
            model={model}
          />
        </div>
      </div>
    </div>
  );
}
