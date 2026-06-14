import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import type { AgentId, AppId } from "@mosoo/id";

import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAgentMcpBindings } from "../../mcp/application/mcp-agent-binding.service";
import { ensureAppAgentOwner } from "./agent-access.service";
import { loadAgentEnvironmentConfig } from "./agent-environment.service";
import { toAgentDetailModel, toAgentSummaryModels } from "./agent-models";
import { computeAgentReadiness } from "./agent-readiness.service";
import { listAppOwnerAgentRows } from "./agent-repository";
import { parseAgentStoredConfig } from "./agent-stored-config.service";

export async function getAgent(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<AgentDetail> {
  const agent = await ensureAppAgentOwner(database, viewer.id, input);
  return toAgentDetailModel(database, viewer, agent.agent, agent.owner, agent.viewerRole);
}

export async function getAgentEditorState(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<AgentEditorState> {
  const editable = await ensureAppAgentOwner(database, viewer.id, input);
  const environment = await loadAgentEnvironmentConfig(
    database,
    editable.agent.id,
    editable.agent.environmentId,
  );
  const storedConfig = parseAgentStoredConfig(editable.agent.configJson);

  return {
    builder: storedConfig.builder,
    environment,
    id: editable.agent.id,
    mcpBindings: await listAgentMcpBindings(database, viewer, editable.agent.id),
    packageResolution: storedConfig.packageResolution,
    providerOptions: storedConfig.providerOptions,
    readiness: await computeAgentReadiness(database, editable.agent.ownerId, {
      agentId: editable.agent.id,
      environment,
      model: editable.agent.model,
      organizationId: editable.agent.appOrganizationId,
      packageResolution: storedConfig.packageResolution,
      appId: editable.agent.appId,
      provider: editable.agent.provider,
      runtimeId: editable.agent.runtimeId,
    }),
  };
}

export async function listVisibleAgents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<AgentSummary[]> {
  await ensureAppOwnership(database, viewer.id, appId);
  const agents = await listAppOwnerAgentRows(database, {
    appId,
    viewerId: viewer.id,
  });

  return toAgentSummaryModels(
    database,
    agents.map((agent) => ({ agent, viewerRole: "owner" })),
  );
}
