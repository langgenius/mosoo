import type { AgentDetail, AgentEditorState, AgentSummary } from "@mosoo/contracts/agent";
import type { AgentId, ProjectId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAgentMcpBindings } from "../../mcp/application/mcp-agent-binding.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { ensureProjectAgentOwner } from "./agent-access.service";
import { loadAgentEnvironmentConfig } from "./agent-environment.service";
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
  return toAgentDetailModel(database, viewer, agent.agent, agent.owner, agent.viewerRole);
}

export async function getAgentEditorState(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<AgentEditorState> {
  const editable = await ensureProjectAgentOwner(database, viewer.id, input);
  const environment = await loadAgentEnvironmentConfig(
    database,
    editable.agent.id,
    editable.agent.environmentId,
  );
  const storedConfig = parseAgentStoredConfig(editable.agent.configJson);

  return {
    builtInTools: storedConfig.builtInTools,
    environment,
    id: editable.agent.id,
    mcpBindings: await listAgentMcpBindings(database, viewer, editable.agent.id),
    packageResolution: storedConfig.packageResolution,
    providerOptions: storedConfig.providerOptions,
    readiness: await computeAgentReadiness(database, editable.agent.ownerId, {
      agentId: editable.agent.id,
      environment,
      kind: editable.agent.kind,
      model: editable.agent.model,
      packageResolution: storedConfig.packageResolution,
      projectId: editable.agent.projectId,
      provider: editable.agent.provider,
      runtimeId: editable.agent.runtimeId,
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

  return toAgentSummaryModels(
    database,
    agents.map((agent) => ({ agent, viewerRole: "owner" })),
  );
}
