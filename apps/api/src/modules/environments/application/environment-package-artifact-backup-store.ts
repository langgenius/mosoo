import {
  environmentPackageArtifactBackupsTable,
  environmentPackageArtifactBackupStagingTable,
} from "@mosoo/db";
import type { ApiCommandId } from "@mosoo/db";
import type { ProjectId, SandboxBackupId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type {
  EnvironmentPackageArtifactKey,
  EnvironmentPackageArtifactPaths,
} from "../domain/environment-package-artifact";
import {
  environmentPackageArtifactDir,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
  parseEnvironmentPackageArtifactPaths,
} from "../domain/environment-package-artifact";

const DATABASE_NOW_MS_SQL = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export interface EnvironmentPackageArtifactBackupStage {
  readonly actualBackupId: SandboxBackupId | null;
  readonly projectId: ProjectId;
  readonly attemptCount: number;
  readonly claimOwner: string;
  readonly commandId: ApiCommandId;
  readonly createdAt: number;
  readonly deliveryGeneration: number;
  readonly dir: string;
  readonly inputDigest: string;
  readonly paths: EnvironmentPackageArtifactPaths;
  readonly updatedAt: number;
}

export interface EnvironmentPackageArtifactBackupManifest extends EnvironmentPackageArtifactKey {
  readonly attemptCount: number;
  readonly backupId: SandboxBackupId;
  readonly commandId: ApiCommandId;
  readonly committedAt: number;
  readonly deliveryGeneration: number;
  readonly expiresAt: number;
  readonly manifestGeneration: number;
  readonly paths: EnvironmentPackageArtifactPaths;
}

export interface EnvironmentPackageArtifactCommandAuthority extends EnvironmentPackageArtifactKey {
  readonly attemptCount: number;
  readonly commandId: ApiCommandId;
  readonly deliveryGeneration: number;
}

export type EnvironmentPackageArtifactBackupStageAuthority = Pick<
  EnvironmentPackageArtifactBackupStage,
  "attemptCount" | "claimOwner" | "commandId" | "deliveryGeneration"
>;

function mapStage(
  row: typeof environmentPackageArtifactBackupStagingTable.$inferSelect,
): EnvironmentPackageArtifactBackupStage {
  const artifactDir = environmentPackageArtifactDir(row);
  const paths = parseEnvironmentPackageArtifactPaths(JSON.parse(row.pathsJson), artifactDir);
  if (row.dir !== artifactDir || paths === null) {
    throw new Error("Environment package artifact backup stage paths are invalid.");
  }
  return { ...row, paths };
}

function mapManifest(
  row: typeof environmentPackageArtifactBackupsTable.$inferSelect,
): EnvironmentPackageArtifactBackupManifest {
  const paths = parseEnvironmentPackageArtifactPaths(
    JSON.parse(row.pathsJson),
    environmentPackageArtifactDir(row),
  );
  if (paths === null) {
    throw new Error("Environment package artifact backup manifest paths are invalid.");
  }
  return { ...row, paths };
}

export async function getEnvironmentPackageArtifactBackupManifest(
  database: D1Database,
  key: EnvironmentPackageArtifactKey,
): Promise<EnvironmentPackageArtifactBackupManifest | null> {
  const row = await getAppDatabase(database)
    .select()
    .from(environmentPackageArtifactBackupsTable)
    .where(
      and(
        eq(environmentPackageArtifactBackupsTable.projectId, key.projectId),
        eq(environmentPackageArtifactBackupsTable.inputDigest, key.inputDigest),
      ),
    )
    .limit(1)
    .get();
  return row === undefined ? null : mapManifest(row);
}

export async function retireExpiredEnvironmentPackageArtifactBackups(
  database: D1Database,
  limit: number,
): Promise<SandboxBackupId[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new TypeError("Environment package artifact retirement limit must be positive.");
  }
  const rows = await database
    .prepare(
      `DELETE FROM environment_package_artifact_backup
       WHERE backup_id IN (
         SELECT artifact.backup_id
         FROM environment_package_artifact_backup AS artifact
         WHERE artifact.expires_at <= ${DATABASE_NOW_MS_SQL}
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup_delete_intent AS deletion
             WHERE deletion.backup_id = artifact.backup_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup AS backup
             WHERE backup.id = artifact.backup_id AND backup.status = 'ready'
           )
           AND NOT EXISTS (
             SELECT 1 FROM sandbox_backup_staging AS stage
             WHERE stage.actual_backup_id = artifact.backup_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM environment_package_artifact_backup_staging AS stage
             WHERE stage.actual_backup_id = artifact.backup_id
           )
         ORDER BY artifact.expires_at, artifact.backup_id
         LIMIT ?
       )
         AND expires_at <= ${DATABASE_NOW_MS_SQL}
       RETURNING backup_id`,
    )
    .bind(limit)
    .all<{ backup_id: SandboxBackupId }>();
  return rows.results.map((row) => row.backup_id);
}

