import { describe, expect, test } from "bun:test";

import type { ApiCommandId } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  ProjectId,
  RuntimeOperationId,
  SandboxBackupId,
  SandboxId,
  SessionId,
} from "@mosoo/id";

import {
  publishEnvironmentPackageArtifactBackup,
  resolveEnvironmentPackageArtifactBackup,
} from "../src/modules/environments/application/environment-package-artifact-backup";
import {
  claimEnvironmentPackageArtifactBackupActual,
  commitEnvironmentPackageArtifactBackup,
  getEnvironmentPackageArtifactBackupManifest,
  getEnvironmentPackageArtifactBackupStage,
  retireExpiredEnvironmentPackageArtifactBackups,
  stageEnvironmentPackageArtifactBackup,
} from "../src/modules/environments/application/environment-package-artifact-backup-store";
import { resolveEnvironmentPackageArtifact } from "../src/modules/environments/application/environment-package-artifact.service";
import {
  createEnvironmentPackageArtifactBackupName,
  environmentPackageArtifactDir,
  environmentPackageArtifactMetadataKey,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS,
  ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
} from "../src/modules/environments/domain/environment-package-artifact";
import type {
  EnvironmentPackageArtifactKey,
  EnvironmentPackageArtifactPaths,
} from "../src/modules/environments/domain/environment-package-artifact";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import {
  createRuntimeSandboxBackupName,
  deleteAuthorizedSandboxBackupObjects,
  getSandboxBackupObjectKeys,
} from "../src/modules/runtime/infrastructure/sandbox-backup-platform";
import { reconcileSandboxBackupPage } from "../src/modules/runtime/infrastructure/sandbox-backup-reconciliation.service";
import {
  authorizeSandboxBackupDeletion,
  claimSandboxBackupStageActual,
  finalizeSandboxBackupStage,
  getSandboxBackupStage,
  listPendingSandboxBackupDeletions,
  revokeSandboxBackupStage,
  revokeSandboxBackupsForSessionDelete,
  stageSandboxBackupWrites,
} from "../src/modules/runtime/infrastructure/sandbox-backup-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { applyDrizzleMigrationsThrough } from "./helpers/drizzle-migrations";
import { createApiCommandQueueStub } from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SANDBOX_ID = parsePlatformId<SandboxId>("01J0000000000000000000000D");
const SESSION_ID = parsePlatformId<SessionId>("01J0000000000000000000000S");
const OPERATION_ID = parsePlatformId<RuntimeOperationId>("01J0000000000000000000000A");
const CLEANUP_OPERATION_ID = parsePlatformId<RuntimeOperationId>("01J0000000000000000000000B");
const DIR = "/workspace/current";
const NOW = Date.now();
const OLD_UPLOAD = new Date(NOW - 25 * 60 * 60_000);
const ENVIRONMENT_COMMAND_ID = parsePlatformId<ApiCommandId>("01J0000000000000000000000J");
const ENVIRONMENT_PROJECT_ID = parsePlatformId<ProjectId>("01J0000000000000000000000K");
const ENVIRONMENT_KEY: EnvironmentPackageArtifactKey = {
  projectId: ENVIRONMENT_PROJECT_ID,
  inputDigest: "a".repeat(64),
};
const ENVIRONMENT_DIR = environmentPackageArtifactDir(ENVIRONMENT_KEY);
const ENVIRONMENT_PATHS: EnvironmentPackageArtifactPaths = {
  executable: [`${ENVIRONMENT_DIR}/python/bin`],
  node: [`${ENVIRONMENT_DIR}/npm/node_modules`],
  python: [`${ENVIRONMENT_DIR}/python/site-packages`],
};

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsThrough(database, "0021_sandbox-backup-object-authority");
  database.execute(`
    INSERT INTO sandbox (
      agent_id, project_id, claim_expires_at, claim_owner, created_at, id, incarnation,
      kind, network_constraints_hash, operation_kind, owner_account_id, status, status_operation_id,
      subject_id, subject_kind, updated_at
    ) VALUES (
      '01J0000000000000000000000E', '01J0000000000000000000000F', ${NOW + 60_000},
      'owner', ${NOW}, '${SANDBOX_ID}', 1, 'pet', '${"0".repeat(64)}', 'hibernate',
      '01J0000000000000000000000G', 'backing_up', '${OPERATION_ID}',
      '01J0000000000000000000000E', 'agent', ${NOW}
    );
  `);
  return database;
}

async function setEnvironmentArtifactCommand(
  database: D1Database,
  input: {
    readonly attemptCount: number;
    readonly claimOwner: string;
    readonly commandId?: ApiCommandId;
    readonly dedupeKey?: string;
    readonly deliveryGeneration: number;
    readonly key?: EnvironmentPackageArtifactKey;
  },
): Promise<void> {
  const commandId = input.commandId ?? ENVIRONMENT_COMMAND_ID;
  const key = input.key ?? ENVIRONMENT_KEY;
  await database
    .prepare(
      `INSERT INTO api_command (
         attempt_count, claim_expires_at, claim_owner, created_at, dedupe_key,
         delivery_generation, id, kind, payload_json, status, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'environment_package_artifact_build', ?, 'running', ?)
       ON CONFLICT(id) DO UPDATE SET
         attempt_count = excluded.attempt_count,
         claim_expires_at = excluded.claim_expires_at,
         claim_owner = excluded.claim_owner,
         delivery_generation = excluded.delivery_generation,
         status = 'running',
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.attemptCount,
      Date.now() + 60_000,
      input.claimOwner,
      NOW,
      input.dedupeKey ?? `environment-artifact:${key.projectId}:${key.inputDigest}`,
      input.deliveryGeneration,
      commandId,
      JSON.stringify(key),
      NOW,
    )
    .run();
}

async function createEnvironmentArtifactStage(
  database: D1Database,
  input: {
    readonly attemptCount?: number;
    readonly claimOwner?: string;
    readonly deliveryGeneration?: number;
  } = {},
) {
  const authority = {
    attemptCount: input.attemptCount ?? 1,
    claimOwner: input.claimOwner ?? "environment-owner",
    commandId: ENVIRONMENT_COMMAND_ID,
    deliveryGeneration: input.deliveryGeneration ?? 1,
  };
  await setEnvironmentArtifactCommand(database, authority);
  const stage = await stageEnvironmentPackageArtifactBackup(database, {
    ...authority,
    dir: ENVIRONMENT_DIR,
    key: ENVIRONMENT_KEY,
    paths: ENVIRONMENT_PATHS,
  });
  return { authority, stage };
}

async function succeedEnvironmentArtifactCommand(
  database: D1Database,
  commandId: ApiCommandId = ENVIRONMENT_COMMAND_ID,
): Promise<void> {
  await database
    .prepare(
      `UPDATE api_command
       SET claim_expires_at = NULL, claim_owner = NULL,
         completed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER), status = 'succeeded'
       WHERE id = ?`,
    )
    .bind(commandId)
    .run();
}

async function expireEnvironmentArtifactManifest(
  database: SqliteD1Database,
  expiresAt = Date.now() - 1_000,
  key: EnvironmentPackageArtifactKey = ENVIRONMENT_KEY,
): Promise<void> {
  const trigger = await database
    .prepare(
      `SELECT sql FROM sqlite_schema
       WHERE type = 'trigger' AND name = 'environment_package_artifact_backup_rotation_authority'`,
    )
    .first<{ sql: string }>();
  if (trigger === null) {
    throw new Error("Rotation authority trigger is missing.");
  }
  database.execute("DROP TRIGGER environment_package_artifact_backup_rotation_authority");
  await database
    .prepare(
      `UPDATE environment_package_artifact_backup
       SET committed_at = ?, expires_at = ?
       WHERE project_id = ? AND input_digest = ?`,
    )
    .bind(expiresAt - 25 * 60 * 60_000, expiresAt, key.projectId, key.inputDigest)
    .run();
  database.execute(trigger.sql);
}

async function insertRawEnvironmentArtifactManifest(
  database: D1Database,
  backupId: SandboxBackupId,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO environment_package_artifact_backup (
         project_id, attempt_count, backup_id, command_id, committed_at,
         delivery_generation, expires_at, input_digest, manifest_generation, paths_json
       ) VALUES (
         ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
         CAST(unixepoch('subsec') * 1000 AS INTEGER) + 315359999000, ?, 1, ?
       )`,
    )
    .bind(
      ENVIRONMENT_PROJECT_ID,
      backupId,
      ENVIRONMENT_COMMAND_ID,
      ENVIRONMENT_KEY.inputDigest,
      JSON.stringify(ENVIRONMENT_PATHS),
    )
    .run();
}

interface StoredObject {
  readonly body: string;
  readonly uploaded: Date;
}

class MemoryR2Bucket {
  readonly gets: string[] = [];
  readonly objects = new Map<string, StoredObject>();
  readonly #cursorKeys = new Map<string, string>();
  #cursorSequence = 0;
  failAfterDeletingKey: string | null = null;

  async delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.objects.delete(key);
      if (this.failAfterDeletingKey === key) {
        this.failAfterDeletingKey = null;
        throw new Error("Simulated partial R2 deletion failure.");
      }
    }
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    this.gets.push(key);
    const object = this.objects.get(key);
    return object === undefined
      ? null
      : ({
          text: async () => object.body,
          uploaded: object.uploaded,
        } as R2ObjectBody);
  }

  async head(key: string): Promise<R2Object | null> {
    const object = this.objects.get(key);
    return object === undefined ? null : ({ key, uploaded: object.uploaded } as R2Object);
  }

  async list(options: R2ListOptions): Promise<R2Objects> {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ""))
      .toSorted();
    const cursorKey =
      options.cursor === undefined ? undefined : this.#cursorKeys.get(options.cursor);
    if (options.cursor !== undefined && cursorKey === undefined) {
      throw new Error("Unknown R2 test cursor.");
    }
    const start = cursorKey === undefined ? 0 : keys.findIndex((key) => key > cursorKey);
    const normalizedStart = start === -1 ? keys.length : start;
    const end = Math.min(normalizedStart + (options.limit ?? 1_000), keys.length);
    const pageKeys = keys.slice(normalizedStart, end);
    const cursor = `opaque-${++this.#cursorSequence}`;
    const lastKey = pageKeys.at(-1);
    if (lastKey !== undefined) {
      this.#cursorKeys.set(cursor, lastKey);
    }
    return {
      cursor,
      delimitedPrefixes: [],
      objects: pageKeys.map((key) => ({
        key,
        uploaded: this.objects.get(key)!.uploaded,
      })) as R2Object[],
      truncated: end < keys.length,
    };
  }

  async put(
    key: string,
    body = "",
    options: Date | R2PutOptions = OLD_UPLOAD,
  ): Promise<R2Object | null> {
    const uploaded = options instanceof Date ? options : new Date();
    this.objects.set(key, { body, uploaded });
    return { key, uploaded } as R2Object;
  }

  putBackup(input: {
    readonly createdAt?: Date;
    readonly dir?: string;
    readonly metadataId?: string;
    readonly name?: string | null;
    readonly platformId: string;
    readonly stagingId?: SandboxBackupId;
    readonly uploaded?: Date;
  }): SandboxBackupId {
    const backupId = encodeSandboxBackupIdForStorage(input.platformId);
    const [dataKey, metadataKey] = getSandboxBackupObjectKeys(backupId);
    const createdAt = input.createdAt ?? new Date();
    void this.put(dataKey, "archive", input.uploaded ?? OLD_UPLOAD);
    const name =
      input.name !== undefined
        ? input.name
        : input.stagingId === undefined
          ? (() => {
              throw new Error("A runtime backup stage ID is required.");
            })()
          : createRuntimeSandboxBackupName(input.stagingId);
    void this.put(
      metadataKey,
      JSON.stringify({
        dir: input.dir ?? DIR,
        id: input.metadataId ?? input.platformId,
        name,
        createdAt: createdAt.toISOString(),
        ttl: ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS,
      }),
      input.uploaded ?? OLD_UPLOAD,
    );
    return backupId;
  }

  backupExpiresAt(backupId: SandboxBackupId): number {
    const [, metadataKey] = getSandboxBackupObjectKeys(backupId);
    const metadata = JSON.parse(this.objects.get(metadataKey)!.body) as { createdAt: string };
    return Date.parse(metadata.createdAt) + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000;
  }
}

function createBindings(database: D1Database, bucket: MemoryR2Bucket): ApiBindings {
  return {
    DB: database,
    SANDBOX_STATE_BUCKET: bucket,
  } as ApiBindings;
}

