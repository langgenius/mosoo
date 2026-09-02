import type { SessionStatus, SessionType } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { AccountId, AgentDeploymentVersionId, AgentId, ProjectId, SessionId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, eq, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { enforceSessionCanAcceptEvents } from "./session-lifecycle";

export interface SessionParticipantTimelineAccessRow {
  id: SessionId;
  updated_at: number;
}

export interface SessionParticipantCapabilityAccessRow {
  archived_at: number | null;
  is_session_creator: number;
  runtime_id: string;
  status: SessionStatus;
}

export interface ActiveSessionParticipantAccessRow {
  archived_at: number | null;
  project_id: ProjectId;
  status: SessionStatus;
  type: SessionType;
}

export interface SessionQueueAccessRow {
  agent_id: AgentId;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  id: SessionId;
  model: string;
  project_id: ProjectId;
  provider: string;
  runtime_id: string;
}

export type SessionActionAuthorization = "admitted";

export function resolveSessionActionCreatorFlag(input: {
  authorization?: SessionActionAuthorization | undefined;
  isSessionCreator: boolean;
}): boolean {
  return input.authorization === "admitted" || input.isSessionCreator;
}

function humanSessionCreatorCondition(viewerId: AccountId): SQL {
  return eq(sessionsTable.creatorAccountId, viewerId);
}

export function sessionCreatorCondition(viewerId: AccountId): SQL {
  return humanSessionCreatorCondition(viewerId);
}

export function sessionParticipantCondition(viewerId: AccountId): SQL {
  return or(
    humanSessionCreatorCondition(viewerId),
    eq(sessionsTable.participantAccountId, viewerId),
  )!;
}

export function sessionCreatorFlag(viewerId: AccountId): SQL<number> {
  return sql<number>`CASE WHEN ${sessionCreatorCondition(viewerId)} THEN 1 ELSE 0 END`;
}

export function sessionParticipantFlag(viewerId: AccountId): SQL<number> {
  return sql<number>`CASE WHEN ${sessionParticipantCondition(viewerId)} THEN 1 ELSE 0 END`;
}

export async function ensureProjectSessionParticipantAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<void> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const row =
    (await getAppDatabase(database)
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }
}

export async function getProjectSessionParticipantTimelineAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionParticipantTimelineAccessRow> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const row =
    (await getAppDatabase(database)
      .select({
        id: sessionsTable.id,
        updated_at: sessionsTable.updatedAt,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return row;
}

export type ProjectSessionParticipantCapabilityAccessLookup =
  | { kind: "found"; row: SessionParticipantCapabilityAccessRow }
  | { kind: "missing" }
  | { kind: "not_participant" };

export async function lookupProjectSessionParticipantCapabilityAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<ProjectSessionParticipantCapabilityAccessLookup> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const row =
    (await getAppDatabase(database)
      .select({
        archived_at: sessionsTable.archivedAt,
        is_participant: sessionParticipantFlag(viewerId).as("is_participant"),
        is_session_creator: sessionCreatorFlag(viewerId).as("is_session_creator"),
        runtime_id: sessionsTable.runtimeId,
        status: sessionsTable.status,
      })
      .from(sessionsTable)
      .where(
        and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.projectId, input.projectId)),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return { kind: "missing" };
  }

  if (row.is_participant !== 1) {
    return { kind: "not_participant" };
  }

  return {
    kind: "found",
    row: {
      archived_at: row.archived_at,
      is_session_creator: row.is_session_creator,
      runtime_id: row.runtime_id,
      status: row.status,
    },
  };
}

export async function getProjectSessionParticipantCapabilityAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionParticipantCapabilityAccessRow> {
  const lookup = await lookupProjectSessionParticipantCapabilityAccess(database, viewerId, input);

  if (lookup.kind !== "found") {
    throw forbiddenError();
  }

  return lookup.row;
}

export async function getActiveProjectSessionParticipantAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<ActiveSessionParticipantAccessRow> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const row =
    (await getAppDatabase(database)
      .select({
        archived_at: sessionsTable.archivedAt,
        project_id: sessionsTable.projectId,
        status: sessionsTable.status,
        type: sessionsTable.type,
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  enforceSessionCanAcceptEvents({
    archivedAt: row.archived_at,
    status: row.status,
  });

  return row;
}

export async function getActiveProjectSessionQueueAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionQueueAccessRow> {
  await ensureProjectOwnership(database, viewerId, input.projectId);
  const row =
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
      })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, input.sessionId),
          eq(sessionsTable.projectId, input.projectId),
          sessionParticipantCondition(viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  enforceSessionCanAcceptEvents({
    archivedAt: row.archived_at,
    status: row.status,
  });

  return {
    agent_id: row.agent_id,
    deployment_version_id: row.deployment_version_id,
    deployment_version_number: row.deployment_version_number,
    id: row.id,
    model: row.model,
    project_id: row.project_id,
    provider: row.provider,
    runtime_id: row.runtime_id,
  };
}