function commandMatchesStage(alias: string): string {
  return `EXISTS (
    SELECT 1 FROM api_command AS command
    WHERE command.id = ${alias}.command_id
      AND command.kind = 'environment_package_artifact_build'
      AND json_valid(command.payload_json) = 1
      AND json_extract(command.payload_json, '$.projectId') = ${alias}.project_id
      AND json_extract(command.payload_json, '$.inputDigest') = ${alias}.input_digest
      AND command.delivery_generation = ${alias}.delivery_generation
      AND command.attempt_count = ${alias}.attempt_count
      AND command.claim_owner = ${alias}.claim_owner
  )`;
}

export async function getEnvironmentPackageArtifactBackupStage(
  database: D1Database,
  commandId: ApiCommandId,
): Promise<EnvironmentPackageArtifactBackupStage | null> {
  const row = await getAppDatabase(database)
    .select()
    .from(environmentPackageArtifactBackupStagingTable)
    .where(eq(environmentPackageArtifactBackupStagingTable.commandId, commandId))
    .limit(1)
    .get();
  return row === undefined ? null : mapStage(row);
}

function mapCommandAuthority(row: {
  readonly attempt_count: number;
  readonly delivery_generation: number;
  readonly id: string;
  readonly payload_json: string;
}): EnvironmentPackageArtifactCommandAuthority | null {
  try {
    const payload = JSON.parse(row.payload_json) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const projectId = Reflect.get(payload, "projectId");
    const inputDigest = Reflect.get(payload, "inputDigest");
    if (
      typeof projectId !== "string" ||
      typeof inputDigest !== "string" ||
      !Number.isSafeInteger(row.attempt_count) ||
      row.attempt_count <= 0 ||
      !Number.isSafeInteger(row.delivery_generation) ||
      row.delivery_generation <= 0
    ) {
      return null;
    }
    return {
      projectId: parsePlatformId<ProjectId>(projectId, "environment artifact command project ID"),
      attemptCount: row.attempt_count,
      commandId: parsePlatformId<ApiCommandId>(row.id, "environment artifact command ID"),
      deliveryGeneration: row.delivery_generation,
      inputDigest,
    };
  } catch {
    return null;
  }
}

export async function getEnvironmentPackageArtifactCommandIntent(
  database: D1Database,
  commandId: ApiCommandId,
): Promise<EnvironmentPackageArtifactCommandAuthority | null> {
  const row = await database
    .prepare(
      `SELECT attempt_count, delivery_generation, id, payload_json
       FROM api_command
       WHERE id = ? AND kind = 'environment_package_artifact_build'`,
    )
    .bind(commandId)
    .first<{
      attempt_count: number;
      delivery_generation: number;
      id: string;
      payload_json: string;
    }>();
  return row === null ? null : mapCommandAuthority(row);
}

