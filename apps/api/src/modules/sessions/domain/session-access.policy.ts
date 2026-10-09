import type { SessionStatus } from "@mosoo/contracts/session";
import { projectsTable, sessionsTable } from "@mosoo/db";
import type { AccountId, AgentDeploymentVersionId, AgentId, ProjectId, SessionId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { enforceSessionCanAcceptEvents } from "./session-lifecycle";

export interface ProjectSessionRow {
  agent_id: AgentId | null;
  archived_at: number | null;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  id: SessionId;
  model: string;
  project_id: ProjectId;
  provider: string;
  runtime_id: string;
  status: SessionStatus;
  updated_at: number;
}

/** Project access is single-owner: a viewer may act on a Session only through the Project it owns. */
export async function findProjectSession(
  database: D1Database,
  viewerId: AccountId,
  input: { projectId?: ProjectId; sessionId: SessionId },
): Promise<ProjectSessionRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        archived_at: sessionsTable.archivedAt,
        deployment_version_id: sessionsTable.deploymentVersionId,
        deployment_version_number: sessionsTable.deploymentVersionNumber,
        id: sessionsTable.id,
        model: sessionsTable.model,
        project_id: sessionsTable.projectId,
        provider: sessionsTable.provider,
        runtime_id: sessionsTable.runtimeId,
        status: sessionsTable.status,
        updated_at: sessionsTable.updatedAt,
      })
      .from(sessionsTable)
      .innerJoin(projectsTable, eq(projectsTable.id, sessionsTable.projectId))
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          input.projectId === undefined ? undefined : eq(sessionsTable.projectId, input.projectId),
          eq(projectsTable.ownerAccountId, viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function requireProjectSession(
  database: D1Database,
  viewerId: AccountId,
  input: { projectId: ProjectId; sessionId: SessionId },
): Promise<ProjectSessionRow> {
  const session = await findProjectSession(database, viewerId, input);

  if (session === null) {
    throw forbiddenError();
  }

  return session;
}

export async function requireActiveProjectSession(
  database: D1Database,
  viewerId: AccountId,
  input: { projectId: ProjectId; sessionId: SessionId },
): Promise<ProjectSessionRow> {
  const session = await requireProjectSession(database, viewerId, input);

  enforceSessionCanAcceptEvents({
    archivedAt: session.archived_at,
    status: session.status,
  });

  return session;
}