function loseRunAcknowledgementOnce(
  database: D1Database,
  queryNeedle: string,
): { readonly database: D1Database; readonly wasLost: () => boolean } {
  let lost = false;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(Reflect.apply(target.bind, target, values));
        }
        if (property === "run") {
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(target.run, target, args);
            if (!lost) {
              lost = true;
              throw new Error("Simulated D1 write acknowledgement loss.");
            }
            return result;
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes(queryNeedle) ? wrap(statement) : statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    wasLost: () => lost,
  };
}

async function createOperationStage(
  database: D1Database,
  input: { readonly updateSubjectBackup?: boolean; readonly workspace?: boolean } = {},
) {
  if (input.workspace === true) {
    await database
      .prepare(
        `INSERT INTO session (
           agent_id, project_id, created_at, creator_account_id, id, kind, last_message_at,
           model, provider, renamed, runtime_id, status, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'pet', 1, 'gpt-5.4', 'openai', 0, 'openai-runtime', 'IDLE', ?)`,
      )
      .bind(
        "01J0000000000000000000000E",
        "01J0000000000000000000000F",
        NOW,
        "01J0000000000000000000000G",
        SESSION_ID,
        NOW,
      )
      .run();
    await database
      .prepare(
        `INSERT INTO sandbox_session (
           cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
           sandbox_incarnation, session_id, status, updated_at
         ) VALUES (?, ?, ?, '{}', ?, 1, ?, 'active', ?)`,
      )
      .bind("01J0000000000000000000000H", NOW, DIR, SANDBOX_ID, SESSION_ID, NOW)
      .run();
  }
  const [write] = await stageSandboxBackupWrites(database, {
    admission: {
      kind: "operation",
      lease: {
        claimExpiresAt: NOW + 60_000,
        claimOwner: "owner",
        incarnation: 1,
        kind: "hibernate",
        operationId: OPERATION_ID,
        status: "backing_up",
      },
    },
    sandboxId: SANDBOX_ID,
    targets: [
      {
        dir: DIR,
        updateSandboxLastBackup: input.updateSubjectBackup ?? false,
        workspaceSessionId: input.workspace === true ? SESSION_ID : null,
      },
    ],
    ttlSeconds: 100,
  });
  if (write?.kind !== "staged") {
    throw new Error("Test stage was not created.");
  }
  return write.stage;
}

async function readyRows(database: D1Database): Promise<Array<{ id: string; staging_id: string }>> {
  return (
    await database
      .prepare("SELECT id, staging_id FROM sandbox_backup WHERE status = 'ready' ORDER BY id")
      .all<{ id: string; staging_id: string }>()
  ).results;
}