export async function findEnvironmentPackageArtifactCommandAuthority(
  database: D1Database,
  key: EnvironmentPackageArtifactKey,
): Promise<EnvironmentPackageArtifactCommandAuthority | null> {
  const rows = (
    await database
      .prepare(
        `SELECT attempt_count, delivery_generation, id, payload_json
         FROM api_command
         WHERE kind = 'environment_package_artifact_build'
           AND json_valid(payload_json) = 1
           AND json_extract(payload_json, '$.projectId') = ?
           AND json_extract(payload_json, '$.inputDigest') = ?
         ORDER BY id
         LIMIT 2`,
      )
      .bind(key.projectId, key.inputDigest)
      .all<{
        attempt_count: number;
        delivery_generation: number;
        id: string;
        payload_json: string;
      }>()
  ).results;
  return rows.length === 1 ? mapCommandAuthority(rows[0]!) : null;
}

function manifestMatches(
  manifest: EnvironmentPackageArtifactBackupManifest,
  input: {
    readonly backupId: SandboxBackupId;
    readonly commandId: ApiCommandId;
    readonly attemptCount: number;
    readonly deliveryGeneration: number;
    readonly expiresAt: number;
    readonly key: EnvironmentPackageArtifactKey;
    readonly paths: EnvironmentPackageArtifactPaths;
  },
): boolean {
  return (
    manifest.backupId === input.backupId &&
    manifest.commandId === input.commandId &&
    manifest.attemptCount === input.attemptCount &&
    manifest.deliveryGeneration === input.deliveryGeneration &&
    manifest.expiresAt === input.expiresAt &&
    manifest.projectId === input.key.projectId &&
    manifest.inputDigest === input.key.inputDigest &&
    JSON.stringify(manifest.paths) === JSON.stringify(input.paths)
  );
}

export async function commitEnvironmentPackageArtifactBackup(
  database: D1Database,
  input: EnvironmentPackageArtifactBackupStageAuthority & {
    readonly actualBackupId: SandboxBackupId;
    readonly expiresAt: number;
    readonly key: EnvironmentPackageArtifactKey;
    readonly paths: EnvironmentPackageArtifactPaths;
  },
): Promise<boolean> {
  const paths = parseEnvironmentPackageArtifactPaths(
    input.paths,
    environmentPackageArtifactDir(input.key),
  );
  if (paths === null) {
    throw new Error("Environment package artifact backup paths are invalid.");
  }
  const pathsJson = JSON.stringify(paths);
  const previous = await getEnvironmentPackageArtifactBackupManifest(database, input.key);
  if (
    previous !== null &&
    manifestMatches(previous, { ...input, backupId: input.actualBackupId })
  ) {
    return true;
  }
  if (previous?.backupId === input.actualBackupId) {
    return false;
  }
  const authoritySql = `EXISTS (
    SELECT 1
    FROM environment_package_artifact_backup_staging AS stage
    JOIN api_command AS command ON command.id = stage.command_id
    WHERE stage.command_id = ? AND stage.actual_backup_id = ?
      AND stage.project_id = ? AND stage.input_digest = ? AND stage.dir = ? AND stage.paths_json = ?
      AND stage.delivery_generation = ? AND stage.attempt_count = ?
      AND stage.claim_owner = ? AND command.status = 'running'
      AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}
      AND ${commandMatchesStage("stage")}
      AND NOT EXISTS (
        SELECT 1 FROM sandbox_backup_delete_intent AS deletion
        WHERE deletion.backup_id = stage.actual_backup_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sandbox_backup
        WHERE id = stage.actual_backup_id
        UNION ALL
        SELECT 1 FROM sandbox_backup_staging
        WHERE actual_backup_id = stage.actual_backup_id
      )
  )`;
  const bindings = [
    input.commandId,
    input.actualBackupId,
    input.key.projectId,
    input.key.inputDigest,
    environmentPackageArtifactDir(input.key),
    pathsJson,
    input.deliveryGeneration,
    input.attemptCount,
    input.claimOwner,
  ] as const;
  const insert = async (): Promise<void> => {
    await database
      .prepare(
        `INSERT INTO environment_package_artifact_backup (
           project_id, attempt_count, backup_id, command_id, committed_at,
           delivery_generation, expires_at, input_digest, manifest_generation, paths_json
         )
         SELECT ?, ?, ?, ?, ${DATABASE_NOW_MS_SQL}, ?, ?, ?, 1, ?
         WHERE ${authoritySql}
           AND NOT EXISTS (
             SELECT 1 FROM environment_package_artifact_backup
             WHERE backup_id = ? OR (project_id = ? AND input_digest = ?)
           )`,
      )
      .bind(
        input.key.projectId,
        input.attemptCount,
        input.actualBackupId,
        input.commandId,
        input.deliveryGeneration,
        input.expiresAt,
        input.key.inputDigest,
        pathsJson,
        ...bindings,
        input.actualBackupId,
        input.key.projectId,
        input.key.inputDigest,
      )
      .run();
  };
  if (previous === null) {
    await insert();
  } else {
    await database
      .prepare(
        `UPDATE environment_package_artifact_backup
         SET attempt_count = ?, backup_id = ?, command_id = ?, committed_at = ${DATABASE_NOW_MS_SQL},
           delivery_generation = ?, expires_at = ?, manifest_generation = manifest_generation + 1,
           paths_json = ?
         WHERE project_id = ? AND input_digest = ? AND manifest_generation = ?
           AND backup_id = ? AND ${authoritySql}
           AND NOT EXISTS (
             SELECT 1 FROM environment_package_artifact_backup AS other
             WHERE other.backup_id = ?
               AND (other.project_id <> ? OR other.input_digest <> ?)
           )`,
      )
      .bind(
        input.attemptCount,
        input.actualBackupId,
        input.commandId,
        input.deliveryGeneration,
        input.expiresAt,
        pathsJson,
        input.key.projectId,
        input.key.inputDigest,
        previous.manifestGeneration,
        previous.backupId,
        ...bindings,
        input.actualBackupId,
        input.key.projectId,
        input.key.inputDigest,
      )
      .run();
  }
  let manifest = await getEnvironmentPackageArtifactBackupManifest(database, input.key);
  if (previous !== null && manifest === null) {
    await insert();
    manifest = await getEnvironmentPackageArtifactBackupManifest(database, input.key);
  }
  return (
    manifest !== null && manifestMatches(manifest, { ...input, backupId: input.actualBackupId })
  );
}

