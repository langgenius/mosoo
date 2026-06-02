import type { SessionStatus } from "@mosoo/contracts/session";
import {
  sandboxBackupsTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxBackupId, SandboxId, SessionId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface CreatedSandboxBackupRecord {
  readonly dir: string;
  readonly id: string;
}

export interface CreatedSandboxBackupWrite {
  readonly backup: CreatedSandboxBackupRecord;
  readonly updateSandboxLastBackup: boolean;
}

export interface ReadySandboxBackupForPruning {
  readonly dir: string;
  readonly id: SandboxBackupId;
  readonly keep: boolean;
}

export interface SandboxSessionBackupCandidate {
  readonly cwd: string;
  readonly lastMessageAt: number | null;
  readonly sessionId: SessionId;
  readonly sessionStatus: SessionStatus;
}

function parseSandboxBackupIds(values: readonly string[], label: string): SandboxBackupId[] {
  return values.map((value, index) =>
    parsePlatformId<SandboxBackupId>(value, `${label}[${index}]`),
  );
}

function sandboxStatusOperationCondition(operationId: RuntimeOperationId | null | undefined) {
  if (operationId === undefined) {
    return [];
  }

  return operationId === null
    ? [isNull(sandboxesTable.statusOperationId)]
    : [eq(sandboxesTable.statusOperationId, operationId)];
}

export async function listReadySandboxBackupsForPruning(
  database: D1Database,
  sandboxId: string,
): Promise<ReadySandboxBackupForPruning[]> {
  const parsedSandboxId = parsePlatformId<SandboxId>(sandboxId, "sandbox id");

  return getAppDatabase(database)
    .select({
      dir: sandboxBackupsTable.dir,
      id: sandboxBackupsTable.id,
      keep: sandboxBackupsTable.keep,
    })
    .from(sandboxBackupsTable)
    .where(
      and(
        eq(sandboxBackupsTable.sandboxId, parsedSandboxId),
        eq(sandboxBackupsTable.status, "ready"),
      ),
    )
    .orderBy(asc(sandboxBackupsTable.dir), desc(sandboxBackupsTable.createdAt))
    .all();
}

export async function markSandboxBackupsPruned(
  database: D1Database,
  backupIds: readonly string[],
): Promise<void> {
  if (backupIds.length === 0) {
    return;
  }

  const parsedBackupIds = parseSandboxBackupIds(backupIds, "sandbox backup id");

  await getAppDatabase(database)
    .update(sandboxBackupsTable)
    .set({
      status: "pruned",
      updatedAt: currentTimestampMs(),
    })
    .where(inArray(sandboxBackupsTable.id, [...new Set(parsedBackupIds)]))
    .run();
}

export async function recordCreatedSandboxBackups(
  database: D1Database,
  input: {
    readonly backups: readonly CreatedSandboxBackupWrite[];
    readonly operationId?: string | null;
    readonly sandboxId: string;
    readonly ttlSeconds: number;
  },
): Promise<void> {
  if (input.backups.length === 0) {
    return;
  }

  const sandboxId = parsePlatformId<SandboxId>(input.sandboxId, "sandbox id");
  const operationId =
    input.operationId === undefined || input.operationId === null
      ? input.operationId
      : parsePlatformId<RuntimeOperationId>(input.operationId, "runtime operation id");
  const now = currentTimestampMs();
  const backupRows = input.backups.map((entry, index) => ({
    createdAt: now,
    dir: entry.backup.dir,
    errorMessage: null,
    id: parsePlatformId<SandboxBackupId>(entry.backup.id, `sandbox backup id ${index}`),
    keep: false,
    sandboxId,
    status: "ready" as const,
    ttlSeconds: input.ttlSeconds,
    updatedAt: now,
  }));
  let subjectCheckpointBackup: CreatedSandboxBackupRecord | null = null;

  for (const entry of input.backups) {
    if (entry.updateSandboxLastBackup) {
      subjectCheckpointBackup = entry.backup;
    }
  }

  if (!subjectCheckpointBackup) {
    await getAppDatabase(database).insert(sandboxBackupsTable).values(backupRows).run();
    return;
  }

  const appDb = getAppDatabase(database);
  await appDb.insert(sandboxBackupsTable).values(backupRows).run();
  const updated = await appDb
    .update(sandboxesTable)
    .set({
      lastBackupId: parsePlatformId<SandboxBackupId>(
        subjectCheckpointBackup.id,
        "checkpoint sandbox backup id",
      ),
      updatedAt: now,
    })
    .where(
      and(
        eq(sandboxesTable.id, sandboxId),
        inArray(sandboxesTable.status, ["backing_up", "destroying"]),
        ...sandboxStatusOperationCondition(operationId),
      ),
    )
    .run();

  if (getD1ChangeCount(updated) === 0) {
    throw new Error("Runtime subject changed before checkpoint backup was recorded.");
  }
}

export async function listSandboxSessionBackupCandidates(
  database: D1Database,
  sandboxId: string,
): Promise<SandboxSessionBackupCandidate[]> {
  const parsedSandboxId = parsePlatformId<SandboxId>(sandboxId, "sandbox id");
  const results = await getAppDatabase(database)
    .select({
      cwd: sandboxSessionsTable.cwd,
      last_message_at: sessionsTable.lastMessageAt,
      session_id: sandboxSessionsTable.sessionId,
      session_status: sessionsTable.status,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, parsedSandboxId),
        inArray(sandboxSessionsTable.status, ["active", "closed"]),
      ),
    )
    .all();

  return results.map((row) => ({
    cwd: row.cwd,
    lastMessageAt: row.last_message_at,
    sessionId: row.session_id,
    sessionStatus: row.session_status,
  }));
}

export async function listSandboxBackupIdsByDir(
  database: D1Database,
  dir: string,
): Promise<SandboxBackupId[]> {
  const results = await getAppDatabase(database)
    .select({ id: sandboxBackupsTable.id })
    .from(sandboxBackupsTable)
    .where(eq(sandboxBackupsTable.dir, dir))
    .all();

  return results.map((backup) => backup.id);
}

export async function deleteSandboxBackupRecordsForDir(
  database: D1Database,
  dir: string,
): Promise<void> {
  await getAppDatabase(database)
    .delete(sandboxBackupsTable)
    .where(eq(sandboxBackupsTable.dir, dir))
    .run();
}
