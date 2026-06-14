import type { AgentId } from "@mosoo/id";

import { isApiError } from "../../platform/errors";
import { isTruthy } from "../../shared/truthiness";
import { getAgentRow } from "../agents/application/agent-repository";
import type { AgentRow } from "../agents/application/agent-types";
import { ensureAppOwnership } from "../apps/application/app.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  publicAgentNotExposed,
  publicForbidden,
  publicNotFound,
  publicServiceInactive,
} from "./public-api-errors";
export async function admitAgentApiEndpointCaller(
  database: D1Database,
  caller: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentRow> {
  const agent = await getAgentRow(database, agentId).catch((error: unknown) => {
    if (isApiError(error) && error.status === 404) {
      throw publicNotFound("Agent not found.");
    }

    throw error;
  });

  await ensureAgentApiEndpointCallerAccess(database, caller, agent);

  return agent;
}

export async function ensureAgentApiEndpointCallerAccess(
  database: D1Database,
  caller: AuthenticatedViewer,
  agent: AgentRow,
): Promise<void> {
  ensureAgentApiEndpointReady(agent);
  await ensureCallerOwnsAgentApp(database, caller, agent);
}

function ensureAgentApiEndpointReady(agent: AgentRow): void {
  if (agent.status !== "published") {
    throw publicAgentNotExposed("This Agent is not exposed as an active API endpoint.");
  }

  if (!isTruthy(agent.liveDeploymentVersionId)) {
    throw publicServiceInactive("This Agent does not have a live API endpoint version.");
  }
}

async function ensureCallerOwnsAgentApp(
  database: D1Database,
  caller: AuthenticatedViewer,
  agent: AgentRow,
): Promise<void> {
  const app = await ensureAppOwnership(database, caller.id, agent.appId).catch((error: unknown) => {
    if (isApiError(error) && error.status === 404) {
      throw publicNotFound("Agent not found.");
    }

    if (isApiError(error) && error.status === 403) {
      throw publicForbidden("Caller is not the App owner for this Agent.");
    }

    throw error;
  });

  if (agent.ownerId !== app.ownerAccountId) {
    throw publicForbidden("Agent owner does not match the App owner.");
  }
}