export async function adoptLegacyEnvironmentPackageArtifactBackup(
  database: D1Database,
  input: EnvironmentPackageArtifactCommandAuthority & {
    readonly actualBackupId: SandboxBackupId;
    readonly expiresAt: number;
    readonly key: EnvironmentPackageArtifactKey;
    readonly paths: EnvironmentPackageArtifactPaths;
  },
): Promise<boolean> {
  const paths = parseEnvironmentPackageArtifactPaths(
    input.paths,
    environmentPackageArtifactDir(input.key),
  );
  if (paths === null) {
    throw new Error("Environment package artifact backup paths are invalid.");
  }
  const pathsJson = JSON.stringify(paths);
  await database
    .prepare(
      `INSERT INTO environment_package_artifact_backup (
         project_id, attempt_count, backup_id, command_id, committed_at,
         delivery_generation, expires_at, input_digest, manifest_generation, paths_json
       )
       SELECT ?, command.attempt_count, ?, command.id, ${DATABASE_NOW_MS_SQL},
         command.delivery_generation, ?, ?, 1, ?
       FROM api_command AS command
       WHERE command.id = ? AND command.kind = 'environment_package_artifact_build'
         AND command.status = 'succeeded'
         AND command.completed_at IS NOT NULL
         AND command.claim_owner IS NULL AND command.claim_expires_at IS NULL
         AND command.attempt_count = ? AND command.delivery_generation = ?
         AND ? > ${DATABASE_NOW_MS_SQL} + ?
         AND ? <= ${DATABASE_NOW_MS_SQL} + ?
         AND json_valid(command.payload_json) = 1
         AND json_extract(command.payload_json, '$.projectId') = ?
         AND json_extract(command.payload_json, '$.inputDigest') = ?
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup_delete_intent AS deletion
           WHERE deletion.backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup AS artifact
           WHERE artifact.backup_id = ?
             OR (artifact.project_id = ? AND artifact.input_digest = ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup_staging AS stage
           WHERE stage.actual_backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup
           WHERE id = ?
           UNION ALL
           SELECT 1 FROM sandbox_backup_staging
           WHERE actual_backup_id = ?
         )`,
    )
    .bind(
      input.key.projectId,
      input.actualBackupId,
      input.expiresAt,
      input.key.inputDigest,
      pathsJson,
      input.commandId,
      input.attemptCount,
      input.deliveryGeneration,
      input.expiresAt,
      ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS,
      input.expiresAt,
      ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000,
      input.key.projectId,
      input.key.inputDigest,
      input.actualBackupId,
      input.actualBackupId,
      input.actualBackupId,
      input.key.projectId,
      input.key.inputDigest,
      input.actualBackupId,
      input.actualBackupId,
    )
    .run();
  const manifest = await getEnvironmentPackageArtifactBackupManifest(database, input.key);
  return (
    manifest !== null && manifestMatches(manifest, { ...input, backupId: input.actualBackupId })
  );
}

