import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";
import {
  sandboxBackupsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";
import { and, desc, eq, exists, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";

import { getAppDatabase, runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import {
  getRuntimeKindPolicy,
  getRuntimeSubjectInactiveDeadline,
} from "../../domain/runtime-kind-policy";
import { toRuntimeSubjectStatusLifecycleEventName } from "../../domain/runtime-subject-lifecycle.machine";
import { isCattleTerminalCheckpointReadyForNextRun } from "../session-runs/session-run-admission.repository";
import {
  activeConversationSessionQuery,
  mapReadyRuntimeSubjectBackup,
  readyConversationBackupTable,
  runLeaseQuery,
  runLeaseQueryForListedSubject,
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
        workspaceCheckpointRequired: sessionsTable.workspaceCheckpointRequired,
      })
      .from(sandboxSessionsTable)
      .leftJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
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
    workspaceCheckpointRequired: row.workspaceCheckpointRequired ?? false,
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

// Session-scoped (cattle) conversations stay open across terminal runs so the
// driver survives the idle grace. This lists the ones quiet past that grace so
// the maintenance sweep can close them; the close path arms the subject
// inactive deadline, which feeds the existing subject reclamation chain. Rows
// with an active run lease are skipped — a long-running turn is not idle.
export async function listIdleSessionScopedConversationSessions(
  database: D1Database,
  input: {
    readonly idleSinceLte: number;
    readonly limit: number;
  },
): Promise<Array<{ sandboxId: SandboxId; sessionId: SessionId }>> {
  const projectDb = getAppDatabase(database);

  return projectDb
    .select({
      sandboxId: sandboxSessionsTable.sandboxId,
      sessionId: sandboxSessionsTable.sessionId,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sandboxesTable, eq(sandboxesTable.id, sandboxSessionsTable.sandboxId))
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .where(
      and(
        eq(sandboxSessionsTable.status, "active"),
        eq(sandboxesTable.kind, "cattle"),
        sql`${sandboxSessionsTable.updatedAt} <= ${input.idleSinceLte}`,
        notExists(runLeaseQueryForListedSubject(projectDb)),
        or(
          eq(sessionsTable.workspaceCheckpointRequired, false),
          isNull(sessionsTable.lastRunId),
          notExists(
            projectDb
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(
                and(
                  eq(sessionRunsTable.id, sessionsTable.lastRunId),
                  eq(sessionRunsTable.status, "completed"),
                ),
              ),
          ),
          exists(
            projectDb
              .select({ id: sandboxBackupsTable.id })
              .from(sandboxBackupsTable)
              .where(
                and(
                  eq(sandboxBackupsTable.sandboxId, sandboxSessionsTable.sandboxId),
                  eq(sandboxBackupsTable.dir, sandboxSessionsTable.cwd),
                  eq(sandboxBackupsTable.sessionRunId, sessionsTable.lastRunId),
                  eq(sandboxBackupsTable.status, "ready"),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(input.limit)
    .all();
}

// Atomically claim an idle cattle conversation for the sweep to close. Between
// the sweep's LIST and its per-row close there is a window where a follow-up
// turn can re-use the resident session (ensureSandboxConversationSession
// refreshes updatedAt) before its run lease exists — the list-time lease guard
// would miss it and the close would delete the session mid-run. This flips the
// row active->closed only if it is STILL the same session instance
// (cloudflare_session_id), still idle (updatedAt <= idleSinceLte), and still
// lease-free. A refreshed updatedAt or a rebuilt session makes the claim fail,
// so the caller skips it; once claimed, a follow-up sees status=closed and
// rebuilds a fresh session, so the sweep only ever finalizes the stale one.
export async function claimIdleSessionScopedConversationForClose(
  database: D1Database,
  input: {
    readonly idleSinceLte: number;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
    readonly sandboxSessionId: SandboxSessionId;
    readonly sessionId: SessionId;
  },
): Promise<boolean> {
  if (!(await isCattleTerminalCheckpointReadyForNextRun(database, input.sessionId))) {
    return false;
  }

  const projectDb = getAppDatabase(database);
  const claimed = await projectDb
    .update(sandboxSessionsTable)
    .set({ status: "closed", updatedAt: input.now })
    .where(
      and(
        eq(sandboxSessionsTable.sessionId, input.sessionId),
        eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        eq(sandboxSessionsTable.sandboxSessionId, input.sandboxSessionId),
        eq(sandboxSessionsTable.status, "active"),
        lte(sandboxSessionsTable.updatedAt, input.idleSinceLte),
        notExists(runLeaseQuery(projectDb, input.runtimeSubjectId)),
      ),
    )
    .returning({ sessionId: sandboxSessionsTable.sessionId })
    .get();

  return claimed != null;
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
  await runAppDatabaseBatch(database, (projectDb) => [
    projectDb
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
    projectDb
      .update(sandboxesTable)
      .set({
        lastError: input.message,
        lastErrorCode: input.errorCode,
        status: "cold",
        statusChangedAt: input.now,
        statusEvent: toRuntimeSubjectStatusLifecycleEventName("cold"),
        statusOperationId: null,
        statusSeq: sql`${sandboxesTable.statusSeq} + 1`,
        statusSource: "runtime",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          inArray(sandboxesTable.status, ["restoring", "active"]),
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
  const petInactiveDeadlineAt = getRuntimeSubjectInactiveDeadline(
    getRuntimeKindPolicy("pet"),
    input.now,
  );

  await runAppDatabaseBatch(database, (projectDb) => [
    projectDb
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
    projectDb
      .update(sandboxesTable)
      .set({
        inactiveDeadlineAt: sql`
          CASE
            WHEN ${sandboxesTable.kind} = 'pet'
              THEN COALESCE(${sandboxesTable.inactiveDeadlineAt}, ${petInactiveDeadlineAt})
            ELSE NULL
          END
        `,
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
  await runAppDatabaseBatch(database, (projectDb) => [
    projectDb
      .update(sandboxSessionsTable)
      .set({
        status: "closed",
        updatedAt: input.now,
      })
      .where(eq(sandboxSessionsTable.sessionId, input.sessionId)),
    projectDb
      .update(sandboxesTable)
      .set({
        inactiveDeadlineAt: input.inactiveDeadlineAt,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          notExists(activeConversationSessionQuery(projectDb, input.runtimeSubjectId)),
          notExists(runLeaseQuery(projectDb, input.runtimeSubjectId)),
        ),
      ),
  ]);
}
