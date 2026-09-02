import { fileRecordsTable, runtimeArtifactAttemptsTable } from "@mosoo/db";
import type { AccountId, FileId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { stringifyRuntimeEventSemanticValue } from "@mosoo/runtime-events";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  createRuntimeOutputContentSha256,
  deleteRuntimeArtifactObject,
} from "../../../files/application/file-store";
import type { DriverRuntimeEventFence } from "../../../sessions/infrastructure/session-runtime-event-store.types";
import {
  normalizeRuntimeSessionOutputRelativePath,
  toRuntimeSessionOutputArtifactPath,
} from "./runtime-session-outputs";

const RUNTIME_ARTIFACT_STAGE_TTL_MS = 24 * 60 * 60_000;
const RUNTIME_ARTIFACT_DELETE_QUARANTINE_MS = 7 * 24 * 60 * 60_000;
const RUNTIME_ARTIFACT_DELETE_LEASE_MS = 5 * 60_000;
const RUNTIME_ARTIFACT_CLEANUP_BATCH_SIZE = 25;

export interface RuntimeArtifactCapturePlanFile {
  readonly contentType: string | null;
  readonly expectedSize: number;
  readonly fileId: FileId;
  readonly name: string;
  readonly objectKey: string;
  readonly operation: "upsert";
  readonly readPath: string;
  readonly sourcePath: string;
}

export type RuntimeArtifactCaptureStatus =
  | "complete"
  | "omitted_file_limit"
  | "omitted_runtime_unavailable"
  | "omitted_size_limit"
  | "omitted_source_changed"
  | "omitted_source_missing";

export interface RuntimeArtifactCapturePlan {
  readonly captureStatus: RuntimeArtifactCaptureStatus;
  readonly files: readonly (
    | RuntimeArtifactCapturePlanFile
    | { readonly operation: "delete"; readonly sourcePath: string }
  )[];
  readonly mode: "delta" | "snapshot";
  readonly version: 1;
}

export interface RuntimeArtifactUpsertManifestFile {
  readonly contentSha256: string;
  readonly contentType: string | null;
  readonly disposition: "create" | "reuse";
  readonly etag: string;
  readonly fileId: FileId;
  readonly name: string;
  readonly objectKey: string;
  readonly operation: "upsert";
  readonly parentPath: string;
  readonly path: string;
  readonly size: number;
  readonly sourcePath: string;
}

export interface RuntimeArtifactDeleteManifestFile {
  readonly operation: "delete";
  readonly sourcePath: string;
}

export type RuntimeArtifactManifestFile =
  | RuntimeArtifactDeleteManifestFile
  | RuntimeArtifactUpsertManifestFile;

export interface RuntimeArtifactManifest {
  readonly captureStatus: RuntimeArtifactCaptureStatus;
  readonly files: readonly RuntimeArtifactManifestFile[];
  readonly mode: "delta" | "snapshot";
  readonly semanticHash: string;
  readonly sourceEventId: string;
  readonly version: 1;
}

export interface StagedRuntimeArtifactProjection {
  readonly attemptId: string;
  readonly manifestJson: string;
  readonly manifestSha256: string;
}

export interface ReadyRuntimeArtifactRecord {
  readonly contentType: string | null;
  readonly etag: string;
  readonly fileId: FileId;
  readonly name: string;
  readonly objectKey: string;
  readonly parentPath: string;
  readonly path: string;
  readonly size: number;
}

