import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId, AppId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { fileStore } from "../src/modules/files/application/file-store";
import { appendSessionResourceContextToPrompt } from "../src/modules/runtime/application/session-resources/session-resource-prompt.service";
import { removeSessionResource } from "../src/modules/sessions/application/session-resource-removal.service";
import {
  addSessionResource,
  listSessionResources,
} from "../src/modules/sessions/application/session-resource.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "owner ID");
const OTHER_CREATOR_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000004",
  "other creator ID",
);
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000002", "file ID");
const ARTIFACT_FILE_ID = parsePlatformId<FileId>("01J00000000000000000000007", "artifact file ID");
const LIBRARY_FILE_ID = parsePlatformId<FileId>("01J00000000000000000000008", "library file ID");
const OTHER_SESSION_ID = parsePlatformId<SessionId>(
  "01J00000000000000000000009",
  "other session ID",
);
const OTHER_SESSION_FILE_ID = parsePlatformId<FileId>(
  "01J0000000000000000000000A",
  "other session file ID",
);
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000003", "session ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);
const APP_ID = parsePlatformId<AppId>("01J0000000000000000000000Q", "app ID");

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ID,
  imageUrl: null,
  name: "Owner",
};

function createSessionResourceDatabase(input: { includeFile?: boolean } = {}): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });
  const includeFile = input.includeFile ?? true;

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      creator_account_id text NOT NULL,
      attributed_user_id text,
      archived_at integer,
      metadata_json text DEFAULT '{}' NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE file_record (
      id text PRIMARY KEY NOT NULL,
      scope_kind text NOT NULL,
      scope_id text,
      session_kind text,
      status text NOT NULL,
      committed integer NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      etag text,
      expires_at integer,
      mime_type text,
      name text NOT NULL,
      object_key text NOT NULL,
      owner_id text NOT NULL,
      owner_kind text NOT NULL,
      parent_path text NOT NULL,
      path text NOT NULL,
      purpose text NOT NULL,
      size integer NOT NULL,
      updated_at integer NOT NULL,
      version integer NOT NULL
    );

    CREATE TABLE file_upload (
      content_type text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      expected_size integer NOT NULL,
      expires_at integer NOT NULL,
      file_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      if_match_etag text,
      multipart_upload_id text,
      overwrite integer NOT NULL,
      part_size integer,
      scope_id text NOT NULL,
      scope_kind text NOT NULL,
      status text NOT NULL,
      strategy text NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO session (
      id,
      creator_account_id,
      attributed_user_id,
      archived_at,
      metadata_json,
      app_id,
      provider,
      runtime_id,
      status,
      title
    )
    VALUES (
      '${SESSION_ID}',
      '${OWNER_ID}',
      NULL,
      NULL,
      '{}',
      '${APP_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Session'
    );

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    ) VALUES (
      '${APP_ID}',
      '${ORGANIZATION_ID}',
      '${OWNER_ID}',
      'Default App',
      NULL,
      1,
      1
    );
  `);

  if (includeFile) {
    database.execute(`
    INSERT INTO file_record (
      id,
      scope_kind,
      scope_id,
      session_kind,
      status,
      committed,
      created_at,
      created_by_account_id,
      etag,
      expires_at,
      mime_type,
      name,
      object_key,
      owner_id,
      owner_kind,
      parent_path,
      path,
      purpose,
      size,
      updated_at,
      version
    )
    VALUES (
      '${FILE_ID}',
      'session',
      '${SESSION_ID}',
      'attachment',
      'ready',
      1,
      1,
      '${OWNER_ID}',
      NULL,
      NULL,
      'text/plain',
      'notes.txt',
      'objects/${FILE_ID}',
      '${SESSION_ID}',
      'session',
      'attachment/${FILE_ID}',
      'attachment/${FILE_ID}/notes.txt',
      'session_attachment',
      12,
      1,
      1
    );
  `);
  }

  return database;
}

function makeOwnerAttributedParticipant(database: SqliteD1Database): void {
  database.execute(`
    UPDATE session
       SET creator_account_id = '${OTHER_CREATOR_ID}',
           attributed_user_id = '${OWNER_ID}'
     WHERE id = '${SESSION_ID}';
  `);
}

function insertSessionArtifact(database: SqliteD1Database): void {
  database.execute(`
    INSERT INTO file_record (
      id,
      scope_kind,
      scope_id,
      session_kind,
      status,
      committed,
      created_at,
      created_by_account_id,
      etag,
      expires_at,
      mime_type,
      name,
      object_key,
      owner_id,
      owner_kind,
      parent_path,
      path,
      purpose,
      size,
      updated_at,
      version
    )
    VALUES (
      '${ARTIFACT_FILE_ID}',
      'session',
      '${SESSION_ID}',
      'artifact',
      'ready',
      1,
      2,
      '${OWNER_ID}',
      NULL,
      NULL,
      'text/markdown',
      'summary.md',
      'objects/${ARTIFACT_FILE_ID}',
      '${SESSION_ID}',
      'session',
      'artifact/${ARTIFACT_FILE_ID}',
      'artifact/${ARTIFACT_FILE_ID}/summary.md',
      'session_artifact',
      23,
      2,
      1
    );
  `);
}

function insertLibraryFile(database: SqliteD1Database): void {
  database.execute(`
    INSERT INTO file_record (
      id,
      scope_kind,
      scope_id,
      session_kind,
      status,
      committed,
      created_at,
      created_by_account_id,
      etag,
      expires_at,
      mime_type,
      name,
      object_key,
      owner_id,
      owner_kind,
      parent_path,
      path,
      purpose,
      size,
      updated_at,
      version
    )
    VALUES (
	      '${LIBRARY_FILE_ID}',
	      'library',
	      '${APP_ID}',
	      NULL,
      'ready',
      1,
      3,
      '${OWNER_ID}',
      NULL,
      NULL,
      'text/csv',
	      'seed.csv',
	      'objects/${LIBRARY_FILE_ID}',
	      '${APP_ID}',
	      'app',
      '',
      'seed.csv',
      'library_file',
      34,
      3,
      1
    );
  `);
}

function insertInaccessibleSessionFile(database: SqliteD1Database): void {
  database.execute(`
    INSERT INTO session (
      id,
      creator_account_id,
      attributed_user_id,
      archived_at,
      metadata_json,
      app_id,
      provider,
      runtime_id,
      status,
      title
    )
    VALUES (
      '${OTHER_SESSION_ID}',
      '${OTHER_CREATOR_ID}',
      NULL,
      NULL,
      '{}',
      '${APP_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Other Session'
    );

    INSERT INTO file_record (
      id,
      scope_kind,
      scope_id,
      session_kind,
      status,
      committed,
      created_at,
      created_by_account_id,
      etag,
      expires_at,
      mime_type,
      name,
      object_key,
      owner_id,
      owner_kind,
      parent_path,
      path,
      purpose,
      size,
      updated_at,
      version
    )
    VALUES (
      '${OTHER_SESSION_FILE_ID}',
      'session',
      '${OTHER_SESSION_ID}',
      'attachment',
      'ready',
      1,
      4,
      '${OTHER_CREATOR_ID}',
      NULL,
      NULL,
      'text/plain',
      'private.txt',
      'objects/${OTHER_SESSION_FILE_ID}',
      '${OTHER_SESSION_ID}',
      'session',
      'attachment/${OTHER_SESSION_FILE_ID}',
      'attachment/${OTHER_SESSION_FILE_ID}/private.txt',
      'session_attachment',
      45,
      4,
      1
    );
  `);
}

class RecordingDeleteBucket {
  readonly deletedKeys: string[] = [];

  constructor(private readonly failAfterDelete: boolean = false) {}

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key);

    if (this.failAfterDelete) {
      throw new Error("delete interrupted");
    }
  }
}

function createFileBindings(database: D1Database, bucket: RecordingDeleteBucket): ApiBindings {
  return {
    DB: database,
    FILE_BUCKET: bucket as unknown as R2Bucket,
  } as ApiBindings;
}

describe("session resource files", () => {
  test("creates upload mentions with the mounted session-file path grammar", async () => {
    const database = createSessionResourceDatabase({ includeFile: false });

    const upload = await fileStore.createSessionResourceUpload(
      { DB: database } as ApiBindings,
      VIEWER,
      {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 12,
        },
        appId: APP_ID,
        sessionId: SESSION_ID,
      },
    );

    expect(upload.path).toBe(`session-files/${upload.fileId}/notes.txt`);

    const row = await database
      .prepare("SELECT parent_path, path FROM file_record WHERE id = ?")
      .bind(upload.fileId)
      .first<{ parent_path: string; path: string }>();

    expect(row).toEqual({
      parent_path: `attachment/${upload.fileId}`,
      path: `attachment/${upload.fileId}/notes.txt`,
    });
  });

  test("lists file records after session admission", async () => {
    const database = createSessionResourceDatabase();

    const resources = await fileStore.listSessionResources(database, SESSION_ID);

    expect(resources).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        id: FILE_ID,
        kind: "attachment",
        mimeType: "text/plain",
        name: "notes.txt",
        path: `session-files/${FILE_ID}/notes.txt`,
        size: 12,
      },
    ]);
  });

  test("lists prompt path entries with stable resource ids", async () => {
    const database = createSessionResourceDatabase();

    const resources = await fileStore.listSessionResourcePathEntries(database, SESSION_ID);

    expect(resources).toEqual([
      {
        id: FILE_ID,
        name: "notes.txt",
        path: `session-files/${FILE_ID}/notes.txt`,
        size: 12,
      },
    ]);
  });

  test("appends a runtime-neutral session file context to the prompt", () => {
    const originalPrompt = "Summarize the latest upload.";
    const prompt = appendSessionResourceContextToPrompt(originalPrompt, [
      {
        id: FILE_ID,
        name: "agent.md",
        path: `session-files/${FILE_ID}/agent.md`,
        size: 42,
      },
    ]);

    expect(prompt).toContain(originalPrompt);
    expect(prompt.length).toBeGreaterThan(originalPrompt.length);
  });

  test("leaves prompts unchanged when the session has no files", () => {
    expect(appendSessionResourceContextToPrompt("No files here.", [])).toBe("No files here.");
  });

  test("lists resources through the session service without delete-side dependencies", async () => {
    const database = createSessionResourceDatabase();

    const resources = await listSessionResources(database, VIEWER, {
      appId: APP_ID,
      sessionId: SESSION_ID,
    });

    expect(resources).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        id: FILE_ID,
        kind: "attachment",
        mimeType: "text/plain",
        name: "notes.txt",
        path: `session-files/${FILE_ID}/notes.txt`,
        size: 12,
      },
    ]);
  });

  test("lists empty accessible sessions", async () => {
    const database = createSessionResourceDatabase({ includeFile: false });

    const resources = await listSessionResources(database, VIEWER, {
      appId: APP_ID,
      sessionId: SESSION_ID,
    });

    expect(resources).toEqual([]);
  });

  test("lists visible Thread files and filters by session", async () => {
    const database = createSessionResourceDatabase();
    insertSessionArtifact(database);
    insertLibraryFile(database);
    insertInaccessibleSessionFile(database);
    const bindings = { DB: database } as ApiBindings;

    const allFiles = await fileStore.list(bindings, VIEWER, { appId: APP_ID });
    const allFileIds = allFiles.files.map((file) => file.id).toSorted();

    expect(allFileIds).toEqual([ARTIFACT_FILE_ID, FILE_ID, LIBRARY_FILE_ID].toSorted());

    const sessionFiles = await fileStore.list(bindings, VIEWER, {
      appId: APP_ID,
      sessionId: SESSION_ID,
    });

    expect(sessionFiles.files.map((file) => file.id).toSorted()).toEqual(
      [ARTIFACT_FILE_ID, FILE_ID].toSorted(),
    );

    const artifacts = await fileStore.list(bindings, VIEWER, {
      appId: APP_ID,
      sessionKind: "artifact",
    });

    expect(artifacts.files.map((file) => file.id)).toEqual([ARTIFACT_FILE_ID]);
  });

  test("records runtime outputs as session-scoped artifacts", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const bucket = new PublicApiMemoryFileBucket();
    const ownerViewer: AuthenticatedViewer = {
      email: "owner@example.com",
      emailVerified: true,
      id: PUBLIC_API_TEST_IDS.ownerAccount,
      imageUrl: null,
      name: "Owner",
    };
    const file = await fileStore.recordRuntimeOutput({
      bindings: createPublicHttpTestBindings(database, {
        fileBucket: bucket as unknown as R2Bucket,
      }) as ApiBindings,
      body: new TextEncoder().encode("runtime summary"),
      contentType: "text/markdown",
      createdBy: PUBLIC_API_TEST_IDS.ownerAccount,
      path: "summary.md",
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    expect(file.owner).toEqual({
      id: PUBLIC_API_TEST_IDS.ownerSession,
      kind: "session",
    });
    expect(file.purpose).toBe("session_artifact");
    expect(file.scope).toEqual({
      id: PUBLIC_API_TEST_IDS.ownerSession,
      kind: "session",
    });
    expect(file.sessionKind).toBe("artifact");

    const resources = await listSessionResources(database, ownerViewer, {
      appId: PUBLIC_API_TEST_IDS.app,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    expect(resources).toEqual([
      expect.objectContaining({
        id: file.id,
        kind: "artifact",
        name: "summary.md",
        path: `session-artifacts/${file.id}/summary.md`,
      }),
    ]);
  });

  test("lists session artifacts but does not treat them as removable attachments", async () => {
    const database = createSessionResourceDatabase();
    insertSessionArtifact(database);
    const bucket = new RecordingDeleteBucket();
    const bindings = createFileBindings(database, bucket);

    const resources = await listSessionResources(database, VIEWER, {
      appId: APP_ID,
      sessionId: SESSION_ID,
    });

    expect(resources).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.002Z",
        id: ARTIFACT_FILE_ID,
        kind: "artifact",
        mimeType: "text/markdown",
        name: "summary.md",
        path: `session-artifacts/${ARTIFACT_FILE_ID}/summary.md`,
        size: 23,
      },
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        id: FILE_ID,
        kind: "attachment",
        mimeType: "text/plain",
        name: "notes.txt",
        path: `session-files/${FILE_ID}/notes.txt`,
        size: 12,
      },
    ]);

    await expect(
      removeSessionResource(bindings, VIEWER, {
        appId: APP_ID,
        resourceId: ARTIFACT_FILE_ID,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow("Session resource not found.");

    expect(bucket.deletedKeys).toEqual([]);
  });

  test("marks session resources deleting before R2 delete failure can leave a ready row", async () => {
    const database = createSessionResourceDatabase();
    const bucket = new RecordingDeleteBucket(true);

    await expect(
      fileStore.delete(createFileBindings(database, bucket), VIEWER, FILE_ID),
    ).rejects.toThrow();

    const row = await database
      .prepare("SELECT status FROM file_record WHERE id = ?")
      .bind(FILE_ID)
      .first<{ status: string }>();

    expect(bucket.deletedKeys).toEqual([`objects/${FILE_ID}`]);
    expect(row?.status).toBe("deleting");
  });

  test("resumes deleting session resource rows as idempotent cleanup", async () => {
    const database = createSessionResourceDatabase();
    const bucket = new RecordingDeleteBucket();

    database.execute(`UPDATE file_record SET status = 'deleting' WHERE id = '${FILE_ID}'`);

    await fileStore.delete(createFileBindings(database, bucket), VIEWER, FILE_ID);

    const row = await database
      .prepare("SELECT id FROM file_record WHERE id = ?")
      .bind(FILE_ID)
      .first();

    expect(bucket.deletedKeys).toEqual([`objects/${FILE_ID}`]);
    expect(row).toBeNull();
  });

  test("rejects participant resource mutations when the viewer is not the session creator", async () => {
    const database = createSessionResourceDatabase();
    makeOwnerAttributedParticipant(database);
    const bindings = { DB: database } as ApiBindings;

    await expect(
      addSessionResource(bindings, VIEWER, {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 12,
        },
        appId: APP_ID,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow();

    await expect(
      removeSessionResource(bindings, VIEWER, {
        appId: APP_ID,
        resourceId: FILE_ID,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow();
  });
});
