import { describe, expect, test } from "bun:test";

import type { FileSessionKind } from "@mosoo/contracts/file";

import type { ListedFileEntry } from "../src/domains/file/api/files";
import {
  createThreadArtifactLinkResolver,
  normalizeArtifactSourcePath,
} from "../src/routes/threads/detail/artifact-links";
import { toAccountId, toFileId, toSessionId } from "../src/routes/typed-id";

const ACCOUNT_ID = toAccountId("01J000000000000000000000A1");
const SESSION_ID = toSessionId("01J000000000000000000000S1");

function createArtifact(
  id: string,
  sourcePath: string | null,
  sessionKind: FileSessionKind | null = "artifact",
): ListedFileEntry {
  return {
    createdAt: "2026-07-16T00:00:00.000Z",
    createdBy: ACCOUNT_ID,
    etag: "etag",
    expiresAt: null,
    id: toFileId(id),
    mimeType: "text/markdown",
    name: sourcePath?.split("/").at(-1) ?? "unknown.md",
    path: `session-artifacts/${id}/result.md`,
    sessionId: SESSION_ID,
    sessionKind,
    sourcePath,
    size: 32,
    status: "ready",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 1,
  };
}

describe("Thread artifact links", () => {
  test("normalizes only safe outputs-relative paths", () => {
    expect(normalizeArtifactSourcePath("outputs/report.md")).toBe("outputs/report.md");
    expect(normalizeArtifactSourcePath("./outputs/final%20report.md")).toBe(
      "outputs/final report.md",
    );
    expect(normalizeArtifactSourcePath("outputs/../secret.txt")).toBeNull();
    expect(normalizeArtifactSourcePath("/outputs/report.md")).toBeNull();
    expect(normalizeArtifactSourcePath("https://example.com/report.md")).toBeNull();
  });

  test("resolves nested paths to the exact ready artifact", () => {
    const first = createArtifact("01J000000000000000000000F1", "outputs/one/report.md");
    const second = createArtifact("01J000000000000000000000F2", "outputs/two/report.md");
    const opened: ListedFileEntry[] = [];
    const resolve = createThreadArtifactLinkResolver([first, second], (file) => {
      opened.push(file);
    });

    const resolution = resolve("outputs/two/report.md");

    expect(resolution).toMatchObject({
      href: `/api/files/${second.id}/content?disposition=inline`,
      label: "Preview report.md",
    });
    resolution?.onOpen?.();
    expect(opened.map((file) => file.id)).toEqual([second.id]);
  });

  test("marks missing artifacts unavailable without relaxing normal link safety", () => {
    const resolve = createThreadArtifactLinkResolver([], () => {});
    const missing = resolve("outputs/missing.md");

    expect(missing).toMatchObject({
      label: "File unavailable",
      unavailable: true,
    });
    expect(missing?.href).toBe("/api/files/unavailable/content");
    expect(resolve("https://example.com/report.md")).toBeNull();
  });
});
