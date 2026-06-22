import { describe, expect, test } from "bun:test";

import { createRuntimeEvent } from "@mosoo/runtime-events";

import { createBaseLiveState } from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { appRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/events";
import {
  getRuntimeSessionOutputDirectory,
  normalizeRuntimeSessionOutputRelativePath,
  readRuntimeSessionOutputListing,
  toRuntimeSessionOutputFile,
} from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-outputs";
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
  const successfulCommand: SandboxHandle["exec"] = async (command) => {
    if (command.includes("find . -type f")) {
      const outputDir = "/workspace/session/outputs/";
      const output = [...files.keys()]
        .filter((path) => path.startsWith(outputDir))
        .map((path) => path.slice(outputDir.length))
        .toSorted()
        .join("\n");

      return {
        exitCode: 0,
        stderr: "",
        stdout: output.length === 0 ? "" : `${output}\n`,
        success: true,
      };
    }

    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      success: true,
    };
  };
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

async function insertActiveSandboxSession(database: D1Database): Promise<void> {
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
}

function createRuntimeLink(): RuntimeSessionLink {
  return {
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
    traceId: "trace-session-outputs",
  };
}

function createCompletedRunEvent() {
  return createRuntimeEvent({
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
}

function createFileChangedEvent() {
  return createRuntimeEvent({
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
    id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
    kind: "file.changed",
    occurredAt: "2026-06-22T00:00:00.000Z",
    payload: {
      changes: [
        {
          change: "upsert",
          metadata: { contentType: "text/plain" },
          path: "outputs/live.txt",
        },
        {
          change: "upsert",
          path: "src/temp.txt",
        },
      ],
    },
    runId: PUBLIC_API_TEST_IDS.run,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
}

async function createBindings(input: {
  database: D1Database;
  files?: ReadonlyMap<string, string>;
}): Promise<{ bindings: ApiBindings; bucket: PublicApiMemoryFileBucket }> {
  const bucket = new PublicApiMemoryFileBucket();
  const sandbox = createSandboxHandle(input.files ?? new Map());

  return {
    bindings: {
      ...createPublicHttpTestBindings(input.database, {
        fileBucket: bucket as unknown as R2Bucket,
      }),
      runtimeSubjectHandleFactory: () => sandbox,
    } as ApiBindings,
    bucket,
  };
}

async function dispatchRuntimeEvent(input: {
  bindings: ApiBindings;
  event: ReturnType<typeof createRuntimeEvent>;
  link: RuntimeSessionLink;
}): Promise<void> {
  await appRuntimeDriverEvents(input.bindings, {
    currentLiveState: createBaseLiveState({
      callerId: input.link.callerId,
      creatorId: input.link.creatorId,
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      sessionId: input.link.sessionId,
    }),
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
    events: [
      {
        event: input.event,
        eventId: "source-runtime-session-outputs",
        occurredAt: 1,
      },
    ],
    link: input.link,
  });
}

describe("runtime session outputs", () => {
  test("normalizes the session output directory contract", () => {
    expect(getRuntimeSessionOutputDirectory("/workspace/session")).toBe(
      "/workspace/session/outputs",
    );
    expect(normalizeRuntimeSessionOutputRelativePath("a/./b.txt")).toBe("a/b.txt");
    expect(normalizeRuntimeSessionOutputRelativePath("../b.txt")).toBeNull();
    expect(normalizeRuntimeSessionOutputRelativePath("/tmp/b.txt")).toBeNull();
    expect(readRuntimeSessionOutputListing("b.txt\n../secret.txt\nnested/a.pdf\n")).toEqual([
      "b.txt",
      "nested/a.pdf",
    ]);
    expect(
      toRuntimeSessionOutputFile({
        cwd: "/workspace/session",
        path: "outputs/resume.md",
      }),
    ).toEqual({
      artifactPath: "outputs/resume.md",
      contentType: "text/markdown",
      readPath: "/workspace/session/outputs/resume.md",
      relativePath: "resume.md",
    });
    expect(
      toRuntimeSessionOutputFile({
        cwd: "/workspace/session",
        path: "/workspace/session/outputs/final.pdf",
      })?.artifactPath,
    ).toBe("outputs/final.pdf");
    expect(
      toRuntimeSessionOutputFile({
        cwd: "/workspace/session",
        path: "src/temp.txt",
      }),
    ).toBeNull();
  });

  test("records files under outputs as session artifacts on run completion", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertActiveSandboxSession(database);

    const { bindings, bucket } = await createBindings({
      database,
      files: new Map([
        ["/workspace/session/outputs/resume.txt", "Improved resume"],
        ["/workspace/session/outputs/nested/summary.md", "# Summary"],
      ]),
    });
    const link = createRuntimeLink();

    await dispatchRuntimeEvent({
      bindings,
      event: createCompletedRunEvent(),
      link,
    });

    const rows = await database
      .prepare(
        `
          SELECT mime_type, name, owner_id, owner_kind, purpose, scope_id, scope_kind, session_kind, size
            FROM file_record
           WHERE session_kind = 'artifact'
           ORDER BY name
        `,
      )
      .all<{
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

    expect(rows.results).toEqual([
      {
        mime_type: "text/plain",
        name: "resume.txt",
        owner_id: PUBLIC_API_TEST_IDS.ownerSession,
        owner_kind: "session",
        purpose: "session_artifact",
        scope_id: PUBLIC_API_TEST_IDS.ownerSession,
        scope_kind: "session",
        session_kind: "artifact",
        size: 15,
      },
      {
        mime_type: "text/markdown",
        name: "summary.md",
        owner_id: PUBLIC_API_TEST_IDS.ownerSession,
        owner_kind: "session",
        purpose: "session_artifact",
        scope_id: PUBLIC_API_TEST_IDS.ownerSession,
        scope_kind: "session",
        session_kind: "artifact",
        size: 9,
      },
    ]);
    expect([...bucket.objects.values()]).toHaveLength(2);
  });

  test("records file change events only when the path is under outputs", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertActiveSandboxSession(database);

    const { bindings } = await createBindings({
      database,
      files: new Map([
        ["/workspace/session/outputs/live.txt", "download me"],
        ["/workspace/session/src/temp.txt", "ignore me"],
      ]),
    });
    const link = createRuntimeLink();

    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(),
      link,
    });

    const rows = await database
      .prepare("SELECT name, size FROM file_record WHERE session_kind = 'artifact'")
      .all<{ name: string; size: number }>();

    expect(rows.results).toEqual([
      {
        name: "live.txt",
        size: 11,
      },
    ]);
  });

  test("skips optional output directory when it has no files", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertActiveSandboxSession(database);

    const { bindings, bucket } = await createBindings({ database });
    const link = createRuntimeLink();

    await dispatchRuntimeEvent({
      bindings,
      event: createCompletedRunEvent(),
      link,
    });

    const row = await database
      .prepare("SELECT count(*) AS count FROM file_record")
      .first<{ count: number }>();

    expect(row?.count).toBe(0);
    expect([...bucket.objects.values()]).toEqual([]);
  });
});
