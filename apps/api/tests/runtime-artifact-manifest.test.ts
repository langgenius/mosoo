import { describe, expect, test } from "bun:test";

import { createRuntimeEvent } from "@mosoo/runtime-events";

import { createBaseLiveState } from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { appRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/events";
import {
  RUNTIME_ARTIFACT_MANIFEST_MAX_FILES,
  isRuntimeArtifactManifestPath,
  normalizeRuntimeArtifactPath,
  readRuntimeArtifactManifestEntries,
} from "../src/modules/runtime/infrastructure/driver-instance/runtime-artifact-manifest";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { API_DRIVER_BOUNDARY_IDS } from "./api-driver-boundary-fixtures";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

const encoder = new TextEncoder();

function manifest(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function encodeBase64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary);
}

function createSandboxHandle(files: ReadonlyMap<string, string>): SandboxHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };
  const successfulCommand = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: "",
    success: true,
  });
  const readFile: SandboxHandle["readFile"] = async (path) => {
    const content = files.get(path);

    if (content === undefined) {
      throw new Error(`Missing sandbox test file: ${path}`);
    }

    return {
      content: encodeBase64(content),
      encoding: "base64",
    };
  };

  return {
    createBackup: unavailable,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: unavailable,
    exec: successfulCommand,
    getSession: async () => ({
      exec: successfulCommand,
      mkdir: unavailable,
      readFile,
      startProcess: unavailable,
      watch: unavailable,
      writeFile: unavailable,
    }),
    mkdir: unavailable,
    mountBucket: unavailable,
    readFile,
    restoreBackup: unavailable,
    setKeepAlive: unavailable,
    startProcess: unavailable,
    terminal: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  };
}

describe("runtime artifact manifest", () => {
  test("parses the small sandbox artifact outbox contract", () => {
    const entries = readRuntimeArtifactManifestEntries(
      manifest({
        artifacts: [
          {
            contentType: " text/markdown ",
            path: "./dist\\resume.md",
          },
          {
            mimeType: "application/pdf",
            path: "resume.pdf",
          },
          {
            path: "../secret.txt",
          },
          {
            path: "/workspace/session/absolute.txt",
          },
          {
            path: ".mosoo/artifacts.json",
          },
        ],
      }),
    );

    expect(entries).toEqual([
      {
        contentType: "text/markdown",
        path: "dist/resume.md",
      },
      {
        contentType: "application/pdf",
        path: "resume.pdf",
      },
    ]);
  });

  test("keeps artifact paths relative to the runtime cwd", () => {
    expect(normalizeRuntimeArtifactPath("a/./b.txt")).toBe("a/b.txt");
    expect(normalizeRuntimeArtifactPath("../b.txt")).toBeNull();
    expect(normalizeRuntimeArtifactPath("/tmp/b.txt")).toBeNull();
    expect(normalizeRuntimeArtifactPath("")).toBeNull();
  });

  test("recognizes the manifest path in relative and absolute event payloads", () => {
    expect(isRuntimeArtifactManifestPath(".mosoo/artifacts.json")).toBe(true);
    expect(isRuntimeArtifactManifestPath("./.mosoo/artifacts.json")).toBe(true);
    expect(isRuntimeArtifactManifestPath("/workspace/session/.mosoo/artifacts.json")).toBe(true);
    expect(isRuntimeArtifactManifestPath("dist/output.txt")).toBe(false);
  });

  test("bounds manifest fanout", () => {
    const artifacts = Array.from(
      { length: RUNTIME_ARTIFACT_MANIFEST_MAX_FILES + 1 },
      (_, index) => ({
        path: `artifact-${index}.txt`,
      }),
    );

    expect(readRuntimeArtifactManifestEntries(manifest({ artifacts }))).toHaveLength(
      RUNTIME_ARTIFACT_MANIFEST_MAX_FILES,
    );
  });

  test("records declared sandbox outputs as session artifacts on run completion", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);

    await database
      .prepare(
        `
          INSERT INTO sandbox_session (
            cloudflare_session_id,
            created_at,
            cwd,
            origin_json,
            sandbox_id,
            session_id,
            status,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        API_DRIVER_BOUNDARY_IDS.sandboxSession,
        nowMsForTest(),
        "/workspace/session",
        "{}",
        PUBLIC_API_TEST_IDS.sandbox,
        PUBLIC_API_TEST_IDS.ownerSession,
        "active",
        nowMsForTest(),
      )
      .run();

    const bucket = new PublicApiMemoryFileBucket();
    const sandbox = createSandboxHandle(
      new Map([
        [
          "/workspace/session/.mosoo/artifacts.json",
          JSON.stringify({
            artifacts: [
              {
                contentType: "text/plain",
                path: "dist/resume.txt",
              },
            ],
          }),
        ],
        ["/workspace/session/dist/resume.txt", "Improved resume"],
      ]),
    );
    const bindings = {
      ...createPublicHttpTestBindings(database, {
        fileBucket: bucket as unknown as R2Bucket,
      }),
      runtimeSubjectHandleFactory: () => sandbox,
    } as ApiBindings;
    const link: RuntimeSessionLink = {
      agentId: PUBLIC_API_TEST_IDS.agent,
      callerId: PUBLIC_API_TEST_IDS.ownerAccount,
      creatorId: PUBLIC_API_TEST_IDS.ownerAccount,
      executionOwnerId: PUBLIC_API_TEST_IDS.ownerAccount,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sandboxKind: "cattle",
      sandboxSubjectKind: "session",
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      sessionRunId: PUBLIC_API_TEST_IDS.run,
      sessionRunStatus: "running",
      traceId: "trace-artifact-manifest",
    };
    const event = createRuntimeEvent({
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
      kind: "run.completed",
      occurredAt: "2026-06-22T00:00:00.000Z",
      payload: {
        run: {
          completedAt: "2026-06-22T00:00:00.000Z",
          error: null,
          startedAt: null,
          status: "completed",
        },
      },
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    await appRuntimeDriverEvents(bindings, {
      currentLiveState: createBaseLiveState({
        callerId: link.callerId,
        creatorId: link.creatorId,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
        sessionId: link.sessionId,
      }),
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      events: [
        {
          event,
          eventId: "source-run-completed-artifacts",
          occurredAt: 1,
        },
      ],
      link,
    });

    const row = await database
      .prepare(
        `
          SELECT mime_type, name, owner_id, owner_kind, purpose, scope_id, scope_kind, session_kind, size
            FROM file_record
           WHERE session_kind = 'artifact'
        `,
      )
      .first<{
        mime_type: string;
        name: string;
        owner_id: string;
        owner_kind: string;
        purpose: string;
        scope_id: string;
        scope_kind: string;
        session_kind: string;
        size: number;
      }>();

    expect(row).toEqual({
      mime_type: "text/plain",
      name: "resume.txt",
      owner_id: PUBLIC_API_TEST_IDS.ownerSession,
      owner_kind: "session",
      purpose: "session_artifact",
      scope_id: PUBLIC_API_TEST_IDS.ownerSession,
      scope_kind: "session",
      session_kind: "artifact",
      size: 15,
    });
    expect([...bucket.objects.values()]).toEqual([
      expect.objectContaining({
        body: "Improved resume",
        contentType: "text/plain",
      }),
    ]);
  });
});
