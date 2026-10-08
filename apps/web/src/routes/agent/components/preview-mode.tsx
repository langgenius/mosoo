import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { lazy, Suspense, useReducer } from "react";
import { createPortal } from "react-dom";

import { publishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";

import type { Agent } from "../agent.types";
import { AgentApiAccessDialog } from "../lifecycle/api-access-panel";
import { PendingChangesBanner } from "../lifecycle/pending-changes-banner";
import { PublishMenu } from "../lifecycle/publish-menu";
import { PublishSuccessModal } from "../lifecycle/publish-success-modal";
import { AgentFormView } from "./editor/form-view";
import { useAgentEditorAutoSave } from "./editor/use-auto-save";
import { useAgentEditorModel } from "./editor/use-model";

const AgentSessionPanel = lazy(async () => {
  const mod = await import("./agent-session-panel");
  return { default: mod.AgentSessionPanel };
});

interface PublishStatusMessage {
  readonly tone: "danger" | "neutral";
  readonly text: string;
}

interface PreviewModeState {
  apiAccessDialogOpen: boolean;
  showSuccessModal: boolean;
}

type PreviewModeAction =
  | { type: "setApiAccessDialogOpen"; open: boolean }
  | { type: "setSuccessModalOpen"; open: boolean };

const PREVIEW_MODE_INITIAL_STATE: PreviewModeState = {
  apiAccessDialogOpen: false,
  showSuccessModal: false,
};

export interface PreviewModeProps {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
}

function PreviewChatLoading(): ReactElement {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-[13px]">
      Loading preview…
    </div>
  );
}

function publishStatusMessage({
  error,
  publishBlockMessage,
  publishBlocked,
}: {
  error: Error | null;
  publishBlockMessage: string | undefined;
  publishBlocked: boolean;
}): PublishStatusMessage | null {
  if (error !== null) {
    return { text: error.message, tone: "danger" };
  }

  if (publishBlocked && publishBlockMessage !== undefined) {
    return { text: publishBlockMessage, tone: "neutral" };
  }

  return null;
}

function previewModeReducer(state: PreviewModeState, action: PreviewModeAction): PreviewModeState {
  switch (action.type) {
    case "setApiAccessDialogOpen":
      return { ...state, apiAccessDialogOpen: action.open };
    case "setSuccessModalOpen":
      return { ...state, showSuccessModal: action.open };
  }
}

// Saving a preset affects future Sessions. The selected Preview keeps its snapshot.
export function PreviewMode({ agent, headerActionTarget }: PreviewModeProps): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const model = useAgentEditorModel({ agent });
  useAgentEditorAutoSave(model);
  const [state, dispatch] = useReducer(previewModeReducer, PREVIEW_MODE_INITIAL_STATE);
  const { apiAccessDialogOpen, showSuccessModal } = state;

  const publishBlocked =
    agent.readiness?.issues.some((issue) => issue.severity === "error") ?? false;
  const publishBlockMessage = agent.readiness?.issues.find(
    (issue) => issue.severity === "error",
  )?.message;

  const publishMutation = useMutation({
    mutationFn: async () =>
      publishAgent({
        agentId: toAgentId(agent.id),
        projectId: toProjectId(agent.projectId),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.projectId, agent.id) }),
        queryClient.invalidateQueries({
          queryKey: agentKeys.editorState(agent.projectId, agent.id),
        }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
      dispatch({ open: true, type: "setSuccessModalOpen" });
    },
  });

  const publishDisabled = publishBlocked || publishMutation.isPending || model.dirty;
  const publishError = publishMutation.error instanceof Error ? publishMutation.error : null;
  const publishStatus = publishStatusMessage({
    error: publishError,
    publishBlockMessage,
    publishBlocked,
  });

  return (
    <div className="flex h-full flex-col md:flex-row" data-testid="agent-preview-panel">
      {headerActionTarget !== null
        ? createPortal(
            <PublishMenu
              agent={agent}
              busy={publishMutation.isPending}
              disabled={publishDisabled}
              errorMessage={publishError?.message ?? null}
              onApiAccessClick={() => {
                dispatch({ open: true, type: "setApiAccessDialogOpen" });
              }}
              onPublish={() => {
                publishMutation.mutate();
              }}
            />,
            headerActionTarget,
          )
        : null}
      <div className="border-border-subtle flex h-[42%] w-full shrink-0 flex-col border-b md:h-auto md:w-1/2 md:border-r md:border-b-0">
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<PreviewChatLoading />}>
            <AgentSessionPanel
              agentId={agent.id}
              agentName={agent.name}
              configurationChangedAt={agent.updatedAt}
              configurationRevisionKey={`${agent.updatedAt}:${agent.liveVersion?.id ?? "draft"}`}
              key={agent.id}
              projectId={agent.projectId}
              readiness={agent.readiness}
              tone="preview"
            />
          </Suspense>
        </div>
      </div>

      <div className="flex h-[58%] w-full min-w-0 flex-col md:h-auto md:w-1/2">
        <PendingChangesBanner model={model} onDiscard={model.discard} />
        <p
          className="border-border-subtle text-muted-foreground border-b px-4 py-2 text-xs"
          data-testid="preset-session-scope"
        >
          {model.saving ? t("agent.savingPreset") : t("agent.presetSessionScope")}
        </p>

        <div
          className="min-h-0 flex-1 overflow-y-auto bg-white p-4 sm:p-5"
          data-agent-editor-scroll
        >
          <div className="space-y-5">
            <AgentFormView agent={agent} model={model} />
          </div>
        </div>

        {publishStatus ? (
          <div className="border-border-subtle text-muted-foreground flex shrink-0 items-center gap-3 border-t bg-white px-4 py-2.5 text-[12px]">
            <span className={publishStatus.tone === "danger" ? "text-destructive" : undefined}>
              {publishStatus.text}
            </span>
          </div>
        ) : null}
      </div>

      {apiAccessDialogOpen ? (
        <AgentApiAccessDialog
          agent={agent}
          onOpenChange={(open) => {
            dispatch({ open, type: "setApiAccessDialogOpen" });
          }}
          open={apiAccessDialogOpen}
        />
      ) : null}

      <PublishSuccessModal
        agent={agent}
        onOpenChange={(next) => {
          dispatch({ open: next, type: "setSuccessModalOpen" });
        }}
        open={showSuccessModal}
      />
    </div>
  );
}
