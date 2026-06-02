import type { SessionStatus, SessionType } from "@mosoo/contracts/session";
import { organizationMembersTable, sessionsTable } from "@mosoo/db";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  OrganizationId,
  SessionId,
} from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, eq, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { enforceSessionCanAcceptEvents } from "./session-lifecycle";

export interface SessionCallerAccessRow {
  agent_id: AgentId;
  archived_at: number | null;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  id: SessionId;
  model: string;
  provider: string;
  runtime_id: string;
  status: SessionStatus;
  title: string | null;
  organization_id: OrganizationId;
}

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
  organization_id: OrganizationId;
  status: SessionStatus;
  type: SessionType;
}

export interface SessionMutationAuditAccessRow {
  agent_id: AgentId;
  id: SessionId;
  organization_id: OrganizationId;
  title: string | null;
}

export interface SessionMutationCapabilityAccessRow extends SessionMutationAuditAccessRow {
  archived_at: number | null;
  is_session_creator: number;
  runtime_id: string;
  status: SessionStatus;
}

export interface SessionQueueAccessRow {
  agent_id: AgentId;
  deployment_version_id: AgentDeploymentVersionId | null;
  deployment_version_number: number | null;
  id: SessionId;
  model: string;
  organization_id: OrganizationId;
  provider: string;
  runtime_id: string;
}

export type SessionActionAuthorization = "admitted" | "viewer";

export function resolveSessionActionCreatorFlag(input: {
  authorization?: SessionActionAuthorization | undefined;
  isSessionCreator: boolean;
}): boolean {
  return input.authorization === "admitted" || input.isSessionCreator;
}

function activeSessionMembershipCondition(viewerId: AccountId): SQL {
  return sql`EXISTS (
    SELECT 1
      FROM ${organizationMembersTable}
     WHERE ${organizationMembersTable.organizationId} = ${sessionsTable.organizationId}
       AND ${organizationMembersTable.accountId} = ${viewerId}
       AND ${organizationMembersTable.disabledAt} IS NULL
  )`;
}

function humanSessionCreatorCondition(viewerId: AccountId): SQL {
  return and(
    eq(sessionsTable.creatorAccountId, viewerId),
    sql`COALESCE(json_extract(${sessionsTable.metadataJson}, '$.public_api.created_by.kind'), 'human_pat') <> 'service_token'`,
  )!;
}

export function sessionCreatorCondition(viewerId: AccountId): SQL {
  return and(humanSessionCreatorCondition(viewerId), activeSessionMembershipCondition(viewerId))!;
}

export function sessionParticipantCondition(viewerId: AccountId): SQL {
  return and(
    or(humanSessionCreatorCondition(viewerId), eq(sessionsTable.attributedUserId, viewerId)),
    activeSessionMembershipCondition(viewerId),
  )!;
}

export function sessionCreatorFlag(viewerId: AccountId): SQL<number> {
  return sql<number>`CASE WHEN ${sessionCreatorCondition(viewerId)} THEN 1 ELSE 0 END`;
}

export function sessionParticipantFlag(viewerId: AccountId): SQL<number> {
  return sql<number>`CASE WHEN ${sessionParticipantCondition(viewerId)} THEN 1 ELSE 0 END`;
}

export async function getSessionCallerAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionCallerAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        archived_at: sessionsTable.archivedAt,
        deployment_version_id: sessionsTable.deploymentVersionId,
        deployment_version_number: sessionsTable.deploymentVersionNumber,
        id: sessionsTable.id,
        model: sessionsTable.model,
        organization_id: sessionsTable.organizationId,
        provider: sessionsTable.provider,
        runtime_id: sessionsTable.runtimeId,
        status: sessionsTable.status,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return row;
}

export async function ensureSessionParticipantAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }
}

export async function getSessionParticipantTimelineAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionParticipantTimelineAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        id: sessionsTable.id,
        updated_at: sessionsTable.updatedAt,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return row;
}

export async function getSessionParticipantCapabilityAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionParticipantCapabilityAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        archived_at: sessionsTable.archivedAt,
        is_session_creator: sessionCreatorFlag(viewerId).as("is_session_creator"),
        runtime_id: sessionsTable.runtimeId,
        status: sessionsTable.status,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return row;
}

export async function getSessionMutationCapabilityAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionMutationCapabilityAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        archived_at: sessionsTable.archivedAt,
        id: sessionsTable.id,
        is_session_creator: sessionCreatorFlag(viewerId).as("is_session_creator"),
        organization_id: sessionsTable.organizationId,
        runtime_id: sessionsTable.runtimeId,
        status: sessionsTable.status,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return row;
}

export async function getSessionMutationAuditAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionMutationAuditAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        id: sessionsTable.id,
        organization_id: sessionsTable.organizationId,
        title: sessionsTable.title,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return row;
}

export async function ensureActiveSessionParticipantAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({
        archived_at: sessionsTable.archivedAt,
        status: sessionsTable.status,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  enforceSessionCanAcceptEvents({
    archivedAt: row.archived_at,
    status: row.status,
  });
}

export async function getActiveSessionParticipantAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<ActiveSessionParticipantAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        archived_at: sessionsTable.archivedAt,
        organization_id: sessionsTable.organizationId,
        status: sessionsTable.status,
        type: sessionsTable.type,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
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

export async function getActiveSessionQueueAccess(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionQueueAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        archived_at: sessionsTable.archivedAt,
        deployment_version_id: sessionsTable.deploymentVersionId,
        deployment_version_number: sessionsTable.deploymentVersionNumber,
        id: sessionsTable.id,
        model: sessionsTable.model,
        organization_id: sessionsTable.organizationId,
        provider: sessionsTable.provider,
        runtime_id: sessionsTable.runtimeId,
        status: sessionsTable.status,
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
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
    organization_id: row.organization_id,
    provider: row.provider,
    runtime_id: row.runtime_id,
  };
}
