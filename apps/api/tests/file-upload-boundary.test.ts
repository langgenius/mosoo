import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SessionId, SpaceId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  createDownloadDisposition,
  createFinalObjectKey,
  normalizeSpaceDirectoryPath,
  normalizeSpaceFilePath,
} from "../src/modules/files/infrastructure/file-paths";
import { createFileUpload } from "../src/modules/files/infrastructure/file-upload-create";
import {
  formatR2EtagHeader,
  normalizeR2Etag,
} from "../src/modules/files/infrastructure/r2-s3-etag";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const VIEWER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "viewer ID");
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000002", "session ID");
const FILE_ID = parsePlatformId<FileId>("01J00000000000000000000003", "file ID");
const SPACE_ID = parsePlatformId<SpaceId>("01J00000000000000000000004", "space ID");

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
        },
      }),
    ).rejects.toMatchObject({
      code: "file_invalid_request",
      status: 400,
    });
  });

  test("normalizes R2 ETags for comparison and HTTP preconditions", () => {
    expect(normalizeR2Etag(null)).toBeNull();
    expect(normalizeR2Etag(' "abc123" ')).toBe("abc123");
    expect(normalizeR2Etag('W/"abc123"')).toBe("abc123");
    expect(normalizeR2Etag('W/ "abc123"')).toBe("abc123");

    expect(formatR2EtagHeader("abc123")).toBe('"abc123"');
    expect(formatR2EtagHeader('"abc123"')).toBe('"abc123"');
    expect(formatR2EtagHeader('W/"abc123"')).toBe('"abc123"');
    expect(formatR2EtagHeader("*")).toBe("*");
  });

  test("rejects noncanonical space path segments before storage work", () => {
    for (const path of [
      ".",
      "..",
      "docs/./notes.txt",
      "docs/../notes.txt",
      "%2e/notes.txt",
      "%2E%2E/notes.txt",
      "docs/%2f/notes.txt",
      "docs/%5c/notes.txt",
    ]) {
      expect(() => normalizeSpaceFilePath(path)).toThrow();
    }

    for (const path of ["/docs/notes.txt", String.raw`\docs\notes.txt`, "docs/notes.txt/"]) {
      expect(() => normalizeSpaceFilePath(path)).toThrow();
    }

    expect(() => normalizeSpaceFilePath(String.raw`docs\notes.txt`)).toThrow();
    expect(() => normalizeSpaceDirectoryPath("/docs")).toThrow();
    expect(() => normalizeSpaceDirectoryPath("docs/%2e%2e")).toThrow();
  });

  test("rejects unsafe file names before download header projection", () => {
    expect(createDownloadDisposition(' "notes".txt ', "attachment")).toBe(
      'attachment; filename="notes.txt"',
    );
    expect(() => createDownloadDisposition("notes\r\nx-file: bad.txt", "attachment")).toThrow();
    expect(() => createDownloadDisposition('"', "attachment")).toThrow();
  });

  test("translates unsafe object key projection records into typed file errors", () => {
    expect(() =>
      createFinalObjectKey({
        created_by_account_id: VIEWER_ID,
        id: FILE_ID,
        name: "notes.txt",
        path: "docs/notes.txt ",
        scope_id: SPACE_ID,
        scope_kind: "space",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "file_invalid_request",
        status: 400,
      }),
    );
  });
});