export async function stageEnvironmentPackageArtifactBackup(
  database: D1Database,
  input: {
    readonly attemptCount: number;
    readonly claimOwner: string;
    readonly commandId: ApiCommandId;
    readonly deliveryGeneration: number;
    readonly dir: string;
    readonly key: EnvironmentPackageArtifactKey;
    readonly paths: EnvironmentPackageArtifactPaths;
  },
): Promise<EnvironmentPackageArtifactBackupStage> {
  if (
    !Number.isSafeInteger(input.deliveryGeneration) ||
    input.deliveryGeneration <= 0 ||
    !Number.isSafeInteger(input.attemptCount) ||
    input.attemptCount <= 0
  ) {
    throw new Error("Environment package artifact attempt must be a positive safe integer.");
  }
  const artifactDir = environmentPackageArtifactDir(input.key);
  const paths = parseEnvironmentPackageArtifactPaths(input.paths, artifactDir);
  if (input.dir !== artifactDir || paths === null) {
    throw new Error("Environment package artifact backup paths are invalid.");
  }
  const pathsJson = JSON.stringify(paths);
  await database
    .prepare(
      `DELETE FROM environment_package_artifact_backup_staging AS stage
       WHERE stage.command_id = ?
         AND (
           stage.delivery_generation <> ? OR stage.attempt_count <> ? OR stage.claim_owner <> ?
         )
         AND EXISTS (
           SELECT 1 FROM api_command AS command
           WHERE command.id = stage.command_id
             AND command.kind = 'environment_package_artifact_build'
             AND command.status = 'running' AND command.claim_owner = ?
             AND command.delivery_generation = ? AND command.attempt_count = ?
             AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}
             AND json_valid(command.payload_json) = 1
             AND json_extract(command.payload_json, '$.projectId') = ?
             AND json_extract(command.payload_json, '$.inputDigest') = ?
         )
      `,
    )
    .bind(
      input.commandId,
      input.deliveryGeneration,
      input.attemptCount,
      input.claimOwner,
      input.claimOwner,
      input.deliveryGeneration,
      input.attemptCount,
      input.key.projectId,
      input.key.inputDigest,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO environment_package_artifact_backup_staging (
         actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
         delivery_generation, dir, input_digest, paths_json, updated_at
       )
       SELECT NULL, ?, ?, ?, ?, ${DATABASE_NOW_MS_SQL}, ?, ?, ?, ?, ${DATABASE_NOW_MS_SQL}
       WHERE EXISTS (
         SELECT 1 FROM api_command AS command
         WHERE command.id = ? AND command.kind = 'environment_package_artifact_build'
           AND command.status = 'running' AND command.claim_owner = ?
           AND command.delivery_generation = ? AND command.attempt_count = ?
           AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}
           AND json_valid(command.payload_json) = 1
           AND json_extract(command.payload_json, '$.projectId') = ?
           AND json_extract(command.payload_json, '$.inputDigest') = ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM environment_package_artifact_backup_staging AS existing
         WHERE existing.command_id = ?
           OR (existing.project_id = ? AND existing.input_digest = ?)
       )
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.key.projectId,
      input.attemptCount,
      input.claimOwner,
      input.commandId,
      input.deliveryGeneration,
      input.dir,
      input.key.inputDigest,
      pathsJson,
      input.commandId,
      input.claimOwner,
      input.deliveryGeneration,
      input.attemptCount,
      input.key.projectId,
      input.key.inputDigest,
      input.commandId,
      input.key.projectId,
      input.key.inputDigest,
    )
    .run();
  const stage = await getEnvironmentPackageArtifactBackupStage(database, input.commandId);
  if (
    stage === null ||
    stage.projectId !== input.key.projectId ||
    stage.attemptCount !== input.attemptCount ||
    stage.claimOwner !== input.claimOwner ||
    stage.deliveryGeneration !== input.deliveryGeneration ||
    stage.inputDigest !== input.key.inputDigest ||
    stage.dir !== input.dir ||
    JSON.stringify(stage.paths) !== pathsJson
  ) {
    throw new Error("Environment package artifact backup lost its immutable stage.");
  }
  const owned = await database
    .prepare(
      `SELECT 1
       FROM environment_package_artifact_backup_staging AS stage
       JOIN api_command AS command ON command.id = stage.command_id
       WHERE stage.command_id = ? AND command.status = 'running'
         AND command.claim_owner = ? AND command.delivery_generation = ?
         AND command.attempt_count = ?
         AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}
         AND ${commandMatchesStage("stage")}`,
    )
    .bind(input.commandId, input.claimOwner, input.deliveryGeneration, input.attemptCount)
    .first();
  if (owned === null) {
    throw new Error("Environment package artifact build lost its API command lease.");
  }
  return stage;
}

