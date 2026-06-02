import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  createSessionResourceUpload,
  listSessionResourcesForSession,
} from "../src/modules/files/application/session-resource-file.service";
import { deleteFileById } from "../src/modules/files/infrastructure/file-content-service";
import {
  appendSessionResourceContextToPrompt,
  listSessionResourcePathEntries,
} from "../src/modules/runtime/application/session-resources/session-resource-prompt.service";
import { removeSessionResource } from "../src/modules/sessions/application/session-resource-removal.service";
import {
  addSessionResource,
  listSessionResources,
} from "../src/modules/sessions/application/session-resource.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "owner ID");
const MEMBER_ID = parsePlatformId<AccountId>("01J00000000000000000000004", "member ID");
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000002", "file ID");
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000003", "session ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ID,
  imageUrl: null,
  name: "Owner",
};

const MEMBER_VIEWER: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: MEMBER_ID,
  imageUrl: null,
  name: "Member",
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
      organization_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE file_record (
      id text PRIMARY KEY NOT NULL,
      scope_kind text NOT NULL,
      scope_id text NOT NULL,
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
      organization_id,
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
      '${ORGANIZATION_ID}',
      'openai',
      'openai-runtime',
      'IDLE',
      'Session'
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES (
      '${ORGANIZATION_ID}',
      '${OWNER_ID}',
      'owner',
      NULL
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

function makeMemberParticipant(database: SqliteD1Database): void {
  database.execute(`
    UPDATE session
       SET attributed_user_id = '${MEMBER_ID}'
     WHERE id = '${SESSION_ID}';

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES (
      '${ORGANIZATION_ID}',
      '${MEMBER_ID}',
      'member',
      NULL
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

    const upload = await createSessionResourceUpload({ DB: database } as ApiBindings, VIEWER, {
      file: {
        contentType: "text/plain",
        name: "notes.txt",
        size: 12,
      },
      sessionId: SESSION_ID,
    });

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

    const resources = await listSessionResourcesForSession(database, SESSION_ID);

    expect(resources).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        id: FILE_ID,
        mimeType: "text/plain",
        name: "notes.txt",
        path: `session-files/${FILE_ID}/notes.txt`,
        size: 12,
      },
    ]);
  });

  test("lists prompt path entries with stable resource ids", async () => {
    const database = createSessionResourceDatabase();

    const resources = await listSessionResourcePathEntries(database, SESSION_ID);

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

    const resources = await listSessionResources(database, VIEWER, SESSION_ID);

    expect(resources).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        id: FILE_ID,
        mimeType: "text/plain",
        name: "notes.txt",
        path: `session-files/${FILE_ID}/notes.txt`,
        size: 12,
      },
    ]);
  });

  test("lists empty accessible sessions", async () => {
    const database = createSessionResourceDatabase({ includeFile: false });

    const resources = await listSessionResources(database, VIEWER, SESSION_ID);

    expect(resources).toEqual([]);
  });

  test("marks session resources deleting before R2 delete failure can leave a ready row", async () => {
    const database = createSessionResourceDatabase();
    const bucket = new RecordingDeleteBucket(true);

    await expect(
      deleteFileById(createFileBindings(database, bucket), VIEWER, FILE_ID),
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

    await deleteFileById(createFileBindings(database, bucket), VIEWER, FILE_ID);

    const row = await database
      .prepare("SELECT id FROM file_record WHERE id = ?")
      .bind(FILE_ID)
      .first();

    expect(bucket.deletedKeys).toEqual([`objects/${FILE_ID}`]);
    expect(row).toBeNull();
  });

  test("rejects participant resource mutations when the viewer is not the session creator", async () => {
    const database = createSessionResourceDatabase();
    makeMemberParticipant(database);
    const bindings = { DB: database } as ApiBindings;

    await expect(
      addSessionResource(bindings, MEMBER_VIEWER, {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 12,
        },
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow();

    await expect(
      removeSessionResource(bindings, MEMBER_VIEWER, {
        resourceId: FILE_ID,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow();
  });
});
