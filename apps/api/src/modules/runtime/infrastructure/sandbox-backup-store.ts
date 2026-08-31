import type { SessionStatus } from "@mosoo/contracts/session";
import type { ApiCommandId } from "@mosoo/db";
import {
  sandboxBackupsTable,
  sandboxBackupStagingTable,
  sandboxSessionsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { RuntimeSubjectOperationLease } from "./runtime-subject-lifecycle/runtime-subject-store";

const TERMINAL_BACKUP_DRIVER_STATUSES_SQL =
  "('provisioning', 'connecting', 'ready', 'stopping', 'stopped', 'failed')";
const DATABASE_NOW_MS_SQL = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export interface SandboxBackupRecord {
  readonly createdAt: number;
  readonly dir: string;
  readonly id: SandboxBackupId;
  readonly keep: boolean;
  readonly operationId: RuntimeOperationId | null;
  readonly sandboxId: SandboxId;
  readonly sandboxIncarnation: number;
  readonly sessionRunId: SessionRunId | null;
  readonly stagingId: SandboxBackupId;
  readonly status: "pruned" | "ready";
  readonly ttlSeconds: number;
  readonly updatedAt: number;
  readonly workspaceSessionId: SessionId | null;
}

export interface SandboxBackupStage {
  readonly actualBackupId: SandboxBackupId | null;
  readonly claimOwner: string | null;
  readonly createdAt: number;
  readonly dir: string;
  readonly driverGeneration: number | null;
  readonly driverInstanceId: DriverInstanceId | null;
  readonly id: SandboxBackupId;
  readonly operationId: RuntimeOperationId | null;
  readonly sandboxId: SandboxId;
  readonly sandboxIncarnation: number;
  readonly sessionRunId: SessionRunId | null;
  readonly ttlSeconds: number;
  readonly updatedAt: number;
  readonly updatesSubjectBackup: boolean;
  readonly workspaceSessionId: SessionId | null;
}

export interface SandboxBackupTarget {
  readonly dir: string;
  readonly updateSandboxLastBackup: boolean;
  readonly workspaceSessionId: string | null;
}

export type SandboxBackupAdmission =
  | { readonly kind: "operation"; readonly lease: RuntimeSubjectOperationLease }
  | {
      readonly driverGeneration: number;
      readonly driverInstanceId: DriverInstanceId;
      readonly incarnation: number;
      readonly kind: "terminal";
      readonly sessionId: SessionId;
      readonly sessionRunId: SessionRunId;
    };

export type SandboxBackupWrite =
  | { readonly backup: SandboxBackupRecord; readonly kind: "finalized" }
  | { readonly isNew: boolean; readonly kind: "staged"; readonly stage: SandboxBackupStage };

interface SandboxBackupScope {
  readonly dir: string;
  readonly operationId: RuntimeOperationId | null;
  readonly sandboxId: SandboxId;
  readonly sandboxIncarnation: number;
  readonly sessionRunId: SessionRunId | null;
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
}

function scopeForTarget(
  sandboxId: SandboxId,
  admission: SandboxBackupAdmission,
  dir: string,
): SandboxBackupScope {
  return {
    dir,
    operationId: admission.kind === "operation" ? admission.lease.operationId : null,
    sandboxId,
    sandboxIncarnation:
      admission.kind === "operation" ? admission.lease.incarnation : admission.incarnation,
    sessionRunId: admission.kind === "terminal" ? admission.sessionRunId : null,
  };
}

function mapBackup(row: typeof sandboxBackupsTable.$inferSelect): SandboxBackupRecord {
  if (row.status !== "ready" && row.status !== "pruned") {
    throw new Error("Sandbox backup storage returned an invalid public status.");
  }
  return { ...row, status: row.status };
}

export async function getSandboxBackupStage(
  database: D1Database,
  stagingId: SandboxBackupId,
): Promise<SandboxBackupStage | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(sandboxBackupStagingTable)
      .where(eq(sandboxBackupStagingTable.id, stagingId))
      .limit(1)
      .get()) ?? null
  );
}

export async function getSandboxBackupRecord(
  database: D1Database,
  backupId: SandboxBackupId,
): Promise<SandboxBackupRecord | null> {
  const row = await getAppDatabase(database)
    .select()
    .from(sandboxBackupsTable)
    .where(eq(sandboxBackupsTable.id, backupId))
    .limit(1)
    .get();
  return row === undefined ? null : mapBackup(row);
}

export async function getSandboxBackupRecordByStagingId(
  database: D1Database,
  stagingId: SandboxBackupId,
): Promise<SandboxBackupRecord | null> {
  const row = await getAppDatabase(database)
    .select()
    .from(sandboxBackupsTable)
    .where(eq(sandboxBackupsTable.stagingId, stagingId))
    .limit(1)
    .get();
  return row === undefined ? null : mapBackup(row);
}

export type SandboxBackupDeletionAuthority =
  | { readonly kind: "pruned" }
  | { readonly kind: "unattributed" }
  | {
      readonly kind: "runtime_candidate" | "runtime_invalid";
      readonly stagingId: SandboxBackupId;
    }
  | {
      readonly attemptCount: number;
      readonly commandId: ApiCommandId;
      readonly deliveryGeneration: number;
      readonly kind: "environment_candidate" | "environment_invalid";
    };

