import {
  driverInstancesTable,
  sandboxBackupsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionRunsTable,
} from "@mosoo/db";
import type { SandboxBackupId, SandboxId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { getAppDatabase } from "../../../../platform/db/drizzle";
import {
  ASSIGNABLE_DRIVER_INSTANCE_STATUSES,
  LIVE_DRIVER_INSTANCE_STATUSES,
} from "../../domain/driver-instance-lifecycle.machine";
import { RUNTIME_KIND_POLICIES } from "../../domain/runtime-kind-policy";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import type {
  ReadyRuntimeSubjectBackupRecord,
  RuntimeSubjectBackupRecord,
} from "./runtime-subject-store.types";

export type AppDatabase = ReturnType<typeof getAppDatabase>;

export const ASSIGNABLE_DRIVER_STATUSES = ASSIGNABLE_DRIVER_INSTANCE_STATUSES;
export const LIVE_DRIVER_STATUSES = LIVE_DRIVER_INSTANCE_STATUSES;

const activeConversationSessionsTable = alias(sandboxSessionsTable, "active_runtime_session");
const runLeaseDriversTable = alias(driverInstancesTable, "runtime_run_lease_driver");
const runLeaseRunsTable = alias(sessionRunsTable, "runtime_run_lease_run");
export const readyConversationBackupTable = alias(sandboxBackupsTable, "ready_conversation_backup");
export const lastBackupTable = alias(sandboxBackupsTable, "last_backup");
export const readyLastBackupTable = alias(sandboxBackupsTable, "ready_last_backup");

export function mapRuntimeSubjectBackup(input: {
  readonly dir: string | null;
  readonly id: SandboxBackupId | null;
  readonly status: RuntimeSubjectBackupRecord["status"] | null;
}): RuntimeSubjectBackupRecord | null {
  if (input.dir === null || input.id === null || input.status === null) {
    return null;
  }

  return {
    dir: input.dir,
    id: input.id,
    status: input.status,
  };
}

export function mapReadyRuntimeSubjectBackup(input: {
  readonly dir: string | null;
  readonly id: SandboxBackupId | null;
}): ReadyRuntimeSubjectBackupRecord | null {
  if (input.dir === null || input.id === null) {
    return null;
  }

  return {
    dir: input.dir,
    id: input.id,
  };
}

export function parseMountedSpaceIds(raw: string | null | undefined): ReadonlySet<string> {
  if (raw === null || raw === undefined || raw.length === 0) {
    return new Set<string>();
  }

  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("Runtime subject global mounts must be a JSON string array.");
  }

  return new Set(parsed);
}

export function activeConversationSessionQuery(appDb: AppDatabase, runtimeSubjectId: SandboxId) {
  return appDb
    .select({ id: activeConversationSessionsTable.sessionId })
    .from(activeConversationSessionsTable)
    .where(
      and(
        eq(activeConversationSessionsTable.sandboxId, runtimeSubjectId),
        eq(activeConversationSessionsTable.status, "active"),
      ),
    );
}

export function activeConversationSessionQueryForListedSubject(appDb: AppDatabase) {
  return appDb
    .select({ id: activeConversationSessionsTable.sessionId })
    .from(activeConversationSessionsTable)
    .where(
      and(
        eq(activeConversationSessionsTable.sandboxId, sandboxesTable.id),
        eq(activeConversationSessionsTable.status, "active"),
      ),
    );
}

export function runLeaseQuery(appDb: AppDatabase, runtimeSubjectId: SandboxId) {
  return appDb
    .select({ id: runLeaseRunsTable.id })
    .from(runLeaseRunsTable)
    .innerJoin(
      runLeaseDriversTable,
      eq(runLeaseDriversTable.id, runLeaseRunsTable.driverInstanceId),
    )
    .where(
      and(
        eq(runLeaseDriversTable.sandboxId, runtimeSubjectId),
        inArray(runLeaseRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
}

export function runLeaseQueryForListedSubject(appDb: AppDatabase) {
  return appDb
    .select({ id: runLeaseRunsTable.id })
    .from(runLeaseRunsTable)
    .innerJoin(
      runLeaseDriversTable,
      eq(runLeaseDriversTable.id, runLeaseRunsTable.driverInstanceId),
    )
    .where(
      and(
        eq(runLeaseDriversTable.sandboxId, sandboxesTable.id),
        inArray(runLeaseRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
}

export function getRuntimeSubjectInactiveDeadlineSql(now: number) {
  return sql<number>`
    CASE ${sandboxesTable.kind}
      WHEN 'pet' THEN ${now + RUNTIME_KIND_POLICIES.pet.subject.idleReleaseDelayMs}
      WHEN 'cattle' THEN ${now + RUNTIME_KIND_POLICIES.cattle.subject.idleReleaseDelayMs}
      ELSE ${now}
    END
  `;
}
