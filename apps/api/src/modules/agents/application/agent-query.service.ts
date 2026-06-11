import type {
  AgentDetail,
  AgentEditorState,
  AgentSummary,
  AgentViewerRole,
} from "@mosoo/contracts/agent";
import { Permission, can } from "@mosoo/contracts/permission";
import type { AgentId, OrganizationId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAgentMcpBindings } from "../../mcp/application/mcp-agent-binding.service";
import { ensureOrganizationMembership } from "../../organizations/domain/organization-access.policy";
import {
  canReadAgent,
  ensureAgentEditor,
  ensureAgentReadable,
  resolveAgentViewerRole,
} from "./agent-access.service";
import { listAgentCollaborators } from "./agent-collaborator.service";
import { loadAgentEnvironmentConfig } from "./agent-environment.service";
import { toAgentDetailModel, toAgentSummaryModels } from "./agent-models";
import { computeAgentReadiness } from "./agent-readiness.service";
import { listVisibleAgentAccessRowsForOrganization } from "./agent-repository";
import { parseAgentStoredConfig } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";

export async function getAgent(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentDetail> {
  const agent = await ensureAgentReadable(database, viewer.id, agentId);
  return toAgentDetailModel(database, viewer, agent.agent, agent.owner, agent.viewerRole);
}

export async function getAgentEditorState(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentEditorState> {
  const editable = await ensureAgentEditor(database, viewer.id, agentId);
  const environment = await loadAgentEnvironmentConfig(
    database,
    editable.agent.id,
    editable.agent.environmentId,
  );
  const storedConfig = parseAgentStoredConfig(editable.agent.configJson);

  return {
    builder: storedConfig.builder,
    collaborators: await listAgentCollaborators(database, viewer, agentId),
    environment,
    id: editable.agent.id,
    mcpBindings: await listAgentMcpBindings(database, viewer, editable.agent.id),
    packageResolution: storedConfig.packageResolution,
    providerOptions: storedConfig.providerOptions,
    readiness: await computeAgentReadiness(database, editable.agent.ownerId, {
      agentId: editable.agent.id,
      environment,
      model: editable.agent.model,
      organizationId: editable.agent.organizationId,
      packageResolution: storedConfig.packageResolution,
      provider: editable.agent.provider,
      runtimeId: editable.agent.runtimeId,
    }),
  };
}

export async function listVisibleAgents(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<AgentSummary[]> {
  const membership = await ensureOrganizationMembership(database, viewer.id, organizationId);
  const includeAllAgents = can(membership.role, Permission.AgentsListAll);
  const agentAccessRows = await listVisibleAgentAccessRowsForOrganization(database, {
    includeAllAgents,
    organizationId,
    viewerId: viewer.id,
  });
  const summaryInputs: {
    agent: AgentRow;
    viewerRole: AgentViewerRole;
  }[] = [];

  for (const accessRow of agentAccessRows) {
    const viewerRole = resolveAgentViewerRole(
      accessRow.agent,
      viewer.id,
      accessRow.viewerAclRoleRank,
      membership.role,
    );

    if (
      viewerRole === "none" ||
      !canReadAgent(accessRow.agent, viewerRole) ||
      (!includeAllAgents && viewerRole !== "owner" && accessRow.hasPersonalMcpBindings)
    ) {
      continue;
    }

    summaryInputs.push({ agent: accessRow.agent, viewerRole });
  }

  return toAgentSummaryModels(database, summaryInputs);
}