interface RuntimeArtifactAttemptIdentity {
  readonly createdByAccountId: AccountId;
  readonly driverFence: DriverRuntimeEventFence;
  readonly eventType: string;
  readonly runId: SessionRunId;
  readonly semanticHash: string;
  readonly sessionId: SessionId;
  readonly sourceEventId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Runtime artifact manifest ${key} must be a non-empty string.`);
  }
  return value;
}

function parseManifestFile(value: unknown): RuntimeArtifactManifestFile {
  if (!isRecord(value)) {
    throw new Error("Runtime artifact manifest file must be an object.");
  }
  const operation = value["operation"];
  const sourcePath = readRequiredString(value, "sourcePath");
  if (operation === "delete") {
    return { operation, sourcePath };
  }
  const contentType = value["contentType"];
  const disposition = value["disposition"];
  const size = value["size"];
  if (
    operation !== "upsert" ||
    (contentType !== null && typeof contentType !== "string") ||
    (disposition !== "create" && disposition !== "reuse") ||
    !Number.isSafeInteger(size) ||
    (size as number) < 0
  ) {
    throw new Error("Runtime artifact manifest file has invalid storage metadata.");
  }
  const contentSha256 = readRequiredString(value, "contentSha256");
  if (!/^[0-9a-f]{64}$/.test(contentSha256)) {
    throw new Error("Runtime artifact manifest content hash is invalid.");
  }
  return {
    contentSha256,
    contentType,
    disposition,
    etag: readRequiredString(value, "etag"),
    fileId: readRequiredString(value, "fileId") as FileId,
    name: readRequiredString(value, "name"),
    objectKey: readRequiredString(value, "objectKey"),
    operation,
    parentPath: readRequiredString(value, "parentPath"),
    path: readRequiredString(value, "path"),
    size: size as number,
    sourcePath,
  };
}

export function parseRuntimeArtifactManifest(value: string): RuntimeArtifactManifest {
  const parsed: unknown = JSON.parse(value);
  if (
    !isRecord(parsed) ||
    parsed["version"] !== 1 ||
    (parsed["captureStatus"] !== "complete" &&
      parsed["captureStatus"] !== "omitted_file_limit" &&
      parsed["captureStatus"] !== "omitted_runtime_unavailable" &&
      parsed["captureStatus"] !== "omitted_size_limit" &&
      parsed["captureStatus"] !== "omitted_source_changed" &&
      parsed["captureStatus"] !== "omitted_source_missing") ||
    (parsed["mode"] !== "delta" && parsed["mode"] !== "snapshot") ||
    !Array.isArray(parsed["files"])
  ) {
    throw new Error("Runtime artifact manifest is invalid.");
  }
  const sourceEventId = readRequiredString(parsed, "sourceEventId");
  const semanticHash = readRequiredString(parsed, "semanticHash");
  if (!/^[0-9a-f]{64}$/.test(semanticHash)) {
    throw new Error("Runtime artifact manifest semantic hash is invalid.");
  }
  const files = parsed["files"].map(parseManifestFile);
  if (parsed["captureStatus"] !== "complete" && files.length !== 0) {
    throw new Error("An omitted runtime artifact capture must be empty.");
  }
  const identities = new Set<string>();
  for (const file of files) {
    for (const identity of [
      file.sourcePath,
      ...(file.operation === "upsert" ? [file.fileId, file.path, file.objectKey] : []),
    ]) {
      if (identities.has(identity)) {
        throw new Error("Runtime artifact manifest contains a duplicate file identity.");
      }
      identities.add(identity);
    }
  }
  return {
    captureStatus: parsed["captureStatus"],
    files,
    mode: parsed["mode"],
    semanticHash,
    sourceEventId,
    version: 1,
  };
}

export async function createRuntimeArtifactManifest(
  input: Omit<RuntimeArtifactManifest, "version">,
): Promise<{ manifestJson: string; manifestSha256: string }> {
  const manifest: RuntimeArtifactManifest = {
    ...input,
    files: input.files.toSorted((left, right) =>
      left.sourcePath === right.sourcePath
        ? (left.operation === "upsert" ? left.fileId : "").localeCompare(
            right.operation === "upsert" ? right.fileId : "",
          )
        : left.sourcePath.localeCompare(right.sourcePath),
    ),
    version: 1,
  };
  const manifestJson = stringifyRuntimeEventSemanticValue(manifest);
  return {
    manifestJson,
    manifestSha256: await createRuntimeOutputContentSha256(new TextEncoder().encode(manifestJson)),
  };
}

export async function createRuntimeArtifactAttempt(
  database: D1Database,
  input: RuntimeArtifactAttemptIdentity & {
    readonly attemptId: string;
    readonly timestampMs?: number;
  },
): Promise<void> {
  if (input.driverFence.sessionRunId !== input.runId) {
    throw new Error("Runtime artifact attempt does not match its fenced Session Run.");
  }
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const result = await database
    .prepare(
      `INSERT INTO runtime_artifact_attempt (
         accepted_event_id, created_at, created_by_account_id,
         delete_after, driver_connection_id, driver_generation, driver_instance_id,
         event_type, expires_at, id, manifest_json, manifest_sha256,
         owned_object_keys_json, run_id, semantic_hash, session_id, source_event_id,
         status, updated_at
       )
       SELECT NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]', ?, ?, ?, ?,
              'staging', ?
       FROM session AS session
       INNER JOIN session_run AS run
         ON run.id = ? AND run.session_id = session.id
       INNER JOIN driver_instance AS driver
         ON driver.id = run.driver_instance_id
       WHERE session.id = ?
         AND session.archived_at IS NULL
         AND session.cleanup_operation_kind IS NULL
         AND session.last_run_id = run.id
         AND session.status = 'RUNNING'
         AND session.status_operation_id IS NULL
         AND run.status IN ('queued', 'booting', 'running', 'waiting_input')
         AND driver.id = ?
         AND driver.generation = ?
         AND driver.connection_id = ?
         AND driver.sandbox_session_id = session.id
       RETURNING id`,
    )
    .bind(
      timestampMs,
      input.createdByAccountId,
      input.driverFence.connectionId,
      input.driverFence.generation,
      input.driverFence.driverInstanceId,
      input.eventType,
      timestampMs + RUNTIME_ARTIFACT_STAGE_TTL_MS,
      input.attemptId,
      input.runId,
      input.semanticHash,
      input.sessionId,
      input.sourceEventId,
      timestampMs,
      input.runId,
      input.sessionId,
      input.driverFence.driverInstanceId,
      input.driverFence.generation,
      input.driverFence.connectionId,
    )
    .first<{ id: string }>();

  if (result?.id !== input.attemptId) {
    throw new Error("Runtime artifact attempt lost its active Driver fence.");
  }
}

function exactActiveAttemptFenceSql(): string {
  return `EXISTS (
    SELECT 1
    FROM session AS session
    INNER JOIN session_run AS run
      ON run.id = runtime_artifact_attempt.run_id
     AND run.session_id = session.id
    INNER JOIN driver_instance AS driver
      ON driver.id = run.driver_instance_id
    WHERE session.id = runtime_artifact_attempt.session_id
      AND session.archived_at IS NULL
      AND session.cleanup_operation_kind IS NULL
      AND session.last_run_id = run.id
      AND session.status = 'RUNNING'
      AND session.status_operation_id IS NULL
      AND run.status IN ('queued', 'booting', 'running', 'waiting_input')
      AND driver.id = runtime_artifact_attempt.driver_instance_id
      AND driver.generation = runtime_artifact_attempt.driver_generation
      AND driver.connection_id = runtime_artifact_attempt.driver_connection_id
      AND driver.sandbox_session_id = session.id
  )`;
}

export async function getReadyRuntimeArtifact(
  database: D1Database,
  input: { readonly parentPath: string; readonly sessionId: SessionId },
): Promise<ReadyRuntimeArtifactRecord | null> {
  const row = await getAppDatabase(database)
    .select({
      contentType: fileRecordsTable.mimeType,
      etag: fileRecordsTable.etag,
      fileId: fileRecordsTable.id,
      name: fileRecordsTable.name,
      objectKey: fileRecordsTable.objectKey,
      parentPath: fileRecordsTable.parentPath,
      path: fileRecordsTable.path,
      size: fileRecordsTable.size,
    })
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, input.sessionId),
        eq(fileRecordsTable.sessionKind, "artifact"),
        eq(fileRecordsTable.status, "ready"),
        eq(fileRecordsTable.parentPath, input.parentPath),
      ),
    )
    .get();
  if (row === undefined) {
    return null;
  }
  if (row.etag === null) {
    throw new Error("Ready runtime artifact is missing its object etag.");
  }
  return { ...row, etag: row.etag };
}

export async function claimRuntimeArtifactObjectKey(
  database: D1Database,
  input: { readonly attemptId: string; readonly objectKey: string; readonly timestampMs?: number },
): Promise<void> {
  if (!input.objectKey.startsWith(`runtime-artifact-attempts/v1/${input.attemptId}/files/`)) {
    throw new Error("Runtime artifact object key is outside its attempt namespace.");
  }
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const result = await database
    .prepare(
      `UPDATE runtime_artifact_attempt
       SET owned_object_keys_json = json_insert(owned_object_keys_json, '$[#]', ?),
           updated_at = ?
       WHERE id = ?
         AND status = 'staging'
         AND expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM json_each(owned_object_keys_json) WHERE value = ?
         )
         AND ${exactActiveAttemptFenceSql()}
       RETURNING id`,
    )
    .bind(input.objectKey, timestampMs, input.attemptId, timestampMs, input.objectKey)
    .first<{ id: string }>();
  if (result?.id !== input.attemptId) {
    throw new Error("Runtime artifact object lost its staging ownership fence.");
  }
}

export async function sealRuntimeArtifactAttempt(
  database: D1Database,
  input: StagedRuntimeArtifactProjection & { readonly timestampMs?: number },
): Promise<void> {
  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const manifest = parseRuntimeArtifactManifest(input.manifestJson);
  for (const file of manifest.files) {
    const outputPrefix = "outputs/";
    const relativePath = file.sourcePath.startsWith(outputPrefix)
      ? normalizeRuntimeSessionOutputRelativePath(file.sourcePath.slice(outputPrefix.length))
      : null;
    if (
      relativePath === null ||
      file.sourcePath !== toRuntimeSessionOutputArtifactPath(relativePath)
    ) {
      throw new Error("Runtime artifact manifest source path is not canonical.");
    }
    if (
      file.operation === "upsert" &&
      file.disposition === "create" &&
      !file.objectKey.startsWith(`runtime-artifact-attempts/v1/${input.attemptId}/files/`)
    ) {
      throw new Error("Runtime artifact manifest object is outside its attempt namespace.");
    }
  }
  const expectedManifestSha256 = await createRuntimeOutputContentSha256(
    new TextEncoder().encode(input.manifestJson),
  );
  if (input.manifestSha256 !== expectedManifestSha256) {
    throw new Error("Runtime artifact manifest hash does not match its canonical bytes.");
  }
  const result = await database
    .prepare(
      `UPDATE runtime_artifact_attempt
       SET manifest_json = ?, manifest_sha256 = ?, status = 'staged', updated_at = ?
       WHERE id = ?
         AND status = 'staging'
         AND expires_at > ?
         AND source_event_id = ?
         AND semantic_hash = ?
         AND (
           (event_type = 'run.completed'
             AND json_extract(?, '$.mode') = 'snapshot'
             AND NOT EXISTS (
               SELECT 1 FROM json_each(?, '$.files') AS file
               WHERE json_extract(file.value, '$.operation') = 'delete'
             ))
           OR (event_type IN ('file.change.updated', 'file.changed')
             AND json_extract(?, '$.mode') = 'delta')
         )
         AND ${exactActiveAttemptFenceSql()}
       RETURNING id`,
    )
    .bind(
      input.manifestJson,
      input.manifestSha256,
      timestampMs,
      input.attemptId,
      timestampMs,
      manifest.sourceEventId,
      manifest.semanticHash,
      input.manifestJson,
      input.manifestJson,
      input.manifestJson,
    )
    .first<{ id: string }>();
  if (result?.id !== input.attemptId) {
    throw new Error("Runtime artifact manifest lost its staging ownership fence.");
  }
}

export function prepareRuntimeArtifactPromotion(
  database: D1Database,
  input: StagedRuntimeArtifactProjection & {
    readonly eventId: RuntimeEventId;
    readonly timestampMs: number;
  },
): D1PreparedStatement[] {
  return [
    database
      .prepare(
        `INSERT INTO file_record (
           committed, created_at, created_by_account_id, etag, expires_at, id,
           mime_type, name, object_key, owner_id, owner_kind, parent_path, path,
           purpose, runtime_event_seq, scope_id, scope_kind, session_kind, size,
           status, updated_at, version
         )
         SELECT 1, event.created_at, attempt.created_by_account_id,
                json_extract(file.value, '$.etag'), NULL,
                json_extract(file.value, '$.fileId'),
                json_extract(file.value, '$.contentType'),
                json_extract(file.value, '$.name'),
                json_extract(file.value, '$.objectKey'),
                event.session_id, 'session',
                json_extract(file.value, '$.parentPath'),
                json_extract(file.value, '$.path'),
                'session_artifact', event.seq, event.session_id, 'session', 'artifact',
                json_extract(file.value, '$.size'), 'ready', event.created_at, 1
         FROM runtime_artifact_attempt AS attempt
         INNER JOIN session_event AS event
           ON event.id = ?
          AND event.session_id = attempt.session_id
          AND event.run_id = attempt.run_id
          AND event.source_event_id = attempt.source_event_id
          AND event.semantic_hash = attempt.semantic_hash
          AND event.artifact_attempt_id = attempt.id
          AND event.artifact_manifest_sha256 = attempt.manifest_sha256
         INNER JOIN json_each(attempt.manifest_json, '$.files') AS file
           ON json_extract(file.value, '$.operation') = 'upsert'
          AND json_extract(file.value, '$.disposition') = 'create'
         WHERE attempt.id = ?
           AND attempt.status = 'staged'
           AND attempt.expires_at > ?
           AND attempt.manifest_sha256 = ?`,
      )
      .bind(input.eventId, input.attemptId, input.timestampMs, input.manifestSha256),
    database
      .prepare(
        `UPDATE file_record
         SET runtime_event_seq = MAX(COALESCE(runtime_event_seq, 0), (
               SELECT event.seq FROM session_event AS event WHERE event.id = ?
             )),
             updated_at = MAX(updated_at, (
               SELECT event.created_at FROM session_event AS event WHERE event.id = ?
             ))
         WHERE EXISTS (
           SELECT 1
           FROM runtime_artifact_attempt AS attempt
           INNER JOIN session_event AS event
             ON event.id = ?
            AND event.session_id = attempt.session_id
            AND event.run_id = attempt.run_id
            AND event.source_event_id = attempt.source_event_id
            AND event.semantic_hash = attempt.semantic_hash
            AND event.artifact_attempt_id = attempt.id
            AND event.artifact_manifest_sha256 = attempt.manifest_sha256
           INNER JOIN json_each(attempt.manifest_json, '$.files') AS file
             ON json_extract(file.value, '$.operation') = 'upsert'
            AND json_extract(file.value, '$.disposition') = 'reuse'
           WHERE attempt.id = ?
             AND attempt.status = 'staged'
             AND attempt.expires_at > ?
             AND attempt.manifest_sha256 = ?
             AND file_record.id = json_extract(file.value, '$.fileId')
             AND file_record.scope_kind = 'session'
             AND file_record.scope_id = event.session_id
             AND file_record.session_kind = 'artifact'
             AND file_record.status = 'ready'
             AND file_record.parent_path = json_extract(file.value, '$.parentPath')
             AND file_record.path = json_extract(file.value, '$.path')
             AND file_record.name = json_extract(file.value, '$.name')
             AND file_record.object_key = json_extract(file.value, '$.objectKey')
             AND file_record.etag = json_extract(file.value, '$.etag')
             AND file_record.size = json_extract(file.value, '$.size')
             AND file_record.mime_type IS json_extract(file.value, '$.contentType')
         )`,
      )
      .bind(
        input.eventId,
        input.eventId,
        input.eventId,
        input.attemptId,
        input.timestampMs,
        input.manifestSha256,
      ),
    database
      .prepare(
        `UPDATE session_artifact_head
         SET file_id = NULL,
             runtime_event_seq = (SELECT seq FROM session_event WHERE id = ?),
             source_event_id = (SELECT source_event_id FROM session_event WHERE id = ?),
             updated_at = (SELECT created_at FROM session_event WHERE id = ?)
         WHERE session_id = (SELECT session_id FROM session_event WHERE id = ?)
           AND runtime_event_seq < (SELECT seq FROM session_event WHERE id = ?)
           AND EXISTS (
             SELECT 1
             FROM runtime_artifact_attempt AS attempt
             INNER JOIN session_event AS event
               ON event.id = ?
              AND event.artifact_attempt_id = attempt.id
              AND event.artifact_manifest_sha256 = attempt.manifest_sha256
             WHERE attempt.id = ?
               AND attempt.status = 'staged'
               AND attempt.expires_at > ?
               AND attempt.manifest_sha256 = ?
               AND json_extract(attempt.manifest_json, '$.mode') = 'snapshot'
               AND json_extract(attempt.manifest_json, '$.captureStatus') = 'complete'
           )`,
      )
      .bind(
        input.eventId,
        input.eventId,
        input.eventId,
        input.eventId,
        input.eventId,
        input.eventId,
        input.attemptId,
        input.timestampMs,
        input.manifestSha256,
      ),
    database
      .prepare(
        `INSERT INTO session_artifact_head (
           file_id, runtime_event_seq, session_id, source_event_id, source_path, updated_at
         )
         SELECT CASE
                  WHEN json_extract(file.value, '$.operation') = 'upsert'
                    THEN json_extract(file.value, '$.fileId')
                  ELSE NULL
                END,
                event.seq, event.session_id, event.source_event_id,
                json_extract(file.value, '$.sourcePath'), event.created_at
         FROM runtime_artifact_attempt AS attempt
         INNER JOIN session_event AS event
           ON event.id = ?
          AND event.session_id = attempt.session_id
          AND event.run_id = attempt.run_id
          AND event.source_event_id = attempt.source_event_id
          AND event.semantic_hash = attempt.semantic_hash
          AND event.artifact_attempt_id = attempt.id
          AND event.artifact_manifest_sha256 = attempt.manifest_sha256
         INNER JOIN json_each(attempt.manifest_json, '$.files') AS file ON 1 = 1
         WHERE attempt.id = ?
           AND attempt.status = 'staged'
           AND attempt.expires_at > ?
           AND attempt.manifest_sha256 = ?
         ON CONFLICT(session_id, source_path) DO UPDATE SET
           file_id = excluded.file_id,
           runtime_event_seq = excluded.runtime_event_seq,
           source_event_id = excluded.source_event_id,
           updated_at = excluded.updated_at
         WHERE excluded.runtime_event_seq > session_artifact_head.runtime_event_seq
            OR (
              excluded.runtime_event_seq = session_artifact_head.runtime_event_seq
              AND excluded.source_event_id = session_artifact_head.source_event_id
            )`,
      )
      .bind(input.eventId, input.attemptId, input.timestampMs, input.manifestSha256),
    database
      .prepare(
        `UPDATE runtime_artifact_attempt AS attempt
         SET accepted_event_id = ?, expires_at = NULL, owned_object_keys_json = '[]',
             status = 'accepted', updated_at = ?
         WHERE attempt.id = ?
           AND attempt.status = 'staged'
           AND attempt.expires_at > ?
           AND attempt.manifest_json = ?
           AND attempt.manifest_sha256 = ?
           AND NOT EXISTS (
             SELECT 1
             FROM json_each(attempt.owned_object_keys_json) AS owned
             WHERE NOT EXISTS (
               SELECT 1
               FROM json_each(attempt.manifest_json, '$.files') AS file
               WHERE json_extract(file.value, '$.operation') = 'upsert'
                 AND json_extract(file.value, '$.disposition') = 'create'
                 AND json_extract(file.value, '$.objectKey') = owned.value
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM json_each(attempt.manifest_json, '$.files') AS file
             WHERE json_extract(file.value, '$.operation') = 'upsert'
               AND json_extract(file.value, '$.disposition') = 'create'
               AND NOT EXISTS (
                 SELECT 1
                 FROM json_each(attempt.owned_object_keys_json) AS owned
                 WHERE owned.value = json_extract(file.value, '$.objectKey')
               )
           )
           AND (
             SELECT COUNT(DISTINCT json_extract(file.value, '$.objectKey'))
             FROM json_each(attempt.manifest_json, '$.files') AS file
             WHERE json_extract(file.value, '$.operation') = 'upsert'
               AND json_extract(file.value, '$.disposition') = 'create'
           ) = json_array_length(attempt.owned_object_keys_json)
           AND EXISTS (
             SELECT 1 FROM session_event AS event
             WHERE event.id = ?
               AND event.session_id = attempt.session_id
               AND event.run_id = attempt.run_id
               AND event.source_event_id = attempt.source_event_id
               AND event.semantic_hash = attempt.semantic_hash
               AND event.artifact_attempt_id = attempt.id
               AND event.artifact_manifest_json = attempt.manifest_json
               AND event.artifact_manifest_sha256 = attempt.manifest_sha256
           )
           AND NOT EXISTS (
             SELECT 1
             FROM json_each(attempt.manifest_json, '$.files') AS file
             INNER JOIN session_event AS event ON event.id = ?
             WHERE NOT EXISTS (
               SELECT 1
               FROM session_artifact_head AS head
               WHERE head.session_id = attempt.session_id
                 AND head.source_path = json_extract(file.value, '$.sourcePath')
                 AND head.runtime_event_seq = event.seq
                 AND head.source_event_id = event.source_event_id
                 AND head.file_id IS CASE
                   WHEN json_extract(file.value, '$.operation') = 'upsert'
                     THEN json_extract(file.value, '$.fileId')
                   ELSE NULL
                 END
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM session_artifact_head AS head
             INNER JOIN session_event AS event ON event.id = ?
             WHERE json_extract(attempt.manifest_json, '$.mode') = 'snapshot'
               AND json_extract(attempt.manifest_json, '$.captureStatus') = 'complete'
               AND head.session_id = attempt.session_id
               AND head.runtime_event_seq < event.seq
           )
           AND NOT EXISTS (
             SELECT 1
             FROM json_each(attempt.manifest_json, '$.files') AS file
             WHERE json_extract(file.value, '$.operation') = 'upsert'
               AND NOT EXISTS (
               SELECT 1 FROM file_record AS stored
               INNER JOIN session_event AS event ON event.id = ?
               WHERE stored.id = json_extract(file.value, '$.fileId')
                 AND stored.scope_kind = 'session'
                 AND stored.scope_id = attempt.session_id
                 AND stored.session_kind = 'artifact'
                 AND stored.status = 'ready'
                 AND stored.parent_path = json_extract(file.value, '$.parentPath')
                 AND stored.path = json_extract(file.value, '$.path')
                 AND stored.name = json_extract(file.value, '$.name')
                 AND stored.object_key = json_extract(file.value, '$.objectKey')
                 AND stored.etag = json_extract(file.value, '$.etag')
                 AND stored.size = json_extract(file.value, '$.size')
                 AND stored.mime_type IS json_extract(file.value, '$.contentType')
                 AND stored.runtime_event_seq >= event.seq
             )
           )`,
      )
      .bind(
        input.eventId,
        input.timestampMs,
        input.attemptId,
        input.timestampMs,
        input.manifestJson,
        input.manifestSha256,
        input.eventId,
        input.eventId,
        input.eventId,
        input.eventId,
      ),
    database
      .prepare(
        `INSERT INTO session_event (id)
         SELECT ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM runtime_artifact_attempt AS attempt
           INNER JOIN session_event AS event ON event.id = attempt.accepted_event_id
           WHERE attempt.id = ?
             AND attempt.status = 'accepted'
             AND attempt.accepted_event_id = ?
             AND attempt.manifest_json = event.artifact_manifest_json
             AND attempt.manifest_sha256 = event.artifact_manifest_sha256
             AND event.artifact_attempt_id = attempt.id
         )`,
      )
      .bind(crypto.randomUUID(), input.attemptId, input.eventId),
  ];
}

interface CleanupAttempt {
  readonly id: string;
  readonly keys: readonly string[];
  readonly deleteAfter: number;
}

function parseOwnedObjectKeys(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((key) => typeof key !== "string" || key.length === 0)) {
    throw new Error("Runtime artifact attempt owned object keys are invalid.");
  }
  return [...new Set(parsed)];
}

async function claimRuntimeArtifactCleanupAttempts(
  database: D1Database,
  nowMs: number,
): Promise<CleanupAttempt[]> {
  await getAppDatabase(database)
    .delete(runtimeArtifactAttemptsTable)
    .where(
      and(
        eq(runtimeArtifactAttemptsTable.status, "accepted"),
        sql`NOT EXISTS (
          SELECT 1 FROM session_event
          WHERE session_event.id = ${runtimeArtifactAttemptsTable.acceptedEventId}
            AND session_event.artifact_attempt_id = ${runtimeArtifactAttemptsTable.id}
        )`,
      ),
    )
    .run();

  const candidates = await getAppDatabase(database)
    .select({
      deleteAfter: runtimeArtifactAttemptsTable.deleteAfter,
      id: runtimeArtifactAttemptsTable.id,
      ownedObjectKeysJson: runtimeArtifactAttemptsTable.ownedObjectKeysJson,
      status: runtimeArtifactAttemptsTable.status,
      updatedAt: runtimeArtifactAttemptsTable.updatedAt,
    })
    .from(runtimeArtifactAttemptsTable)
    .where(
      or(
        and(
          inArray(runtimeArtifactAttemptsTable.status, ["staging", "staged"]),
          lte(runtimeArtifactAttemptsTable.expiresAt, nowMs),
        ),
        and(
          eq(runtimeArtifactAttemptsTable.status, "deleting"),
          lte(runtimeArtifactAttemptsTable.updatedAt, nowMs - RUNTIME_ARTIFACT_DELETE_LEASE_MS),
        ),
      ),
    )
    .orderBy(runtimeArtifactAttemptsTable.id)
    .limit(RUNTIME_ARTIFACT_CLEANUP_BATCH_SIZE)
    .all();
  const claimed: CleanupAttempt[] = [];

  for (const candidate of candidates) {
    const deleteAfter = candidate.deleteAfter ?? nowMs + RUNTIME_ARTIFACT_DELETE_QUARANTINE_MS;
    const row = await getAppDatabase(database)
      .update(runtimeArtifactAttemptsTable)
      .set({
        acceptedEventId: null,
        deleteAfter,
        expiresAt: null,
        status: "deleting",
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(runtimeArtifactAttemptsTable.id, candidate.id),
          eq(runtimeArtifactAttemptsTable.status, candidate.status),
          candidate.deleteAfter === null
            ? isNull(runtimeArtifactAttemptsTable.deleteAfter)
            : eq(runtimeArtifactAttemptsTable.deleteAfter, candidate.deleteAfter),
          eq(runtimeArtifactAttemptsTable.updatedAt, candidate.updatedAt),
        ),
      )
      .returning({ id: runtimeArtifactAttemptsTable.id })
      .get();
    if (row !== undefined) {
      claimed.push({
        deleteAfter,
        id: candidate.id,
        keys: parseOwnedObjectKeys(candidate.ownedObjectKeysJson),
      });
    }
  }
  return claimed;
}

async function runtimeArtifactObjectIsOwned(
  database: D1Database,
  input: { readonly attemptId: string; readonly objectKey: string },
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT 1 AS owned
       WHERE EXISTS (SELECT 1 FROM file_record WHERE object_key = ?)
          OR EXISTS (
            SELECT 1
            FROM runtime_artifact_attempt AS other,
                 json_each(other.owned_object_keys_json) AS owned_key
            WHERE other.id <> ?
              AND other.status IN ('staging', 'staged', 'accepted')
              AND owned_key.value = ?
          )
       LIMIT 1`,
    )
    .bind(input.objectKey, input.attemptId, input.objectKey)
    .first<{ owned: number }>();
  return row !== null;
}

export async function cleanupRuntimeArtifactAttempts(bindings: ApiBindings): Promise<void> {
  const nowMs = currentTimestampMs();
  const attempts = await claimRuntimeArtifactCleanupAttempts(bindings.DB, nowMs);
  for (const attempt of attempts) {
    for (const objectKey of attempt.keys) {
      if (await runtimeArtifactObjectIsOwned(bindings.DB, { attemptId: attempt.id, objectKey })) {
        continue;
      }
      await deleteRuntimeArtifactObject(bindings, objectKey);
    }
    if (attempt.deleteAfter > nowMs) {
      continue;
    }
    await getAppDatabase(bindings.DB)
      .delete(runtimeArtifactAttemptsTable)
      .where(
        and(
          eq(runtimeArtifactAttemptsTable.id, attempt.id),
          eq(runtimeArtifactAttemptsTable.status, "deleting"),
          eq(runtimeArtifactAttemptsTable.deleteAfter, attempt.deleteAfter),
        ),
      )
      .run();
  }
}
