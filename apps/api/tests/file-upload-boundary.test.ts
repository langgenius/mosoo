import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, ProjectId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createFinalObjectKey } from "../src/modules/files/infrastructure/file-paths";
import { createFileUpload } from "../src/modules/files/infrastructure/file-upload-create";
import { normalizeR2Etag } from "../src/modules/files/infrastructure/r2-object";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const VIEWER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "viewer ID");
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000002", "session ID");
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000003", "file ID");
const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000005", "project ID");

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Viewer",
};

describe("file upload boundary", () => {
  test("rejects invalid byte sizes before storage or database work", async () => {
    await expect(
      createFileUpload({} as ApiBindings, VIEWER, {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: -1,
        },
        target: {
          id: SESSION_ID,
          kind: "session",
          name: "notes.txt",
          projectId: PROJECT_ID,
        },
      }),
    ).rejects.toMatchObject({
      code: "file_invalid_request",
      status: 400,
    });

    await expect(
      createFileUpload({} as ApiBindings, VIEWER, {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 1.5,
        },
        target: {
          id: SESSION_ID,
          kind: "session",
          name: "notes.txt",
          projectId: PROJECT_ID,
        },
      }),
    ).rejects.toMatchObject({
      code: "file_invalid_request",
      status: 400,
    });
  });

  test("rejects unsupported upload targets before ownership lookup", async () => {
    await expect(
      createFileUpload({} as ApiBindings, VIEWER, {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 1,
        },
        purpose: "organization_draft",
        target: {
          id: PROJECT_ID,
          kind: "organization_draft",
          name: "notes.txt",
        },
      } as unknown as Parameters<typeof createFileUpload>[2]),
    ).rejects.toMatchObject({
      code: "file_invalid_request",
      status: 400,
    });
  });

  test("normalizes R2 ETags for comparison", () => {
    expect(normalizeR2Etag(null)).toBeNull();
    expect(normalizeR2Etag(' "abc123" ')).toBe("abc123");
    expect(normalizeR2Etag('W/"abc123"')).toBe("abc123");
    expect(normalizeR2Etag('W/ "abc123"')).toBe("abc123");
  });

  test("translates unsafe object key projection records into typed file errors", () => {
    expect(() =>
      createFinalObjectKey({
        id: FILE_ID,
        name: "notes.txt ",
        path: `attachment/${FILE_ID}/notes.txt`,
        scope_id: SESSION_ID,
        scope_kind: "session",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "file_invalid_request",
        status: 400,
      }),
    );
  });
});
