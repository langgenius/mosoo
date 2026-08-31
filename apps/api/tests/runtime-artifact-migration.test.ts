import { describe, expect, test } from "bun:test";

import type { FileId, SessionId } from "@mosoo/id";

import { fileStore } from "../src/modules/files/application/file-store";
import { applyDrizzleMigration, applyDrizzleMigrationsBefore } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const MIGRATION_TAG = "0017_durable-event-side-effects";

const ACCOUNT_ID = "01J0000000000000000000001K";
const AGENT_ID = "01J0000000000000000000001J";
const PROJECT_ID = "01J0000000000000000000001M";
const SESSION_ID = "01J0000000000000000000001H" as SessionId;
const ORPHAN_SESSION_ID = "01J0000000000000000000001P" as SessionId;

const OLDER_FILE_ID = "01J00000000000000000000039" as FileId;
const TIE_LOSER_FILE_ID = "01J00000000000000000000031" as FileId;
const WINNER_FILE_ID = "01J00000000000000000000032" as FileId;
const ORPHAN_FILE_ID = "01J00000000000000000000033" as FileId;
const INVALID_PARENT_FILE_ID = "01J00000000000000000000034" as FileId;
const INVALID_PATH_FILE_ID = "01J00000000000000000000035" as FileId;
const DELETING_FILE_ID = "01J00000000000000000000036" as FileId;
const LATE_REPORT_FILE_ID = "01J00000000000000000000037" as FileId;
const LATE_PATH_NEWER_FILE_ID = "01J0000000000000000000003A" as FileId;
const V3_FILE_ID = "01J0000000000000000000003D" as FileId;
const V3_LATE_LEGACY_FILE_ID = "01J0000000000000000000003E" as FileId;
const MISSING_HEAD_FILE_ID = "01J0000000000000000000003F" as FileId;
const MISSING_HEAD_LATE_FILE_ID = "01J0000000000000000000003G" as FileId;
const SAME_TIME_LOSER_FILE_ID = "01J0000000000000000000003H" as FileId;
const SAME_TIME_WINNER_FILE_ID = "01J0000000000000000000003J" as FileId;

interface ArtifactHeadRow {
  file_id: string | null;
  runtime_event_seq: number;
  session_id: string;
  source_event_id: string;
  source_path: string;
  updated_at: number;
}

function legacyRuntimeOutputParentPath(sourcePath: string, contentSha256: string): string {
  return `runtime-output/${sourcePath}/${contentSha256}`;
}

async function createPre0016Database(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsBefore(database, MIGRATION_TAG);

  return database;
}

async function insertSession(database: SqliteD1Database): Promise<void> {
  await database
    .prepare(
      `INSERT INTO session (
        agent_id, created_at, creator_account_id, id, kind, model, project_id,
        provider, renamed, runtime_id, status, updated_at
      ) VALUES (?, 1, ?, ?, 'agent', 'gpt-5.4', ?, 'openai', 0, 'codex', 'IDLE', 1)`,
    )
    .bind(AGENT_ID, ACCOUNT_ID, SESSION_ID, PROJECT_ID)
    .run();
}

async function insertLegacyArtifact(
  database: SqliteD1Database,
  input: {
    createdAt: number;
    fileId: FileId;
    parentPath: string;
    sessionId?: SessionId;
    status?: "deleting" | "ready";
  },
): Promise<void> {
  const name = `artifact-${input.fileId}.txt`;

  await database
    .prepare(
      `INSERT INTO file_record (
        committed, created_at, created_by_account_id, etag, expires_at, id,
        mime_type, name, object_key, owner_id, owner_kind, parent_path, path,
        purpose, scope_id, scope_kind, session_kind, size, status, updated_at,
        version
      ) VALUES (
        1, ?, ?, ?, NULL, ?, 'text/plain', ?, ?, ?, 'session', ?, ?,
        'session_artifact', ?, 'session', 'artifact', ?, ?, ?, 1
      )`,
    )
    .bind(
      input.createdAt,
      ACCOUNT_ID,
      `etag-${input.fileId}`,
      input.fileId,
      name,
      `objects/${input.fileId}`,
      input.sessionId ?? SESSION_ID,
      input.parentPath,
      `session-artifacts/${input.fileId}/${name}`,
      input.sessionId ?? SESSION_ID,
      input.fileId === WINNER_FILE_ID ? 32 : 1,
      input.status ?? "ready",
      input.createdAt,
    )
    .run();
}