describe("sandbox backup lifecycle", () => {
  test("scanner adopts a complete object after the create ACK is lost", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const stage = await createOperationStage(database);
    const actualId = bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-446655440001",
      stagingId: stage.id,
    });

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(await readyRows(database)).toEqual([{ id: actualId, staging_id: stage.id }]);
    expect(await getSandboxBackupStage(database, stage.id)).toBeNull();
  });

  test("two candidates converge on one ready row and the scanner deletes the loser", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const stage = await createOperationStage(database);
    const candidates = [
      bucket.putBackup({
        platformId: "550e8400-e29b-41d4-a716-446655440002",
        stagingId: stage.id,
      }),
      bucket.putBackup({
        platformId: "550e8400-e29b-41d4-a716-446655440003",
        stagingId: stage.id,
      }),
    ];

    await Promise.all(
      candidates.map((actualBackupId) =>
        claimSandboxBackupStageActual(database, {
          actualBackupId,
          dir: DIR,
          sandboxIncarnation: 1,
          stagingId: stage.id,
        }),
      ),
    );
    const winner = (await getSandboxBackupStage(database, stage.id))?.actualBackupId;
    if (winner === null || winner === undefined) {
      throw new Error("Concurrent claims produced no winner.");
    }
    await finalizeSandboxBackupStage(database, { actualBackupId: winner, stagingId: stage.id });
    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(await readyRows(database)).toEqual([{ id: winner, staging_id: stage.id }]);
    const loser = candidates.find((candidate) => candidate !== winner)!;
    expect(getSandboxBackupObjectKeys(winner).every((key) => bucket.objects.has(key))).toBe(true);
    expect(getSandboxBackupObjectKeys(loser).every((key) => !bucket.objects.has(key))).toBe(true);
  });

  test("claim keeps its winner when another worker finalizes before the caller resumes", async () => {
    const database = createDatabase();
    const stage = await createOperationStage(database);
    const actualId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440009");
    let intercepted = false;
    const interceptClaim = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property, receiver) {
          if (property === "bind") {
            return (...values: unknown[]) =>
              interceptClaim(Reflect.apply(target.bind, target, values));
          }
          if (property === "first") {
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(target.first, target, args);
              intercepted = true;
              await finalizeSandboxBackupStage(database, {
                actualBackupId: actualId,
                stagingId: stage.id,
              });
              return result;
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes("UPDATE sandbox_backup_staging AS stage") &&
              query.includes("RETURNING actual_backup_id")
              ? interceptClaim(statement)
              : statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      claimSandboxBackupStageActual(racingDatabase, {
        actualBackupId: actualId,
        dir: DIR,
        sandboxIncarnation: 1,
        stagingId: stage.id,
      }),
    ).resolves.toEqual({ actualBackupId: actualId });
    expect(intercepted).toBe(true);
    expect(await readyRows(database)).toEqual([{ id: actualId, staging_id: stage.id }]);
    expect(await getSandboxBackupStage(database, stage.id)).toBeNull();
  });

  test("a stale collector cannot tombstone an object after finalization wins", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const stage = await createOperationStage(database);
    const actualId = bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-44665544000a",
      stagingId: stage.id,
    });
    expect(
      await claimSandboxBackupStageActual(database, {
        actualBackupId: actualId,
        dir: DIR,
        sandboxIncarnation: 1,
        stagingId: stage.id,
      }),
    ).toEqual({ actualBackupId: actualId });

    // The collector observed no finalized row, then the authoritative finalizer won D1.
    expect(await readyRows(database)).toEqual([]);
    await finalizeSandboxBackupStage(database, {
      actualBackupId: actualId,
      stagingId: stage.id,
    });
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "runtime_invalid", stagingId: stage.id },
        backupId: actualId,
      }),
    ).toBe(false);

    expect(await readyRows(database)).toEqual([{ id: actualId, staging_id: stage.id }]);
    expect(getSandboxBackupObjectKeys(actualId).every((key) => bucket.objects.has(key))).toBe(true);
  });

  test("an old lease owner cannot borrow a successor lease to finalize its backup", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const stageA = await createOperationStage(database);
    const delayedA = bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-446655440012",
      stagingId: stageA.id,
    });
    await database
      .prepare(
        `UPDATE sandbox
         SET claim_owner = 'successor-owner',
             claim_expires_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) + 60000
         WHERE id = ?`,
      )
      .bind(SANDBOX_ID)
      .run();

    await expect(
      claimSandboxBackupStageActual(database, {
        actualBackupId: delayedA,
        dir: DIR,
        sandboxIncarnation: 1,
        stagingId: stageA.id,
      }),
    ).resolves.toBeNull();
    const [writeB] = await stageSandboxBackupWrites(database, {
      admission: {
        kind: "operation",
        lease: {
          claimExpiresAt: NOW + 60_000,
          claimOwner: "successor-owner",
          incarnation: 1,
          kind: "hibernate",
          operationId: OPERATION_ID,
          status: "backing_up",
        },
      },
      sandboxId: SANDBOX_ID,
      targets: [{ dir: DIR, updateSandboxLastBackup: false, workspaceSessionId: null }],
      ttlSeconds: 100,
    });
    expect(writeB?.kind).toBe("staged");
    if (writeB?.kind !== "staged") {
      throw new Error("Successor lease did not create a replacement backup stage.");
    }
    expect(writeB.stage).toMatchObject({ claimOwner: "successor-owner" });
    expect(writeB.stage.id).not.toBe(stageA.id);

    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });
    expect(getSandboxBackupObjectKeys(delayedA).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
    expect(await getSandboxBackupStage(database, writeB.stage.id)).not.toBeNull();
    expect(await readyRows(database)).toEqual([]);
  });

  test("a handoff race never returns a third owner's backup stage", async () => {
    const database = createDatabase();
    const stageA = await createOperationStage(database);
    await database
      .prepare(
        `UPDATE sandbox
         SET claim_owner = 'owner-b',
             claim_expires_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) + 60000
         WHERE id = ?`,
      )
      .bind(SANDBOX_ID)
      .run();
    let stageC: Awaited<ReturnType<typeof getSandboxBackupStage>> = null;
    let raced = false;
    const interceptDelete = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property, receiver) {
          if (property === "bind") {
            return (...values: unknown[]) =>
              interceptDelete(Reflect.apply(target.bind, target, values));
          }
          if (property === "first") {
            return async (...args: unknown[]) => {
              if (!raced) {
                raced = true;
                await database
                  .prepare(
                    `UPDATE sandbox
                     SET claim_owner = 'owner-c',
                         claim_expires_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) + 60000
                     WHERE id = ?`,
                  )
                  .bind(SANDBOX_ID)
                  .run();
                await revokeSandboxBackupStage(database, {
                  onlyIfStale: true,
                  stagingId: stageA.id,
                });
                const [writeC] = await stageSandboxBackupWrites(database, {
                  admission: {
                    kind: "operation",
                    lease: {
                      claimExpiresAt: NOW + 60_000,
                      claimOwner: "owner-c",
                      incarnation: 1,
                      kind: "hibernate",
                      operationId: OPERATION_ID,
                      status: "backing_up",
                    },
                  },
                  sandboxId: SANDBOX_ID,
                  targets: [{ dir: DIR, updateSandboxLastBackup: false, workspaceSessionId: null }],
                  ttlSeconds: 100,
                });
                stageC = writeC?.kind === "staged" ? writeC.stage : null;
              }
              return Reflect.apply(target.first, target, args);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes("DELETE FROM sandbox_backup_staging AS stage") &&
              query.includes("AND NOT")
              ? interceptDelete(statement)
              : statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      stageSandboxBackupWrites(racingDatabase, {
        admission: {
          kind: "operation",
          lease: {
            claimExpiresAt: NOW + 60_000,
            claimOwner: "owner-b",
            incarnation: 1,
            kind: "hibernate",
            operationId: OPERATION_ID,
            status: "backing_up",
          },
        },
        sandboxId: SANDBOX_ID,
        targets: [{ dir: DIR, updateSandboxLastBackup: false, workspaceSessionId: null }],
        ttlSeconds: 100,
      }),
    ).rejects.toThrow("another admission authority");
    expect(raced).toBe(true);
    expect(stageC).toMatchObject({ claimOwner: "owner-c" });
  });

  test("an expired D1 lease cannot claim a backup stage", async () => {
    const database = createDatabase();
    const stage = await createOperationStage(database);
    await database
      .prepare(
        `UPDATE sandbox
         SET claim_expires_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) - 1
         WHERE id = ?`,
      )
      .bind(SANDBOX_ID)
      .run();

    await expect(
      claimSandboxBackupStageActual(database, {
        actualBackupId: encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440013"),
        dir: DIR,
        sandboxIncarnation: 1,
        stagingId: stage.id,
      }),
    ).resolves.toBeNull();
  });

  test("a partial finalization cannot borrow a successor owner to update the subject", async () => {
    const database = createDatabase();
    const stage = await createOperationStage(database, { updateSubjectBackup: true });
    const actualId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440017");
    await claimSandboxBackupStageActual(database, {
      actualBackupId: actualId,
      dir: DIR,
      sandboxIncarnation: 1,
      stagingId: stage.id,
    });
    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup (
             created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
             staging_id, status, ttl_seconds, updated_at
           ) SELECT created_at, dir, actual_backup_id, 0, operation_id, sandbox_id,
               sandbox_incarnation, id, 'pruned', ttl_seconds,
               CAST(unixepoch('subsec') * 1000 AS INTEGER)
             FROM sandbox_backup_staging WHERE id = ?`,
        )
        .bind(stage.id)
        .run(),
    ).rejects.toThrow("already referenced");
    await database
      .prepare(
        `INSERT INTO sandbox_backup (
           created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
           staging_id, status, ttl_seconds, updated_at
         ) SELECT created_at, dir, actual_backup_id, 0, operation_id, sandbox_id,
             sandbox_incarnation, id, 'ready', ttl_seconds,
             CAST(unixepoch('subsec') * 1000 AS INTEGER)
           FROM sandbox_backup_staging WHERE id = ?`,
      )
      .bind(stage.id)
      .run();
    await expect(
      database
        .prepare("UPDATE sandbox_backup_staging SET actual_backup_id = NULL WHERE id = ?")
        .bind(stage.id)
        .run(),
    ).rejects.toThrow("already owned");
    await expect(
      database
        .prepare("UPDATE sandbox_backup SET status = 'pruned' WHERE id = ?")
        .bind(actualId)
        .run(),
    ).rejects.toThrow("already referenced");
    await database
      .prepare(
        `UPDATE sandbox
         SET claim_owner = 'successor-owner',
             claim_expires_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) + 60000
         WHERE id = ?`,
      )
      .bind(SANDBOX_ID)
      .run();

    await expect(
      finalizeSandboxBackupStage(database, {
        actualBackupId: actualId,
        stagingId: stage.id,
      }),
    ).resolves.toMatchObject({ candidateAccepted: true, complete: false });
    expect(
      await database
        .prepare("SELECT last_backup_id FROM sandbox WHERE id = ?")
        .bind(SANDBOX_ID)
        .first(),
    ).toEqual({ last_backup_id: null });
    expect(await getSandboxBackupStage(database, stage.id)).not.toBeNull();
  });

  test("the tombstone guard independently rejects a ready row ID change", async () => {
    const database = createDatabase();
    const stage = await createOperationStage(database);
    const readyId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-44665544000d");
    const tombstonedId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-44665544000e");
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "unattributed" },
        backupId: tombstonedId,
      }),
    ).toBe(true);
    await claimSandboxBackupStageActual(database, {
      actualBackupId: readyId,
      dir: DIR,
      sandboxIncarnation: 1,
      stagingId: stage.id,
    });
    await finalizeSandboxBackupStage(database, {
      actualBackupId: readyId,
      stagingId: stage.id,
    });
    database.execute("DROP TRIGGER sandbox_backup_identity_immutable");

    await expect(
      database
        .prepare("UPDATE sandbox_backup SET id = ? WHERE id = ?")
        .bind(tombstonedId, readyId)
        .run(),
    ).rejects.toThrow("sandbox backup object is tombstoned or already referenced");
    expect(await readyRows(database)).toEqual([{ id: readyId, staging_id: stage.id }]);
  });

  test("runtime final identity cannot use OR REPLACE to delete another owner", async () => {
    const database = createDatabase();
    const actualA = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440020");
    const actualB = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440021");
    const actualC = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440022");
    const actualD = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440027");
    const stageA = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440023");
    const stageB = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440024");
    const stageC = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440028");
    const insert = (actualId: SandboxBackupId, stagingId: SandboxBackupId, dir: string) =>
      database
        .prepare(
          `INSERT INTO sandbox_backup (
             created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
             session_run_id, staging_id, status, ttl_seconds, updated_at, workspace_session_id
           ) VALUES (?, ?, ?, 0, ?, ?, 1, NULL, ?, 'ready', 100, ?, NULL)`,
        )
        .bind(NOW, dir, actualId, OPERATION_ID, SANDBOX_ID, stagingId, NOW)
        .run();
    await insert(actualA, stageA, "/workspace/a");
    await insert(actualB, stageB, "/workspace/b");
    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    for (const [actualId, stagingId, dir] of [
      [actualC, stageA, "/workspace/c"],
      [actualD, stageC, "/workspace/b"],
    ] as const) {
      await expect(
        database
          .prepare(
            `INSERT OR REPLACE INTO sandbox_backup (
               created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
               session_run_id, staging_id, status, ttl_seconds, updated_at, workspace_session_id
             ) VALUES (?, ?, ?, 0, ?, ?, 1, NULL, ?, 'ready', 100, ?, NULL)`,
          )
          .bind(NOW, dir, actualId, OPERATION_ID, SANDBOX_ID, stagingId, NOW)
          .run(),
      ).rejects.toThrow("already referenced");
    }
    await expect(
      database
        .prepare("UPDATE OR REPLACE sandbox_backup SET dir = '/workspace/b' WHERE id = ?")
        .bind(actualA)
        .run(),
    ).rejects.toThrow("identity is immutable");
    await expect(
      database.prepare("DELETE FROM sandbox_backup WHERE id = ?").bind(actualA).run(),
    ).rejects.toThrow("record is permanent");
    expect(
      (await database.prepare("SELECT id, staging_id FROM sandbox_backup ORDER BY id").all())
        .results,
    ).toEqual([
      { id: actualA, staging_id: stageA },
      { id: actualB, staging_id: stageB },
    ]);
  });

  test("ready and pruned runtime records prevent a second stage from claiming their ID", async () => {
    const database = createDatabase();
    const stageA = await createOperationStage(database);
    const actualId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440025");
    await claimSandboxBackupStageActual(database, {
      actualBackupId: actualId,
      dir: DIR,
      sandboxIncarnation: 1,
      stagingId: stageA.id,
    });
    await finalizeSandboxBackupStage(database, {
      actualBackupId: actualId,
      stagingId: stageA.id,
    });
    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup_staging (
             actual_backup_id, claim_owner, created_at, dir, driver_generation,
             driver_instance_id, id, operation_id, sandbox_id, sandbox_incarnation,
             session_run_id, ttl_seconds, updated_at, updates_subject_backup,
             workspace_session_id
           ) VALUES (
             NULL, 'owner', ?, '/workspace/resurrected', NULL, NULL, ?, ?, ?, 1,
             NULL, 100, ?, 0, NULL
           )`,
        )
        .bind(NOW, stageA.id, OPERATION_ID, SANDBOX_ID, NOW)
        .run(),
    ).rejects.toThrow("already owned");
    const [write] = await stageSandboxBackupWrites(database, {
      admission: {
        kind: "operation",
        lease: {
          claimExpiresAt: NOW + 60_000,
          claimOwner: "owner",
          incarnation: 1,
          kind: "hibernate",
          operationId: OPERATION_ID,
          status: "backing_up",
        },
      },
      sandboxId: SANDBOX_ID,
      targets: [
        {
          dir: "/workspace/other",
          updateSandboxLastBackup: false,
          workspaceSessionId: null,
        },
      ],
      ttlSeconds: 100,
    });
    if (write?.kind !== "staged") {
      throw new Error("Second runtime backup stage was not created.");
    }

    await expect(
      claimSandboxBackupStageActual(database, {
        actualBackupId: actualId,
        dir: write.stage.dir,
        sandboxIncarnation: 1,
        stagingId: write.stage.id,
      }),
    ).resolves.toBeNull();
    await database
      .prepare("UPDATE sandbox_backup SET status = 'pruned' WHERE id = ?")
      .bind(actualId)
      .run();
    await expect(
      database
        .prepare("UPDATE sandbox_backup SET status = 'ready' WHERE id = ?")
        .bind(actualId)
        .run(),
    ).rejects.toThrow("cannot become ready");
    await expect(
      claimSandboxBackupStageActual(database, {
        actualBackupId: actualId,
        dir: write.stage.dir,
        sandboxIncarnation: 1,
        stagingId: write.stage.id,
      }),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare("UPDATE OR REPLACE sandbox_backup_staging SET actual_backup_id = ? WHERE id = ?")
        .bind(actualId, write.stage.id)
        .run(),
    ).rejects.toThrow("already owned");
    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup_staging (
             actual_backup_id, claim_owner, created_at, dir, driver_generation,
             driver_instance_id, id, operation_id, sandbox_id, sandbox_incarnation,
             session_run_id, ttl_seconds, updated_at, updates_subject_backup,
             workspace_session_id
           ) VALUES (
             ?, 'owner', ?, '/workspace/third', NULL, NULL, ?, ?, ?, 1,
             NULL, 100, ?, 0, NULL
           )`,
        )
        .bind(
          actualId,
          NOW,
          encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440026"),
          OPERATION_ID,
          SANDBOX_ID,
          NOW,
        )
        .run(),
    ).rejects.toThrow("already owned");
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "pruned" },
        backupId: actualId,
      }),
    ).toBe(true);
    expect(await getSandboxBackupStage(database, write.stage.id)).toMatchObject({
      actualBackupId: null,
    });
  });

  test("a crash after delete intent is retried to physical completion", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const actualId = bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-44665544000b",
      stagingId: parsePlatformId<SandboxBackupId>("01J0000000000000000000000C"),
    });
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "unattributed" },
        backupId: actualId,
      }),
    ).toBe(true);
    expect(
      await database
        .prepare("SELECT deleted_at FROM sandbox_backup_delete_intent WHERE backup_id = ?")
        .bind(actualId)
        .first(),
    ).toEqual({ deleted_at: null });

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
    expect(
      await database
        .prepare("SELECT deleted_at FROM sandbox_backup_delete_intent WHERE backup_id = ?")
        .bind(actualId)
        .first<{ deleted_at: number | null }>(),
    ).toMatchObject({ deleted_at: expect.any(Number) });
    await expect(
      database
        .prepare("DELETE FROM sandbox_backup_delete_intent WHERE backup_id = ?")
        .bind(actualId)
        .run(),
    ).rejects.toThrow("deletion intent is permanent");
    await database.prepare("PRAGMA recursive_triggers = OFF").run();
    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup_delete_intent (
             attempted_at, backup_id, created_at, delete_after, deleted_at
           ) VALUES (
             NULL, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
             CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL
           )`,
        )
        .bind(actualId)
        .run(),
    ).rejects.toThrow("deletion lacks D1 authority");
    bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-44665544000b",
      stagingId: parsePlatformId<SandboxBackupId>("01J0000000000000000000000C"),
    });
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "unattributed" },
        backupId: actualId,
      }),
    ).toBe(true);
    await deleteAuthorizedSandboxBackupObjects(createBindings(database, bucket), [actualId]);
    expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
  });

  test.each([
    ["data", "550e8400-e29b-41d4-a716-446655440019"],
    ["metadata", "550e8400-e29b-41d4-a716-44665544001c"],
  ] as const)(
    "reconciliation resumes after deleting %s when the R2 ACK is lost",
    async (kind, id) => {
      const database = createDatabase();
      const bucket = new MemoryR2Bucket();
      const actualId = bucket.putBackup({
        platformId: id,
        stagingId: parsePlatformId<SandboxBackupId>("01J0000000000000000000000C"),
        uploaded: new Date(),
      });
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "unattributed" },
        backupId: actualId,
      });
      const [dataKey, metadataKey] = getSandboxBackupObjectKeys(actualId);
      bucket.failAfterDeletingKey = kind === "data" ? dataKey : metadataKey;

      await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });

      expect(bucket.objects.has(dataKey)).toBe(false);
      expect(bucket.objects.has(metadataKey)).toBe(kind === "data");
      expect(
        await database
          .prepare(
            `SELECT attempted_at, deleted_at
           FROM sandbox_backup_delete_intent WHERE backup_id = ?`,
          )
          .bind(actualId)
          .first(),
      ).toEqual({ attempted_at: expect.any(Number), deleted_at: null });

      await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });

      expect(bucket.objects.has(metadataKey)).toBe(false);
      expect(
        await database
          .prepare("SELECT deleted_at FROM sandbox_backup_delete_intent WHERE backup_id = ?")
          .bind(actualId)
          .first(),
      ).toEqual({ deleted_at: expect.any(Number) });
    },
  );

  test("a lost deletion completion acknowledgement remains idempotently complete", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const actualId = bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-44665544001a",
      stagingId: parsePlatformId<SandboxBackupId>("01J0000000000000000000000C"),
    });
    await authorizeSandboxBackupDeletion(database, {
      authority: { kind: "unattributed" },
      backupId: actualId,
    });
    const fault = loseRunAcknowledgementOnce(database, "SET deleted_at = coalesce");

    await reconcileSandboxBackupPage(createBindings(fault.database, bucket), { cursor: null });

    expect(fault.wasLost()).toBe(true);
    expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
    expect(
      await database
        .prepare("SELECT deleted_at FROM sandbox_backup_delete_intent WHERE backup_id = ?")
        .bind(actualId)
        .first(),
    ).toEqual({ deleted_at: expect.any(Number) });

    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });
    expect(await listPendingSandboxBackupDeletions(database, 1)).toEqual([]);
  });

  test("a deletion cannot be completed before its first physical attempt", async () => {
    const database = createDatabase();
    const backupId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-44665544001b");
    await authorizeSandboxBackupDeletion(database, {
      authority: { kind: "unattributed" },
      backupId,
    });

    await expect(
      database
        .prepare(
          `UPDATE sandbox_backup_delete_intent
           SET deleted_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
           WHERE backup_id = ?`,
        )
        .bind(backupId)
        .run(),
    ).rejects.toThrow("completion must use D1 time and is irreversible");
  });

  test("an unattempted deletion wins an otherwise exact retry ordering tie", async () => {
    const database = createDatabase();
    const attempted = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-44665544001d");
    const unattempted = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-44665544001e");
    database.execute("DROP TRIGGER sandbox_backup_delete_intent_authority");
    await database
      .prepare(
        `INSERT INTO sandbox_backup_delete_intent (
           attempted_at, backup_id, created_at, delete_after, deleted_at
         ) VALUES (1, ?, 1, 1, NULL), (NULL, ?, 1, 1, NULL)`,
      )
      .bind(attempted, unattempted)
      .run();

    expect(await listPendingSandboxBackupDeletions(database, 2)).toEqual([unattempted, attempted]);
  });

  test("cleanup admitted between SDK creation and D1 claim leaves no ready row", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const stage = await createOperationStage(database, { workspace: true });
    const actualId = bucket.putBackup({
      platformId: "550e8400-e29b-41d4-a716-446655440004",
      stagingId: stage.id,
    });
    await database
      .prepare(
        `UPDATE session
         SET archived_at = ?, cleanup_operation_kind = 'delete',
             status = 'RESCHEDULING', status_operation_id = ?
         WHERE id = ?`,
      )
      .bind(NOW, CLEANUP_OPERATION_ID, SESSION_ID)
      .run();

    const claim = await claimSandboxBackupStageActual(database, {
      actualBackupId: actualId,
      dir: DIR,
      sandboxIncarnation: 1,
      stagingId: stage.id,
    });
    expect(claim).toBeNull();
    expect(
      await revokeSandboxBackupsForSessionDelete(database, {
        cwd: DIR,
        operationId: CLEANUP_OPERATION_ID,
        sandboxId: SANDBOX_ID,
        sessionId: SESSION_ID,
      }),
    ).toEqual([]);
    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(await readyRows(database)).toEqual([]);
    expect(await getSandboxBackupStage(database, stage.id)).toBeNull();
    expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
  });

  for (const mismatch of ["dir", "id", "scope"] as const) {
    test(`scanner rejects ${mismatch} metadata that does not match its stage`, async () => {
      const database = createDatabase();
      const bucket = new MemoryR2Bucket();
      const stage = await createOperationStage(database);
      const platformId = "550e8400-e29b-41d4-a716-446655440005";
      const actualId = bucket.putBackup({
        ...(mismatch === "dir" ? { dir: "/workspace/wrong" } : {}),
        ...(mismatch === "id" ? { metadataId: "550e8400-e29b-41d4-a716-446655440006" } : {}),
        ...(mismatch === "scope"
          ? {
              name: createRuntimeSandboxBackupName(
                parsePlatformId<SandboxBackupId>("01J0000000000000000000000C"),
              ),
            }
          : {}),
        platformId,
        stagingId: stage.id,
      });

      await reconcileSandboxBackupPage(createBindings(database, bucket), {
        cursor: null,
      });

      expect(await readyRows(database)).toEqual([]);
      expect((await getSandboxBackupStage(database, stage.id))?.actualBackupId).toBeNull();
      expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
        true,
      );
    });
  }

  test("reconciliation remains bounded and resumes with an opaque page cursor", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    for (let index = 0; index < 65; index += 1) {
      const backupId = encodeSandboxBackupIdForStorage(
        `550e8400-e29b-4000-8000-${index.toString(16).padStart(12, "0")}`,
      );
      const [dataKey] = getSandboxBackupObjectKeys(backupId);
      await bucket.put(dataKey, "orphan");
    }

    const first = await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });
    const second = await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: first.nextCursor,
    });

    expect(first).toEqual({ hasMore: true, nextCursor: "opaque-1", processed: 64 });
    expect(second).toEqual({ hasMore: false, nextCursor: null, processed: 1 });
    expect(bucket.objects.size).toBe(0);
  });

  test("database-backed orphan grace retains fresh uploads", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const backupId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-44665544000c");
    const [dataKey] = getSandboxBackupObjectKeys(backupId);
    await bucket.put(dataKey, "in-flight", new Date());

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(bucket.objects.has(dataKey)).toBe(true);
  });
});

