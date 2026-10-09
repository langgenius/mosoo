import type { AccountId, AgentId, ProjectId } from "@mosoo/id";

import { forbiddenError } from "../../../platform/errors";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { getAgentRow, getProjectAgentRow } from "./agent-repository";
import type { AgentRow } from "./agent-types";

export async function ensureProjectAgentOwner(
  database: D1Database,
  viewerId: AccountId,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<AgentRow> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const agent = await getProjectAgentRow(database, input);

  if (agent === null || agent.ownerId !== viewerId) {
    throw forbiddenError();
  }

  return agent;
}

export async function ensureAgentEditor(
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
