import type {
  AgentBuilderExecutableActionToolId,
  AgentBuilderSecureUiAction,
} from "@mosoo/contracts/agent-builder";
import type { AgentId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import { updateAgentConfig } from "../../agents/application/agent-command.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteAgentSession } from "../../sessions/application/session-lifecycle-mutation.service";
import { ensureModelAvailableForSelection } from "../../vendor-credentials/application/vendor-credential.service";
import { toAgentBuilderUpdateAgentConfigInput } from "./agent-builder-lightweight-manifest-projections";
import { listAgentBuilderPreviewSessions } from "./agent-builder-preview-session.service";
import { markAgentBuilderPreviewOpened } from "./agent-builder-thread.service";

export type AgentBuilderControlPlaneActionStatus = "applied" | "needs_secure_ui" | "noop";

export interface ExecuteAgentBuilderControlPlaneActionInput {
  readonly agentId: AgentId;
  readonly draftYaml?: string;
  readonly toolId: AgentBuilderExecutableActionToolId;
}

export interface AgentBuilderControlPlaneActionResult {
  readonly message: string;
  readonly secureUi?: AgentBuilderSecureUiAction;
  readonly sessionId?: SessionId;
  readonly status: AgentBuilderControlPlaneActionStatus;
  readonly toolId: AgentBuilderExecutableActionToolId;
}

function requireDraftYaml(input: ExecuteAgentBuilderControlPlaneActionInput): string {
  if (input.draftYaml === undefined || input.draftYaml.trim().length === 0) {
    throw new Error(`${input.toolId} requires the current Agent Manifest draft YAML.`);
  }

  return input.draftYaml;
}

async function applyAgentConfig(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  const configInput = toAgentBuilderUpdateAgentConfigInput(input.agentId, requireDraftYaml(input));
  const editable = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  await ensureModelAvailableForSelection(bindings.DB, {
    accountId: viewer.id,
    modelId: configInput.model,
    organizationId: editable.agent.organizationId,
    runtimeId: configInput.runtimeId,
    vendorId: configInput.provider,
  });
  await updateAgentConfig(bindings.DB, viewer, configInput);

  return {
    message: "Agent config applied.",
    status: "applied",
    toolId: input.toolId,
  };
}

async function createAgentFromDraft(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  const editable = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  if (editable.agent.status !== "draft") {
    return {
      message: "Create Agent is only available while this Agent is still a draft.",
      status: "noop",
      toolId: input.toolId,
    };
  }

  return applyAgentConfig(bindings, viewer, input);
}

async function resetPreviewSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  const editable = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);
  const previewSessions = await listAgentBuilderPreviewSessions(bindings.DB, {
    agent: {
      id: editable.agent.id,
      organizationId: editable.agent.organizationId,
    },
    viewerId: viewer.id,
  });
  const latestPreviewSession = previewSessions[0] ?? null;

  if (latestPreviewSession === null) {
    return {
      message: "No preview Session exists for this Agent.",
      status: "noop",
      toolId: input.toolId,
    };
  }

  for (const previewSession of previewSessions) {
    await deleteAgentSession({
      authorization: "admitted",
      bindings,
      sessionId: previewSession.id,
      viewer,
    });
  }

  return {
    message: "Preview Sessions reset.",
    sessionId: latestPreviewSession.id,
    status: "applied",
    toolId: input.toolId,
  };
}

async function openPreview(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  await markAgentBuilderPreviewOpened(bindings.DB, viewer, input.agentId);

  return {
    message: "Preview opened.",
    status: "applied",
    toolId: input.toolId,
  };
}

async function executeCreateEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  return {
    message: "Open the secure Environment creation UI.",
    secureUi: { kind: "create_environment" },
    status: "needs_secure_ui",
    toolId: input.toolId,
  };
}

async function executeCreateRemoteMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  return {
    message: "Open the secure MCP server creation UI.",
    secureUi: { kind: "create_remote_mcp_server" },
    status: "needs_secure_ui",
    toolId: input.toolId,
  };
}

export async function executeAgentBuilderControlPlaneAction(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  switch (input.toolId) {
    case "apply_agent_config":
      return applyAgentConfig(bindings, viewer, input);
    case "create_agent":
      return createAgentFromDraft(bindings, viewer, input);
    case "open_preview":
      return openPreview(bindings, viewer, input);
    case "create_environment":
      return executeCreateEnvironment(bindings, viewer, input);
    case "create_remote_mcp_server":
      return executeCreateRemoteMcpServer(bindings, viewer, input);
    case "reset_preview_session":
      return resetPreviewSession(bindings, viewer, input);
    default:
      throw new Error(`Unsupported Agent Builder executable action: ${input.toolId}`);
  }
}
