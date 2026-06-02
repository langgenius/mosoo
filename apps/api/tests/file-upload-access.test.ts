import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId, SessionId, UploadId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { ensureUploadAccess } from "../src/modules/files/infrastructure/file-record-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "viewer ID");
const OTHER_VIEWER_ID = parsePlatformId<AccountId>("01J00000000000000000000002", "other viewer ID");
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000003", "file ID");
const UPLOAD_ID = parsePlatformId<UploadId>("01J00000000000000000000004", "upload ID");
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000005", "session ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);

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
      organization_id text NOT NULL,
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

    INSERT INTO session (
      attributed_user_id,
      creator_account_id,
      id,
      organization_id,
      provider,
      title
    )
    VALUES (NULL, '${VIEWER_ID}', '${SESSION_ID}', '${ORGANIZATION_ID}', 'openai', 'Session');

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

describe("file upload access", () => {
  test("loads upload, file, and session access", async () => {
    const database = createFileUploadAccessDatabase();

    const context = await ensureUploadAccess({
      database,
      fileId: FILE_ID,
      requiredRole: "edit",
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
        requiredRole: "edit",
        viewer: { ...VIEWER, id: OTHER_VIEWER_ID },
      }),
    ).rejects.toThrow();
  });
});
