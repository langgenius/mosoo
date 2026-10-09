import type { Agent, AgentDetail, AgentOwnerSummary, AgentSummary } from "@mosoo/contracts/agent";

import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getAgentLiveDeploymentVersionRecord,
  listAgentDeploymentVersionRecords,
  toAgentDeploymentVersionModel,
} from "./agent-deployment-version.service";
import { listAgentToolSummaries, listAgentToolSummariesByAgentIds } from "./agent-repository";
import { listResolvedAgentSkills } from "./agent-skill-resolution.service";
import type { AgentRow } from "./agent-types";

// Only an Agent's owner can read it, so the owner is always the viewer.
function toOwnerSummary(viewer: AuthenticatedViewer): AgentOwnerSummary {
  return { id: viewer.id, imageUrl: viewer.imageUrl, name: viewer.name };
}

export async function toAgentModel(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agent: AgentRow,
): Promise<Agent> {
  const liveVersion = await getAgentLiveDeploymentVersionRecord(database, agent);

  return {
    createdAt: toIsoString(agent.createdAt),
    description: agent.description,
    id: agent.id,
    liveVersion: liveVersion
      ? toAgentDeploymentVersionModel(liveVersion, agent.liveDeploymentVersionId)
      : null,
    model: agent.model,
    name: agent.name,
    projectId: agent.projectId,
    prompt: agent.prompt,
    provider: agent.provider,
    runtimeId: agent.runtimeId,
    skills: await listResolvedAgentSkills(database, viewer, agent.id),
    status: agent.status,
    updatedAt: toIsoString(agent.updatedAt),
    visibility: "private",
  };
}

export async function toAgentSummaryModels(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agents: readonly AgentRow[],
): Promise<AgentSummary[]> {
  const toolsByAgentId = await listAgentToolSummariesByAgentIds(
    database,
    agents.map((agent) => agent.id),
  );

  return agents.map((agent) => ({
    createdAt: toIsoString(agent.createdAt),
    description: agent.description,
    id: agent.id,
    name: agent.name,
    projectId: agent.projectId,
    owner: toOwnerSummary(viewer),
    runtimeId: agent.runtimeId,
    status: agent.status,
    tools: toolsByAgentId.get(agent.id) ?? [],
    updatedAt: toIsoString(agent.updatedAt),
    viewerRole: "owner",
    visibility: "private",
  }));
}

export async function toAgentDetailModel(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agent: AgentRow,
): Promise<AgentDetail> {
  const [versions, skills, tools] = await Promise.all([
    listAgentDeploymentVersionRecords(database, agent.id),
    listResolvedAgentSkills(database, viewer, agent.id),
    listAgentToolSummaries(database, agent.id),
  ]);
  const liveVersion =
    versions.find((version) => version.id === agent.liveDeploymentVersionId) ?? null;

  return {
    createdAt: toIsoString(agent.createdAt),
    description: agent.description,
    id: agent.id,
    liveVersion: liveVersion
      ? toAgentDeploymentVersionModel(liveVersion, agent.liveDeploymentVersionId)
      : null,
    model: agent.model,
    name: agent.name,
    projectId: agent.projectId,
    owner: toOwnerSummary(viewer),
    prompt: agent.prompt,
    provider: agent.provider,
    runtimeId: agent.runtimeId,
    skills,
    status: agent.status,
    tools,
    updatedAt: toIsoString(agent.updatedAt),
    versions: versions.map((version) =>
      toAgentDeploymentVersionModel(version, agent.liveDeploymentVersionId),
    ),
    viewerRole: "owner",
    visibility: "private",
  };
}
