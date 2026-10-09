import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import type { AgentId, ProjectId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAgentMcpBindings } from "../../mcp/application/mcp-agent-binding.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { ensureProjectAgentOwner } from "./agent-access.service";
import { toAgentDetailModel, toAgentSummaryModels } from "./agent-models";
import { computeAgentReadiness } from "./agent-readiness.service";
import { listProjectOwnerAgentRows } from "./agent-repository";
import { parseAgentStoredConfig } from "./agent-stored-config.service";

export async function getAgent(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<AgentDetail> {
  const agent = await ensureProjectAgentOwner(database, viewer.id, input);
  return toAgentDetailModel(database, viewer, agent);
}

export async function getAgentEditorState(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<AgentEditorState> {
  const agent = await ensureProjectAgentOwner(database, viewer.id, input);
  const environment = { environmentId: agent.environmentId };
  const storedConfig = parseAgentStoredConfig(agent.configJson);

  return {
    builtInTools: storedConfig.builtInTools,
    environment,
    id: agent.id,
    mcpBindings: await listAgentMcpBindings(database, viewer, agent.id),
    packageResolution: storedConfig.packageResolution,
    providerOptions: storedConfig.providerOptions,
    readiness: await computeAgentReadiness(database, {
      agentId: agent.id,
      builtInTools: storedConfig.builtInTools,
      environment,
      model: agent.model,
      packageResolution: storedConfig.packageResolution,
      projectId: agent.projectId,
      provider: agent.provider,
      runtimeId: agent.runtimeId,
    }),
  };
}

export async function listVisibleAgents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<AgentSummary[]> {
  await ensureProjectOwnership(database, viewer.id, projectId);
  const agents = await listProjectOwnerAgentRows(database, {
    projectId,
    viewerId: viewer.id,
  });

  return toAgentSummaryModels(database, viewer, agents);
}
