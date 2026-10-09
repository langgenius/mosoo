import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, ProjectId, UploadId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { FileUploadContext } from "../src/modules/files/infrastructure/file-record-model";
import { completeFileUpload } from "../src/modules/files/infrastructure/file-upload-complete";
import { completeStagingUpload } from "../src/modules/files/infrastructure/file-upload-completion-steps";
import { createFileUpload } from "../src/modules/files/infrastructure/file-upload-create";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "owner ID");
const STALE_FILE_ID = parsePlatformId<FileId>("01J00000000000000000000003", "stale file ID");
const STALE_UPLOAD_ID = parsePlatformId<UploadId>("01J00000000000000000000004", "stale upload ID");
const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000006", "project ID");
const STALE_OBJECT_KEY = `staging/app_draft/${PROJECT_ID}/${STALE_FILE_ID}`;
const STALE_FILE_PATH = `attachment/${STALE_FILE_ID}/report.csv`;

const OWNER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ID,
  imageUrl: null,
  name: "Owner",
};

interface StoredObject {
  body: string;
  contentType: string;
  etag: string;
  key: string;
}

class MemoryFileBucket {
  readonly #objects = new Map<string, StoredObject>();

  body(key: string): string | null {
    return this.#objects.get(key)?.body ?? null;
  }

  has(key: string): boolean {
    return this.#objects.has(key);
  }

  putHead(
    key: string,
    input: { body?: string; contentLength: number; contentType: string; etag: string },
  ): void {
    this.#objects.set(key, {
      body: input.body ?? "".padEnd(input.contentLength, "x"),
      contentType: input.contentType,
      etag: input.etag,
      key,
    });
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.#objects.get(key);
    return stored === undefined ? null : this.#toObjectBody(stored);
  }

  async head(key: string): Promise<R2Object | null> {
    const stored = this.#objects.get(key);
    return stored === undefined ? null : this.#toObject(stored);
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    const stored: StoredObject = {
      body: typeof body === "string" ? body : "",
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
      etag: `etag-${this.#objects.size + 1}`,
      key,
    };

    this.#objects.set(key, stored);
    return this.#toObject(stored);
  }

  #toObject(stored: StoredObject): R2Object {
    return {
      customMetadata: {},
      etag: stored.etag,
      httpEtag: `"${stored.etag}"`,
      httpMetadata: {
        contentType: stored.contentType,
      },
      key: stored.key,
      size: stored.body.length,
      uploaded: new Date(0),
      version: "",
      writeHttpMetadata(headers: Headers) {
        headers.set("Content-Type", stored.contentType);
      },
    } as R2Object;
  }

  #toObjectBody(stored: StoredObject): R2ObjectBody {
    return {
      ...this.#toObject(stored),
      async arrayBuffer() {
        const bytes = new TextEncoder().encode(stored.body);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async blob() {
        return new Blob([stored.body], { type: stored.contentType });
      },
      body: new ReadableStream<Uint8Array>(),
      bodyUsed: false,
      async json<T>() {
        return JSON.parse(stored.body) as T;
      },
      async text() {
        return stored.body;
      },
    } as R2ObjectBody;
  }
}

function createUploadRecoveryDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
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
      scope_id text,
      scope_kind text NOT NULL,
      status text NOT NULL,
      strategy text NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO project (
      id,
      name,
      organization_id,
      owner_account_id,
      default_environment_id,
      created_at,
      updated_at
    )
    VALUES (
      '${PROJECT_ID}',
      'Default Project',
      '01J0000000000000000000000A',
      '${OWNER_ID}',
      NULL,
      1,
      1
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
      '${STALE_FILE_ID}',
      'app_draft',
      '${PROJECT_ID}',
      'attachment',
      'pending',
      0,
      1,
      '${OWNER_ID}',
      NULL,
      1,
      'text/csv',
      'report.csv',
      '${STALE_OBJECT_KEY}',
      '${PROJECT_ID}',
      'app',
      'attachment/${STALE_FILE_ID}',
      '${STALE_FILE_PATH}',
      'app_draft',
      42,
      1,
      1
    );

    INSERT INTO file_upload (
      content_type,
      created_at,
      created_by_account_id,
      expected_size,
      expires_at,
      file_id,
      id,
      if_match_etag,
      multipart_upload_id,
      overwrite,
      part_size,
      scope_id,
      scope_kind,
      status,
      strategy,
      updated_at
    )
    VALUES (
      'text/csv',
      1,
      '${OWNER_ID}',
      42,
      1,
      '${STALE_FILE_ID}',
      '${STALE_UPLOAD_ID}',
      NULL,
      'multipart-stale',
      0,
      16777216,
      '${PROJECT_ID}',
      'app_draft',
      'completing',
      'multipart',
      1
    );
  `);

  return database;
}

function createBindings(database: D1Database, bucket: MemoryFileBucket): ApiBindings {
  return {
    DB: database,
    FILE_BUCKET: bucket as unknown as R2Bucket,
  } as ApiBindings;
}

describe("file upload recovery", () => {
  test("lets completing multipart retries continue when the staged object already exists", async () => {
    const bucket = new MemoryFileBucket();
    const objectKey = STALE_OBJECT_KEY;
    bucket.putHead(objectKey, {
      contentLength: 42,
      contentType: "text/csv",
      etag: "staged-etag",
    });

    const context = {
      file: {
        committed: 0,
        created_at: 1,
        created_by_account_id: OWNER_ID,
        etag: null,
        expires_at: 1,
        id: STALE_FILE_ID,
        mime_type: "text/csv",
        name: "report.csv",
        object_key: objectKey,
        owner_id: PROJECT_ID,
        owner_kind: "app",
        parent_path: `attachment/${STALE_FILE_ID}`,
        path: STALE_FILE_PATH,
        purpose: "app_draft",
        scope_id: PROJECT_ID,
        scope_kind: "app_draft",
        session_kind: "attachment",
        size: 42,
        status: "pending",
        updated_at: 1,
        version: 1,
      },
      upload: {
        content_type: "text/csv",
        created_by_account_id: OWNER_ID,
        expected_size: 42,
        expires_at: Date.now() + 60_000,
        id: STALE_UPLOAD_ID,
        multipart_upload_id: "multipart-stale",
        part_size: 16777216,
        scope_id: PROJECT_ID,
        scope_kind: "app_draft",
        status: "completing",
        strategy: "multipart",
      },
    } satisfies FileUploadContext;

    await expect(
      completeStagingUpload({
        bindings: createBindings(new SqliteD1Database(), bucket),
        context,
        request: {
          parts: [{ etag: "part-etag", partNumber: 1 }],
        },
      }),
    ).resolves.toBeUndefined();
  });

  test("keeps completed Project draft uploads expiring until they are claimed", async () => {
    const database = createUploadRecoveryDatabase();
    const bucket = new MemoryFileBucket();

    const upload = await createFileUpload(createBindings(database, bucket), OWNER, {
      file: {
        contentType: "text/plain",
        name: "launch-note.txt",
        size: 12,
      },
      purpose: "app_draft",
      target: {
        id: PROJECT_ID,
        kind: "app_draft",
        name: "launch-note.txt",
      },
    });
    const stagingObjectKey = `staging/app_draft/${PROJECT_ID}/${upload.fileId}`;

    bucket.putHead(stagingObjectKey, {
      body: "draft bytes!",
      contentLength: 12,
      contentType: "text/plain",
      etag: "project-draft-etag",
    });

    const result = await completeFileUpload({
      bindings: createBindings(database, bucket),
      input: {},
      fileId: upload.fileId,
      viewer: OWNER,
    });
    const file = await database
      .prepare(
        `SELECT committed, expires_at, object_key, owner_id, owner_kind, purpose, scope_id, scope_kind, status
           FROM file_record
          WHERE id = ?`,
      )
      .bind(upload.fileId)
      .first<{
        committed: number;
        expires_at: number | null;
        object_key: string;
        owner_id: string;
        owner_kind: string;
        purpose: string;
        scope_id: string | null;
        scope_kind: string;
        status: string;
      }>();

    expect(result.scope).toEqual({
      id: PROJECT_ID,
      kind: "app_draft",
    });
    expect(file).toMatchObject({
      committed: 0,
      owner_id: PROJECT_ID,
      owner_kind: "app",
      purpose: "app_draft",
      scope_id: PROJECT_ID,
      scope_kind: "app_draft",
      status: "ready",
    });
    expect(file?.expires_at).toBeNumber();
    expect(file?.object_key).toBe(
      `project-draft/${PROJECT_ID}/attachment/${upload.fileId}/launch-note.txt`,
    );
    expect(bucket.has(stagingObjectKey)).toBe(false);
    expect(bucket.has(file?.object_key ?? "")).toBe(true);
  });

  test("recovers when final object copy succeeded before the file row was finalized", async () => {
    const database = createUploadRecoveryDatabase();
    const bucket = new MemoryFileBucket();
    const stagingObjectKey = STALE_OBJECT_KEY;
    const finalObjectKey = `project-draft/${PROJECT_ID}/attachment/${STALE_FILE_ID}/report.csv`;

    await database
      .prepare("UPDATE file_upload SET expires_at = ? WHERE id = ?")
      .bind(Date.now() + 60_000, STALE_UPLOAD_ID)
      .run();
    bucket.putHead(stagingObjectKey, {
      body: "recovered final object bytes for report",
      contentLength: 39,
      contentType: "text/csv",
      etag: "copied-etag",
    });
    bucket.putHead(finalObjectKey, {
      body: "recovered final object bytes for report",
      contentLength: 39,
      contentType: "text/csv",
      etag: "copied-etag",
    });
    await database
      .prepare("UPDATE file_record SET size = ?, object_key = ? WHERE id = ?")
      .bind(39, stagingObjectKey, STALE_FILE_ID)
      .run();
    await database
      .prepare("UPDATE file_upload SET expected_size = ? WHERE id = ?")
      .bind(39, STALE_UPLOAD_ID)
      .run();

    const result = await completeFileUpload({
      bindings: createBindings(database, bucket),
      input: {
        parts: [{ etag: "part-etag", partNumber: 1 }],
      },
      fileId: STALE_FILE_ID,
      viewer: OWNER,
    });

    const upload = await database
      .prepare("SELECT status FROM file_upload WHERE id = ?")
      .bind(STALE_UPLOAD_ID)
      .first<{ status: string }>();
    const file = await database
      .prepare("SELECT object_key, status FROM file_record WHERE id = ?")
      .bind(STALE_FILE_ID)
      .first<{ object_key: string; status: string }>();

    expect(file?.object_key).not.toBe(stagingObjectKey);
    expect(upload?.status).toBe("completed");
    expect(file).toEqual({
      object_key: finalObjectKey,
      status: "ready",
    });
    expect(bucket.has(stagingObjectKey)).toBe(false);
    expect(bucket.has(finalObjectKey)).toBe(true);
    expect(result.id).toBe(STALE_FILE_ID);
  });
});