describe("runtime artifact migration", () => {
  test("backfills only the deterministic visible and restorable legacy artifact head", async () => {
    const database = await createPre0016Database();
    const preMigrationColumns = await database
      .prepare("PRAGMA table_info(file_record)")
      .all<{ name: string }>();

    expect(preMigrationColumns.results.map(({ name }) => name)).not.toContain("runtime_event_seq");

    await insertSession(database);
    await insertLegacyArtifact(database, {
      createdAt: 10,
      fileId: OLDER_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/report.txt", "a".repeat(64)),
    });
    await insertLegacyArtifact(database, {
      createdAt: 20,
      fileId: TIE_LOSER_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/report.txt", "b".repeat(64)),
    });
    await insertLegacyArtifact(database, {
      createdAt: 20,
      fileId: WINNER_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/report.txt", "c".repeat(64)),
    });
    await insertLegacyArtifact(database, {
      createdAt: 30,
      fileId: ORPHAN_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/orphan.txt", "d".repeat(64)),
      sessionId: ORPHAN_SESSION_ID,
    });
    await insertLegacyArtifact(database, {
      createdAt: 30,
      fileId: INVALID_PARENT_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/invalid-parent.txt", "g".repeat(64)),
    });
    await insertLegacyArtifact(database, {
      createdAt: 30,
      fileId: INVALID_PATH_FILE_ID,
      parentPath: `runtime-output/outputs/../invalid-path.txt/${"e".repeat(64)}`,
    });
    await insertLegacyArtifact(database, {
      createdAt: 30,
      fileId: DELETING_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/deleting.txt", "f".repeat(64)),
      status: "deleting",
    });

    applyDrizzleMigration(database, MIGRATION_TAG);

    const heads = await database
      .prepare(
        `SELECT file_id, runtime_event_seq, session_id, source_event_id, source_path, updated_at
         FROM session_artifact_head
         ORDER BY session_id, source_path`,
      )
      .all<ArtifactHeadRow>();

    expect(heads.results).toEqual([
      {
        file_id: WINNER_FILE_ID,
        runtime_event_seq: 0,
        session_id: SESSION_ID,
        source_event_id: `legacy-file:${WINNER_FILE_ID}`,
        source_path: "outputs/report.txt",
        updated_at: 20,
      },
    ]);

    const viewerFiles = await fileStore.listReadySessionFiles(database, SESSION_ID);
    expect(viewerFiles.map(({ id }) => id)).toEqual([WINNER_FILE_ID]);

    const restoreSources = await fileStore.listLatestReadySessionArtifactSources(
      database,
      SESSION_ID,
    );
    expect(restoreSources).toEqual([
      {
        objectKey: `objects/${WINNER_FILE_ID}`,
        size: 32,
        sourcePath: "outputs/report.txt",
      },
    ]);

    // Once the migration creates the head ledger, later headless writes from
    // an old Worker are not durable artifact authority.
    await insertLegacyArtifact(database, {
      createdAt: 40,
      fileId: LATE_REPORT_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/report.txt", "1".repeat(64)),
    });
    await insertLegacyArtifact(database, {
      createdAt: 35,
      fileId: LATE_PATH_NEWER_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/late.txt", "3".repeat(64)),
    });

    expect(
      (await fileStore.listReadySessionFiles(database, SESSION_ID)).map(({ id }) => id),
    ).toEqual([WINNER_FILE_ID]);
    expect(await fileStore.listLatestReadySessionArtifactSources(database, SESSION_ID)).toEqual([
      {
        objectKey: `objects/${WINNER_FILE_ID}`,
        size: 32,
        sourcePath: "outputs/report.txt",
      },
    ]);
  });

  test("keeps v3 and invalid legacy heads authoritative over late legacy rows", async () => {
    const database = await createPre0016Database();
    await insertSession(database);
    applyDrizzleMigration(database, MIGRATION_TAG);

    await insertLegacyArtifact(database, {
      createdAt: 10,
      fileId: V3_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/v3.txt", "6".repeat(64)),
    });
    await database
      .prepare("UPDATE file_record SET runtime_event_seq = 2 WHERE id = ?")
      .bind(V3_FILE_ID)
      .run();
    await database
      .prepare(
        `INSERT INTO session_artifact_head (
           file_id, runtime_event_seq, session_id, source_event_id, source_path, updated_at
         ) VALUES (?, 2, ?, 'v3:upsert', 'outputs/v3.txt', 10)`,
      )
      .bind(V3_FILE_ID, SESSION_ID)
      .run();
    await insertLegacyArtifact(database, {
      createdAt: 20,
      fileId: V3_LATE_LEGACY_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/v3.txt", "7".repeat(64)),
    });

    await database
      .prepare(
        `INSERT INTO session_artifact_head (
           file_id, runtime_event_seq, session_id, source_event_id, source_path, updated_at
         ) VALUES (?, 0, ?, ?, 'outputs/missing.txt', 10)`,
      )
      .bind(MISSING_HEAD_FILE_ID, SESSION_ID, `legacy-file:${MISSING_HEAD_FILE_ID}`)
      .run();
    await insertLegacyArtifact(database, {
      createdAt: 20,
      fileId: MISSING_HEAD_LATE_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/missing.txt", "8".repeat(64)),
    });

    await insertLegacyArtifact(database, {
      createdAt: 30,
      fileId: SAME_TIME_LOSER_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/tie.txt", "9".repeat(64)),
    });
    await insertLegacyArtifact(database, {
      createdAt: 30,
      fileId: SAME_TIME_WINNER_FILE_ID,
      parentPath: legacyRuntimeOutputParentPath("outputs/tie.txt", "a".repeat(64)),
    });

    const viewerFileIds = (await fileStore.listReadySessionFiles(database, SESSION_ID)).map(
      ({ id }) => id,
    );
    expect(viewerFileIds).toContain(V3_FILE_ID);
    expect(viewerFileIds).not.toContain(V3_LATE_LEGACY_FILE_ID);
    expect(viewerFileIds).not.toContain(MISSING_HEAD_LATE_FILE_ID);
    expect(viewerFileIds).not.toContain(SAME_TIME_WINNER_FILE_ID);
    expect(viewerFileIds).not.toContain(SAME_TIME_LOSER_FILE_ID);

    expect(await fileStore.listLatestReadySessionArtifactSources(database, SESSION_ID)).toEqual([
      {
        objectKey: `objects/${V3_FILE_ID}`,
        size: 1,
        sourcePath: "outputs/v3.txt",
      },
    ]);
  });
});
