import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { lazy, Suspense, useEffect, useReducer } from "react";
import { createPortal } from "react-dom";

import { publishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toAppId } from "@/routes/typed-id";

import type { Agent } from "../agent.types";
import { AgentApiAccessDialog } from "../lifecycle/api-access-panel";
import type { LifecycleActionKind } from "../lifecycle/live-config-action-dialog";
import { PendingChangesBanner } from "../lifecycle/pending-changes-banner";
import { PublishMenu } from "../lifecycle/publish-menu";
import { PublishSuccessModal } from "../lifecycle/publish-success-modal";
import { AgentKindSection } from "./agent-kind-section";
import { ChannelsConfigDialog } from "./channels-config-dialog";
import { AgentFormView } from "./editor/form-view";
import { useAgentEditorAutoSave } from "./editor/use-auto-save";
import { useAgentEditorModel } from "./editor/use-model";
import type { ChannelId } from "./settings-dialog-model";

const AgentSessionPanel = lazy(async () => {
  const mod = await import("./agent-session-panel");
  return { default: mod.AgentSessionPanel };
});

type AppliedToastKind = LifecycleActionKind | "direct-update";

interface PublishStatusMessage {
  readonly tone: "danger" | "neutral";
  readonly text: string;
}

interface PreviewModeState {
  apiAccessDialogOpen: boolean;
  appliedKind: AppliedToastKind | null;
  channelsDialogOpen: boolean;
  discardCounter: number;
  showAppliedToast: boolean;
  showSuccessModal: boolean;
}

type PreviewModeAction =
  | { type: "applied"; kind: AppliedToastKind }
  | { type: "discarded" }
  | { type: "setApiAccessDialogOpen"; open: boolean }
  | { type: "setAppliedToast"; open: boolean }
  | { type: "setChannelsDialogOpen"; open: boolean }
  | { type: "setSuccessModalOpen"; open: boolean };

const DEFAULT_CHANNEL_ID: ChannelId = "slack";
const PREVIEW_MODE_INITIAL_STATE: PreviewModeState = {
  apiAccessDialogOpen: false,
  appliedKind: null,
  channelsDialogOpen: false,
  discardCounter: 0,
  showAppliedToast: false,
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
    case "applied":
      return { ...state, appliedKind: action.kind, showAppliedToast: true };
    case "discarded":
      return { ...state, discardCounter: state.discardCounter + 1 };
    case "setApiAccessDialogOpen":
      return { ...state, apiAccessDialogOpen: action.open };
    case "setAppliedToast":
      return { ...state, showAppliedToast: action.open };
    case "setChannelsDialogOpen":
      return { ...state, channelsDialogOpen: action.open };
    case "setSuccessModalOpen":
      return { ...state, showSuccessModal: action.open };
  }
}

// Preview surface for Draft stage 2 and Live debug-and-iterate flows.
// The writable form classifies dirty fields and routes them to the right apply action.
export function PreviewMode({ agent, headerActionTarget }: PreviewModeProps): ReactElement {
  const queryClient = useQueryClient();
  const model = useAgentEditorModel({ agent });
  useAgentEditorAutoSave(model);
  const [state, dispatch] = useReducer(previewModeReducer, PREVIEW_MODE_INITIAL_STATE);
  const {
    apiAccessDialogOpen,
    appliedKind,
    channelsDialogOpen,
    discardCounter,
    showAppliedToast,
    showSuccessModal,
  } = state;

  useEffect(() => {
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

    if (showAppliedToast) {
      timer = globalThis.setTimeout(() => {
        dispatch({ open: false, type: "setAppliedToast" });
      }, 2400);
    }

    return () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [showAppliedToast]);

  const publishBlocked =
    agent.readiness?.issues.some((issue) => issue.severity === "error") ?? false;
  const publishBlockMessage = agent.readiness?.issues.find(
    (issue) => issue.severity === "error",
  )?.message;

  const publishMutation = useMutation({
    mutationFn: async () =>
      publishAgent({
        agentId: toAgentId(agent.id),
        appId: toAppId(agent.appId),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.appId, agent.id) }),
        queryClient.invalidateQueries({
          queryKey: agentKeys.editorState(agent.appId, agent.id),
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
  const draftAgent: Agent = {
    ...agent,
    kind: model.draft.kind,
  };

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
              onChannelClick={() => {
                dispatch({ open: true, type: "setChannelsDialogOpen" });
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
              appId={agent.appId}
              readiness={agent.readiness}
              tone="preview"
            />
          </Suspense>
        </div>

        {showAppliedToast && appliedKind ? (
          <div className="bg-success-bg text-success-fg shrink-0 border-t border-green-200/60 px-4 py-2 text-[12px]">
            Applied · {appliedToastText(appliedKind)}
          </div>
        ) : null}
      </div>

      <div className="flex h-[58%] w-full min-w-0 flex-col md:h-auto md:w-1/2">
        <PendingChangesBanner
          agent={agent}
          key={`${agent.id}:${discardCounter}`}
          model={model}
          onAfterApply={(kind) => {
            dispatch({ kind, type: "applied" });
          }}
          onDiscard={() => {
            model.discard();
            dispatch({ type: "discarded" });
          }}
        />

        <div
          className="min-h-0 flex-1 overflow-y-auto bg-white p-4 sm:p-5"
          data-agent-editor-scroll
        >
          <div className="space-y-5">
            <AgentKindSection agent={draftAgent} onKindChange={model.setKind} />
            <AgentFormView agent={draftAgent} model={model} />
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
      {channelsDialogOpen ? (
        <ChannelsConfigDialog
          agent={agent}
          initialChannelId={DEFAULT_CHANNEL_ID}
          onOpenChange={(open) => {
            dispatch({ open, type: "setChannelsDialogOpen" });
          }}
          open={channelsDialogOpen}
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

function appliedToastText(kind: AppliedToastKind): string {
  switch (kind) {
    case "direct-update": {
      return "Changes saved";
    }
    case "restart-process": {
      return "Agent process restarted";
    }
    case "patch-and-restart": {
      return "Native config patched + Agent process restarted";
    }
    case "recreate-preserving-state": {
      return "Sandbox recreated · checkpointed memory/workspaces restored";
    }
    case "fork-agent": {
      return "New Agent forked with the new runtime";
    }
    case "reset-agent-state": {
      return "agent-state cleared";
    }
    default: {
      return unreachableCase(kind, "Unsupported applied toast kind.");
    }
  }
}

function unreachableCase(_value: never, message: string): never {
  throw new Error(message);
}