export async function authorizeSandboxBackupDeletion(
  database: D1Database,
  input: {
    readonly authority: SandboxBackupDeletionAuthority;
    readonly backupId: SandboxBackupId;
  },
): Promise<boolean> {
  const { authority, backupId } = input;
  const invalidRuntime = authority.kind === "runtime_invalid";
  const invalidEnvironment = authority.kind === "environment_invalid";
  const preparations: D1PreparedStatement[] = [];
  if (invalidRuntime) {
    preparations.push(
      database
        .prepare(
          `UPDATE sandbox_backup_staging AS stage
           SET actual_backup_id = NULL, updated_at = ${DATABASE_NOW_MS_SQL}
           WHERE stage.id = ? AND stage.actual_backup_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM sandbox_backup AS backup
               WHERE backup.id = ? AND backup.status = 'ready'
             )
             AND NOT EXISTS (
               SELECT 1 FROM environment_package_artifact_backup AS artifact
               WHERE artifact.backup_id = ?
             )`,
        )
        .bind(authority.stagingId, backupId, backupId, backupId),
    );
  } else if (invalidEnvironment) {
    preparations.push(
      database
        .prepare(
          `UPDATE environment_package_artifact_backup_staging AS stage
           SET actual_backup_id = NULL, updated_at = ${DATABASE_NOW_MS_SQL}
           WHERE stage.command_id = ? AND stage.delivery_generation = ?
             AND stage.attempt_count = ? AND stage.actual_backup_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM environment_package_artifact_backup AS artifact
               WHERE artifact.backup_id = ?
             )`,
        )
        .bind(
          authority.commandId,
          authority.deliveryGeneration,
          authority.attemptCount,
          backupId,
          backupId,
        ),
    );
  }

  const requiresPruned =
    authority.kind === "pruned"
      ? `AND EXISTS (
           SELECT 1 FROM sandbox_backup AS pruned
           WHERE pruned.id = ? AND pruned.status = 'pruned'
         )`
      : "";
  const blocksUnclaimedRuntime =
    authority.kind === "runtime_candidate"
      ? `AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup_staging AS candidate_stage
           WHERE candidate_stage.id = ? AND candidate_stage.actual_backup_id IS NULL
         )`
      : "";
  const blocksUnclaimedEnvironment =
    authority.kind === "environment_candidate"
      ? `AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup_staging AS candidate_stage
           WHERE candidate_stage.command_id = ? AND candidate_stage.delivery_generation = ?
             AND candidate_stage.attempt_count = ?
             AND candidate_stage.actual_backup_id IS NULL
         )`
      : "";
  const authorityBindings =
    authority.kind === "pruned"
      ? [backupId]
      : authority.kind === "runtime_candidate"
        ? [authority.stagingId]
        : authority.kind === "environment_candidate"
          ? [authority.commandId, authority.deliveryGeneration, authority.attemptCount]
          : [];
  const authorize = database
    .prepare(
      `INSERT INTO sandbox_backup_delete_intent (backup_id, created_at, delete_after, deleted_at)
       SELECT ?, ${DATABASE_NOW_MS_SQL}, ${DATABASE_NOW_MS_SQL}, NULL
       WHERE NOT EXISTS (
           SELECT 1 FROM sandbox_backup_delete_intent AS deletion
           WHERE deletion.backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup AS backup
           WHERE backup.id = ? AND backup.status = 'ready'
         )
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup_staging AS stage
           WHERE stage.actual_backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup_staging AS stage
           WHERE stage.actual_backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup AS artifact
           WHERE artifact.backup_id = ?
         )
         ${requiresPruned}
         ${blocksUnclaimedRuntime}
         ${blocksUnclaimedEnvironment}
      `,
    )
    .bind(backupId, backupId, backupId, backupId, backupId, backupId, ...authorityBindings);
  if (preparations.length === 0) {
    await authorize.run();
  } else {
    await database.batch([...preparations, authorize]);
  }
  return (
    (await database
      .prepare(
        `SELECT 1 FROM sandbox_backup_delete_intent
         WHERE backup_id = ? AND delete_after <= ${DATABASE_NOW_MS_SQL}`,
      )
      .bind(backupId)
      .first()) !== null
  );
}

