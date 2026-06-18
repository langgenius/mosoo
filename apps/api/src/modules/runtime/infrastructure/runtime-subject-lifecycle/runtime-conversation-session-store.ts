import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";
import { sandboxesTable, sandboxSessionsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";

import { getAppDatabase, runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import { toRuntimeSubjectStatusLifecycleEventName } from "../../domain/runtime-subject-lifecycle.machine";
import {
  activeConversationSessionQuery,
  mapReadyRuntimeSubjectBackup,
  readyConversationBackupTable,
  runLeaseQuery,
} from "./runtime-subject-store-queries";
import type {
  RuntimeConversationSessionRecord,
  RuntimeConversationSessionState,
} from "./runtime-subject-store.types";

export async function getRuntimeConversationSession(
  database: D1Database,
  sessionId: SessionId,
): Promise<RuntimeConversationSessionRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        sandboxSessionId: sandboxSessionsTable.sandboxSessionId,
        cwd: sandboxSessionsTable.cwd,
        latestReadyBackupDir: readyConversationBackupTable.dir,
        latestReadyBackupId: readyConversationBackupTable.id,
        originJson: sandboxSessionsTable.originJson,
        sandboxId: sandboxSessionsTable.sandboxId,
        status: sandboxSessionsTable.status,
      })
      .from(sandboxSessionsTable)
      .leftJoin(
        readyConversationBackupTable,
        and(
          eq(readyConversationBackupTable.sandboxId, sandboxSessionsTable.sandboxId),
          eq(readyConversationBackupTable.dir, sandboxSessionsTable.cwd),
          eq(readyConversationBackupTable.status, "ready"),
        ),
      )
      .where(eq(sandboxSessionsTable.sessionId, sessionId))
      .orderBy(desc(readyConversationBackupTable.createdAt))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    sandboxSessionId: row.sandboxSessionId,
    cwd: row.cwd,
    latestReadyBackup: mapReadyRuntimeSubjectBackup({
      dir: row.latestReadyBackupDir,
      id: row.latestReadyBackupId,
    }),
    originJson: row.originJson,
    sandboxId: row.sandboxId,
    status: row.status,
  };
}

export async function getRuntimeConversationSessionState(
  database: D1Database,
  input: {
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeConversationSessionState | null> {
  return (
    (await getAppDatabase(database)
      .select({
        agentId: sessionsTable.agentId,
        sandboxSessionId: sandboxSessionsTable.sandboxSessionId,
        kind: sandboxesTable.kind,
        status: sandboxSessionsTable.status,
      })
      .from(sandboxSessionsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
      .innerJoin(sandboxesTable, eq(sandboxesTable.id, sandboxSessionsTable.sandboxId))
      .where(
        and(
          eq(sandboxSessionsTable.sessionId, input.sessionId),
          eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function ensureRuntimeConversationSessionRecord(
  database: D1Database,
  input: {
    readonly cwd: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeConversationSessionRecord> {
  const existing = await getRuntimeConversationSession(database, input.sessionId);

  if (existing !== null) {
    if (existing.sandboxId !== input.runtimeSubjectId) {
      throw new Error("Sandbox session is already bound to a different sandbox.");
    }

    return existing;
  }

  await getAppDatabase(database)
    .insert(sandboxSessionsTable)
    .values({
      sandboxSessionId: createPlatformId<SandboxSessionId>(input.now),
      createdAt: input.now,
      cwd: input.cwd,
      originJson: input.originJson,
      sandboxId: input.runtimeSubjectId,
      sessionId: input.sessionId,
      status: "closed",
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: sandboxSessionsTable.sessionId })
    .run();

  const created = await getRuntimeConversationSession(database, input.sessionId);

  if (created === null) {
    throw new Error("Sandbox session could not be allocated.");
  }

  if (created.sandboxId !== input.runtimeSubjectId) {
    throw new Error("Sandbox session is already bound to a different sandbox.");
  }

  return created;
}

export async function recordRuntimeConversationSessionError(
  database: D1Database,
  input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly cwd: string;
    readonly message: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<void> {
  await runAppDatabaseBatch(database, (appDb) => [
    appDb
      .insert(sandboxSessionsTable)
      .values({
        sandboxSessionId: input.sandboxSessionId,
        createdAt: input.now,
        cwd: input.cwd,
        originJson: input.originJson,
        sandboxId: input.runtimeSubjectId,
        sessionId: input.sessionId,
        status: "error",
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        set: {
          status: "error",
          updatedAt: sql`excluded.updated_at`,
        },
        target: sandboxSessionsTable.sessionId,
      }),
    appDb
      .update(sandboxesTable)
      .set({
        lastError: input.message,
        lastErrorCode: input.errorCode,
        status: "error",
        statusChangedAt: input.now,
        statusEvent: toRuntimeSubjectStatusLifecycleEventName("error"),
        statusOperationId: null,
        statusSeq: sql`${sandboxesTable.statusSeq} + 1`,
        statusSource: "runtime",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          inArray(sandboxesTable.status, ["restoring", "active", "error"]),
        ),
      ),
  ]);
}

export async function recordRuntimeConversationSessionActive(
  database: D1Database,
  input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly cwd: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<void> {
  await runAppDatabaseBatch(database, (appDb) => [
    appDb
      .insert(sandboxSessionsTable)
      .values({
        sandboxSessionId: input.sandboxSessionId,
        createdAt: input.now,
        cwd: input.cwd,
        originJson: input.originJson,
        sandboxId: input.runtimeSubjectId,
        sessionId: input.sessionId,
        status: "active",
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        set: {
          sandboxSessionId: sql`excluded.cloudflare_session_id`,
          cwd: sql`excluded.cwd`,
          status: "active",
          updatedAt: sql`excluded.updated_at`,
        },
        target: sandboxSessionsTable.sessionId,
      }),
    appDb
      .update(sandboxesTable)
      .set({
        inactiveDeadlineAt: null,
        updatedAt: input.now,
      })
      .where(eq(sandboxesTable.id, input.runtimeSubjectId)),
  ]);
}

export async function recordRuntimeConversationSessionClosed(
  database: D1Database,
  input: {
    readonly inactiveDeadlineAt: number | null;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<void> {
  await runAppDatabaseBatch(database, (appDb) => [
    appDb
      .update(sandboxSessionsTable)
      .set({
        status: "closed",
        updatedAt: input.now,
      })
      .where(eq(sandboxSessionsTable.sessionId, input.sessionId)),
    appDb
      .update(sandboxesTable)
      .set({
        inactiveDeadlineAt: input.inactiveDeadlineAt,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          notExists(activeConversationSessionQuery(appDb, input.runtimeSubjectId)),
          notExists(runLeaseQuery(appDb, input.runtimeSubjectId)),
        ),
      ),
  ]);
}