export async function claimEnvironmentPackageArtifactBackupActual(
  database: D1Database,
  input: {
    readonly actualBackupId: SandboxBackupId;
    readonly authority: {
      readonly attemptCount: number;
      readonly claimOwner: string;
      readonly deliveryGeneration: number;
    };
    readonly commandId: ApiCommandId;
    readonly dir: string;
  },
): Promise<{ readonly actualBackupId: SandboxBackupId } | null> {
  const authorityBindings = [
    input.authority.claimOwner,
    input.authority.deliveryGeneration,
    input.authority.attemptCount,
  ] as const;
  const authorityPredicate = `command.status = 'running' AND command.claim_owner = ? AND command.delivery_generation = ? AND command.attempt_count = ? AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}`;
  const claimed = await database
    .prepare(
      `UPDATE environment_package_artifact_backup_staging AS stage
       SET actual_backup_id = ?, updated_at = ${DATABASE_NOW_MS_SQL}
       WHERE stage.command_id = ? AND stage.dir = ? AND stage.actual_backup_id IS NULL
         AND EXISTS (
           SELECT 1 FROM api_command AS command
           WHERE command.id = stage.command_id AND ${authorityPredicate}
         )
         AND ${commandMatchesStage("stage")}
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup_delete_intent AS deletion
           WHERE deletion.backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup AS artifact
           WHERE artifact.backup_id = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup
           WHERE id = ?
           UNION ALL
           SELECT 1 FROM sandbox_backup_staging
           WHERE actual_backup_id = ?
         )
       RETURNING actual_backup_id`,
    )
    .bind(
      input.actualBackupId,
      input.commandId,
      input.dir,
      ...authorityBindings,
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
      `SELECT stage.actual_backup_id
       FROM environment_package_artifact_backup_staging AS stage
       JOIN api_command AS command ON command.id = stage.command_id
       WHERE stage.command_id = ? AND stage.dir = ? AND stage.actual_backup_id IS NOT NULL
         AND ${authorityPredicate} AND ${commandMatchesStage("stage")}
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup_delete_intent AS deletion
           WHERE deletion.backup_id = stage.actual_backup_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM environment_package_artifact_backup AS artifact
           WHERE artifact.backup_id = stage.actual_backup_id
         )
         AND NOT EXISTS (
           SELECT 1 FROM sandbox_backup
           WHERE id = stage.actual_backup_id
           UNION ALL
           SELECT 1 FROM sandbox_backup_staging
           WHERE actual_backup_id = stage.actual_backup_id
         )`,
    )
    .bind(input.commandId, input.dir, ...authorityBindings)
    .first<{ actual_backup_id: SandboxBackupId }>();
  return winner === null ? null : { actualBackupId: winner.actual_backup_id };
}

