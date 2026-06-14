import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import type { McpServerWithCredential } from "@mosoo/contracts/mcp";
import { Upload } from "lucide-react";
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
} from "./agent-builder/agent-builder-auto-apply";
import { AgentBuilderPanel } from "./agent-builder/agent-builder-panel";
import { AgentBuilderRemoteMcpSecureDialog } from "./agent-builder/agent-builder-remote-mcp-secure-dialog";
import { useAgentBuilderControlPlaneActions } from "./agent-builder/use-agent-builder-control-plane-actions";
import { AgentKindSection } from "./agent-kind-section";
import { ConfigPanel } from "./config-panel";
import { useAgentEditorModel } from "./editor/use-model";

export function DevMode({
  agent,
  headerActionTarget,
  onSwitchMode,
}: {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
  onSwitchMode: (mode: AgentMode | "logs") => void;
}): ReactElement {
  const model = useAgentEditorModel({ agent });
  const [createEnvironmentOpen, setCreateEnvironmentOpen] = useState(false);
  const [createRemoteMcpOpen, setCreateRemoteMcpOpen] = useState(false);
  const [connectMcpServer, setConnectMcpServer] = useState<McpConnectTargetServer | null>(null);
  const previewBlocked =
    agent.readiness?.issues.some((issue) => issue.severity === "error") ?? false;
  const previewDisabled = previewBlocked || model.dirty || model.saving;
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
    previewDisabled,
    appId: agent.appId,
    saving: model.saving,
  });

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
    <>
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
      {headerActionTarget !== null
        ? createPortal(
            <Button
              disabled={builderActions.isActionDisabled("open_preview")}
              onClick={() => {
                builderActions.onAction("open_preview");
              }}
              size="sm"
            >
              <Upload />
              Preview changes
            </Button>,
            headerActionTarget,
          )
        : null}
      <div className="bg-paper-200 flex h-full min-h-0">
        <div className="border-border-subtle min-h-0 w-[40%] min-w-[360px] shrink-0 border-r">
          <AgentBuilderPanel
            agent={agent}
            actionError={builderActions.actionError}
            actionDisabled={builderActions.isActionDisabled}
            actionPending={builderActions.actionPending}
            draftRevision={model.draftYamlHash}
            draftYaml={model.draftYaml}
            onAction={builderActions.onAction}
            onDraftPatchAutoApply={model.applyAndSaveBuilderPatch}
            onDraftPatchFocus={model.focusBuilderPatchSection}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] space-y-4 p-5">
            <AgentKindSection
              agent={{ ...agent, kind: model.draft.kind }}
              onKindChange={model.setKind}
            />
            <div className="border-border-subtle overflow-hidden rounded-xl border bg-white">
              <ConfigPanel agent={agent} model={model} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
