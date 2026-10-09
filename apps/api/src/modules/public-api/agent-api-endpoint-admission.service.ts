import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import { agentsTable, projectsTable } from "@mosoo/db";
import type { AgentId, ProjectId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { assertProjectKeyAccess } from "../auth/domain/project-key-access";
import { publicAgentNotExposed, publicForbidden, publicNotFound } from "./public-api-errors";

/** Admits the Project owner to an Agent API Endpoint and returns the Agent's Project. */
export async function admitAgentApiEndpointCaller(
  database: D1Database,
  caller: AuthenticatedViewer,
  agentId: AgentId,
  apiVersion: PublicApiVersion,
): Promise<ProjectId> {
  const agent =
    (await getAppDatabase(database)
      .select({
        projectId: agentsTable.projectId,
        projectOwnerAccountId: projectsTable.ownerAccountId,
        status: agentsTable.status,
      })
      .from(agentsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, agentsTable.projectId))
      .where(eq(agentsTable.id, agentId))
      .limit(1)
      .get()) ?? null;

  if (agent === null) {
    throw publicNotFound("Agent not found.");
  }

  assertProjectKeyAccess(caller, agent.projectId);

  if (apiVersion === "v1" && agent.status !== "published") {
    throw publicAgentNotExposed("This Agent is not exposed as an active API endpoint.");
  }

  if (agent.projectOwnerAccountId !== caller.id) {
    throw publicForbidden("Caller is not the Project owner for this Agent.");
  }

  return agent.projectId;
}
