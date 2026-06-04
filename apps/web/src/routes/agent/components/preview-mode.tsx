import type { AgentVisibility } from "@mosoo/contracts/agent";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useReducer } from "react";
import { createPortal } from "react-dom";

import { publishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId } from "@/routes/typed-id";

import type { Agent, AgentMode } from "../agent.types";
import type { LifecycleActionKind } from "../lifecycle/live-config-action-dialog";
import { PendingChangesBanner } from "../lifecycle/pending-changes-banner";
import { PublishMenu } from "../lifecycle/publish-menu";
import { PublishSuccessModal } from "../lifecycle/publish-success-modal";
import { AgentSessionPanel } from "./agent-session-panel";
import { ChannelsConfigDialog } from "./channels-config-dialog";
import { AgentFormView } from "./editor/form-view";
import { isAutoSaveEligible, useAgentEditorAutoSave } from "./editor/use-auto-save";
import { useAgentEditorModel } from "./editor/use-model";
import type { ChannelId } from "./settings-dialog-model";

type AppliedToastKind = LifecycleActionKind | "direct-update";

interface PublishStatusMessage {
  readonly tone: "danger" | "neutral";
  readonly text: string;
}

interface PreviewModeState {
  appliedKind: AppliedToastKind | null;
  channelsDialogOpen: boolean;
  discardCounter: number;
  showAppliedToast: boolean;
  showSuccessModal: boolean;
}

type PreviewModeAction =
  | { type: "applied"; kind: AppliedToastKind }
  | { type: "discarded" }
  | { type: "setAppliedToast"; open: boolean }
  | { type: "setChannelsDialogOpen"; open: boolean }
  | { type: "setSuccessModalOpen"; open: boolean };

const DEFAULT_PUBLISH_VISIBILITY: AgentVisibility = "organization";
const DEFAULT_CHANNEL_ID: ChannelId = "slack";
const PREVIEW_MODE_INITIAL_STATE: PreviewModeState = {
  appliedKind: null,
  channelsDialogOpen: false,
  discardCounter: 0,
  showAppliedToast: false,
  showSuccessModal: false,
};

export interface PreviewModeProps {
  agent: Agent;
  headerActionTarget: HTMLDivElement | null;
  onSwitchMode: (mode: AgentMode | "logs") => void;
  organizationId: string | null;
}

function publishStatusMessage({
  dirty,
  error,
  publishBlockMessage,
  publishBlocked,
}: {
  dirty: boolean;
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

  if (dirty) {
    return { text: "Apply or discard changes before publishing.", tone: "neutral" };
  }

  return null;
}

function previewModeReducer(state: PreviewModeState, action: PreviewModeAction): PreviewModeState {
  switch (action.type) {
    case "applied":
      return { ...state, appliedKind: action.kind, showAppliedToast: true };
    case "discarded":
      return { ...state, discardCounter: state.discardCounter + 1 };
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
export function PreviewMode({
  agent,
  headerActionTarget,
  onSwitchMode,
  organizationId,
}: PreviewModeProps): ReactElement {
  const queryClient = useQueryClient();
  const model = useAgentEditorModel({ agent });
  useAgentEditorAutoSave(model);
  const autoSaveEligible = isAutoSaveEligible(model.changePlan);
  const [state, dispatch] = useReducer(previewModeReducer, PREVIEW_MODE_INITIAL_STATE);
  const { appliedKind, channelsDialogOpen, discardCounter, showAppliedToast, showSuccessModal } =
    state;

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
    mutationFn: async (nextVisibility?: AgentVisibility) =>
      publishAgent({
        agentId: toAgentId(agent.id),
        ...(nextVisibility !== undefined ? { visibility: nextVisibility } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.id) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.editorState(agent.id) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
      dispatch({ open: true, type: "setSuccessModalOpen" });
    },
  });

  const isLive = agent.status === "published";
  const publishDisabled = publishBlocked || publishMutation.isPending || model.dirty;
  const publishError = publishMutation.error instanceof Error ? publishMutation.error : null;
  const publishStatus = publishStatusMessage({
    dirty: model.dirty,
    error: publishError,
    publishBlockMessage,
    publishBlocked,
  });

  return (
    <div className="flex h-full" data-testid="agent-preview-panel">
      {headerActionTarget !== null
        ? createPortal(
            <PublishMenu
              agent={agent}
              busy={publishMutation.isPending}
              disabled={publishDisabled}
              errorMessage={publishError?.message ?? null}
              onChannelClick={() => {
                dispatch({ open: true, type: "setChannelsDialogOpen" });
              }}
              onPublish={() => {
                // Re-publish inherits the agent's current visibility (omit). First
                // publish defaults to organization — audience changes live in
                // Settings → Collaborators afterward.
                if (isLive) {
                  publishMutation.mutate(undefined);
                } else {
                  publishMutation.mutate(DEFAULT_PUBLISH_VISIBILITY);
                }
              }}
            />,
            headerActionTarget,
          )
        : null}
      <div className="border-border-subtle flex min-h-0 w-[60%] shrink-0 flex-col border-r">
        {model.dirty && !autoSaveEligible ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-amber-300/60 bg-amber-50/70 px-4 py-2 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Pending changes are not yet applied; the chat below is still using the saved config.
              Apply on the right to test the new behavior.
            </span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <AgentSessionPanel
            agentId={agent.id}
            agentName={agent.name}
            configurationChangedAt={agent.updatedAt}
            configurationRevisionKey={`${agent.updatedAt}:${agent.liveVersion?.id ?? "draft"}`}
            key={agent.id}
            organizationId={organizationId}
            readiness={agent.readiness}
            tone="preview"
          />
        </div>

        {showAppliedToast && appliedKind ? (
          <div className="shrink-0 border-t border-emerald-200/60 bg-emerald-50 px-4 py-2 text-[12px] text-emerald-900">
            Applied · {appliedToastText(appliedKind)}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 w-[40%] min-w-0 flex-col">
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

        <div className="min-h-0 flex-1 overflow-y-auto bg-white p-4" data-agent-editor-scroll>
          <AgentFormView
            agent={agent}
            mode="tabbed"
            model={model}
            organizationId={organizationId}
          />
        </div>

        {publishStatus ? (
          <div className="border-border-subtle text-muted-foreground flex shrink-0 items-center gap-3 border-t bg-white px-4 py-2.5 text-[12px]">
            <span className={publishStatus.tone === "danger" ? "text-destructive" : undefined}>
              {publishStatus.text}
            </span>
          </div>
        ) : null}
      </div>

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
          if (!next) {
            onSwitchMode("consume");
          }
        }}
        onOpenChat={() => {
          onSwitchMode("consume");
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
      return "Sandbox recreated · agent-state restored from backup";
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
