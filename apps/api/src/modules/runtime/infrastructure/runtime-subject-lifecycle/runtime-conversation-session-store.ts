import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";
import {
  sandboxBackupsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";
import { and, desc, eq, exists, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import {
  getRuntimeKindPolicy,
  getRuntimeSubjectInactiveDeadline,
} from "../../domain/runtime-kind-policy";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { isCattleTerminalCheckpointReadyForNextRun } from "../session-runs/session-run-admission.repository";
import {
  activeConversationSessionQuery,
  mapReadyRuntimeSubjectBackup,
  readyConversationBackupTable,
  runLeaseQuery,
  runLeaseQueryForListedSubject,
} from "./runtime-subject-store-queries";
import type {
  PendingRuntimeConversationSessionCleanup,
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
        sandboxIncarnation: sandboxSessionsTable.sandboxIncarnation,
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
          eq(readyConversationBackupTable.workspaceSessionId, sandboxSessionsTable.sessionId),
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
    sandboxIncarnation: row.sandboxIncarnation,
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
    readonly expectedProvisioningOperationId?: RuntimeOperationId;
    readonly expectedSandboxSessionId?: SandboxSessionId;
    readonly runtimeSubjectId: SandboxId;
    readonly expectedSandboxIncarnation?: number;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeConversationSessionState | null> {
  return (
    (await getAppDatabase(database)
      .select({
        agentId: sessionsTable.agentId,
        cleanupOperationId: sandboxSessionsTable.cleanupOperationId,
        sandboxSessionId: sandboxSessionsTable.sandboxSessionId,
        sandboxIncarnation: sandboxSessionsTable.sandboxIncarnation,
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
          ...(input.expectedSandboxSessionId === undefined
            ? []
            : [eq(sandboxSessionsTable.sandboxSessionId, input.expectedSandboxSessionId)]),
          ...(input.expectedSandboxIncarnation === undefined
            ? []
            : [eq(sandboxSessionsTable.sandboxIncarnation, input.expectedSandboxIncarnation)]),
          ...(input.expectedProvisioningOperationId === undefined
            ? []
            : [
                eq(
                  sessionsTable.runtimeProvisioningOperationId,
                  input.expectedProvisioningOperationId,
                ),
              ]),
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
  const appDb = getAppDatabase(database);

  return appDb
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
        isNull(sandboxSessionsTable.cleanupOperationId),
        isNull(sessionsTable.runtimeProvisioningOperationId),
        eq(sandboxesTable.kind, "cattle"),
        sql`${sandboxSessionsTable.updatedAt} <= ${input.idleSinceLte}`,
        notExists(runLeaseQueryForListedSubject(appDb)),
        notExists(
          appDb
            .select({ id: sessionRunsTable.id })
            .from(sessionRunsTable)
            .where(
              and(
                eq(sessionRunsTable.sessionId, sandboxSessionsTable.sessionId),
                inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
              ),
            ),
        ),
        or(
          eq(sessionsTable.workspaceCheckpointRequired, false),
          isNull(sessionsTable.lastRunId),
          notExists(
            appDb
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
            appDb
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
    readonly sandboxIncarnation: number;
    readonly sandboxSessionId: SandboxSessionId;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeOperationId | null> {
  if (!(await isCattleTerminalCheckpointReadyForNextRun(database, input.sessionId))) {
    return null;
  }

  const appDb = getAppDatabase(database);
  const operationId = createPlatformId<RuntimeOperationId>();
  const claimed = await appDb
    .update(sandboxSessionsTable)
    .set({ cleanupOperationId: operationId, status: "cleanup_pending", updatedAt: input.now })
    .where(
      and(
        eq(sandboxSessionsTable.sessionId, input.sessionId),
        eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
        eq(sandboxSessionsTable.sandboxSessionId, input.sandboxSessionId),
        inArray(sandboxSessionsTable.status, ["active", "error"]),
        isNull(sandboxSessionsTable.cleanupOperationId),
        lte(sandboxSessionsTable.updatedAt, input.idleSinceLte),
        notExists(runLeaseQuery(appDb, input.runtimeSubjectId)),
        notExists(
          appDb
            .select({ id: sessionRunsTable.id })
            .from(sessionRunsTable)
            .where(
              and(
                eq(sessionRunsTable.sessionId, input.sessionId),
                inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
              ),
            ),
        ),
        exists(
          appDb
            .select({ id: sessionsTable.id })
            .from(sessionsTable)
            .where(
              and(
                eq(sessionsTable.id, input.sessionId),
                isNull(sessionsTable.runtimeProvisioningOperationId),
              ),
            ),
        ),
      ),
    )
    .returning({ sessionId: sandboxSessionsTable.sessionId })
    .get();

  return claimed == null ? null : operationId;
}

export async function claimRuntimeConversationSessionCleanup(
  database: D1Database,
  input: {
    readonly expectedProvisioningOperationId?: RuntimeOperationId;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
    readonly sandboxIncarnation: number;
    readonly sandboxSessionId: SandboxSessionId;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeOperationId | null> {
  const appDb = getAppDatabase(database);
  const operationId = createPlatformId<RuntimeOperationId>();
  const claimed = await appDb
    .update(sandboxSessionsTable)
    .set({ cleanupOperationId: operationId, status: "cleanup_pending", updatedAt: input.now })
    .where(
      and(
        eq(sandboxSessionsTable.sessionId, input.sessionId),
        eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
        inArray(sandboxSessionsTable.status, ["active", "closed", "error"]),
        isNull(sandboxSessionsTable.cleanupOperationId),
        eq(sandboxSessionsTable.sandboxSessionId, input.sandboxSessionId),
        ...(input.expectedProvisioningOperationId === undefined
          ? []
          : [
              exists(
                appDb
                  .select({ id: sessionsTable.id })
                  .from(sessionsTable)
                  .where(
                    and(
                      eq(sessionsTable.id, input.sessionId),
                      eq(
                        sessionsTable.runtimeProvisioningOperationId,
                        input.expectedProvisioningOperationId,
                      ),
                      eq(sessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
                      eq(sessionsTable.runtimeProvisioningSandboxSessionId, input.sandboxSessionId),
                      eq(
                        sessionsTable.runtimeProvisioningSandboxIncarnation,
                        input.sandboxIncarnation,
                      ),
                    ),
                  ),
              ),
            ]),
      ),
    )
    .returning({ id: sandboxSessionsTable.sessionId })
    .get();

  return claimed === undefined ? null : operationId;
}

export async function listPendingRuntimeConversationSessionCleanups(
  database: D1Database,
  limit: number,
): Promise<PendingRuntimeConversationSessionCleanup[]> {
  return getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      cleanupOperationId: sandboxSessionsTable.cleanupOperationId,
      kind: sandboxesTable.kind,
      sandboxId: sandboxSessionsTable.sandboxId,
      sandboxSessionId: sandboxSessionsTable.sandboxSessionId,
      sandboxIncarnation: sandboxSessionsTable.sandboxIncarnation,
      sessionId: sandboxSessionsTable.sessionId,
      status: sandboxSessionsTable.status,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .innerJoin(sandboxesTable, eq(sandboxesTable.id, sandboxSessionsTable.sandboxId))
    .where(eq(sandboxSessionsTable.status, "cleanup_pending"))
    .limit(limit)
    .all() as Promise<PendingRuntimeConversationSessionCleanup[]>;
}

export async function retireRuntimeConversationSessionsForIncarnation(
  database: D1Database,
  input: {
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
    readonly sandboxIncarnation: number;
  },
): Promise<void> {
  await getAppDatabase(database)
    .update(sandboxSessionsTable)
    .set({ cleanupOperationId: null, status: "closed", updatedAt: input.now })
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
        inArray(sandboxSessionsTable.status, ["active", "cleanup_pending", "error"]),
      ),
    )
    .run();
}

export async function ensureRuntimeConversationSessionRecord(
  database: D1Database,
  input: {
    readonly cwd: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sandboxIncarnation: number;
    readonly sessionId: SessionId;
  },
): Promise<RuntimeConversationSessionRecord> {
  const existing = await getRuntimeConversationSession(database, input.sessionId);

  if (existing !== null) {
    if (existing.sandboxId !== input.runtimeSubjectId) {
      throw new Error("Sandbox session is already bound to a different sandbox.");
    }

    if (existing.status !== "closed" && existing.sandboxIncarnation !== input.sandboxIncarnation) {
      throw new Error("Sandbox session belongs to a retired sandbox incarnation.");
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
      sandboxIncarnation: input.sandboxIncarnation,
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

  if (created.status !== "closed" && created.sandboxIncarnation !== input.sandboxIncarnation) {
    throw new Error("Sandbox session belongs to a retired sandbox incarnation.");
  }

  return created;
}

export async function recordRuntimeConversationSessionError(
  database: D1Database,
  input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly sandboxIncarnation: number;
    readonly cwd: string;
    readonly message: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly now: number;
    readonly originJson: string;
    readonly expectedProvisioningOperationId?: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<boolean> {
  const appDb = getAppDatabase(database);
  const updated = await appDb
    .update(sandboxSessionsTable)
    .set({
      cleanupOperationId: null,
      sandboxSessionId: input.sandboxSessionId,
      sandboxIncarnation: input.sandboxIncarnation,
      status: "error",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(sandboxSessionsTable.sessionId, input.sessionId),
        eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
        or(
          and(
            eq(sandboxSessionsTable.status, "active"),
            eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
          ),
          inArray(sandboxSessionsTable.status, ["closed", "error"]),
        ),
        isNull(sandboxSessionsTable.cleanupOperationId),
        exists(
          appDb
            .select({ id: sandboxesTable.id })
            .from(sandboxesTable)
            .where(
              and(
                eq(sandboxesTable.id, input.runtimeSubjectId),
                eq(sandboxesTable.incarnation, input.sandboxIncarnation),
                eq(sandboxesTable.status, "active"),
              ),
            ),
        ),
        ...(input.expectedProvisioningOperationId === undefined
          ? []
          : [
              exists(
                appDb
                  .select({ id: sessionsTable.id })
                  .from(sessionsTable)
                  .where(
                    and(
                      eq(sessionsTable.id, input.sessionId),
                      eq(
                        sessionsTable.runtimeProvisioningOperationId,
                        input.expectedProvisioningOperationId,
                      ),
                      eq(sessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
                      eq(sessionsTable.runtimeProvisioningSandboxSessionId, input.sandboxSessionId),
                      eq(
                        sessionsTable.runtimeProvisioningSandboxIncarnation,
                        input.sandboxIncarnation,
                      ),
                    ),
                  ),
              ),
            ]),
      ),
    )
    .returning({ id: sandboxSessionsTable.sessionId })
    .get();

  return updated !== undefined;
}

export async function recordRuntimeConversationSessionActive(
  database: D1Database,
  input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly sandboxIncarnation: number;
    readonly cwd: string;
    readonly now: number;
    readonly originJson: string;
    readonly expectedProvisioningOperationId?: RuntimeOperationId;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<boolean> {
  const petInactiveDeadlineAt = getRuntimeSubjectInactiveDeadline(
    getRuntimeKindPolicy("pet"),
    input.now,
  );

  const results = await runAppDatabaseBatch(database, (appDb) => [
    appDb
      .update(sandboxSessionsTable)
      .set({
        cleanupOperationId: null,
        cwd: input.cwd,
        sandboxSessionId: input.sandboxSessionId,
        sandboxIncarnation: input.sandboxIncarnation,
        status: "active",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxSessionsTable.sessionId, input.sessionId),
          eq(sandboxSessionsTable.sandboxId, input.runtimeSubjectId),
          or(
            and(
              eq(sandboxSessionsTable.status, "active"),
              eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
            ),
            inArray(sandboxSessionsTable.status, ["closed", "error"]),
          ),
          isNull(sandboxSessionsTable.cleanupOperationId),
          exists(
            appDb
              .select({ id: sandboxesTable.id })
              .from(sandboxesTable)
              .where(
                and(
                  eq(sandboxesTable.id, input.runtimeSubjectId),
                  eq(sandboxesTable.incarnation, input.sandboxIncarnation),
                  eq(sandboxesTable.status, "active"),
                ),
              ),
          ),
          ...(input.expectedProvisioningOperationId === undefined
            ? []
            : [
                exists(
                  appDb
                    .select({ id: sessionsTable.id })
                    .from(sessionsTable)
                    .where(
                      and(
                        eq(sessionsTable.id, input.sessionId),
                        eq(
                          sessionsTable.runtimeProvisioningOperationId,
                          input.expectedProvisioningOperationId,
                        ),
                        eq(sessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
                        eq(
                          sessionsTable.runtimeProvisioningSandboxSessionId,
                          input.sandboxSessionId,
                        ),
                        eq(
                          sessionsTable.runtimeProvisioningSandboxIncarnation,
                          input.sandboxIncarnation,
                        ),
                      ),
                    ),
                ),
              ]),
        ),
      ),
    appDb
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
      .where(
        and(
          eq(sandboxesTable.id, input.runtimeSubjectId),
          eq(sandboxesTable.incarnation, input.sandboxIncarnation),
          eq(sandboxesTable.status, "active"),
          exists(
            appDb
              .select({ id: sandboxSessionsTable.sessionId })
              .from(sandboxSessionsTable)
              .where(
                and(
                  eq(sandboxSessionsTable.sessionId, input.sessionId),
                  eq(sandboxSessionsTable.sandboxSessionId, input.sandboxSessionId),
                  eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
                  eq(sandboxSessionsTable.status, "active"),
                ),
              ),
          ),
        ),
      ),
  ]);

  return getD1ChangeCount(results[0]) === 1;
}

export async function recordRuntimeConversationSessionClosed(
  database: D1Database,
  input: {
    readonly expectedProvisioningOperationId?: RuntimeOperationId;
    readonly cleanupOperationId: RuntimeOperationId;
    readonly inactiveDeadlineAt: number | null;
    readonly now: number;
    readonly runtimeSubjectId: SandboxId;
    readonly sandboxIncarnation: number;
    readonly sandboxSessionId: SandboxSessionId;
    readonly sessionId: SessionId;
  },
): Promise<boolean> {
  const results = await runAppDatabaseBatch(database, (appDb) => [
    appDb
      .update(sandboxSessionsTable)
      .set({
        status: "closed",
        cleanupOperationId: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sandboxSessionsTable.sessionId, input.sessionId),
          eq(sandboxSessionsTable.sandboxSessionId, input.sandboxSessionId),
          eq(sandboxSessionsTable.sandboxIncarnation, input.sandboxIncarnation),
          eq(sandboxSessionsTable.status, "cleanup_pending"),
          eq(sandboxSessionsTable.cleanupOperationId, input.cleanupOperationId),
          ...(input.expectedProvisioningOperationId === undefined
            ? []
            : [
                exists(
                  appDb
                    .select({ id: sessionsTable.id })
                    .from(sessionsTable)
                    .where(
                      and(
                        eq(sessionsTable.id, input.sessionId),
                        eq(
                          sessionsTable.runtimeProvisioningOperationId,
                          input.expectedProvisioningOperationId,
                        ),
                        eq(sessionsTable.runtimeProvisioningSandboxId, input.runtimeSubjectId),
                        eq(
                          sessionsTable.runtimeProvisioningSandboxSessionId,
                          input.sandboxSessionId,
                        ),
                        eq(
                          sessionsTable.runtimeProvisioningSandboxIncarnation,
                          input.sandboxIncarnation,
                        ),
                      ),
                    ),
                ),
              ]),
        ),
      ),
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

  return getD1ChangeCount(results[0]) === 1;
}