export async function listPendingSandboxBackupDeletions(
  database: D1Database,
  limit: number,
): Promise<SandboxBackupId[]> {
  assertPositiveSafeInteger(limit, "Sandbox backup deletion limit");
  const rows = await database
    .prepare(
      `SELECT backup_id
       FROM sandbox_backup_delete_intent
       WHERE deleted_at IS NULL AND delete_after <= ${DATABASE_NOW_MS_SQL}
       ORDER BY coalesce(attempted_at, delete_after), attempted_at IS NOT NULL,
         created_at, backup_id
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ backup_id: SandboxBackupId }>();
  return rows.results.map((row) => row.backup_id);
}

export async function beginSandboxBackupDeletionAttempt(
  database: D1Database,
  backupId: SandboxBackupId,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE sandbox_backup_delete_intent
       SET attempted_at = ${DATABASE_NOW_MS_SQL}
       WHERE backup_id = ? AND deleted_at IS NULL AND delete_after <= ${DATABASE_NOW_MS_SQL}`,
    )
    .bind(backupId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function isSandboxBackupDeletionAuthorized(
  database: D1Database,
  backupId: SandboxBackupId,
): Promise<boolean> {
  return (
    (await database
      .prepare(
        `SELECT 1 FROM sandbox_backup_delete_intent
         WHERE backup_id = ? AND delete_after <= ${DATABASE_NOW_MS_SQL}`,
      )
      .bind(backupId)
      .first()) !== null
  );
}

export async function completeSandboxBackupDeletion(
  database: D1Database,
  backupId: SandboxBackupId,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE sandbox_backup_delete_intent
       SET deleted_at = coalesce(deleted_at, ${DATABASE_NOW_MS_SQL})
       WHERE backup_id = ? AND attempted_at IS NOT NULL`,
    )
    .bind(backupId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function getStageByScope(
  database: D1Database,
  scope: SandboxBackupScope,
): Promise<SandboxBackupStage | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(sandboxBackupStagingTable)
      .where(
        and(
          eq(sandboxBackupStagingTable.sandboxId, scope.sandboxId),
          eq(sandboxBackupStagingTable.sandboxIncarnation, scope.sandboxIncarnation),
          eq(sandboxBackupStagingTable.dir, scope.dir),
          scope.operationId === null
            ? isNull(sandboxBackupStagingTable.operationId)
            : eq(sandboxBackupStagingTable.operationId, scope.operationId),
          scope.sessionRunId === null
            ? isNull(sandboxBackupStagingTable.sessionRunId)
            : eq(sandboxBackupStagingTable.sessionRunId, scope.sessionRunId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

async function getFinalizedSandboxBackupByScope(
  database: D1Database,
  scope: SandboxBackupScope,
): Promise<SandboxBackupRecord | null> {
  const row = await getAppDatabase(database)
    .select()
    .from(sandboxBackupsTable)
    .where(
      and(
        eq(sandboxBackupsTable.sandboxId, scope.sandboxId),
        eq(sandboxBackupsTable.sandboxIncarnation, scope.sandboxIncarnation),
        eq(sandboxBackupsTable.dir, scope.dir),
        scope.operationId === null
          ? isNull(sandboxBackupsTable.operationId)
          : eq(sandboxBackupsTable.operationId, scope.operationId),
        scope.sessionRunId === null
          ? isNull(sandboxBackupsTable.sessionRunId)
          : eq(sandboxBackupsTable.sessionRunId, scope.sessionRunId),
      ),
    )
    .limit(1)
    .get();
  return row === undefined ? null : mapBackup(row);
}

function assertTargetMatches(
  value: Pick<SandboxBackupRecord | SandboxBackupStage, "workspaceSessionId">,
  target: SandboxBackupTarget,
): void {
  if (value.workspaceSessionId !== target.workspaceSessionId) {
    throw new Error("A sandbox backup retry changed its immutable workspace target.");
  }
  if (
    "updatesSubjectBackup" in value &&
    value.updatesSubjectBackup !== target.updateSandboxLastBackup
  ) {
    throw new Error("A sandbox backup retry changed its subject checkpoint target.");
  }
}

function workspaceAdmission(
  target: SandboxBackupTarget,
  scope: SandboxBackupScope,
): {
  readonly bindings: readonly unknown[];
  readonly predicate: string;
} {
  if (target.workspaceSessionId === null) {
    return { bindings: [], predicate: "1 = 1" };
  }
  return {
    bindings: [target.workspaceSessionId, scope.sandboxId, scope.sandboxIncarnation, scope.dir],
    predicate: `EXISTS (
      SELECT 1
      FROM sandbox_session AS workspace
      JOIN session AS logical_session ON logical_session.id = workspace.session_id
      WHERE workspace.session_id = ?
        AND workspace.sandbox_id = ?
        AND workspace.sandbox_incarnation = ?
        AND workspace.cwd = ?
        AND workspace.status IN ('active', 'closed')
        AND workspace.cleanup_operation_id IS NULL
        AND logical_session.archived_at IS NULL
        AND logical_session.cleanup_operation_kind IS NULL
    )`,
  };
}

async function insertStage(
  database: D1Database,
  input: {
    readonly admission: SandboxBackupAdmission;
    readonly sandboxId: SandboxId;
    readonly target: SandboxBackupTarget;
    readonly ttlSeconds: number;
  },
): Promise<boolean> {
  const id = createPlatformId<SandboxBackupId>();
  const scope = scopeForTarget(input.sandboxId, input.admission, input.target.dir);
  const workspace = workspaceAdmission(input.target, scope);
  const authority =
    input.admission.kind === "operation"
      ? {
          bindings: [
            input.sandboxId,
            input.admission.lease.incarnation,
            input.admission.lease.operationId,
            input.admission.lease.claimOwner,
          ],
          predicate: `EXISTS (
            SELECT 1 FROM sandbox
            WHERE id = ? AND incarnation = ? AND status = 'backing_up'
              AND status_operation_id = ? AND claim_owner = ?
              AND claim_expires_at > ${DATABASE_NOW_MS_SQL}
          )`,
        }
      : {
          bindings: [
            input.admission.sessionRunId,
            input.admission.sessionId,
            input.admission.driverInstanceId,
            input.admission.driverInstanceId,
            input.admission.driverGeneration,
            input.sandboxId,
            input.admission.incarnation,
            input.admission.sessionId,
            input.admission.sessionRunId,
          ],
          predicate: `EXISTS (
            SELECT 1
            FROM session_run AS terminal_run
            JOIN driver_instance AS terminal_driver
              ON terminal_driver.id = terminal_run.driver_instance_id
            WHERE terminal_run.id = ? AND terminal_run.session_id = ?
              AND terminal_run.driver_instance_id = ? AND terminal_run.status = 'completed'
              AND terminal_driver.id = ? AND terminal_driver.generation = ?
              AND terminal_driver.sandbox_id = ? AND terminal_driver.sandbox_incarnation = ?
              AND terminal_driver.sandbox_session_id = ?
              AND terminal_driver.status IN ${TERMINAL_BACKUP_DRIVER_STATUSES_SQL}
              AND terminal_driver.status_operation_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM session_run AS successor
                WHERE successor.session_id = terminal_run.session_id
                  AND successor.id <> terminal_run.id
                  AND successor.status IN ('queued', 'booting', 'running', 'waiting_input')
              )
          )`,
        };
  const result = await database
    .prepare(
      `INSERT INTO sandbox_backup_staging (
        actual_backup_id, claim_owner, created_at, dir, driver_generation, driver_instance_id,
        id, operation_id, sandbox_id, sandbox_incarnation, session_run_id, ttl_seconds, updated_at,
        updates_subject_backup, workspace_session_id
      )
      SELECT NULL, ?, ${DATABASE_NOW_MS_SQL}, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ${DATABASE_NOW_MS_SQL}, ?, ?
      WHERE ${authority.predicate} AND ${workspace.predicate}
        AND NOT EXISTS (
          SELECT 1 FROM sandbox_backup AS finalized
          WHERE finalized.staging_id = ?
            OR (finalized.sandbox_id = ? AND finalized.sandbox_incarnation = ?
              AND finalized.dir = ? AND finalized.operation_id IS ?
              AND finalized.session_run_id IS ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM sandbox_backup_staging AS existing
          WHERE existing.id = ?
            OR (existing.sandbox_id = ? AND existing.sandbox_incarnation = ?
              AND existing.dir = ? AND existing.operation_id IS ?
              AND existing.session_run_id IS ?)
        )
      ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.admission.kind === "operation" ? input.admission.lease.claimOwner : null,
      scope.dir,
      input.admission.kind === "terminal" ? input.admission.driverGeneration : null,
      input.admission.kind === "terminal" ? input.admission.driverInstanceId : null,
      id,
      scope.operationId,
      scope.sandboxId,
      scope.sandboxIncarnation,
      scope.sessionRunId,
      input.ttlSeconds,
      input.target.updateSandboxLastBackup ? 1 : 0,
      input.target.workspaceSessionId,
      ...authority.bindings,
      ...workspace.bindings,
      id,
      scope.sandboxId,
      scope.sandboxIncarnation,
      scope.dir,
      scope.operationId,
      scope.sessionRunId,
      id,
      scope.sandboxId,
      scope.sandboxIncarnation,
      scope.dir,
      scope.operationId,
      scope.sessionRunId,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function stageSandboxBackupWrites(
  database: D1Database,
  input: {
    readonly admission: SandboxBackupAdmission;
    readonly sandboxId: string;
    readonly targets: readonly SandboxBackupTarget[];
    readonly ttlSeconds: number;
  },
): Promise<SandboxBackupWrite[]> {
  assertPositiveSafeInteger(input.ttlSeconds, "Sandbox backup TTL");
  assertPositiveSafeInteger(
    input.admission.kind === "operation"
      ? input.admission.lease.incarnation
      : input.admission.incarnation,
    "Sandbox backup incarnation",
  );
  if (
    input.admission.kind === "terminal" &&
    (!Number.isSafeInteger(input.admission.driverGeneration) ||
      input.admission.driverGeneration < 0)
  ) {
    throw new TypeError("Terminal sandbox backup identity is invalid.");
  }
  const sandboxId = parsePlatformId<SandboxId>(input.sandboxId, "sandbox id");
  const writes: SandboxBackupWrite[] = [];

  for (const rawTarget of input.targets) {
    const target: SandboxBackupTarget = {
      ...rawTarget,
      workspaceSessionId:
        rawTarget.workspaceSessionId === null
          ? null
          : parsePlatformId<SessionId>(rawTarget.workspaceSessionId, "workspace session id"),
    };
    if (input.admission.kind === "terminal" && target.workspaceSessionId === null) {
      throw new Error("Terminal sandbox backups require an exact workspace session.");
    }
    const scope = scopeForTarget(sandboxId, input.admission, target.dir);
    const finalized = await getFinalizedSandboxBackupByScope(database, scope);
    if (finalized !== null) {
      assertTargetMatches(finalized, target);
      writes.push({ backup: finalized, kind: "finalized" });
      continue;
    }
    let stage = await getStageByScope(database, scope);
    let isNew = false;
    if (
      stage !== null &&
      input.admission.kind === "operation" &&
      stage.claimOwner !== input.admission.lease.claimOwner
    ) {
      if (await isSandboxBackupStageCurrent(database, stage.id)) {
        throw new Error("Sandbox backup stage belongs to another live lease owner.");
      }
      const revoked = await revokeSandboxBackupStage(database, {
        onlyIfStale: true,
        stagingId: stage.id,
      });
      if (revoked?.actualBackupId !== null && revoked?.actualBackupId !== undefined) {
        await authorizeSandboxBackupDeletion(database, {
          authority: { kind: "runtime_candidate", stagingId: stage.id },
          backupId: revoked.actualBackupId,
        });
      }
      stage = null;
    }
    if (stage === null) {
      isNew = await insertStage(database, {
        admission: input.admission,
        sandboxId,
        target,
        ttlSeconds: input.ttlSeconds,
      });
      const racedFinalized = await getFinalizedSandboxBackupByScope(database, scope);
      if (racedFinalized !== null) {
        assertTargetMatches(racedFinalized, target);
        writes.push({ backup: racedFinalized, kind: "finalized" });
        continue;
      }
      stage = await getStageByScope(database, scope);
    }
    if (stage === null) {
      throw new Error("Sandbox backup admission lost its exact lifecycle authority.");
    }
    if (
      input.admission.kind === "operation"
        ? stage.claimOwner !== input.admission.lease.claimOwner
        : stage.claimOwner !== null ||
          stage.driverInstanceId !== input.admission.driverInstanceId ||
          stage.driverGeneration !== input.admission.driverGeneration
    ) {
      throw new Error("Sandbox backup stage belongs to another admission authority.");
    }
    if (!(await isSandboxBackupStageCurrent(database, stage.id))) {
      throw new Error("Sandbox backup stage lost its lifecycle authority before use.");
    }
    assertTargetMatches(stage, target);
    writes.push({ isNew, kind: "staged", stage });
  }
  return writes;
}

function currentAuthority(alias: string): string {
  return `(
    (${alias}.operation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM sandbox AS subject
      WHERE subject.id = ${alias}.sandbox_id
        AND subject.incarnation = ${alias}.sandbox_incarnation
        AND subject.status = 'backing_up'
        AND subject.status_operation_id = ${alias}.operation_id
        AND ${alias}.claim_owner IS NOT NULL
        AND subject.claim_owner = ${alias}.claim_owner
        AND subject.claim_expires_at > ${DATABASE_NOW_MS_SQL}
    )) OR (${alias}.session_run_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM sandbox AS subject
      JOIN session_run AS terminal_run ON terminal_run.id = ${alias}.session_run_id
      JOIN driver_instance AS terminal_driver
        ON terminal_driver.id = ${alias}.driver_instance_id
      WHERE subject.id = ${alias}.sandbox_id
        AND subject.incarnation = ${alias}.sandbox_incarnation
        AND terminal_run.session_id = ${alias}.workspace_session_id
        AND terminal_run.status = 'completed'
        AND terminal_run.driver_instance_id = ${alias}.driver_instance_id
        AND terminal_driver.generation = ${alias}.driver_generation
        AND terminal_driver.sandbox_id = ${alias}.sandbox_id
        AND terminal_driver.sandbox_incarnation = ${alias}.sandbox_incarnation
        AND terminal_driver.sandbox_session_id = ${alias}.workspace_session_id
        AND terminal_driver.status IN ${TERMINAL_BACKUP_DRIVER_STATUSES_SQL}
        AND terminal_driver.status_operation_id = ${alias}.session_run_id
        AND NOT EXISTS (
          SELECT 1 FROM session_run AS successor
          WHERE successor.session_id = terminal_run.session_id
            AND successor.id <> terminal_run.id
            AND successor.status IN ('queued', 'booting', 'running', 'waiting_input')
        )
    ))
  ) AND (${alias}.workspace_session_id IS NULL OR EXISTS (
    SELECT 1
    FROM sandbox_session AS workspace
    JOIN session AS logical_session ON logical_session.id = workspace.session_id
    WHERE workspace.session_id = ${alias}.workspace_session_id
      AND workspace.sandbox_id = ${alias}.sandbox_id
      AND workspace.sandbox_incarnation = ${alias}.sandbox_incarnation
      AND workspace.cwd = ${alias}.dir
      AND workspace.status IN ('active', 'closed')
      AND workspace.cleanup_operation_id IS NULL
      AND logical_session.archived_at IS NULL
      AND logical_session.cleanup_operation_kind IS NULL
  ))`;
}

export async function isSandboxBackupStageCurrent(
  database: D1Database,
  stagingId: SandboxBackupId,
): Promise<boolean> {
  return (
    (await database
      .prepare(
        `SELECT id FROM sandbox_backup_staging AS stage
         WHERE id = ? AND ${currentAuthority("stage")}`,
      )
      .bind(stagingId)
      .first()) !== null
  );
}

export async function claimSandboxBackupStageActual(
  database: D1Database,
  input: {
    readonly actualBackupId: SandboxBackupId;
    readonly dir: string;
    readonly sandboxIncarnation: number;
    readonly stagingId: SandboxBackupId;
  },
): Promise<{ readonly actualBackupId: SandboxBackupId } | null> {
  const claimed = await database
    .prepare(
      `UPDATE sandbox_backup_staging AS stage
       SET actual_backup_id = ?, updated_at = ${DATABASE_NOW_MS_SQL}
       WHERE id = ? AND sandbox_incarnation = ? AND dir = ?
         AND actual_backup_id IS NULL AND ${currentAuthority("stage")}
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup_delete_intent AS deletion
           WHERE deletion.backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup
           WHERE id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup
           WHERE backup_id = ?
           UNION ALL
           SELECT 1 FROM environment_package_artifact_backup_staging
           WHERE actual_backup_id = ?
         )
       RETURNING actual_backup_id`,
    )
    .bind(
      input.actualBackupId,
      input.stagingId,
      input.sandboxIncarnation,
      input.dir,
      input.actualBackupId,
      input.actualBackupId,
      input.actualBackupId,
      input.actualBackupId,
    )
    .first<{ actual_backup_id: SandboxBackupId }>();
  if (claimed !== null) {
    return { actualBackupId: claimed.actual_backup_id };
  }

  const winner = await database
    .prepare(
      `SELECT actual_backup_id
       FROM (
         SELECT actual_backup_id, 0 AS priority
         FROM sandbox_backup_staging
         WHERE id = ? AND actual_backup_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup_delete_intent AS deletion
             WHERE deletion.backup_id = sandbox_backup_staging.actual_backup_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup
             WHERE id = sandbox_backup_staging.actual_backup_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM environment_package_artifact_backup
             WHERE backup_id = sandbox_backup_staging.actual_backup_id
             UNION ALL
             SELECT 1 FROM environment_package_artifact_backup_staging
             WHERE actual_backup_id = sandbox_backup_staging.actual_backup_id
           )
         UNION ALL
         SELECT id AS actual_backup_id, 1 AS priority
         FROM sandbox_backup
         WHERE staging_id = ? AND status = 'ready'
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup_delete_intent AS deletion
             WHERE deletion.backup_id = sandbox_backup.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM environment_package_artifact_backup
             WHERE backup_id = sandbox_backup.id
             UNION ALL
             SELECT 1 FROM environment_package_artifact_backup_staging
             WHERE actual_backup_id = sandbox_backup.id
           )
       )
       ORDER BY priority
       LIMIT 1`,
    )
    .bind(input.stagingId, input.stagingId)
    .first<{ actual_backup_id: SandboxBackupId }>();
  return winner === null ? null : { actualBackupId: winner.actual_backup_id };
}

export async function clearMissingSandboxBackupStageActual(
  database: D1Database,
  input: { readonly actualBackupId: SandboxBackupId; readonly stagingId: SandboxBackupId },
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE sandbox_backup_staging
       SET actual_backup_id = NULL, updated_at = ${DATABASE_NOW_MS_SQL}
       WHERE id = ? AND actual_backup_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup
           WHERE staging_id = sandbox_backup_staging.id
         )`,
    )
    .bind(input.stagingId, input.actualBackupId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function revokeSandboxBackupStage(
  database: D1Database,
  input: { readonly onlyIfStale?: boolean; readonly stagingId: SandboxBackupId },
): Promise<{ readonly actualBackupId: SandboxBackupId | null } | null> {
  const row = await database
    .prepare(
      `DELETE FROM sandbox_backup_staging AS stage
       WHERE id = ?${input.onlyIfStale === true ? ` AND NOT (${currentAuthority("stage")})` : ""}
       RETURNING actual_backup_id`,
    )
    .bind(input.stagingId)
    .first<{ actual_backup_id: SandboxBackupId | null }>();
  return row === null ? null : { actualBackupId: row.actual_backup_id };
}

export async function listSandboxBackupStages(
  database: D1Database,
  limit: number,
): Promise<SandboxBackupStage[]> {
  assertPositiveSafeInteger(limit, "Sandbox backup stage limit");
  return getAppDatabase(database)
    .select()
    .from(sandboxBackupStagingTable)
    .orderBy(asc(sandboxBackupStagingTable.updatedAt), asc(sandboxBackupStagingTable.id))
    .limit(limit)
    .all();
}

export async function deferSandboxBackupStageRepair(
  database: D1Database,
  stage: Pick<SandboxBackupStage, "id" | "updatedAt">,
): Promise<boolean> {
  return (
    (await database
      .prepare(
        `UPDATE sandbox_backup_staging
         SET updated_at = max(${DATABASE_NOW_MS_SQL}, updated_at + 1)
         WHERE id = ? AND updated_at = ? AND updated_at < 9007199254740991
         RETURNING id`,
      )
      .bind(stage.id, stage.updatedAt)
      .first()) !== null
  );
}

export interface FinalizeSandboxBackupResult {
  readonly backup: SandboxBackupRecord;
  readonly candidateAccepted: boolean;
  readonly complete: boolean;
}

export async function finalizeSandboxBackupStage(
  database: D1Database,
  input: { readonly actualBackupId: SandboxBackupId; readonly stagingId: SandboxBackupId },
): Promise<FinalizeSandboxBackupResult | null> {
  const stage = await getSandboxBackupStage(database, input.stagingId);
  if (stage === null) {
    const finalized = await getSandboxBackupRecordByStagingId(database, input.stagingId);
    return finalized === null
      ? null
      : {
          backup: finalized,
          candidateAccepted: finalized.id === input.actualBackupId,
          complete: true,
        };
  }
  const scope: SandboxBackupScope = {
    dir: stage.dir,
    operationId: stage.operationId,
    sandboxId: stage.sandboxId,
    sandboxIncarnation: stage.sandboxIncarnation,
    sessionRunId: stage.sessionRunId,
  };
  const existing = await getFinalizedSandboxBackupByScope(database, scope);
  if (existing !== null && existing.stagingId !== stage.id) {
    await revokeSandboxBackupStage(database, { stagingId: stage.id });
    return { backup: existing, candidateAccepted: false, complete: true };
  }
  if (stage.actualBackupId !== input.actualBackupId) {
    return null;
  }

  await database.batch([
    database
      .prepare(
        `INSERT INTO sandbox_backup (
          created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
          session_run_id, staging_id, status, ttl_seconds, updated_at, workspace_session_id
        )
        SELECT created_at, dir, actual_backup_id, 0, operation_id, sandbox_id,
          sandbox_incarnation, session_run_id, id, 'ready', ttl_seconds,
          ${DATABASE_NOW_MS_SQL}, workspace_session_id
        FROM sandbox_backup_staging AS stage
        WHERE id = ? AND actual_backup_id = ? AND ${currentAuthority("stage")}
          AND NOT EXISTS (
            SELECT 1 FROM sandbox_backup_delete_intent AS deletion
            WHERE deletion.backup_id = stage.actual_backup_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM sandbox_backup AS existing
            WHERE existing.id = stage.actual_backup_id
              OR existing.staging_id = stage.id
              OR (existing.sandbox_id = stage.sandbox_id
                AND existing.sandbox_incarnation = stage.sandbox_incarnation
                AND existing.dir = stage.dir
                AND ((stage.operation_id IS NOT NULL
                    AND existing.operation_id = stage.operation_id)
                  OR (stage.session_run_id IS NOT NULL
                    AND existing.session_run_id = stage.session_run_id)))
          )
          AND NOT EXISTS (
            SELECT 1 FROM environment_package_artifact_backup
            WHERE backup_id = stage.actual_backup_id
            UNION ALL
            SELECT 1 FROM environment_package_artifact_backup_staging
            WHERE actual_backup_id = stage.actual_backup_id
          )
        ON CONFLICT DO NOTHING`,
      )
      .bind(stage.id, input.actualBackupId),
    database
      .prepare(
        `UPDATE native_resume_ref
         SET committed_session_run_id = observed_session_run_id, committed_value = value
         WHERE EXISTS (
           SELECT 1 FROM sandbox_backup_staging AS stage
           JOIN sandbox_backup AS finalized
             ON finalized.staging_id = stage.id AND finalized.id = stage.actual_backup_id
           WHERE stage.id = ? AND stage.session_run_id = observed_session_run_id
             AND stage.workspace_session_id = native_resume_ref.session_id
             AND ${currentAuthority("stage")}
         )`,
      )
      .bind(stage.id),
    database
      .prepare(
        `UPDATE sandbox
         SET last_backup_id = ?, updated_at = ${DATABASE_NOW_MS_SQL}
         WHERE id = ? AND incarnation = ?
           AND status = 'backing_up' AND status_operation_id IS ?
           AND EXISTS (
             SELECT 1 FROM sandbox_backup_staging AS stage
             JOIN sandbox_backup AS finalized
               ON finalized.staging_id = stage.id AND finalized.id = stage.actual_backup_id
             WHERE stage.id = ? AND stage.updates_subject_backup = 1
               AND ${currentAuthority("stage")}
           )`,
      )
      .bind(
        input.actualBackupId,
        stage.sandboxId,
        stage.sandboxIncarnation,
        stage.operationId,
        stage.id,
      ),
    database
      .prepare(
        `DELETE FROM sandbox_backup_staging AS stage
         WHERE id = ? AND actual_backup_id = ?
           AND EXISTS (
             SELECT 1 FROM sandbox_backup AS finalized
             WHERE finalized.staging_id = stage.id AND finalized.id = stage.actual_backup_id
               AND finalized.status = 'ready'
           )
           AND (updates_subject_backup = 0 OR EXISTS (
             SELECT 1 FROM sandbox AS subject
             WHERE subject.id = stage.sandbox_id
               AND subject.incarnation = stage.sandbox_incarnation
               AND subject.last_backup_id = stage.actual_backup_id
           ))
           AND NOT EXISTS (
             SELECT 1 FROM native_resume_ref AS native_ref
             WHERE native_ref.session_id = stage.workspace_session_id
               AND native_ref.observed_session_run_id = stage.session_run_id
               AND native_ref.committed_session_run_id IS NOT stage.session_run_id
           )`,
      )
      .bind(stage.id, input.actualBackupId),
  ]);
  const finalized =
    (await getSandboxBackupRecordByStagingId(database, stage.id)) ??
    (await getFinalizedSandboxBackupByScope(database, scope));
  return finalized === null
    ? null
    : {
        backup: finalized,
        candidateAccepted: finalized.id === input.actualBackupId,
        complete: (await getSandboxBackupStage(database, stage.id)) === null,
      };
}

export async function listReadySandboxBackupsForSessionRun(
  database: D1Database,
  input: { readonly sandboxId: string; readonly sessionRunId: string },
): Promise<Array<{ readonly dir: string; readonly id: SandboxBackupId }>> {
  const sandboxId = parsePlatformId<SandboxId>(input.sandboxId, "sandbox id");
  const sessionRunId = parsePlatformId<SessionRunId>(input.sessionRunId, "session run id");
  return getAppDatabase(database)
    .select({ dir: sandboxBackupsTable.dir, id: sandboxBackupsTable.id })
    .from(sandboxBackupsTable)
    .where(
      and(
        eq(sandboxBackupsTable.sandboxId, sandboxId),
        eq(sandboxBackupsTable.sessionRunId, sessionRunId),
        eq(sandboxBackupsTable.status, "ready"),
      ),
    )
    .all();
}

export interface ReadySandboxBackupForPruning {
  readonly createdAt: number;
  readonly dir: string;
  readonly id: SandboxBackupId;
  readonly keep: boolean;
  readonly protected: boolean;
  readonly sandboxId: SandboxId;
}

export async function listReadySandboxBackupsForPruning(
  database: D1Database,
  sandboxIdInput: string,
): Promise<ReadySandboxBackupForPruning[]> {
  const sandboxId = parsePlatformId<SandboxId>(sandboxIdInput, "sandbox id");
  const rows = await database
    .prepare(
      `SELECT backup.created_at, backup.dir, backup.id, backup.keep, backup.sandbox_id,
        CASE WHEN EXISTS (SELECT 1 FROM sandbox WHERE last_backup_id = backup.id)
          OR EXISTS (
            SELECT 1 FROM sandbox
            WHERE status = 'restoring' AND last_restore_backup_id = backup.id
          )
          OR EXISTS (
            SELECT 1 FROM session
            WHERE id = backup.workspace_session_id
              AND runtime_provisioning_operation_id IS NOT NULL
          )
          OR EXISTS (
            SELECT 1 FROM sandbox_backup_staging AS stage
            WHERE stage.id = backup.staging_id OR stage.actual_backup_id = backup.id
          )
        THEN 1 ELSE 0 END AS protected
       FROM sandbox_backup AS backup
       WHERE backup.sandbox_id = ? AND backup.status = 'ready'
       ORDER BY backup.dir ASC, backup.created_at DESC, backup.id DESC`,
    )
    .bind(sandboxId)
    .all<{
      created_at: number;
      dir: string;
      id: SandboxBackupId;
      keep: number;
      protected: number;
      sandbox_id: SandboxId;
    }>();
  return rows.results.map((row) => ({
    createdAt: row.created_at,
    dir: row.dir,
    id: row.id,
    keep: row.keep === 1,
    protected: row.protected === 1,
    sandboxId: row.sandbox_id,
  }));
}

export async function markSandboxBackupsPruned(
  database: D1Database,
  backupIds: readonly SandboxBackupId[],
): Promise<SandboxBackupId[]> {
  const pruned: SandboxBackupId[] = [];
  for (const id of backupIds) {
    const row = await database
      .prepare(
        `UPDATE sandbox_backup AS backup
         SET status = 'pruned', updated_at = ${DATABASE_NOW_MS_SQL}
         WHERE id = ? AND status = 'ready' AND keep = 0
           AND NOT EXISTS (SELECT 1 FROM sandbox WHERE last_backup_id = backup.id)
           AND NOT EXISTS (
             SELECT 1 FROM sandbox
             WHERE status = 'restoring' AND last_restore_backup_id = backup.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM session
             WHERE id = backup.workspace_session_id
               AND runtime_provisioning_operation_id IS NOT NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup_staging AS stage
             WHERE stage.id = backup.staging_id OR stage.actual_backup_id = backup.id
           )
         RETURNING id`,
      )
      .bind(id)
      .first<{ id: SandboxBackupId }>();
    if (row !== null) {
      pruned.push(row.id);
    }
  }
  return pruned;
}

export interface SandboxSessionBackupCandidate {
  readonly cwd: string;
  readonly lastMessageAt: number | null;
  readonly sessionId: SessionId;
  readonly sessionStatus: SessionStatus;
}

export async function listSandboxSessionBackupCandidates(
  database: D1Database,
  sandboxIdInput: string,
  sandboxIncarnation: number,
): Promise<SandboxSessionBackupCandidate[]> {
  assertPositiveSafeInteger(sandboxIncarnation, "Sandbox backup candidate incarnation");
  const sandboxId = parsePlatformId<SandboxId>(sandboxIdInput, "sandbox id");
  return getAppDatabase(database)
    .select({
      cwd: sandboxSessionsTable.cwd,
      lastMessageAt: sessionsTable.lastMessageAt,
      sessionId: sandboxSessionsTable.sessionId,
      sessionStatus: sessionsTable.status,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, sandboxId),
        eq(sandboxSessionsTable.sandboxIncarnation, sandboxIncarnation),
        inArray(sandboxSessionsTable.status, ["active", "closed"]),
        isNull(sandboxSessionsTable.cleanupOperationId),
        isNull(sessionsTable.archivedAt),
        isNull(sessionsTable.cleanupOperationKind),
      ),
    )
    .all();
}

export async function revokeSandboxBackupsForSessionDelete(
  database: D1Database,
  input: {
    readonly cwd: string;
    readonly operationId: RuntimeOperationId;
    readonly sandboxId: SandboxId;
    readonly sessionId: SessionId;
  },
): Promise<SandboxBackupId[]> {
  const owned = (alias: string) => `EXISTS (
    SELECT 1 FROM session AS deleting_session
    JOIN sandbox_session AS workspace ON workspace.session_id = deleting_session.id
    WHERE deleting_session.id = ?
      AND deleting_session.cleanup_operation_kind = 'delete'
      AND deleting_session.status_operation_id = ?
      AND workspace.sandbox_id = ? AND workspace.cwd = ?
      AND ${alias}.sandbox_id = workspace.sandbox_id
      AND ${alias}.dir = workspace.cwd
  )`;
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM sandbox_backup_staging AS stage
         WHERE stage.workspace_session_id = ? AND stage.sandbox_id = ? AND stage.dir = ?
           AND ${owned("stage")}
         RETURNING actual_backup_id`,
      )
      .bind(
        input.sessionId,
        input.sandboxId,
        input.cwd,
        input.sessionId,
        input.operationId,
        input.sandboxId,
        input.cwd,
      ),
    database
      .prepare(
        `UPDATE sandbox_backup AS backup
         SET status = 'pruned', updated_at = ${DATABASE_NOW_MS_SQL}
         WHERE status = 'ready'
           AND workspace_session_id = ? AND sandbox_id = ? AND dir = ?
           AND ${owned("backup")}
         RETURNING id`,
      )
      .bind(
        input.sessionId,
        input.sandboxId,
        input.cwd,
        input.sessionId,
        input.operationId,
        input.sandboxId,
        input.cwd,
      ),
  ]);
  const ids = new Set<SandboxBackupId>();
  const [stagedResult, finalizedResult] = results;
  if (stagedResult === undefined || finalizedResult === undefined) {
    throw new Error("Session backup cleanup lost its D1 batch results.");
  }
  for (const row of stagedResult.results as Array<{
    actual_backup_id: SandboxBackupId | null;
  }>) {
    if (row.actual_backup_id !== null) {
      ids.add(row.actual_backup_id);
    }
  }
  for (const row of finalizedResult.results as Array<{ id: SandboxBackupId }>) {
    ids.add(row.id);
  }
  return [...ids];
}
