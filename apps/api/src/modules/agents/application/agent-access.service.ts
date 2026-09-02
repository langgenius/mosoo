import type { AgentOwnerSummary } from "@mosoo/contracts/agent";
import type { AccountId, AgentId, ProjectId } from "@mosoo/id";

import { forbiddenError } from "../../../platform/errors";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { getAgentRow, getProjectAgentRow, listAgentOwnerSummaries } from "./agent-repository";
import type { AgentRow } from "./agent-types";

interface AgentPrivilegedAccess {
  agent: AgentRow;
  viewerRole: "owner";
}

interface ProjectAgentOwnerAccess {
  agent: AgentRow;
  owner: AgentOwnerSummary;
  viewerRole: "owner";
}

async function readAgentOwnerSummary(
  database: D1Database,
  agent: AgentRow,
): Promise<AgentOwnerSummary> {
  const owners = await listAgentOwnerSummaries(database, [agent.ownerId]);
  return (
    owners.get(agent.ownerId) ?? {
      id: agent.ownerId,
      imageUrl: null,
      name: null,
    }
  );
}

async function ensureOwnedAgentRow(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentRow> {
  const agent = await getAgentRow(database, agentId);
  await ensureProjectOwnership(database, viewerId, agent.projectId);

  if (agent.ownerId !== viewerId) {
    throw forbiddenError();
  }

  return agent;
}

export async function ensureProjectAgentOwner(
  database: D1Database,
  viewerId: AccountId,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<ProjectAgentOwnerAccess> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const agent = await getProjectAgentRow(database, input);

  if (agent === null || agent.ownerId !== viewerId) {
    throw forbiddenError();
  }

  return {
    agent,
    owner: await readAgentOwnerSummary(database, agent),
    viewerRole: "owner",
  };
}

export async function ensureAgentEditor(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentPrivilegedAccess> {
  return {
    agent: await ensureOwnedAgentRow(database, viewerId, agentId),
    viewerRole: "owner",
  };
}

export async function ensureAgentOwner(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentRow> {
  return ensureOwnedAgentRow(database, viewerId, agentId);
}
