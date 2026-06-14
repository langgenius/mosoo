import type {
  AgentBuilderCreateEnvironmentActionPayload,
  AgentBuilderCreateRemoteMcpServerActionPayload,
  AgentBuilderExecutableActionToolId,
  AgentBuilderSecureUiAction,
} from "@mosoo/contracts/agent-builder";
import type { McpAuthType } from "@mosoo/contracts/mcp";
import type { AgentId, EnvironmentId, McpServerId, AppId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureAppAgentOwner } from "../../agents/application/agent-access.service";
import { updateAgentConfig } from "../../agents/application/agent-command.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createEnvironment } from "../../environments/application/environment.service";
import { createAppMcpServer } from "../../mcp/application/mcp-server.service";
import { deleteAgentSession } from "../../sessions/application/session-lifecycle-mutation.service";
import { ensureModelAvailableForSelection } from "../../vendor-credentials/application/vendor-credential.service";
import { toAgentBuilderUpdateAgentConfigInput } from "./agent-builder-lightweight-manifest-projections";
import { listAgentBuilderPreviewSessions } from "./agent-builder-preview-session.service";
import { markAgentBuilderPreviewOpened } from "./agent-builder-thread.service";

export type AgentBuilderControlPlaneActionStatus = "applied" | "needs_secure_ui" | "noop";

export interface ExecuteAgentBuilderControlPlaneActionInput {
  readonly agentId: AgentId;
  readonly createEnvironmentPayload?: AgentBuilderCreateEnvironmentActionPayload | null;
  readonly createRemoteMcpServerPayload?: AgentBuilderCreateRemoteMcpServerActionPayload | null;
  readonly draftYaml?: string;
  readonly appId: AppId;
  readonly toolId: AgentBuilderExecutableActionToolId;
}

export interface AgentBuilderCreatedEnvironmentSummary {
  readonly id: EnvironmentId;
  readonly name: string;
}

export interface AgentBuilderCreatedMcpServerSummary {
  readonly authType: McpAuthType;
  readonly id: McpServerId;
  readonly name: string;
  readonly url: string;
}

export interface AgentBuilderControlPlaneActionResult {
  readonly createdEnvironment?: AgentBuilderCreatedEnvironmentSummary;
  readonly createdMcpServer?: AgentBuilderCreatedMcpServerSummary;
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
  const editable = await ensureAppAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    appId: input.appId,
  });
  const configInput = toAgentBuilderUpdateAgentConfigInput(
    editable.agent.appId,
    input.agentId,
    requireDraftYaml(input),
  );

  await ensureModelAvailableForSelection(bindings.DB, {
    modelId: configInput.model,
    appId: editable.agent.appId,
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
  const editable = await ensureAppAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    appId: input.appId,
  });

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
  const editable = await ensureAppAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    appId: input.appId,
  });
  const previewSessions = await listAgentBuilderPreviewSessions(bindings.DB, {
    agent: {
      appId: editable.agent.appId,
      id: editable.agent.id,
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
      appId: editable.agent.appId,
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
  const editable = await ensureAppAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    appId: input.appId,
  });
  const payload = input.createEnvironmentPayload ?? null;

  if (payload === null) {
    return {
      message: "Open the secure Environment creation UI.",
      secureUi: { kind: "create_environment" },
      status: "needs_secure_ui",
      toolId: input.toolId,
    };
  }

  // Secret values and executable content never travel through this path: the
  // Builder payload carries metadata only. Env vars and the setup script are
  // added later by the user in the Environment UI.
  const created = await createEnvironment(bindings, viewer, {
    allowMcpServers: true,
    allowPackageManagers: true,
    allowedHosts: [],
    description: payload.description ?? null,
    envVars: [],
    name: payload.name,
    networkPolicy: "full",
    packages: [],
    appId: editable.agent.appId,
    setupScript: "",
  });

  return {
    createdEnvironment: { id: created.id, name: created.name },
    message: `Environment "${created.name}" created.`,
    status: "applied",
    toolId: input.toolId,
  };
}

async function executeCreateRemoteMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ExecuteAgentBuilderControlPlaneActionInput,
): Promise<AgentBuilderControlPlaneActionResult> {
  const editable = await ensureAppAgentOwner(bindings.DB, viewer.id, {
    agentId: input.agentId,
    appId: input.appId,
  });
  const payload = input.createRemoteMcpServerPayload ?? null;

  if (payload === null) {
    return {
      message: "Open the secure MCP server creation UI.",
      secureUi: { kind: "create_remote_mcp_server" },
      status: "needs_secure_ui",
      toolId: input.toolId,
    };
  }

  try {
    const server = await createAppMcpServer(bindings, viewer, {
      authType: payload.authType,
      description: payload.description ?? null,
      name: payload.name,
      appId: editable.agent.appId,
      url: payload.url,
    });

    // The server record exists, but its credential (bearer token or OAuth
    // grant) must be connected by the user in the secure UI.
    return {
      createdMcpServer: {
        authType: server.authType,
        id: server.id,
        name: server.name,
        url: server.url,
      },
      message: `MCP server "${server.name}" created. Connect its credential to authorize it.`,
      secureUi: { kind: "connect_mcp_credential", mcpServerId: server.id },
      status: "applied",
      toolId: input.toolId,
    };
  } catch (error) {
    return {
      message: `Could not create the MCP server: ${error instanceof Error ? error.message : "unknown error"}`,
      status: "noop",
      toolId: input.toolId,
    };
  }
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
      const exhaustiveToolId: never = input.toolId;
      throw new Error(`Unsupported Agent Builder executable action: ${String(exhaustiveToolId)}`);
  }
}
