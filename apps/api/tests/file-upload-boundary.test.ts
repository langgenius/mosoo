import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, AppId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  createDownloadDisposition,
  createFinalObjectKey,
  normalizeLibraryDirectoryPath,
  normalizeLibraryFilePath,
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
const APP_ID = parsePlatformId<AppId>("01J00000000000000000000005", "app ID");
const API_SRC_ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const FILES_MODULE_PREFIX = "modules/files/";
const FILES_INFRASTRUCTURE_IMPORT_PATTERN = /from\s+["'][^"']*files\/infrastructure\//;
const FILES_APPLICATION_ROOT = join(API_SRC_ROOT, "modules/files/application");
const ALLOWED_FILES_APPLICATION_SURFACES = new Set(["file-control-errors.ts", "file-store.ts"]);

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Viewer",
};

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }

    if (!entry.isFile() || !path.endsWith(".ts")) {
      return [];
    }

    return [path];
  });
}

describe("file upload boundary", () => {
  test("keeps Files infrastructure private to the Files module in production code", () => {
    const offenders = listTypeScriptFiles(API_SRC_ROOT)
      .filter(
        (path) =>
          !relative(API_SRC_ROOT, path).replaceAll("\\", "/").startsWith(FILES_MODULE_PREFIX),
      )
      .filter((path) => FILES_INFRASTRUCTURE_IMPORT_PATTERN.test(readFileSync(path, "utf8")))
      .map((path) => relative(API_SRC_ROOT, path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });

  test("keeps the Files application surface narrow", () => {
    const unexpectedApplicationFiles = listTypeScriptFiles(FILES_APPLICATION_ROOT)
      .map((path) => basename(path))
      .filter((name) => !ALLOWED_FILES_APPLICATION_SURFACES.has(name));

    expect(unexpectedApplicationFiles).toEqual([]);
  });

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
          appId: APP_ID,
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
          appId: APP_ID,
        },
      }),
    ).rejects.toMatchObject({
      code: "file_invalid_request",
      status: 400,
    });
  });

  test("rejects removed Organization draft targets before ownership lookup", async () => {
    await expect(
      createFileUpload({} as ApiBindings, VIEWER, {
        file: {
          contentType: "text/plain",
          name: "notes.txt",
          size: 1,
        },
        purpose: "organization_draft",
        target: {
          id: APP_ID,
          kind: "organization_draft",
          name: "notes.txt",
        },
      } as unknown as Parameters<typeof createFileUpload>[2]),
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

  test("rejects noncanonical library path segments before storage work", () => {
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
      expect(() => normalizeLibraryFilePath(path)).toThrow();
    }

    for (const path of ["/docs/notes.txt", String.raw`\docs\notes.txt`, "docs/notes.txt/"]) {
      expect(() => normalizeLibraryFilePath(path)).toThrow();
    }

    expect(() => normalizeLibraryFilePath(String.raw`docs\notes.txt`)).toThrow();
    expect(() => normalizeLibraryDirectoryPath("/docs")).toThrow();
    expect(() => normalizeLibraryDirectoryPath("docs/%2e%2e")).toThrow();
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
        scope_id: null,
        scope_kind: "library",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "file_invalid_request",
        status: 400,
      }),
    );
  });
});
