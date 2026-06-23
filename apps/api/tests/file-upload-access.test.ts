import { describe, expect, test } from "bun:test";

import type {
  CreateFileUploadRequest,
  CreateFileUploadResponse,
  FileErrorResponse,
  FileEntryListing,
} from "@mosoo/contracts/file";
import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId, AppId, SessionId, UploadId } from "@mosoo/id";

import { createHttpApp } from "../src/adapters/http/create-http-app";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  ensureFileAccess,
  ensureUploadAccess,
} from "../src/modules/files/infrastructure/file-record-store";
import { createFileUpload } from "../src/modules/files/infrastructure/file-upload-create";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { createApiTestFixture } from "./helpers/api-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "viewer ID");
const OTHER_VIEWER_ID = parsePlatformId<AccountId>("01J00000000000000000000002", "other viewer ID");
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000003", "file ID");
const UPLOAD_ID = parsePlatformId<UploadId>("01J00000000000000000000004", "upload ID");
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000005", "session ID");
const LIBRARY_FILE_ID = parsePlatformId<FileId>("01J00000000000000000000009", "library file ID");
const LEGACY_LIBRARY_FILE_ID = parsePlatformId<FileId>(
  "01J0000000000000000000000B",
  "legacy library file ID",
);
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);
const APP_ID = parsePlatformId<AppId>("01J00000000000000000000007", "app ID");
const OTHER_APP_ID = parsePlatformId<AppId>("01J00000000000000000000008", "other app ID");

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Viewer",
};

function createFileUploadAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      attributed_user_id text,
      creator_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      title text
    );

    CREATE TABLE file_record (
      committed integer NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      etag text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      mime_type text,
      name text NOT NULL,
      object_key text NOT NULL,
      owner_id text NOT NULL,
      owner_kind text NOT NULL,
      parent_path text NOT NULL,
      path text NOT NULL,
      purpose text NOT NULL,
      scope_id text NOT NULL,
      scope_kind text NOT NULL,
      session_kind text,
      size integer NOT NULL,
      status text NOT NULL,
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

    CREATE TABLE app (
      created_at integer NOT NULL,
      default_environment_id text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO app (
      created_at,
      default_environment_id,
      id,
      name,
      organization_id,
      owner_account_id,
      updated_at
    )
    VALUES (
      1,
      NULL,
      '${APP_ID}',
      'Main App',
      '${ORGANIZATION_ID}',
      '${VIEWER_ID}',
      1
    );

    INSERT INTO session (
      attributed_user_id,
      creator_account_id,
      id,
      app_id,
      provider,
      title
    )
    VALUES (
      NULL,
      '${VIEWER_ID}',
      '${SESSION_ID}',
      '${APP_ID}',
      'openai',
      'Session'
    );

    INSERT INTO file_record (
      committed,
      created_at,
      created_by_account_id,
      etag,
      expires_at,
      id,
      mime_type,
      name,
      object_key,
      owner_id,
      owner_kind,
      parent_path,
      path,
      purpose,
      scope_id,
      scope_kind,
      session_kind,
      size,
      status,
      updated_at,
      version
    )
    VALUES (
      0,
      1,
      '${VIEWER_ID}',
      NULL,
      9999999999999,
      '${FILE_ID}',
      'text/plain',
      'notes.txt',
      'objects/staged/${FILE_ID}',
      '${SESSION_ID}',
      'session',
      'attachment/${FILE_ID}',
      'attachment/${FILE_ID}/notes.txt',
      'session_attachment',
      '${SESSION_ID}',
      'session',
      'attachment',
      42,
      'pending',
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
      'text/plain',
      1,
      '${VIEWER_ID}',
      42,
      9999999999999,
      '${FILE_ID}',
      '${UPLOAD_ID}',
      NULL,
      NULL,
      0,
      NULL,
      '${SESSION_ID}',
      'session',
      'pending',
      'single_put',
      1
    );
  `);

  return database;
}

async function insertRawFileRouteSessionFixture(
  database: SqliteD1Database,
  input: {
    agentId: string;
    organizationId: string;
    otherAppId: AppId;
    appId: string;
    sessionId: SessionId;
    viewerId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO app (
        created_at,
        id,
        name,
        organization_id,
        owner_account_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(1, input.otherAppId, "Other App", input.organizationId, input.viewerId, 1)
    .run();

  await database
    .prepare(
      `INSERT INTO session (
        agent_id,
        archived_at,
        attributed_user_id,
        created_at,
        creator_account_id,
        deployment_version_id,
        deployment_version_number,
        id,
        kind,
        last_message_at,
        last_run_id,
        metadata_json,
        model,
        app_id,
        provider,
        renamed,
        runtime_id,
        status,
        status_operation_id,
        title,
        type,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.agentId,
      null,
      null,
      1,
      input.viewerId,
      null,
      null,
      input.sessionId,
      "pet",
      null,
      null,
      "{}",
      "gpt-5.4",
      input.appId,
      "openai",
      0,
      "openai-runtime",
      "IDLE",
      null,
      "Raw file route session",
      "preview",
      1,
    )
    .run();
}

async function countSessionFileRecords(
  database: SqliteD1Database,
  sessionId: SessionId,
): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS count FROM file_record WHERE scope_kind = ? AND scope_id = ?")
    .bind("session", sessionId)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function insertReadyRawFileRecord(
  database: SqliteD1Database,
  input: {
    createdBy: string;
    fileId: FileId;
    name: string;
    ownerId: string;
    ownerKind: "account" | "app" | "session";
    path: string;
    purpose: "library_file" | "session_attachment";
    scopeId: string | null;
    scopeKind: "library" | "session";
    sessionKind: "attachment" | null;
  },
): Promise<void> {
  const parentPath = input.path.includes("/")
    ? input.path.slice(0, input.path.lastIndexOf("/"))
    : "";

  await database
    .prepare(
      `INSERT INTO file_record (
        committed,
        created_at,
        created_by_account_id,
        etag,
        expires_at,
        id,
        mime_type,
        name,
        object_key,
        owner_id,
        owner_kind,
        parent_path,
        path,
        purpose,
        scope_id,
        scope_kind,
        session_kind,
        size,
        status,
        updated_at,
        version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      1,
      input.createdBy,
      "etag-ready",
      null,
      input.fileId,
      "text/plain",
      input.name,
      `objects/${input.fileId}`,
      input.ownerId,
      input.ownerKind,
      parentPath,
      input.path,
      input.purpose,
      input.scopeId,
      input.scopeKind,
      input.sessionKind,
      12,
      "ready",
      1,
      1,
    )
    .run();
}

async function postRawSessionFileUpload(input: {
  bindings: ApiBindings;
  headers: Headers;
  target: Record<string, unknown>;
}): Promise<Response> {
  return createHttpApp().request(
    `${PUBLIC_API_PREFIX}/files`,
    {
      body: JSON.stringify({
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 12,
        },
        purpose: "session_attachment",
        target: input.target,
      }),
      headers: input.headers,
      method: "POST",
    },
    input.bindings,
  );
}

describe("file upload access", () => {
  test("loads upload, file, and session access", async () => {
    const database = createFileUploadAccessDatabase();

    const context = await ensureUploadAccess({
      database,
      fileId: FILE_ID,
      requiredIntent: "write",
      viewer: VIEWER,
    });

    expect(context.file.id).toBe(FILE_ID);
    expect(context.upload.id).toBe(UPLOAD_ID);
  });

  test("denies session-scoped uploads for other viewers", async () => {
    const database = createFileUploadAccessDatabase();

    await expect(
      ensureUploadAccess({
        database,
        fileId: FILE_ID,
        requiredIntent: "write",
        viewer: { ...VIEWER, id: OTHER_VIEWER_ID },
      }),
    ).rejects.toThrow();
  });

  test("creates agent package uploads as app-owned files", async () => {
    const database = createFileUploadAccessDatabase();
    const bindings = { DB: database } as ApiBindings;

    const upload = await createFileUpload(bindings, VIEWER, {
      file: {
        contentType: "application/zip",
        name: "portable.agent",
        size: 42,
      },
      purpose: "agent_package",
      target: {
        id: APP_ID,
        kind: "agent_package",
        name: "portable.agent",
      },
    });

    await expect(
      ensureUploadAccess({
        database,
        fileId: upload.fileId,
        requiredIntent: "write",
        viewer: { ...VIEWER, id: OTHER_VIEWER_ID },
      }),
    ).rejects.toThrow();
  });

  test("creates App draft uploads as app-owned draft files", async () => {
    const database = createFileUploadAccessDatabase();
    const bindings = { DB: database } as ApiBindings;

    const upload = await createFileUpload(bindings, VIEWER, {
      file: {
        contentType: "text/plain",
        name: "launch-note.txt",
        size: 42,
      },
      purpose: "app_draft",
      target: {
        id: APP_ID,
        kind: "app_draft",
        name: "launch-note.txt",
      },
    });

    expect(upload.path).toBe(`attachment/${upload.fileId}/launch-note.txt`);

    const row = await database
      .prepare(
        `SELECT object_key, owner_id, owner_kind, purpose, scope_id, scope_kind, session_kind
           FROM file_record
          WHERE id = ?`,
      )
      .bind(upload.fileId)
      .first<{
        object_key: string;
        owner_id: string;
        owner_kind: string;
        purpose: string;
        scope_id: string;
        scope_kind: string;
        session_kind: string | null;
      }>();

    expect(row).toEqual({
      object_key: `staging/app_draft/${APP_ID}/${upload.fileId}`,
      owner_id: APP_ID,
      owner_kind: "app",
      purpose: "app_draft",
      scope_id: APP_ID,
      scope_kind: "app_draft",
      session_kind: "attachment",
    });

    await expect(
      ensureUploadAccess({
        database,
        fileId: upload.fileId,
        requiredIntent: "write",
        viewer: { ...VIEWER, id: OTHER_VIEWER_ID },
      }),
    ).rejects.toThrow();
    await expect(
      ensureFileAccess({
        database,
        fileId: upload.fileId,
        requiredIntent: "write",
        viewer: { ...VIEWER, id: OTHER_VIEWER_ID },
      }),
    ).rejects.toThrow();
  });

  test("requires matching App proof for raw session upload targets", async () => {
    const fixture = await createApiTestFixture();
    await fixture.client.loginAsMosooAiTestAccount();
    await insertRawFileRouteSessionFixture(fixture.database, {
      agentId: fixture.ids.agentId,
      organizationId: fixture.ids.organizationId,
      otherAppId: OTHER_APP_ID,
      appId: fixture.ids.appId,
      sessionId: SESSION_ID,
      viewerId: fixture.viewer.id,
    });

    const sessionTarget = {
      id: SESSION_ID,
      kind: "session",
      name: "notes.txt",
      appId: fixture.ids.appId,
    } satisfies CreateFileUploadRequest["target"];

    const missingAppResponse = await postRawSessionFileUpload({
      bindings: fixture.bindings,
      headers: fixture.client.sessionHeaders({ "content-type": "application/json" }),
      target: {
        id: SESSION_ID,
        kind: "session",
        name: "notes.txt",
      },
    });
    const missingAppBody = (await missingAppResponse.json()) as FileErrorResponse;

    expect(missingAppResponse.status).toBe(400);
    expect(missingAppBody.error).toMatchObject({
      code: "file_invalid_request",
      message: "upload session app ID must be a ULID string.",
      status: 400,
    });
    expect(await countSessionFileRecords(fixture.database, SESSION_ID)).toBe(0);

    const mismatchedAppResponse = await postRawSessionFileUpload({
      bindings: fixture.bindings,
      headers: fixture.client.sessionHeaders({ "content-type": "application/json" }),
      target: {
        ...sessionTarget,
        appId: OTHER_APP_ID,
      },
    });
    const mismatchedAppBody = (await mismatchedAppResponse.json()) as FileErrorResponse;

    expect(mismatchedAppResponse.status).toBe(404);
    expect(mismatchedAppBody.error).toMatchObject({
      code: "file_not_found",
      message: "Session not found.",
      status: 404,
    });
    expect(await countSessionFileRecords(fixture.database, SESSION_ID)).toBe(0);

    const acceptedResponse = await postRawSessionFileUpload({
      bindings: fixture.bindings,
      headers: fixture.client.sessionHeaders({ "content-type": "application/json" }),
      target: sessionTarget,
    });
    const acceptedBody = (await acceptedResponse.json()) as CreateFileUploadResponse;

    expect(acceptedResponse.status).toBe(200);
    expect(acceptedBody.fileId).toBeString();
    expect(acceptedBody.path).toContain(acceptedBody.fileId);
    expect(await countSessionFileRecords(fixture.database, SESSION_ID)).toBe(1);
  });

  test("raw HTTP file list defaults to visible Thread files and filters by session", async () => {
    const fixture = await createApiTestFixture();
    await fixture.client.loginAsMosooAiTestAccount();
    await insertRawFileRouteSessionFixture(fixture.database, {
      agentId: fixture.ids.agentId,
      organizationId: fixture.ids.organizationId,
      otherAppId: OTHER_APP_ID,
      appId: fixture.ids.appId,
      sessionId: SESSION_ID,
      viewerId: fixture.viewer.id,
    });

    await insertReadyRawFileRecord(fixture.database, {
      createdBy: fixture.viewer.id,
      fileId: LIBRARY_FILE_ID,
      name: "seed.csv",
      ownerId: fixture.ids.appId,
      ownerKind: "app",
      path: "seed.csv",
      purpose: "library_file",
      scopeId: fixture.ids.appId,
      scopeKind: "library",
      sessionKind: null,
    });
    await insertReadyRawFileRecord(fixture.database, {
      createdBy: fixture.viewer.id,
      fileId: LEGACY_LIBRARY_FILE_ID,
      name: "legacy.csv",
      ownerId: fixture.viewer.id,
      ownerKind: "account",
      path: "legacy.csv",
      purpose: "library_file",
      scopeId: null,
      scopeKind: "library",
      sessionKind: null,
    });
    await insertReadyRawFileRecord(fixture.database, {
      createdBy: fixture.viewer.id,
      fileId: FILE_ID,
      name: "notes.txt",
      ownerId: SESSION_ID,
      ownerKind: "session",
      path: `attachment/${FILE_ID}/notes.txt`,
      purpose: "session_attachment",
      scopeId: SESSION_ID,
      scopeKind: "session",
      sessionKind: "attachment",
    });

    const missingAppResponse = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/files`,
      {
        headers: fixture.client.sessionHeaders(),
        method: "GET",
      },
      fixture.bindings,
    );
    const missingAppBody = (await missingAppResponse.json()) as FileErrorResponse;

    expect(missingAppResponse.status).toBe(400);
    expect(missingAppBody.error).toMatchObject({
      code: "file_invalid_request",
      message: "App ID is required to list files.",
      status: 400,
    });

    const allResponse = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/files?appId=${fixture.ids.appId}`,
      {
        headers: fixture.client.sessionHeaders(),
        method: "GET",
      },
      fixture.bindings,
    );
    const allBody = (await allResponse.json()) as FileEntryListing;

    expect(allResponse.status).toBe(200);
    expect(allBody.files.map((file) => file.id).toSorted()).toEqual(
      [FILE_ID, LIBRARY_FILE_ID].toSorted(),
    );

    const sessionResponse = await createHttpApp().request(
      `${PUBLIC_API_PREFIX}/files?appId=${fixture.ids.appId}&sessionId=${SESSION_ID}`,
      {
        headers: fixture.client.sessionHeaders(),
        method: "GET",
      },
      fixture.bindings,
    );
    const sessionBody = (await sessionResponse.json()) as FileEntryListing;

    expect(sessionResponse.status).toBe(200);
    expect(sessionBody.files.map((file) => file.id)).toEqual([FILE_ID]);
  });
});
