import type { AgentOwnerSummary } from "@mosoo/contracts/agent";
import type { AccountId, AgentId, AppId } from "@mosoo/id";

import { forbiddenError } from "../../../platform/errors";
import { ensureAppOwnership } from "../../apps/application/app.service";
import { getAgentRow, getAppAgentRow, listAgentOwnerSummaries } from "./agent-repository";
import type { AgentRow } from "./agent-types";

interface AgentPrivilegedAccess {
  agent: AgentRow;
  viewerRole: "owner";
}

interface AppAgentOwnerAccess {
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
  await ensureAppOwnership(database, viewerId, agent.appId);

  if (agent.ownerId !== viewerId) {
    throw forbiddenError();
  }

  return agent;
}

export async function ensureAppAgentOwner(
  database: D1Database,
  viewerId: AccountId,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<AppAgentOwnerAccess> {
  await ensureAppOwnership(database, viewerId, input.appId);
  const agent = await getAppAgentRow(database, input);

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

export async function ensureAgentDestructiveAccess(
  database: D1Database,
  viewerId: AccountId,
  agentId: AgentId,
): Promise<AgentPrivilegedAccess> {
  return ensureAgentEditor(database, viewerId, agentId);
}