describe("environment artifact backup lifecycle", () => {
  test("a pruned runtime backup ID cannot be claimed before its tombstone exists", async () => {
    const database = createDatabase();
    const runtimeStage = await createOperationStage(database);
    const { authority } = await createEnvironmentArtifactStage(database);
    const sharedId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440040");

    expect(
      await claimSandboxBackupStageActual(database, {
        actualBackupId: sharedId,
        dir: DIR,
        sandboxIncarnation: 1,
        stagingId: runtimeStage.id,
      }),
    ).toEqual({ actualBackupId: sharedId });
    await finalizeSandboxBackupStage(database, {
      actualBackupId: sharedId,
      stagingId: runtimeStage.id,
    });
    await database
      .prepare("UPDATE sandbox_backup SET status = 'pruned' WHERE id = ?")
      .bind(sharedId)
      .run();

    await expect(
      claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: sharedId,
        authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      }),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare(
          `UPDATE OR REPLACE environment_package_artifact_backup_staging
           SET actual_backup_id = ? WHERE command_id = ?`,
        )
        .bind(sharedId, ENVIRONMENT_COMMAND_ID)
        .run(),
    ).rejects.toThrow("already owned");
    expect(
      await database
        .prepare("SELECT id, status FROM sandbox_backup WHERE id = ?")
        .bind(sharedId)
        .first(),
    ).toEqual({ id: sharedId, status: "pruned" });
    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toMatchObject({ actualBackupId: null });
  });

  test("an environment artifact backup ID cannot be claimed by runtime", async () => {
    const database = createDatabase();
    const runtimeStage = await createOperationStage(database);
    const { authority } = await createEnvironmentArtifactStage(database);
    const sharedId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440041");

    expect(
      await claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: sharedId,
        authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      }),
    ).toEqual({ actualBackupId: sharedId });
    expect(
      await commitEnvironmentPackageArtifactBackup(database, {
        actualBackupId: sharedId,
        ...authority,
        expiresAt: Date.now() + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000 - 1_000,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).toBe(true);

    await expect(
      claimSandboxBackupStageActual(database, {
        actualBackupId: sharedId,
        dir: DIR,
        sandboxIncarnation: 1,
        stagingId: runtimeStage.id,
      }),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare(
          `UPDATE OR REPLACE sandbox_backup_staging
           SET actual_backup_id = ? WHERE id = ?`,
        )
        .bind(sharedId, runtimeStage.id)
        .run(),
    ).rejects.toThrow("already owned");
    expect(await getSandboxBackupStage(database, runtimeStage.id)).toMatchObject({
      actualBackupId: null,
    });
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: sharedId });
    await database
      .prepare("DELETE FROM environment_package_artifact_backup_staging WHERE command_id = ?")
      .bind(ENVIRONMENT_COMMAND_ID)
      .run();
    const successor = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    await expect(
      claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: sharedId,
        authority: successor.authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      }),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare(
          `UPDATE OR REPLACE environment_package_artifact_backup_staging
           SET actual_backup_id = ? WHERE command_id = ?`,
        )
        .bind(sharedId, ENVIRONMENT_COMMAND_ID)
        .run(),
    ).rejects.toThrow("already owned");
  });

  test("bounded reconciliation removes a terminal stage before any R2 object exists", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    await createEnvironmentArtifactStage(database);
    database.execute(
      `UPDATE api_command SET status = 'failed' WHERE id = '${ENVIRONMENT_COMMAND_ID}'`,
    );

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toBeNull();
  });

  test("an empty R2 page continues until every terminal stage is revoked", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    for (let index = 0; index < 65; index += 1) {
      const commandId = createPlatformId<ApiCommandId>();
      const inputDigest = index.toString(16).padStart(64, "0");
      const dir = `/workspace/.mosoo/environment-artifacts/${inputDigest}`;
      await database
        .prepare(
          `INSERT INTO api_command (
             attempt_count, claim_expires_at, claim_owner, created_at, dedupe_key,
             delivery_generation, id, kind, payload_json, status, updated_at
           ) VALUES (1, ?, 'owner', ?, ?, 1, ?, 'environment_package_artifact_build', ?,
             'running', ?)`,
        )
        .bind(
          Date.now() + 60_000,
          NOW,
          `terminal-environment-stage:${commandId}`,
          commandId,
          JSON.stringify({ projectId: ENVIRONMENT_PROJECT_ID, inputDigest }),
          NOW,
        )
        .run();
      await database
        .prepare(
          `INSERT INTO environment_package_artifact_backup_staging (
             actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
             delivery_generation, dir, input_digest, paths_json, updated_at
           ) VALUES (NULL, ?, 1, 'owner', ?, ?, 1, ?, ?, ?, ?)`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          commandId,
          NOW,
          dir,
          inputDigest,
          JSON.stringify({ executable: [`${dir}/bin/tool`], node: [], python: [] }),
          NOW,
        )
        .run();
    }
    await database
      .prepare(
        "UPDATE api_command SET status = 'failed' WHERE dedupe_key LIKE 'terminal-environment-stage:%'",
      )
      .run();

    const first = await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });
    expect(first).toEqual({ hasMore: true, nextCursor: null, processed: 0 });
    await expect(
      database
        .prepare("SELECT count(*) AS count FROM environment_package_artifact_backup_staging")
        .first(),
    ).resolves.toEqual({ count: 1 });

    const second = await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });
    expect(second).toEqual({ hasMore: false, nextCursor: null, processed: 0 });
    await expect(
      database
        .prepare("SELECT count(*) AS count FROM environment_package_artifact_backup_staging")
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  test("scanner commits a complete backup to D1 without writing a projection", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440001",
    });
    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });
    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toBeNull();
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualId, manifestGeneration: 1, paths: ENVIRONMENT_PATHS });
    expect(bucket.objects.has(environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY))).toBe(false);
    expect(getSandboxBackupObjectKeys(actualId).every((key) => bucket.objects.has(key))).toBe(true);
  });

  test("a D1 manifest resolves without an R2 projection", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440009",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: authority.commandId,
      dir: ENVIRONMENT_DIR,
    });
    expect(
      await commitEnvironmentPackageArtifactBackup(database, {
        actualBackupId: actualId,
        ...authority,
        expiresAt: bucket.backupExpiresAt(actualId),
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).toBe(true);
    expect(bucket.objects.has(environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY))).toBe(false);
    const manifest = await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY);
    expect(manifest?.expiresAt).toBe(bucket.backupExpiresAt(actualId));
    expect(manifest?.expiresAt).not.toBe(
      OLD_UPLOAD.getTime() + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000,
    );

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toMatchObject({
      backupId: "650e8400-e29b-41d4-a716-446655440009",
      paths: ENVIRONMENT_PATHS,
    });
  });

  test.each([
    ["data", 0],
    ["metadata", 1],
  ] as const)(
    "a current manifest resolves null when its %s object is missing",
    async (_kind, keyIndex) => {
      const database = createDatabase();
      const bucket = new MemoryR2Bucket();
      const { authority } = await createEnvironmentArtifactStage(database);
      const actualId = bucket.putBackup({
        dir: ENVIRONMENT_DIR,
        name: createEnvironmentPackageArtifactBackupName(authority),
        platformId: "650e8400-e29b-41d4-a716-446655440019",
      });
      await claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: actualId,
        authority,
        commandId: authority.commandId,
        dir: ENVIRONMENT_DIR,
      });
      await commitEnvironmentPackageArtifactBackup(database, {
        actualBackupId: actualId,
        ...authority,
        expiresAt: bucket.backupExpiresAt(actualId),
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      });
      await bucket.delete(getSandboxBackupObjectKeys(actualId)[keyIndex]);

      await expect(
        resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
      ).resolves.toBeNull();
      expect(
        await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
      ).toMatchObject({ backupId: actualId, manifestGeneration: 1 });
    },
  );

  test("a near-expiry current manifest resolves null without reading R2", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      createdAt: new Date(
        Date.now() -
          ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000 +
          ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS / 2,
      ),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-44665544001a",
    });
    const expiresAt = bucket.backupExpiresAt(actualId);
    database.execute("DROP TRIGGER environment_package_artifact_backup_authority");
    await database
      .prepare(
        `INSERT INTO environment_package_artifact_backup (
           project_id, attempt_count, backup_id, command_id, committed_at,
           delivery_generation, expires_at, input_digest, manifest_generation, paths_json
         ) VALUES (?, 1, ?, ?, ?, 1, ?, ?, 1, ?)`,
      )
      .bind(
        ENVIRONMENT_PROJECT_ID,
        actualId,
        ENVIRONMENT_COMMAND_ID,
        expiresAt - 25 * 60 * 60_000,
        expiresAt,
        ENVIRONMENT_KEY.inputDigest,
        JSON.stringify(ENVIRONMENT_PATHS),
      )
      .run();

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toBeNull();
    expect(bucket.gets).not.toContain(getSandboxBackupObjectKeys(actualId)[1]);
  });

  test("default resolution automatically requeues a succeeded near-expiry artifact", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const buildQueue = createApiCommandQueueStub();
    const bindings = {
      ...createBindings(database, bucket),
      API_COMMAND_QUEUE: createApiCommandQueueStub(),
      ENVIRONMENT_ARTIFACT_BUILD_QUEUE: buildQueue,
    } as ApiBindings;
    const packages = [{ manager: "pip", packages: ["requests==2.32.4"] }] as const;
    const initial = await resolveEnvironmentPackageArtifact(
      bindings,
      ENVIRONMENT_PROJECT_ID,
      packages,
    );
    if (initial === null) {
      throw new Error("Environment package artifact resolution returned no key.");
    }
    const command = await database
      .prepare(
        `SELECT id FROM api_command
         WHERE kind = 'environment_package_artifact_build'`,
      )
      .first<{ id: ApiCommandId }>();
    if (command === null) {
      throw new Error("Environment package artifact command was not enqueued.");
    }
    await database
      .prepare(
        `UPDATE api_command
         SET attempt_count = 1, claim_expires_at = NULL, claim_owner = NULL,
           completed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER), status = 'succeeded'
         WHERE id = ?`,
      )
      .bind(command.id)
      .run();
    const dir = environmentPackageArtifactDir(initial.key);
    const paths: EnvironmentPackageArtifactPaths = {
      executable: [`${dir}/python/bin`],
      node: [`${dir}/npm/node_modules`],
      python: [`${dir}/python/site-packages`],
    };
    const backupId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-44665544002b");
    await database
      .prepare(
        `INSERT INTO environment_package_artifact_backup (
           project_id, attempt_count, backup_id, command_id, committed_at,
           delivery_generation, expires_at, input_digest, manifest_generation, paths_json
         ) VALUES (
           ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
           CAST(unixepoch('subsec') * 1000 AS INTEGER) + 315359999000, ?, 1, ?
         )`,
      )
      .bind(
        initial.key.projectId,
        backupId,
        command.id,
        initial.key.inputDigest,
        JSON.stringify(paths),
      )
      .run();
    await expireEnvironmentArtifactManifest(
      database,
      Date.now() + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_REFRESH_WINDOW_MS / 2,
      initial.key,
    );

    await expect(
      resolveEnvironmentPackageArtifact(bindings, ENVIRONMENT_PROJECT_ID, packages),
    ).resolves.toMatchObject({ key: initial.key, metadata: null });
    expect(buildQueue.sent).toHaveLength(2);
    expect(
      await database
        .prepare("SELECT delivery_generation, status FROM api_command WHERE id = ?")
        .bind(command.id)
        .first(),
    ).toEqual({ delivery_generation: 2, status: "queued" });
  });

  test("a delete intent that wins D1 prevents a late environment projection", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-44665544000a",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: authority.commandId,
      dir: ENVIRONMENT_DIR,
    });
    database.execute("DROP TRIGGER sandbox_backup_delete_intent_authority");
    await database
      .prepare(
        `INSERT INTO sandbox_backup_delete_intent (
           attempted_at, backup_id, created_at, delete_after, deleted_at
         ) VALUES (
           NULL, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
           CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL
         )`,
      )
      .bind(actualId)
      .run();
    database.execute("DROP TRIGGER environment_package_artifact_backup_authority");

    await expect(
      database
        .prepare(
          `INSERT INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (
             ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
             ?, ?, 1, ?
           )`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          actualId,
          ENVIRONMENT_COMMAND_ID,
          bucket.backupExpiresAt(actualId),
          ENVIRONMENT_KEY.inputDigest,
          JSON.stringify(ENVIRONMENT_PATHS),
        )
        .run(),
    ).rejects.toThrow("sandbox backup object is tombstoned or already referenced");
    expect(await getEnvironmentPackageArtifactBackupStage(database, authority.commandId)).toEqual(
      expect.objectContaining({ actualBackupId: actualId }),
    );
    await deleteAuthorizedSandboxBackupObjects(createBindings(database, bucket), [actualId]);
    expect(bucket.objects.has(environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY))).toBe(false);
    expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
  });

  test("a verified named R2 projection is atomically adopted into D1", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-44665544000b",
    });
    const legacyKey = environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY);
    await bucket.put(
      legacyKey,
      JSON.stringify({
        backupId: "650e8400-e29b-41d4-a716-44665544000b",
        paths: ENVIRONMENT_PATHS,
      }),
    );
    await succeedEnvironmentArtifactCommand(database);

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toMatchObject({ paths: ENVIRONMENT_PATHS });
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualId, paths: ENVIRONMENT_PATHS });
    await bucket.delete(legacyKey);
    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toMatchObject({ paths: ENVIRONMENT_PATHS });
    expect(bucket.gets.filter((key) => key === legacyKey)).toHaveLength(1);
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "unattributed" },
        backupId: actualId,
      }),
    ).toBe(false);
  });

  test("a real legacy nameless R2 projection is atomically adopted into D1", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: null,
      platformId: "650e8400-e29b-41d4-a716-446655440010",
    });
    await bucket.put(
      environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY),
      JSON.stringify({
        backupId: "650e8400-e29b-41d4-a716-446655440010",
        paths: ENVIRONMENT_PATHS,
      }),
    );
    await succeedEnvironmentArtifactCommand(database);

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toMatchObject({ paths: ENVIRONMENT_PATHS });
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({
      attemptCount: 1,
      backupId: actualId,
      commandId: ENVIRONMENT_COMMAND_ID,
      deliveryGeneration: 1,
      paths: ENVIRONMENT_PATHS,
    });
    await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toMatchObject({ paths: ENVIRONMENT_PATHS });
  });

  test("a D1 manifest ignores a stale legacy R2 projection", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-44665544000c",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: authority.commandId,
      dir: ENVIRONMENT_DIR,
    });
    await commitEnvironmentPackageArtifactBackup(database, {
      actualBackupId: actualId,
      ...authority,
      expiresAt: bucket.backupExpiresAt(actualId),
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    await bucket.put(
      environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY),
      JSON.stringify({
        backupId: "650e8400-e29b-41d4-a716-44665544000d",
        paths: ENVIRONMENT_PATHS,
      }),
    );

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toEqual({
      backupId: "650e8400-e29b-41d4-a716-44665544000c",
      paths: ENVIRONMENT_PATHS,
    });
    expect(getSandboxBackupObjectKeys(actualId).every((key) => bucket.objects.has(key))).toBe(true);
  });

  test("a D1 manifest rejects mismatched object authority metadata", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-44665544000e",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: authority.commandId,
      dir: ENVIRONMENT_DIR,
    });
    await commitEnvironmentPackageArtifactBackup(database, {
      actualBackupId: actualId,
      ...authority,
      expiresAt: bucket.backupExpiresAt(actualId),
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    await bucket.put(
      environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY),
      JSON.stringify({
        backupId: "650e8400-e29b-41d4-a716-44665544000e",
        paths: ENVIRONMENT_PATHS,
      }),
    );
    const [, backupMetadataKey] = getSandboxBackupObjectKeys(actualId);
    const backupMetadata = JSON.parse(bucket.objects.get(backupMetadataKey)!.body) as Record<
      string,
      unknown
    >;
    for (const tamperedAuthority of [
      { ...authority, commandId: "01J0000000000000000000000L" },
      { ...authority, deliveryGeneration: authority.deliveryGeneration + 1 },
      { ...authority, attemptCount: authority.attemptCount + 1 },
    ]) {
      await bucket.put(
        backupMetadataKey,
        JSON.stringify({
          ...backupMetadata,
          name: createEnvironmentPackageArtifactBackupName(tamperedAuthority),
        }),
      );
      await expect(
        resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
      ).resolves.toBeNull();
    }
    for (const tamperedMetadata of [
      { ...backupMetadata, ttl: ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS - 1 },
      { ...backupMetadata, createdAt: "2026-01-01" },
    ]) {
      await bucket.put(backupMetadataKey, JSON.stringify(tamperedMetadata));
      await expect(
        resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
      ).resolves.toBeNull();
    }
  });

  test("a current manifest rejects direct, replacement, and malformed writes", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440014",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: authority.commandId,
      dir: ENVIRONMENT_DIR,
    });
    await commitEnvironmentPackageArtifactBackup(database, {
      actualBackupId: actualId,
      ...authority,
      expiresAt: bucket.backupExpiresAt(actualId),
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    await database.prepare("PRAGMA recursive_triggers = OFF").run();
    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (?, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), ?, ?, ?, 1, ?)`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          authority.attemptCount,
          actualId,
          authority.commandId,
          authority.deliveryGeneration,
          bucket.backupExpiresAt(actualId),
          ENVIRONMENT_KEY.inputDigest,
          JSON.stringify(ENVIRONMENT_PATHS),
        )
        .run(),
    ).rejects.toThrow("backup lacks D1 authority");

    const malformedDatabase = createDatabase();
    const malformedStage = await createEnvironmentArtifactStage(malformedDatabase);
    const malformedId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440015");
    await claimEnvironmentPackageArtifactBackupActual(malformedDatabase, {
      actualBackupId: malformedId,
      authority: malformedStage.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    const duplicatePaths = `{"executable":[],"executable":[],"node":[],"python":[]}`;
    malformedDatabase.execute("DROP TRIGGER environment_package_artifact_backup_staging_immutable");
    await malformedDatabase
      .prepare(
        "UPDATE environment_package_artifact_backup_staging SET paths_json = ? WHERE command_id = ?",
      )
      .bind(duplicatePaths, ENVIRONMENT_COMMAND_ID)
      .run();
    await expect(
      malformedDatabase
        .prepare(
          `INSERT INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
             CAST(unixepoch('subsec') * 1000 AS INTEGER) + 315360000000, ?, 1, ?)`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          malformedId,
          ENVIRONMENT_COMMAND_ID,
          ENVIRONMENT_KEY.inputDigest,
          duplicatePaths,
        )
        .run(),
    ).rejects.toThrow("backup lacks D1 authority");

    const invalidClockDatabase = createDatabase();
    const invalidClockStage = await createEnvironmentArtifactStage(invalidClockDatabase);
    const invalidClockId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440016");
    await claimEnvironmentPackageArtifactBackupActual(invalidClockDatabase, {
      actualBackupId: invalidClockId,
      authority: invalidClockStage.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await expect(
      invalidClockDatabase
        .prepare(
          `INSERT INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (?, 1, ?, ?, 0, 1, 315360000000, ?, 1, ?)`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          invalidClockId,
          ENVIRONMENT_COMMAND_ID,
          ENVIRONMENT_KEY.inputDigest,
          JSON.stringify(ENVIRONMENT_PATHS),
        )
        .run(),
    ).rejects.toThrow("backup lacks D1 authority");
  });

  test("a raw manifest insert accepts an exact live staged command", async () => {
    const database = createDatabase();
    const { authority } = await createEnvironmentArtifactStage(database);
    const backupId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440017");
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: backupId,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });

    await insertRawEnvironmentArtifactManifest(database, backupId);

    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId });
  });

  test.each(["queued", "failed", "dead_lettered"] as const)(
    "an exact live stage cannot borrow a %s command",
    async (status) => {
      const database = createDatabase();
      const { authority } = await createEnvironmentArtifactStage(database);
      const backupId = encodeSandboxBackupIdForStorage(
        `650e8400-e29b-4000-8000-${status.length.toString(16).padStart(12, "0")}`,
      );
      await claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: backupId,
        authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      });
      await database
        .prepare("UPDATE api_command SET status = ? WHERE id = ?")
        .bind(status, ENVIRONMENT_COMMAND_ID)
        .run();

      await expect(insertRawEnvironmentArtifactManifest(database, backupId)).rejects.toThrow(
        "backup lacks D1 authority",
      );
      expect(
        await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
      ).toBeNull();
    },
  );

  test("an exact staged running command requires a live lease", async () => {
    const database = createDatabase();
    const { authority } = await createEnvironmentArtifactStage(database);
    const backupId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440018");
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: backupId,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await database
      .prepare("UPDATE api_command SET claim_expires_at = 0 WHERE id = ?")
      .bind(ENVIRONMENT_COMMAND_ID)
      .run();

    await expect(insertRawEnvironmentArtifactManifest(database, backupId)).rejects.toThrow(
      "backup lacks D1 authority",
    );
  });

  test("a succeeded command can authorize an unstaged legacy manifest", async () => {
    const database = createDatabase();
    await setEnvironmentArtifactCommand(database, {
      attemptCount: 1,
      claimOwner: "environment-owner",
      deliveryGeneration: 1,
    });
    await succeedEnvironmentArtifactCommand(database);
    const backupId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-44665544001f");

    await insertRawEnvironmentArtifactManifest(database, backupId);

    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId });
  });

  test.each([
    ["terminal status", "UPDATE api_command SET status = 'failed' WHERE id = ?"],
    ["completion clock", "UPDATE api_command SET completed_at = NULL WHERE id = ?"],
    ["claim owner", "UPDATE api_command SET claim_owner = 'stale-owner' WHERE id = ?"],
    ["claim lease", "UPDATE api_command SET claim_expires_at = 9007199254740991 WHERE id = ?"],
  ] as const)(
    "an unstaged legacy manifest requires an exact succeeded command %s",
    async (_, sql) => {
      const database = createDatabase();
      await setEnvironmentArtifactCommand(database, {
        attemptCount: 1,
        claimOwner: "environment-owner",
        deliveryGeneration: 1,
      });
      await succeedEnvironmentArtifactCommand(database);
      await database.prepare(sql).bind(ENVIRONMENT_COMMAND_ID).run();
      const backupId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440047");

      await expect(insertRawEnvironmentArtifactManifest(database, backupId)).rejects.toThrow(
        "backup lacks D1 authority",
      );
      expect(
        await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
      ).toBeNull();
    },
  );

  test("OR REPLACE cannot move a live environment candidate to another key", async () => {
    const database = createDatabase();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440042");
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });

    const projectB = parsePlatformId<ProjectId>("01J0000000000000000000000M");
    const commandB = parsePlatformId<ApiCommandId>("01J0000000000000000000000N");
    const keyB: EnvironmentPackageArtifactKey = {
      projectId: projectB,
      inputDigest: "b".repeat(64),
    };
    const dirB = environmentPackageArtifactDir(keyB);
    const pathsB: EnvironmentPackageArtifactPaths = {
      executable: [`${dirB}/python/bin`],
      node: [`${dirB}/npm/node_modules`],
      python: [`${dirB}/python/site-packages`],
    };
    await database
      .prepare(
        `INSERT INTO api_command (
           attempt_count, claim_expires_at, claim_owner, created_at, dedupe_key,
           delivery_generation, id, kind, payload_json, status, updated_at
         ) VALUES (
           1, CAST(unixepoch('subsec') * 1000 AS INTEGER) + 60000, 'owner-b', ?, ?, 1, ?,
           'environment_package_artifact_build', ?, 'running', ?
         )`,
      )
      .bind(
        NOW,
        `environment-artifact:${projectB}:${keyB.inputDigest}`,
        commandB,
        JSON.stringify(keyB),
        NOW,
      )
      .run();
    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO environment_package_artifact_backup_staging (
             actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
             delivery_generation, dir, input_digest, paths_json, updated_at
           ) VALUES (
             ?, ?, 1, 'owner-b', ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
             1, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER)
           )`,
        )
        .bind(actualId, projectB, commandB, dirB, keyB.inputDigest, JSON.stringify(pathsB))
        .run(),
    ).rejects.toThrow("already owned");

    await database
      .prepare(
        `UPDATE api_command
         SET claim_expires_at = NULL, claim_owner = NULL,
           completed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER), status = 'succeeded'
         WHERE id = ?`,
      )
      .bind(commandB)
      .run();
    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (
             ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
             CAST(unixepoch('subsec') * 1000 AS INTEGER) + 315359999000, ?, 1, ?
           )`,
        )
        .bind(projectB, actualId, commandB, keyB.inputDigest, JSON.stringify(pathsB))
        .run(),
    ).rejects.toThrow("backup lacks D1 authority");

    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toMatchObject({ actualBackupId: actualId });
    expect(await getEnvironmentPackageArtifactBackupManifest(database, keyB)).toBeNull();
  });

  test("OR REPLACE cannot replace an occupied environment stage key with a new backup", async () => {
    const database = createDatabase();
    await createEnvironmentArtifactStage(database);
    const commandB = parsePlatformId<ApiCommandId>("01J0000000000000000000000P");
    const actualB = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440048");
    await setEnvironmentArtifactCommand(database, {
      attemptCount: 1,
      claimOwner: "owner-b",
      commandId: commandB,
      dedupeKey: `environment-artifact-replacement:${commandB}`,
      deliveryGeneration: 1,
      key: ENVIRONMENT_KEY,
    });
    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO environment_package_artifact_backup_staging (
             actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
             delivery_generation, dir, input_digest, paths_json, updated_at
           ) VALUES (
             ?, ?, 1, 'owner-b', ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
             1, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER)
           )`,
        )
        .bind(
          actualB,
          ENVIRONMENT_PROJECT_ID,
          commandB,
          ENVIRONMENT_DIR,
          ENVIRONMENT_KEY.inputDigest,
          JSON.stringify(ENVIRONMENT_PATHS),
        )
        .run(),
    ).rejects.toThrow("already owned");

    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).not.toBeNull();
    expect(await getEnvironmentPackageArtifactBackupStage(database, commandB)).toBeNull();
  });

  test("OR REPLACE cannot replace an occupied environment manifest key with a new backup", async () => {
    const database = createDatabase();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualA = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440049");
    const actualB = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-44665544004a");
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await insertRawEnvironmentArtifactManifest(database, actualA);
    const commandB = parsePlatformId<ApiCommandId>("01J0000000000000000000000Q");
    await setEnvironmentArtifactCommand(database, {
      attemptCount: 1,
      claimOwner: "owner-b",
      commandId: commandB,
      dedupeKey: `environment-artifact-replacement:${commandB}`,
      deliveryGeneration: 1,
      key: ENVIRONMENT_KEY,
    });
    await succeedEnvironmentArtifactCommand(database, commandB);
    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (
             ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
             CAST(unixepoch('subsec') * 1000 AS INTEGER) + 315359999000, ?, 1, ?
           )`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          actualB,
          commandB,
          ENVIRONMENT_KEY.inputDigest,
          JSON.stringify(ENVIRONMENT_PATHS),
        )
        .run(),
    ).rejects.toThrow("backup lacks D1 authority");

    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualA });
  });

  test("OR REPLACE cannot move a live runtime candidate between stages", async () => {
    const database = createDatabase();
    const stageA = await createOperationStage(database);
    const actualA = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440043");
    const actualB = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440044");
    const stageB = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440045");
    const stageC = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440046");
    await claimSandboxBackupStageActual(database, {
      actualBackupId: actualA,
      dir: DIR,
      sandboxIncarnation: 1,
      stagingId: stageA.id,
    });
    const insertStage = (stagingId: SandboxBackupId, actualBackupId: SandboxBackupId) =>
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup_staging (
             actual_backup_id, claim_owner, created_at, dir, driver_generation,
             driver_instance_id, id, operation_id, sandbox_id, sandbox_incarnation,
             session_run_id, ttl_seconds, updated_at, updates_subject_backup,
             workspace_session_id
           ) VALUES (
             ?, 'owner', CAST(unixepoch('subsec') * 1000 AS INTEGER), '/workspace/other',
             NULL, NULL, ?, ?, ?, 1, NULL, 100,
             CAST(unixepoch('subsec') * 1000 AS INTEGER), 0, NULL
           )`,
        )
        .bind(actualBackupId, stagingId, OPERATION_ID, SANDBOX_ID)
        .run();
    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    await expect(insertStage(stageC, actualA)).rejects.toThrow("already owned");
    await insertStage(stageB, actualB);
    await expect(
      database
        .prepare("UPDATE OR REPLACE sandbox_backup_staging SET actual_backup_id = ? WHERE id = ?")
        .bind(actualA, stageB)
        .run(),
    ).rejects.toThrow("already owned");

    expect(await getSandboxBackupStage(database, stageA.id)).toMatchObject({
      actualBackupId: actualA,
    });
    expect(await getSandboxBackupStage(database, stageB)).toMatchObject({
      actualBackupId: actualB,
    });
  });

  test("a wrong-dir stage cannot authorize a manifest", async () => {
    const database = createDatabase();
    await setEnvironmentArtifactCommand(database, {
      attemptCount: 1,
      claimOwner: "environment-owner",
      deliveryGeneration: 1,
    });
    const backupId = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-44665544002c");
    await database
      .prepare(
        `INSERT INTO environment_package_artifact_backup_staging (
           actual_backup_id, project_id, attempt_count, claim_owner, command_id, created_at,
           delivery_generation, dir, input_digest, paths_json, updated_at
         ) VALUES (
           ?, ?, 1, 'environment-owner', ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
           1, '/workspace/wrong', ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER)
         )`,
      )
      .bind(
        backupId,
        ENVIRONMENT_PROJECT_ID,
        ENVIRONMENT_COMMAND_ID,
        ENVIRONMENT_KEY.inputDigest,
        JSON.stringify(ENVIRONMENT_PATHS),
      )
      .run();
    const expiresAt = Date.now() + ENVIRONMENT_PACKAGE_ARTIFACT_BACKUP_TTL_SECONDS * 1_000 - 1_000;

    await expect(
      commitEnvironmentPackageArtifactBackup(database, {
        actualBackupId: backupId,
        attemptCount: 1,
        claimOwner: "environment-owner",
        commandId: ENVIRONMENT_COMMAND_ID,
        deliveryGeneration: 1,
        expiresAt,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).resolves.toBe(false);
    await expect(
      database
        .prepare(
          `INSERT INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (
             ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1, ?, ?, 1, ?
           )`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          backupId,
          ENVIRONMENT_COMMAND_ID,
          expiresAt,
          ENVIRONMENT_KEY.inputDigest,
          JSON.stringify(ENVIRONMENT_PATHS),
        )
        .run(),
    ).rejects.toThrow("backup lacks D1 authority");
  });

  test("UPDATE OR REPLACE cannot steal another environment key's backup", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      createdAt: new Date(Date.now() - 60_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440027",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    const projectB = parsePlatformId<ProjectId>("01J0000000000000000000000M");
    const commandB = parsePlatformId<ApiCommandId>("01J0000000000000000000000N");
    const keyB: EnvironmentPackageArtifactKey = {
      projectId: projectB,
      inputDigest: "b".repeat(64),
    };
    const dirB = environmentPackageArtifactDir(keyB);
    const pathsB: EnvironmentPackageArtifactPaths = {
      executable: [`${dirB}/python/bin`],
      node: [`${dirB}/npm/node_modules`],
      python: [`${dirB}/python/site-packages`],
    };
    const actualB = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440028");
    await database
      .prepare(
        `INSERT INTO api_command (
           attempt_count, claim_expires_at, claim_owner, completed_at, created_at,
           dedupe_key, delivery_generation, id, kind, payload_json, status, updated_at
         ) VALUES (
           1, NULL, NULL, CAST(unixepoch('subsec') * 1000 AS INTEGER), ?,
           ?, 1, ?, 'environment_package_artifact_build', ?, 'succeeded', ?
         )`,
      )
      .bind(
        NOW,
        `environment-artifact:${projectB}:${keyB.inputDigest}`,
        commandB,
        JSON.stringify(keyB),
        NOW,
      )
      .run();
    await database
      .prepare(
        `INSERT INTO environment_package_artifact_backup (
           project_id, attempt_count, backup_id, command_id, committed_at,
           delivery_generation, expires_at, input_digest, manifest_generation, paths_json
         ) VALUES (
           ?, 1, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER), 1,
           CAST(unixepoch('subsec') * 1000 AS INTEGER) + 315359999000, ?, 1, ?
         )`,
      )
      .bind(projectB, actualB, commandB, keyB.inputDigest, JSON.stringify(pathsB))
      .run();
    await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "replacement-owner",
      deliveryGeneration: 2,
    });
    const stageGuard = await database
      .prepare(
        `SELECT sql FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'sandbox_backup_delete_intent_blocks_environment_stage_update'`,
      )
      .first<{ sql: string }>();
    if (stageGuard === null) {
      throw new Error("Environment backup stage ownership trigger is missing.");
    }
    database.execute("DROP TRIGGER sandbox_backup_delete_intent_blocks_environment_stage_update");
    await database
      .prepare(
        `UPDATE environment_package_artifact_backup_staging
         SET actual_backup_id = ? WHERE command_id = ?`,
      )
      .bind(actualB, ENVIRONMENT_COMMAND_ID)
      .run();
    database.execute(stageGuard.sql);
    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    await expect(
      database
        .prepare(
          `UPDATE OR REPLACE environment_package_artifact_backup
           SET attempt_count = 2, backup_id = ?, command_id = ?,
             committed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
             delivery_generation = 2, expires_at = ?, manifest_generation = 2,
             paths_json = ?
           WHERE project_id = ? AND input_digest = ?`,
        )
        .bind(
          actualB,
          ENVIRONMENT_COMMAND_ID,
          bucket.backupExpiresAt(actualA) + 30_000,
          JSON.stringify(ENVIRONMENT_PATHS),
          ENVIRONMENT_PROJECT_ID,
          ENVIRONMENT_KEY.inputDigest,
        )
        .run(),
    ).rejects.toThrow("rotation lacks D1 authority");
    expect(
      (
        await database
          .prepare(
            `SELECT project_id, backup_id, input_digest
             FROM environment_package_artifact_backup ORDER BY project_id`,
          )
          .all()
      ).results,
    ).toEqual([
      {
        project_id: ENVIRONMENT_PROJECT_ID,
        backup_id: actualA,
        input_digest: ENVIRONMENT_KEY.inputDigest,
      },
      { project_id: projectB, backup_id: actualB, input_digest: keyB.inputDigest },
    ]);
  });

  test("raw rotation requires a new backup, exact next generation, and longer expiry", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      createdAt: new Date(Date.now() - 60_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-44665544002d",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-44665544002e",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });

    for (const [backupId, manifestGeneration, expiresAt] of [
      [actualB, 3, bucket.backupExpiresAt(actualB)],
      [actualB, 2, bucket.backupExpiresAt(actualA)],
    ] as const) {
      await expect(
        database
          .prepare(
            `UPDATE environment_package_artifact_backup
             SET attempt_count = 2, backup_id = ?, command_id = ?,
               committed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
               delivery_generation = 2, expires_at = ?, manifest_generation = ?,
               paths_json = ?
             WHERE project_id = ? AND input_digest = ?`,
          )
          .bind(
            backupId,
            ENVIRONMENT_COMMAND_ID,
            expiresAt,
            manifestGeneration,
            JSON.stringify(ENVIRONMENT_PATHS),
            ENVIRONMENT_PROJECT_ID,
            ENVIRONMENT_KEY.inputDigest,
          )
          .run(),
      ).rejects.toThrow("rotation lacks D1 authority");
    }
    database.execute("DROP TRIGGER sandbox_backup_delete_intent_blocks_environment_stage_update");
    await database
      .prepare(
        `UPDATE environment_package_artifact_backup_staging
         SET actual_backup_id = ? WHERE command_id = ?`,
      )
      .bind(actualA, ENVIRONMENT_COMMAND_ID)
      .run();
    await expect(
      database
        .prepare(
          `UPDATE environment_package_artifact_backup
           SET attempt_count = 2, backup_id = ?, command_id = ?,
             committed_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
             delivery_generation = 2, expires_at = ?, manifest_generation = 2,
             paths_json = ?
           WHERE project_id = ? AND input_digest = ?`,
        )
        .bind(
          actualA,
          ENVIRONMENT_COMMAND_ID,
          bucket.backupExpiresAt(actualB),
          JSON.stringify(ENVIRONMENT_PATHS),
          ENVIRONMENT_PROJECT_ID,
          ENVIRONMENT_KEY.inputDigest,
        )
        .run(),
    ).rejects.toThrow("rotation lacks D1 authority");
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualA, manifestGeneration: 1 });
  });

  test("a failed old-backup tombstone rolls back the whole manifest swap", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      createdAt: new Date(Date.now() - 60_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-44665544002f",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440030",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    database.execute("DROP TRIGGER sandbox_backup_delete_intent_authority");
    await database
      .prepare(
        `INSERT INTO sandbox_backup_delete_intent (
           attempted_at, backup_id, created_at, delete_after, deleted_at
         ) VALUES (
           NULL, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
           CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL
         )`,
      )
      .bind(actualA)
      .run();

    await expect(
      publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
        ...attemptB.authority,
        backupId: actualB,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).rejects.toThrow();
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualA, manifestGeneration: 1 });
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM sandbox_backup_delete_intent WHERE backup_id = ?")
        .bind(actualA)
        .first(),
    ).toEqual({ count: 1 });
  });

  test.each([
    ["traversal", { ...ENVIRONMENT_PATHS, python: [`${ENVIRONMENT_DIR}/python/../escape`] }],
    ["outside", { ...ENVIRONMENT_PATHS, python: ["/workspace/escape"] }],
    ["relative", { ...ENVIRONMENT_PATHS, python: ["python/site-packages"] }],
    ["root itself", { ...ENVIRONMENT_PATHS, python: [ENVIRONMENT_DIR] }],
    ["prefix collision", { ...ENVIRONMENT_PATHS, python: [`${ENVIRONMENT_DIR}-evil/path`] }],
    ["empty segment", { ...ENVIRONMENT_PATHS, python: [`${ENVIRONMENT_DIR}//python`] }],
    ["dot segment", { ...ENVIRONMENT_PATHS, python: [`${ENVIRONMENT_DIR}/./python`] }],
    ["extra key", { ...ENVIRONMENT_PATHS, extra: [`${ENVIRONMENT_DIR}/extra`] }],
    ["duplicate", { ...ENVIRONMENT_PATHS, python: [ENVIRONMENT_PATHS.executable[0]] }],
    ["NUL", { ...ENVIRONMENT_PATHS, python: [`${ENVIRONMENT_DIR}/python/\0escape`] }],
    ["colon", { ...ENVIRONMENT_PATHS, python: [`${ENVIRONMENT_DIR}/python:escape`] }],
  ])("a legacy projection rejects %s artifact paths", async (_case, paths) => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-44665544000f",
    });
    await bucket.put(
      environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY),
      JSON.stringify({
        backupId: "650e8400-e29b-41d4-a716-44665544000f",
        paths,
      }),
    );

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toBeNull();
    expect(await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY)).toBeNull();
  });

  test("a legacy projection rejects extra metadata keys", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440011",
    });
    await bucket.put(
      environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY),
      JSON.stringify({
        backupId: "650e8400-e29b-41d4-a716-446655440011",
        extra: true,
        paths: ENVIRONMENT_PATHS,
      }),
    );

    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toBeNull();
    expect(await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY)).toBeNull();
  });

  test("an existing D1 manifest cannot complete a successor stage", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440002",
    });
    expect(
      await claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: actualA,
        authority: attemptA.authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      }),
    ).toEqual({ actualBackupId: actualA });
    expect(
      await commitEnvironmentPackageArtifactBackup(database, {
        actualBackupId: actualA,
        ...attemptA.authority,
        expiresAt: bucket.backupExpiresAt(actualA),
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).toBe(true);

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      attemptCount: attemptA.authority.attemptCount,
      backupId: actualA,
      claimOwner: attemptA.authority.claimOwner,
      commandId: attemptA.authority.commandId,
      deliveryGeneration: attemptA.authority.deliveryGeneration,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toEqual(attemptB.stage);
    expect(getSandboxBackupObjectKeys(actualA).every((key) => bucket.objects.has(key))).toBe(true);
    expect(bucket.objects.has(environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY))).toBe(false);
  });

  test("rotation keeps old objects until every issued reference has expired", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      createdAt: new Date(Date.now() - 60_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440008",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440018",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptB.authority,
      backupId: actualB,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualB, manifestGeneration: 2 });
    expect(
      await database
        .prepare(
          `SELECT attempted_at, delete_after, deleted_at
           FROM sandbox_backup_delete_intent WHERE backup_id = ?`,
        )
        .bind(actualA)
        .first(),
    ).toEqual({
      attempted_at: null,
      delete_after: bucket.backupExpiresAt(actualA),
      deleted_at: null,
    });
    expect(await listPendingSandboxBackupDeletions(database, 64)).not.toContain(actualA);

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(getSandboxBackupObjectKeys(actualA).every((key) => bucket.objects.has(key))).toBe(true);
    expect(getSandboxBackupObjectKeys(actualB).every((key) => bucket.objects.has(key))).toBe(true);
  });

  test("an expired manifest rotates atomically and makes its old objects immediately due", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440020",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    await expireEnvironmentArtifactManifest(database);
    const [, oldMetadataKey] = getSandboxBackupObjectKeys(actualA);
    const oldMetadata = JSON.parse(bucket.objects.get(oldMetadataKey)!.body) as Record<
      string,
      unknown
    >;
    await bucket.put(oldMetadataKey, JSON.stringify({ ...oldMetadata, name: null }));

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440021",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptB.authority,
      backupId: actualB,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualB, manifestGeneration: 2 });
    expect(await listPendingSandboxBackupDeletions(database, 64)).toContain(actualA);

    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });
    expect(getSandboxBackupObjectKeys(actualA).every((key) => !bucket.objects.has(key))).toBe(true);
    expect(getSandboxBackupObjectKeys(actualB).every((key) => bucket.objects.has(key))).toBe(true);
  });

  test("reconciliation retires an unused expired manifest and its R2 objects", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const platformId = "650e8400-e29b-41d4-a716-446655440029";
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId,
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...authority,
      backupId: actualId,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });

    await expect(
      database
        .prepare(
          `DELETE FROM environment_package_artifact_backup
           WHERE project_id = ? AND input_digest = ?`,
        )
        .bind(ENVIRONMENT_PROJECT_ID, ENVIRONMENT_KEY.inputDigest)
        .run(),
    ).rejects.toThrow("manifest has not expired");
    await expireEnvironmentArtifactManifest(database);

    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });

    expect(await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY)).toBeNull();
    expect(getSandboxBackupObjectKeys(actualId).every((key) => !bucket.objects.has(key))).toBe(
      true,
    );
    expect(
      await database
        .prepare(
          `SELECT attempted_at, deleted_at
           FROM sandbox_backup_delete_intent WHERE backup_id = ?`,
        )
        .bind(actualId)
        .first(),
    ).toEqual({ attempted_at: expect.any(Number), deleted_at: expect.any(Number) });

    bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId,
    });
    await bucket.put(
      environmentPackageArtifactMetadataKey(ENVIRONMENT_KEY),
      JSON.stringify({ backupId: platformId, paths: ENVIRONMENT_PATHS }),
    );
    await succeedEnvironmentArtifactCommand(database);
    await expect(
      resolveEnvironmentPackageArtifactBackup(createBindings(database, bucket), ENVIRONMENT_KEY),
    ).resolves.toBeNull();
    expect(await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY)).toBeNull();

    const successor = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const successorId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(successor.authority),
      platformId: "650e8400-e29b-41d4-a716-44665544002a",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: successorId,
      authority: successor.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...successor.authority,
      backupId: successorId,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: successorId, manifestGeneration: 1 });
  });

  test("a rotation retries as generation one when retirement wins its CAS", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440031",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });
    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });
    await expireEnvironmentArtifactManifest(database);

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440032",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    let retired = false;
    const intercept = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property, receiver) {
          if (property === "bind") {
            return (...values: unknown[]) => intercept(Reflect.apply(target.bind, target, values));
          }
          if (property === "run") {
            return async (...args: unknown[]) => {
              if (!retired) {
                retired = true;
                await retireExpiredEnvironmentPackageArtifactBackups(database, 64);
              }
              return Reflect.apply(target.run, target, args);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes("UPDATE environment_package_artifact_backup\n         SET")
              ? intercept(statement)
              : statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await publishEnvironmentPackageArtifactBackup(createBindings(racingDatabase, bucket), {
      ...attemptB.authority,
      backupId: actualB,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    expect(retired).toBe(true);
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualB, manifestGeneration: 1 });
    expect(await listPendingSandboxBackupDeletions(database, 64)).toContain(actualA);
  });

  test("an initial manifest survives a lost D1 acknowledgement", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const actualId = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440043",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualId,
      authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    const fault = loseRunAcknowledgementOnce(
      database,
      "INSERT INTO environment_package_artifact_backup",
    );

    await expect(
      publishEnvironmentPackageArtifactBackup(createBindings(fault.database, bucket), {
        ...authority,
        backupId: actualId,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).rejects.toThrow("Simulated D1 write acknowledgement loss");
    expect(fault.wasLost()).toBe(true);
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualId, manifestGeneration: 1 });

    await expect(
      publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
        ...authority,
        backupId: actualId,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).resolves.toBeUndefined();
  });

  test("a committed manifest swap survives a lost D1 acknowledgement", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      createdAt: new Date(Date.now() - 60_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440022",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440023",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    const fault = loseRunAcknowledgementOnce(
      database,
      "UPDATE environment_package_artifact_backup\n         SET",
    );

    await expect(
      publishEnvironmentPackageArtifactBackup(createBindings(fault.database, bucket), {
        ...attemptB.authority,
        backupId: actualB,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).rejects.toThrow("Simulated D1 write acknowledgement loss");

    expect(fault.wasLost()).toBe(true);
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualB, manifestGeneration: 2 });
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM sandbox_backup_delete_intent WHERE backup_id = ?")
        .bind(actualA)
        .first(),
    ).toEqual({ count: 1 });
    await expect(
      publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
        ...attemptB.authority,
        backupId: actualB,
        key: ENVIRONMENT_KEY,
        paths: ENVIRONMENT_PATHS,
      }),
    ).resolves.toBeUndefined();
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualB, manifestGeneration: 2 });
  });

  test("a stale rotation CAS loses without disturbing its winner", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      createdAt: new Date(Date.now() - 120_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440024",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualA,
      authority: attemptA.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });
    await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
      ...attemptA.authority,
      backupId: actualA,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "second-owner",
      deliveryGeneration: 2,
    });
    const actualB = bucket.putBackup({
      createdAt: new Date(Date.now() - 60_000),
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptB.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440025",
    });
    await claimEnvironmentPackageArtifactBackupActual(database, {
      actualBackupId: actualB,
      authority: attemptB.authority,
      commandId: ENVIRONMENT_COMMAND_ID,
      dir: ENVIRONMENT_DIR,
    });

    let actualC: SandboxBackupId | null = null;
    let intercepted = false;
    const intercept = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property, receiver) {
          if (property === "bind") {
            return (...values: unknown[]) => intercept(Reflect.apply(target.bind, target, values));
          }
          if (property === "run") {
            return async (...args: unknown[]) => {
              if (!intercepted) {
                intercepted = true;
                const attemptC = await createEnvironmentArtifactStage(database, {
                  attemptCount: 3,
                  claimOwner: "third-owner",
                  deliveryGeneration: 3,
                });
                actualC = bucket.putBackup({
                  dir: ENVIRONMENT_DIR,
                  name: createEnvironmentPackageArtifactBackupName(attemptC.authority),
                  platformId: "650e8400-e29b-41d4-a716-446655440026",
                });
                await claimEnvironmentPackageArtifactBackupActual(database, {
                  actualBackupId: actualC,
                  authority: attemptC.authority,
                  commandId: ENVIRONMENT_COMMAND_ID,
                  dir: ENVIRONMENT_DIR,
                });
                await publishEnvironmentPackageArtifactBackup(createBindings(database, bucket), {
                  ...attemptC.authority,
                  backupId: actualC,
                  key: ENVIRONMENT_KEY,
                  paths: ENVIRONMENT_PATHS,
                });
              }
              return Reflect.apply(target.run, target, args);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes("UPDATE environment_package_artifact_backup\n         SET")
              ? intercept(statement)
              : statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await publishEnvironmentPackageArtifactBackup(createBindings(racingDatabase, bucket), {
      ...attemptB.authority,
      backupId: actualB,
      key: ENVIRONMENT_KEY,
      paths: ENVIRONMENT_PATHS,
    });

    expect(intercepted).toBe(true);
    expect(actualC).not.toBeNull();
    expect(
      await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY),
    ).toMatchObject({ backupId: actualC, manifestGeneration: 2 });
    expect(await listPendingSandboxBackupDeletions(database, 64)).toContain(actualB);
    expect(getSandboxBackupObjectKeys(actualB).every((key) => bucket.objects.has(key))).toBe(true);

    bucket.failAfterDeletingKey = getSandboxBackupObjectKeys(actualB)[0];
    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });
    await reconcileSandboxBackupPage(createBindings(database, bucket), { cursor: null });
    expect(getSandboxBackupObjectKeys(actualB).every((key) => !bucket.objects.has(key))).toBe(true);
    expect(getSandboxBackupObjectKeys(actualA).every((key) => bucket.objects.has(key))).toBe(true);
    expect(
      actualC !== null &&
        getSandboxBackupObjectKeys(actualC).every((key) => bucket.objects.has(key)),
    ).toBe(true);
  });

  test("scanner cannot claim an old attempt candidate into a rotated stage", async () => {
    const database = createDatabase();
    const attemptA = await createEnvironmentArtifactStage(database);
    const candidateA = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440003");

    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });
    expect(
      await claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: candidateA,
        authority: attemptA.authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      }),
    ).toBeNull();
    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toEqual(attemptB.stage);
  });

  test("old attempt objects are collected after grace without disturbing the current stage", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const attemptA = await createEnvironmentArtifactStage(database);
    const actualA = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(attemptA.authority),
      platformId: "650e8400-e29b-41d4-a716-446655440004",
    });
    const attemptB = await createEnvironmentArtifactStage(database, {
      attemptCount: 2,
      claimOwner: "successor-owner",
      deliveryGeneration: 2,
    });

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(getSandboxBackupObjectKeys(actualA).every((key) => !bucket.objects.has(key))).toBe(true);
    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toEqual(attemptB.stage);
  });

  test("partial objects use bounded grace even while another artifact writer is active", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const metaOnly = bucket.putBackup({
      dir: ENVIRONMENT_DIR,
      name: createEnvironmentPackageArtifactBackupName(authority),
      platformId: "650e8400-e29b-41d4-a716-446655440005",
    });
    expect(
      await claimEnvironmentPackageArtifactBackupActual(database, {
        actualBackupId: metaOnly,
        authority,
        commandId: ENVIRONMENT_COMMAND_ID,
        dir: ENVIRONMENT_DIR,
      }),
    ).toEqual({ actualBackupId: metaOnly });
    const [metaOnlyDataKey, metaOnlyMetadataKey] = getSandboxBackupObjectKeys(metaOnly);
    await bucket.delete(metaOnlyDataKey);

    const oldDataOnly = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440006");
    const freshDataOnly = encodeSandboxBackupIdForStorage("650e8400-e29b-41d4-a716-446655440007");
    const [oldDataKey] = getSandboxBackupObjectKeys(oldDataOnly);
    const [freshDataKey] = getSandboxBackupObjectKeys(freshDataOnly);
    await bucket.put(oldDataKey, "old-partial");
    await bucket.put(freshDataKey, "fresh-partial", new Date(NOW));

    await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });

    expect(bucket.objects.has(metaOnlyMetadataKey)).toBe(false);
    expect(bucket.objects.has(oldDataKey)).toBe(false);
    expect(bucket.objects.has(freshDataKey)).toBe(true);
    expect(
      await getEnvironmentPackageArtifactBackupStage(database, ENVIRONMENT_COMMAND_ID),
    ).toMatchObject({ actualBackupId: null });
  });

  test("opaque pagination converges many complete candidates on one D1 manifest", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    const { authority } = await createEnvironmentArtifactStage(database);
    const candidates: SandboxBackupId[] = [];
    for (let index = 0; index < 65; index += 1) {
      candidates.push(
        bucket.putBackup({
          dir: ENVIRONMENT_DIR,
          name: createEnvironmentPackageArtifactBackupName(authority),
          platformId: `650e8400-e29b-4000-8000-${index.toString(16).padStart(12, "0")}`,
        }),
      );
    }

    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const page = await reconcileSandboxBackupPage(createBindings(database, bucket), {
        cursor,
      });
      cursor = page.nextCursor;
      pageCount += 1;
      if (!page.hasMore) {
        break;
      }
    } while (pageCount < 10);

    const winner = (await getEnvironmentPackageArtifactBackupManifest(database, ENVIRONMENT_KEY))
      ?.backupId;
    if (winner === undefined) {
      throw new Error("Environment artifact candidates produced no D1 winner.");
    }
    expect(candidates).toContain(winner);
    expect(pageCount).toBeGreaterThan(1);
    expect(
      [...bucket.objects.keys()].filter((key) => key.startsWith("backups/")).toSorted(),
    ).toEqual([...getSandboxBackupObjectKeys(winner)].toSorted());
  });

  test("an empty R2 page continues until every expired D1 manifest is retired", async () => {
    const database = createDatabase();
    const bucket = new MemoryR2Bucket();
    await createEnvironmentArtifactStage(database);
    database.execute("DROP TRIGGER environment_package_artifact_backup_authority");
    const committedAt = Date.now() - 2 * 86_400_000;
    const expiresAt = committedAt + 86_400_001;
    for (let index = 0; index < 65; index += 1) {
      const inputDigest = index.toString(16).padStart(64, "0");
      const dir = `/workspace/.mosoo/environment-artifacts/${inputDigest}`;
      const backupId = encodeSandboxBackupIdForStorage(
        `650e8400-e29b-4000-8001-${index.toString(16).padStart(12, "0")}`,
      );
      await database
        .prepare(
          `INSERT INTO environment_package_artifact_backup (
             project_id, attempt_count, backup_id, command_id, committed_at,
             delivery_generation, expires_at, input_digest, manifest_generation, paths_json
           ) VALUES (?, 1, ?, ?, ?, 1, ?, ?, 1, ?)`,
        )
        .bind(
          ENVIRONMENT_PROJECT_ID,
          backupId,
          ENVIRONMENT_COMMAND_ID,
          committedAt,
          expiresAt,
          inputDigest,
          JSON.stringify({ executable: [`${dir}/bin/tool`], node: [], python: [] }),
        )
        .run();
    }

    const first = await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });
    expect(first).toEqual({ hasMore: true, nextCursor: null, processed: 0 });
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM environment_package_artifact_backup")
        .first(),
    ).toEqual({ count: 1 });

    const second = await reconcileSandboxBackupPage(createBindings(database, bucket), {
      cursor: null,
    });
    expect(second).toEqual({ hasMore: false, nextCursor: null, processed: 0 });
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM environment_package_artifact_backup")
        .first(),
    ).toEqual({ count: 0 });
  });

  test("hidden rowid cannot replace permanent backup authority", async () => {
    const database = createDatabase();
    const stage = await createOperationStage(database);
    const readyId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440030");
    const replacementId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440031");
    const replacementStageId = encodeSandboxBackupIdForStorage(
      "550e8400-e29b-41d4-a716-446655440032",
    );
    const intentId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440033");
    const replacementIntentId = encodeSandboxBackupIdForStorage(
      "550e8400-e29b-41d4-a716-446655440034",
    );

    await claimSandboxBackupStageActual(database, {
      actualBackupId: readyId,
      dir: DIR,
      sandboxIncarnation: 1,
      stagingId: stage.id,
    });
    await finalizeSandboxBackupStage(database, {
      actualBackupId: readyId,
      stagingId: stage.id,
    });
    expect(
      await authorizeSandboxBackupDeletion(database, {
        authority: { kind: "unattributed" },
        backupId: intentId,
      }),
    ).toBe(true);

    await database.prepare("PRAGMA recursive_triggers = OFF").run();

    expect(
      (
        await database
          .prepare(
            `SELECT name, wr FROM pragma_table_list
             WHERE name IN (
               'environment_package_artifact_backup',
               'environment_package_artifact_backup_staging',
               'sandbox_backup',
               'sandbox_backup_delete_intent',
               'sandbox_backup_staging'
             )
             ORDER BY name`,
          )
          .all()
      ).results,
    ).toEqual([
      { name: "environment_package_artifact_backup", wr: 1 },
      { name: "environment_package_artifact_backup_staging", wr: 1 },
      { name: "sandbox_backup", wr: 1 },
      { name: "sandbox_backup_delete_intent", wr: 1 },
      { name: "sandbox_backup_staging", wr: 1 },
    ]);

    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup (
             rowid, created_at, dir, id, keep, operation_id, sandbox_id,
             sandbox_incarnation, session_run_id, staging_id, status,
             ttl_seconds, updated_at, workspace_session_id
           ) VALUES (
             1, ?, '/workspace/rowid-replacement', ?, 0, ?, ?, 1,
             NULL, ?, 'ready', 100, ?, NULL
           )`,
        )
        .bind(NOW, replacementId, OPERATION_ID, SANDBOX_ID, replacementStageId, NOW)
        .run(),
    ).rejects.toThrow(/rowid/i);

    await expect(
      database
        .prepare(
          `INSERT OR REPLACE INTO sandbox_backup_delete_intent (
             rowid, attempted_at, backup_id, created_at, delete_after, deleted_at
           ) VALUES (
             1, NULL, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER),
             CAST(unixepoch('subsec') * 1000 AS INTEGER), NULL
           )`,
        )
        .bind(replacementIntentId)
        .run(),
    ).rejects.toThrow(/rowid/i);

    expect(await readyRows(database)).toEqual([{ id: readyId, staging_id: stage.id }]);
    expect(
      (
        await database
          .prepare("SELECT backup_id FROM sandbox_backup_delete_intent ORDER BY backup_id")
          .all()
      ).results,
    ).toEqual([{ backup_id: intentId }]);
  });
});
