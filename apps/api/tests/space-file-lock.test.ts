import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId, SpaceId, UploadId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { deleteFileById } from "../src/modules/files/infrastructure/file-content-service";
import { completeFileUpload } from "../src/modules/files/infrastructure/file-upload-complete";
import { createFileUpload } from "../src/modules/files/infrastructure/file-upload-create";
import {
  acquireSpaceFileLock,
  cleanupExpiredSpaceFileLocks,
} from "../src/modules/files/infrastructure/space-file-lock";
import { updateSpaceFile } from "../src/modules/files/infrastructure/space-file-update";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "owner ID");
const OTHER_ID = parsePlatformId<AccountId>("01J00000000000000000000002", "other ID");
const SPACE_ID = parsePlatformId<SpaceId>("01J00000000000000000000003", "space ID");
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000004", "file ID");
const PENDING_FILE_ID = parsePlatformId<FileId>("01J00000000000000000000005", "pending file ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);
const OVERWRITE_UPLOAD_ID = parsePlatformId<UploadId>(
  "01J00000000000000000000007",
  "overwrite upload ID",
);
const REPORT_PATH = "report.txt";

const OWNER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ID,
  imageUrl: null,
  name: "Owner",
};
const OTHER: AuthenticatedViewer = {
  email: "other@example.com",
  emailVerified: true,
  id: OTHER_ID,
  imageUrl: null,
  name: "Other editor",
};

interface StoredObject {
  body: string;
  contentType: string;
  etag: string;
  key: string;
}

class MemoryFileBucket {
  readonly objects = new Map<string, StoredObject>();
  #nextEtag = 1;

  putJson(key: string, value: unknown): void {
    this.objects.set(key, {
      body: JSON.stringify(value),
      contentType: "application/json",
      etag: this.#createEtag(),
      key,
    });
  }

  putText(key: string, body: string): void {
    this.objects.set(key, {
      body,
      contentType: "text/plain",
      etag: this.#createEtag(),
      key,
    });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.#toObjectBody(stored);
  }

  async head(key: string): Promise<R2Object | null> {
    const stored = this.objects.get(key);
    return stored === undefined ? null : this.#toObject(stored);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? "";
    const objects = [...this.objects.values()]
      .filter((object) => object.key.startsWith(prefix))
      .map((object) => this.#toObject(object));

    return {
      delimitedPrefixes: [],
      objects,
      truncated: false,
    } as unknown as R2Objects;
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const existing = this.objects.get(key);
    const ifNoneMatch = this.#readOnlyIfHeader(options?.onlyIf, "If-None-Match");
    const ifMatch = this.#readOnlyIfHeader(options?.onlyIf, "If-Match");

    if (ifNoneMatch === "*" && existing !== undefined) {
      return null;
    }

    if (ifMatch !== null && existing?.etag !== ifMatch.replaceAll('"', "")) {
      return null;
    }

    const stored: StoredObject = {
      body: this.#stringifyBody(body),
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
      etag: this.#createEtag(),
      key,
    };

    this.objects.set(key, stored);
    return this.#toObject(stored);
  }

  #createEtag(): string {
    const etag = `etag-${this.#nextEtag}`;
    this.#nextEtag += 1;
    return etag;
  }

  #readOnlyIfHeader(onlyIf: R2PutOptions["onlyIf"] | undefined, name: string): string | null {
    return onlyIf instanceof Headers ? onlyIf.get(name) : null;
  }

  #stringifyBody(
    body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob | null,
  ): string {
    return typeof body === "string" ? body : "";
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

function createSpaceFileDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE space (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      visibility text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE resource_acl (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      role text NOT NULL,
      assigned_by_account_id text,
      created_at integer NOT NULL,
      PRIMARY KEY (resource_type, resource_id, target_kind, target_id)
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

    CREATE TABLE session (
      attributed_user_id text,
      creator_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      provider text NOT NULL,
      title text
    );

    INSERT INTO space (
      id,
      name,
      organization_id,
      owner_account_id,
      visibility,
      created_at,
      updated_at
    )
    VALUES ('${SPACE_ID}', 'Docs', '${ORGANIZATION_ID}', '${OWNER_ID}', 'shared', 1, 1);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    )
    VALUES
      ('${ORGANIZATION_ID}', '${OWNER_ID}', 'owner', NULL),
      ('${ORGANIZATION_ID}', '${OTHER_ID}', 'member', NULL);

    INSERT INTO resource_acl (
      resource_type,
      resource_id,
      target_kind,
      target_id,
      role,
      assigned_by_account_id,
      created_at
    )
    VALUES
      ('space', '${SPACE_ID}', 'user', '${OWNER_ID}', 'admin', '${OWNER_ID}', 1),
      ('space', '${SPACE_ID}', 'user', '${OTHER_ID}', 'edit', '${OWNER_ID}', 2);

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
      'space',
      '${SPACE_ID}',
      NULL,
      'ready',
      1,
      1,
      '${OWNER_ID}',
      'ready-etag',
      NULL,
      'text/plain',
      'report.txt',
      'space/${SPACE_ID}/report.txt',
      '${SPACE_ID}',
      'space',
      '',
      '${REPORT_PATH}',
      'space_file',
      42,
      1,
      1
    );
  `);

  return database;
}

function insertPendingOverwriteUpload(database: SqliteD1Database): void {
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
      '${PENDING_FILE_ID}',
      'space',
      '${SPACE_ID}',
      NULL,
      'pending',
      0,
      2,
      '${OWNER_ID}',
      NULL,
      9999999999999,
      'text/plain',
      'report.txt',
      'staging/space/${SPACE_ID}/${PENDING_FILE_ID}',
      '${SPACE_ID}',
      'space',
      '',
      '${REPORT_PATH}',
      'space_file',
      42,
      2,
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
      'text/plain',
      2,
      '${OWNER_ID}',
      42,
      9999999999999,
      '${PENDING_FILE_ID}',
      '${OVERWRITE_UPLOAD_ID}',
      NULL,
      NULL,
      1,
      NULL,
      '${SPACE_ID}',
      'space',
      'uploading',
      'single_put',
      2
    );
  `);
}