export async function clearMissingEnvironmentPackageArtifactBackupActual(
  database: D1Database,
  input: EnvironmentPackageArtifactBackupStageAuthority & {
    readonly actualBackupId: SandboxBackupId;
  },
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE environment_package_artifact_backup_staging
       SET actual_backup_id = NULL, updated_at = ${DATABASE_NOW_MS_SQL}
       WHERE command_id = ? AND delivery_generation = ? AND attempt_count = ?
         AND claim_owner = ? AND actual_backup_id = ?`,
    )
    .bind(
      input.commandId,
      input.deliveryGeneration,
      input.attemptCount,
      input.claimOwner,
      input.actualBackupId,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function completeEnvironmentPackageArtifactBackupStage(
  database: D1Database,
  input: EnvironmentPackageArtifactBackupStageAuthority & {
    readonly actualBackupId: SandboxBackupId | null;
  },
): Promise<boolean> {
  const result = await database
    .prepare(
      `DELETE FROM environment_package_artifact_backup_staging
       WHERE command_id = ? AND delivery_generation = ? AND attempt_count = ?
         AND claim_owner = ? AND actual_backup_id IS ?
         AND EXISTS (
           SELECT 1 FROM environment_package_artifact_backup AS artifact
           WHERE artifact.project_id = environment_package_artifact_backup_staging.project_id
             AND artifact.input_digest = environment_package_artifact_backup_staging.input_digest
             AND artifact.backup_id = environment_package_artifact_backup_staging.actual_backup_id
             AND artifact.command_id = environment_package_artifact_backup_staging.command_id
             AND artifact.delivery_generation = environment_package_artifact_backup_staging.delivery_generation
             AND artifact.attempt_count = environment_package_artifact_backup_staging.attempt_count
             AND artifact.paths_json = environment_package_artifact_backup_staging.paths_json
         )`,
    )
    .bind(
      input.commandId,
      input.deliveryGeneration,
      input.attemptCount,
      input.claimOwner,
      input.actualBackupId,
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function revokeTerminalEnvironmentPackageArtifactBackupStage(
  database: D1Database,
  commandId: ApiCommandId,
): Promise<SandboxBackupId | null> {
  const row = await database
    .prepare(
      `DELETE FROM environment_package_artifact_backup_staging AS stage
       WHERE stage.command_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM api_command AS command
           WHERE command.id = stage.command_id AND command.status = 'running'
             AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}
             AND ${commandMatchesStage("stage")}
         )
       RETURNING actual_backup_id`,
    )
    .bind(commandId)
    .first<{ actual_backup_id: SandboxBackupId | null }>();
  return row?.actual_backup_id ?? null;
}

export async function revokeTerminalEnvironmentPackageArtifactBackupStages(
  database: D1Database,
): Promise<number> {
  const result = await database
    .prepare(
      `DELETE FROM environment_package_artifact_backup_staging AS stage
       WHERE stage.command_id IN (
         SELECT candidate.command_id
         FROM environment_package_artifact_backup_staging AS candidate
         WHERE NOT EXISTS (
           SELECT 1 FROM api_command AS command
           WHERE command.id = candidate.command_id
             AND command.status = 'running'
             AND command.claim_expires_at > ${DATABASE_NOW_MS_SQL}
             AND command.kind = 'environment_package_artifact_build'
             AND json_valid(command.payload_json) = 1
             AND json_extract(command.payload_json, '$.projectId') = candidate.project_id
             AND json_extract(command.payload_json, '$.inputDigest') = candidate.input_digest
             AND command.delivery_generation = candidate.delivery_generation
             AND command.attempt_count = candidate.attempt_count
             AND command.claim_owner = candidate.claim_owner
         )
         ORDER BY candidate.updated_at, candidate.command_id
         LIMIT 64
       )`,
    )
    .run();
  return result.meta.changes ?? 0;
}
