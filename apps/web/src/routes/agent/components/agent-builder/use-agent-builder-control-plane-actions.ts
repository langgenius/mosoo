import type { AgentBuilderExecutableActionToolId } from "@mosoo/contracts/agent-builder";
import { AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES } from "@mosoo/contracts/agent-builder";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import type { AgentBuilderControlPlaneActionResult } from "@/domains/agent-builder/api/agent-builder-client";
import { executeAgentBuilderControlPlaneAction } from "@/domains/agent-builder/api/agent-builder-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId } from "@/routes/typed-id";

import type { AgentStatus } from "../../agent.types";

const CONTROL_PLANE_ACTION_SET = new Set<string>(AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES);

function isControlPlaneAction(actionKey: string): actionKey is AgentBuilderExecutableActionToolId {
  return CONTROL_PLANE_ACTION_SET.has(actionKey);
}

function actionRequiresDraftYaml(actionKey: AgentBuilderExecutableActionToolId): boolean {
  return actionKey === "apply_agent_config" || actionKey === "create_agent";
}

function getPlannerOnlyActionMessage(actionKey: string): string | null {
  switch (actionKey) {
    case "configure_environment":
      return "Environment configuration is handled by the Builder question UI.";
    case "keep_refining":
      return "Continue refining by sending another Builder message.";
    default:
      return null;
  }
}

type AgentBuilderActionDispatch =
  | { readonly kind: "control_plane"; readonly toolId: AgentBuilderExecutableActionToolId }
  | { readonly kind: "planner_only"; readonly message: string };

export function getAgentBuilderActionDispatch(actionKey: string): AgentBuilderActionDispatch {
  if (isControlPlaneAction(actionKey)) {
    return { kind: "control_plane", toolId: actionKey };
  }

  return {
    kind: "planner_only",
    message: getPlannerOnlyActionMessage(actionKey) ?? `Unsupported Builder action: ${actionKey}`,
  };
}

export interface AgentBuilderControlPlaneActions {
  readonly actionError: string | null;
  readonly actionPending: boolean;
  readonly isActionDisabled: (actionKey: string) => boolean;
  readonly onAction: (actionKey: string) => void;
}

export function handleAgentBuilderSecureUiAction(input: {
  readonly onCreateEnvironment?: (() => void) | undefined;
  readonly onCreateRemoteMcpServer?: (() => void) | undefined;
  readonly result: AgentBuilderControlPlaneActionResult;
}): boolean {
  if (input.result.status !== "needs_secure_ui" || input.result.secureUi === null) {
    return false;
  }

  switch (input.result.secureUi.kind) {
    case "create_environment":
      if (input.onCreateEnvironment === undefined) {
        return false;
      }
      input.onCreateEnvironment();
      return true;
    case "create_remote_mcp_server":
      if (input.onCreateRemoteMcpServer === undefined) {
        return false;
      }
      input.onCreateRemoteMcpServer();
      return true;
  }
}

export function useAgentBuilderControlPlaneActions(input: {
  readonly agentId: string;
  readonly agentStatus: AgentStatus;
  readonly draftYaml: string;
  readonly draftYamlHash: string;
  readonly markCurrentDraftSaved: (draftYamlHash: string) => void;
  readonly onCreateEnvironment?: (() => void) | undefined;
  readonly onCreateRemoteMcpServer?: (() => void) | undefined;
  readonly onOpenPreview: () => void;
  readonly previewDisabled: boolean;
  readonly saving: boolean;
}): AgentBuilderControlPlaneActions {
  const queryClient = useQueryClient();
  const pendingDraftYamlHashRef = useRef<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionMutation = useMutation({
    mutationFn: executeAgentBuilderControlPlaneAction,
    onSuccess: async (result, variables) => {
      const handledSecureUi = handleAgentBuilderSecureUiAction({
        onCreateEnvironment: input.onCreateEnvironment,
        onCreateRemoteMcpServer: input.onCreateRemoteMcpServer,
        result,
      });
      setActionMessage(result.status === "applied" || handledSecureUi ? null : result.message);

      if (
        result.status === "applied" &&
        (variables.toolId === "apply_agent_config" || variables.toolId === "create_agent")
      ) {
        const pendingDraftYamlHash = pendingDraftYamlHashRef.current;

        if (pendingDraftYamlHash !== null) {
          input.markCurrentDraftSaved(pendingDraftYamlHash);
        }
      }

      if (result.status === "applied") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: agentKeys.detail(variables.agentId) }),
          queryClient.invalidateQueries({ queryKey: agentKeys.editorState(variables.agentId) }),
          queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
        ]);
      }

      if (result.status === "applied" && variables.toolId === "open_preview") {
        input.onOpenPreview();
      }
    },
    onSettled: () => {
      pendingDraftYamlHashRef.current = null;
    },
  });

  function isDisabled(actionKey: string): boolean {
    if (actionMutation.isPending) {
      return true;
    }

    if (actionKey === "open_preview") {
      return input.previewDisabled;
    }

    if (actionKey === "create_agent" && input.agentStatus !== "draft") {
      return true;
    }

    if (isControlPlaneAction(actionKey) && input.saving) {
      return true;
    }

    return false;
  }

  return {
    actionError:
      actionMutation.error instanceof Error ? actionMutation.error.message : actionMessage,
    actionPending: actionMutation.isPending,
    isActionDisabled: isDisabled,
    onAction(actionKey) {
      const dispatch = getAgentBuilderActionDispatch(actionKey);

      if (dispatch.kind === "planner_only") {
        setActionMessage(dispatch.message);
        return;
      }

      if (isDisabled(actionKey)) {
        return;
      }

      pendingDraftYamlHashRef.current = actionRequiresDraftYaml(dispatch.toolId)
        ? input.draftYamlHash
        : null;
      setActionMessage(null);
      void actionMutation.mutateAsync({
        agentId: toAgentId(input.agentId),
        ...(actionRequiresDraftYaml(dispatch.toolId) ? { draftYaml: input.draftYaml } : {}),
        toolId: dispatch.toolId,
      });
    },
  };
}