function createBindings(
  bucket: MemoryFileBucket,
  database: D1Database = createSpaceFileDatabase(),
): ApiBindings {
  return {
    DB: database,
    FILE_BUCKET: bucket as unknown as R2Bucket,
  } as ApiBindings;
}

async function acquireOtherLock(bucket: MemoryFileBucket, path: string): Promise<void> {
  await expect(
    acquireSpaceFileLock(createBindings(bucket), OTHER, SPACE_ID, {
      path,
      ttlSeconds: 30,
    }),
  ).resolves.toMatchObject({ ok: true });
}

async function putExpiredLock(bucket: MemoryFileBucket, path: string): Promise<void> {
  await acquireOtherLock(bucket, path);

  for (const object of bucket.objects.values()) {
    const payload = JSON.parse(object.body) as { expires_at?: number; path?: string };

    if (payload.path === path) {
      bucket.putJson(object.key, {
        ...payload,
        expires_at: Date.now() - 1,
      });
      return;
    }
  }

  throw new Error("Expected lock fixture was not stored.");
}

describe("space file locks", () => {
  test("rejects locked file update, delete, and upload overwrite paths", async () => {
    const bucket = new MemoryFileBucket();
    await acquireOtherLock(bucket, REPORT_PATH);

    await expect(
      updateSpaceFile(createBindings(bucket), OWNER, FILE_ID, {
        ifMatchVersion: 1,
        path: "renamed.txt",
      }),
    ).rejects.toMatchObject({
      code: "file_conflict",
      status: 409,
    });

    await expect(deleteFileById(createBindings(bucket), OWNER, FILE_ID)).rejects.toMatchObject({
      code: "file_conflict",
      status: 409,
    });

    await expect(
      createFileUpload(createBindings(bucket), OWNER, {
        file: {
          contentType: "text/plain",
          name: "replacement.txt",
          size: 42,
        },
        overwrite: true,
        purpose: "space_file",
        target: {
          id: SPACE_ID,
          kind: "space",
          path: REPORT_PATH,
        },
      }),
    ).rejects.toMatchObject({
      code: "file_conflict",
      status: 409,
    });
  });

  test("rejects locked upload completion before storage finalization", async () => {
    const bucket = new MemoryFileBucket();
    const database = createSpaceFileDatabase();
    await acquireOtherLock(bucket, REPORT_PATH);
    insertPendingOverwriteUpload(database);

    await expect(
      completeFileUpload({
        bindings: createBindings(bucket, database),
        fileId: PENDING_FILE_ID,
        input: {},
        viewer: OWNER,
      }),
    ).rejects.toMatchObject({
      code: "file_conflict",
      status: 409,
    });
  });

  test("expired locks release upload overwrite paths", async () => {
    const bucket = new MemoryFileBucket();
    await putExpiredLock(bucket, REPORT_PATH);

    const upload = await createFileUpload(createBindings(bucket), OWNER, {
      file: {
        contentType: "text/plain",
        name: "replacement.txt",
        size: 42,
      },
      overwrite: true,
      purpose: "space_file",
      target: {
        id: SPACE_ID,
        kind: "space",
        path: REPORT_PATH,
      },
    });

    expect(upload.path).toBe(REPORT_PATH);
  });

  test("stores lock records separately from real lock-suffixed files", async () => {
    const bucket = new MemoryFileBucket();
    bucket.putText(`space/${SPACE_ID}/notes.lock`, "user data");

    const result = await acquireSpaceFileLock(createBindings(bucket), OWNER, SPACE_ID, {
      path: "notes.lock",
      ttlSeconds: 30,
    });

    expect(result.ok).toBe(true);
    expect([...bucket.objects.values()].some((object) => object.body === "user data")).toBe(true);
  });

  test("cleans expired internal locks without depending on a user file suffix", async () => {
    const bucket = new MemoryFileBucket();
    await putExpiredLock(bucket, REPORT_PATH);
    await acquireOtherLock(bucket, "active.txt");
    bucket.putText(`space/${SPACE_ID}/user-owned.lock`, "user data");

    await cleanupExpiredSpaceFileLocks(createBindings(bucket));

    await expect(
      acquireSpaceFileLock(createBindings(bucket), OWNER, SPACE_ID, {
        path: REPORT_PATH,
        ttlSeconds: 30,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      acquireSpaceFileLock(createBindings(bucket), OWNER, SPACE_ID, {
        path: "active.txt",
        ttlSeconds: 30,
      }),
    ).resolves.toMatchObject({ holder: { id: OTHER_ID }, ok: false });
    expect([...bucket.objects.values()].some((object) => object.body === "user data")).toBe(true);
  });
});
