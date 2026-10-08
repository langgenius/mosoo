import { sandboxSessionsTable, sandboxesTable, sessionsTable } from "@mosoo/db";
import type { AccountId, ProjectId, RuntimeOperationId, SandboxId, SessionId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, createApiError, forbiddenError } from "../../../platform/errors";
import type { RuntimeSessionTarget } from "./runtime-state-operation-target-store";

export interface RuntimeOperationSubject {
  readonly runtimeSubjectId: SandboxId;
  readonly targets: readonly RuntimeSessionTarget[];
}

export interface RuntimeOperationScope {
  readonly subjects: RuntimeOperationSubject[];
  readonly targets: RuntimeSessionTarget[];
}

export interface SessionRuntimeOperationTarget {
  readonly executionOwnerUserId: AccountId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
}

export async function resolveSessionRuntimeOperationScope(
  database: D1Database,
  input: SessionRuntimeOperationTarget & { readonly expectedOperationId?: RuntimeOperationId },
): Promise<RuntimeOperationScope> {
  const row = await getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      archivedAt: sessionsTable.archivedAt,
      creatorAccountId: sessionsTable.creatorAccountId,
      lastRunId: sessionsTable.lastRunId,
      runtimeSubjectId: sandboxesTable.id,
      sandboxId: sandboxSessionsTable.sandboxId,
      sandboxProjectId: sandboxesTable.projectId,
      sandboxOwnerId: sandboxesTable.ownerAccountId,
      subjectId: sandboxesTable.subjectId,
      subjectKind: sandboxesTable.subjectKind,
      sessionId: sessionsTable.id,
      sessionStatusOperationId: sessionsTable.statusOperationId,
      sessionStatusSeq: sessionsTable.statusSeq,
      sessionStatus: sessionsTable.status,
      peerCount: sql<number>`(SELECT COUNT(*) FROM sandbox_session AS peer WHERE peer.sandbox_id = ${sandboxSessionsTable.sandboxId})`,
    })
    .from(sessionsTable)
    .leftJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .leftJoin(sandboxesTable, eq(sandboxesTable.id, sandboxSessionsTable.sandboxId))
    .where(and(eq(sessionsTable.id, input.sessionId), eq(sessionsTable.projectId, input.projectId)))
    .get();

  if (!row) throw forbiddenError();
  const expectedStatus = input.expectedOperationId === undefined ? null : "RESCHEDULING";
  if (
    row.archivedAt !== null ||
    row.sessionStatus === "TERMINATED" ||
    row.sessionStatusOperationId !== (input.expectedOperationId ?? null) ||
    (expectedStatus === null
      ? row.sessionStatus !== "IDLE" && row.sessionStatus !== "RUNNING"
      : row.sessionStatus !== expectedStatus)
  ) {
    throw createApiError(
      API_ERROR_CODE.sessionRuntimeOperationUnavailable,
      "Session is archived, stopped, or already undergoing maintenance.",
    );
  }
  if (row.sandboxId === null) {
    if (row.sessionStatus !== "IDLE") {
      throw createApiError(
        API_ERROR_CODE.sessionRuntimeOperationUnavailable,
        "Session has no admitted execution resource to maintain.",
      );
    }
    return { subjects: [], targets: [] };
  }
  if (
    row.runtimeSubjectId === null ||
    row.subjectKind !== "session" ||
    row.subjectId !== input.sessionId ||
    row.sandboxProjectId !== input.projectId ||
    row.sandboxOwnerId !== input.executionOwnerUserId ||
    row.peerCount !== 1
  ) {
    throw createApiError(
      API_ERROR_CODE.sessionRuntimeOperationUnavailable,
      "Session does not have a verified exclusive execution resource.",
    );
  }
  const target: RuntimeSessionTarget = {
    agentId: row.agentId,
    creatorAccountId: row.creatorAccountId,
    lastRunId: row.lastRunId,
    sandboxId: row.sandboxId,
    sessionId: row.sessionId,
    sessionStatusOperationId: row.sessionStatusOperationId,
    sessionStatusSeq: row.sessionStatusSeq,
    sessionStatus: row.sessionStatus,
  };
  return { subjects: [{ runtimeSubjectId: row.runtimeSubjectId, targets: [] }], targets: [target] };
}
