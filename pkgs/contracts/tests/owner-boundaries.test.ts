import { describe, expect, test } from "bun:test";

import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "@mosoo/contracts/agent-manifest";
import { parseAgentPackageJson } from "@mosoo/contracts/agent-manifest-parser";
import {
  serializeAgentManifestToYaml,
  serializeAgentPackageToJson,
} from "@mosoo/contracts/agent-manifest-serializer";
import {
  SESSION_RESOURCE_MOUNT_DIR,
  createAccountAvatarPath,
  createAttachmentPath,
  createDownloadDisposition,
  createFileObjectKey,
  createScope,
  normalizeFileName,
  normalizeLibraryFilePath,
  toSessionResourceMaterializedPath,
} from "@mosoo/contracts/file";
import {
  AGENT_SESSION_ARCHIVED_READ_ONLY_REASON,
  AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
  getAgentSessionUserLifecycleProjection,
} from "@mosoo/contracts/session";
import type { AccountId, FileId, SessionId } from "@mosoo/id";

const FILE_ID = "01J00000000000000000000001" as FileId;
const SESSION_ID = "01J00000000000000000000002" as SessionId;
const ACCOUNT_ID = "01J00000000000000000000003" as AccountId;

describe("contracts owner boundaries", () => {
  test.each([undefined, null, "pet", "cattle", "session", {}])(
    "imports and re-exports a package ignoring legacy kind %j",
    (kind) => {
      const parsed = parseAgentPackageJson(
        JSON.stringify({
          ...(kind === undefined ? {} : { kind }),
          manifestVersion: AGENT_MANIFEST_VERSION,
          packageVersion: AGENT_PACKAGE_VERSION,
          name: "Session preset",
          prompts: { system: "Retain these instructions." },
          runtime: "openai-runtime",
          provider: "openai",
          model: "gpt-5.4",
          settings: { model_reasoning_effort: "low" },
        }),
      );
      expect(parsed.issues).toEqual([]);
      if (parsed.package === null) throw new Error("Expected a valid package");
      expect(parsed.package.manifest).not.toHaveProperty("kind");
      expect(serializeAgentManifestToYaml(parsed.package.manifest)).not.toContain("kind:");
      const exported = serializeAgentPackageToJson(parsed.package);
      expect(JSON.parse(exported)).not.toHaveProperty("kind");
      expect(parseAgentPackageJson(exported).manifest).toEqual(parsed.manifest);
      expect(parsed.manifest?.runtime.providerOptions).toEqual({ model_reasoning_effort: "low" });
    },
  );

  test("agent package parser owns required manifest fields", () => {
    const invalid = parseAgentPackageJson("{}");

    expect(invalid.package).toBeNull();
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "manifest.version.unsupported",
        "manifest.metadata.name.missing",
        "manifest.runtime.missing",
        "manifest.model.missing",
      ]),
    );
  });

  test("agent package parser rejects source authority fields", () => {
    const forbidden = parseAgentPackageJson(
      JSON.stringify({
        manifestVersion: AGENT_MANIFEST_VERSION,
        model: "gpt-5",
        name: "Ops Helper",
        packageVersion: AGENT_PACKAGE_VERSION,
        prompts: { system: "Help with operations." },
        provider: "openai",
        runtime: "openai-runtime",
        sourceOrganizationId: "01J00000000000000000000001",
      }),
    );

    expect(forbidden.package).toBeNull();
    expect(forbidden.issues[0]?.code).toBe("package.field.unsupported");
  });

  test("file contract owns user path admission before object key projection", () => {
    expect(normalizeLibraryFilePath("docs/notes.txt ")).toBe("docs/notes.txt");
    expect(createAttachmentPath(FILE_ID, " notes.txt ")).toBe(`attachment/${FILE_ID}/notes.txt`);

    for (const path of [
      "/docs/notes.txt",
      "docs/../notes.txt",
      "docs/%2f/notes.txt",
      "docs/notes.txt/",
      String.raw`docs\notes.txt`,
    ]) {
      expect(() => normalizeLibraryFilePath(path)).toThrow();
    }

    expect(() => normalizeFileName("notes\r\nx-file: bad.txt")).toThrow();
    expect(createDownloadDisposition(' "notes".txt ', "attachment")).toBe(
      'attachment; filename="notes.txt"',
    );
    expect(() => createDownloadDisposition("notes\r\nx-file: bad.txt", "attachment")).toThrow();
    expect(() => createDownloadDisposition('"', "attachment")).toThrow();
  });

  test("file contract rejects noncanonical object key projection records", () => {
    expect(
      createFileObjectKey({
        id: FILE_ID,
        name: "notes.txt",
        path: "docs/notes.txt",
        scope: createScope("library", null),
      }),
    ).toBe(`library/${FILE_ID}/docs/notes.txt`);

    expect(
      createFileObjectKey({
        id: FILE_ID,
        name: "notes.txt",
        path: "session-files/ignored/notes.txt",
        scope: createScope("session", SESSION_ID),
      }),
    ).toBe(`session/${SESSION_ID}/attachment/${FILE_ID}/notes.txt`);

    expect(createAccountAvatarPath(FILE_ID, " avatar.png ")).toBe(`avatar/${FILE_ID}/avatar.png`);
    expect(
      createFileObjectKey({
        id: FILE_ID,
        name: "avatar.png",
        path: `avatar/${FILE_ID}/avatar.png`,
        scope: createScope("account", ACCOUNT_ID),
      }),
    ).toBe(`account/${ACCOUNT_ID}/avatar/${FILE_ID}/avatar.png`);

    expect(() =>
      createFileObjectKey({
        id: FILE_ID,
        name: "notes.txt",
        path: "docs/notes.txt ",
        scope: createScope("library", null),
      }),
    ).toThrow();

    expect(() =>
      createFileObjectKey({
        id: FILE_ID,
        name: " notes.txt",
        path: "session-files/ignored/notes.txt",
        scope: createScope("session", SESSION_ID),
      }),
    ).toThrow();
  });

  test("file contract materializes only canonical session resource paths", () => {
    expect(SESSION_RESOURCE_MOUNT_DIR).toBe("session-files");
    expect(toSessionResourceMaterializedPath(`attachment/${FILE_ID}/notes.txt`)).toBe(
      `session-files/${FILE_ID}/notes.txt`,
    );
    expect(toSessionResourceMaterializedPath(`session-files/${FILE_ID}/notes.txt`)).toBe(
      `session-files/${FILE_ID}/notes.txt`,
    );

    for (const path of [
      `/attachment/${FILE_ID}/notes.txt`,
      `attachment/${FILE_ID}/notes.txt/`,
      `archive/${FILE_ID}/notes.txt`,
      `attachment/${FILE_ID}/nested/notes.txt`,
      "attachment/not-a-file-id/notes.txt",
      `attachment/${FILE_ID.toLowerCase()}/notes.txt`,
      `attachment/${FILE_ID}/ notes.txt`,
      `attachment/${FILE_ID}/notes\r.txt`,
    ] as const) {
      expect(() => toSessionResourceMaterializedPath(path)).toThrow();
    }
  });

  test("session contract owns user lifecycle projection from engineering state", () => {
    expect(
      getAgentSessionUserLifecycleProjection({
        archivedAt: null,
        status: "RESCHEDULING",
      }),
    ).toEqual({
      readOnly: false,
      recoverability: {
        reason: null,
        status: "resumable",
      },
      state: "alive",
      terminal: false,
    });

    expect(
      getAgentSessionUserLifecycleProjection({
        archivedAt: "2026-06-01T00:00:00.000Z",
        status: "IDLE",
      }),
    ).toEqual({
      readOnly: true,
      recoverability: {
        reason: AGENT_SESSION_ARCHIVED_READ_ONLY_REASON,
        status: "read_only",
      },
      state: "asleep",
      terminal: false,
    });

    expect(
      getAgentSessionUserLifecycleProjection({
        archivedAt: "2026-06-01T00:00:00.000Z",
        status: "TERMINATED",
      }),
    ).toEqual({
      readOnly: true,
      recoverability: {
        reason: AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
        status: "not_recoverable",
      },
      state: "buried",
      terminal: true,
    });
  });
});
