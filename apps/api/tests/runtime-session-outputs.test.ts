import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { fileStore } from "../src/modules/files/application/file-store";
import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { DriverInstanceRpcEventIngestionController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller";
import {
  getRuntimeSessionOutputDirectory,
  normalizeRuntimeSessionOutputRelativePath,
  readRuntimeSessionOutputInventory,
  toRuntimeSessionOutputFile,
} from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-outputs";
import { RuntimeSessionViewCache } from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-view-cache";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import { createRuntimeOutputSandbox } from "./helpers/runtime-output-sandbox";

async function insertActiveRuntime(database: D1Database): Promise<void> {
  const now = nowMsForTest();
  await database
    .prepare(
      `INSERT INTO driver_instance (
         id, sandbox_id, sandbox_incarnation, sandbox_session_id, runtime, protocol, protocol_version,
         status, status_changed_at, status_event, status_seq, status_source,
         connection_id, command_seq_cursor, boot_token_hash, boot_token_expires_at,
         generation, heartbeat_count, restart_count, expires_at, created_at, updated_at
       ) VALUES (?, ?, 1, ?, 'openai-runtime', 'acp', 3, 'ready', ?, 'driver.ready', 1,
         'driver', 'connection-1', 0, X'00', ?, 1, 1, 0, ?, ?, ?)`,
    )
    .bind(
      PUBLIC_API_TEST_IDS.driverOwner,
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      now,
      now + 60_000,
      now + 60_000,
      now,
      now,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO session_run (
         id, session_id, agent_id, created_by_account_id, driver_instance_id,
         trigger, status, provider, model, runtime_id, trace_id, created_at,
         status_changed_at, status_event, status_seq, status_source, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'user_prompt', 'running', 'openai', 'gpt-5.4',
         'openai-runtime', 'trace-session-outputs', ?, ?, 'run.start', 1, 'driver', ?)`,
    )
    .bind(
      PUBLIC_API_TEST_IDS.run,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.driverOwner,
      now,
      now,
      now,
    )
    .run();
  await database
    .prepare(
      "UPDATE session SET last_run_id = ?, status = 'RUNNING', status_operation_id = NULL WHERE id = ?",
    )
    .bind(PUBLIC_API_TEST_IDS.run, PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

function createCompletedRunEvent() {
  return createRuntimeEvent({
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
    id: createPlatformId<RuntimeEventId>(),
    kind: "run.completed",
    occurredAt: "2026-06-22T00:00:01.000Z",
    payload: { stopReason: "end_turn" },
    runId: PUBLIC_API_TEST_IDS.run,
    runtimeId: "openai-runtime",
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
}

interface TestFileChange {
  readonly change: "delete" | "upsert";
  readonly metadata?: { readonly contentType?: string };
  readonly path: string;
}

function createFileChangedEvent(...changes: readonly TestFileChange[]) {
  return createRuntimeEvent({
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
    id: createPlatformId<RuntimeEventId>(),
    kind: "file.changed",
    occurredAt: "2026-06-22T00:00:00.000Z",
    payload: { changes },
    runId: PUBLIC_API_TEST_IDS.run,
    runtimeId: "openai-runtime",
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
}

function fileUpsert(path: string, contentType = "text/plain"): TestFileChange {
  return { change: "upsert", metadata: { contentType }, path };
}

function createBindings(input: { database: D1Database; files?: ReadonlyMap<string, string> }): {
  bindings: ApiBindings;
  bucket: PublicApiMemoryFileBucket;
} {
  const bucket = new PublicApiMemoryFileBucket();
  const sandbox = createRuntimeOutputSandbox({
    files: input.files,
    onExec: (command) => {
      if (command.includes("find . -type f")) {
        expect(command.startsWith("bash -lc ")).toBe(true);
        expect(command.indexOf("head -z")).toBeLessThan(command.indexOf("sort -z"));
      }
    },
    root: "/workspace/session/outputs",
  });

  return {
    bindings: {
      ...createPublicHttpTestBindings(input.database, {
        fileBucket: bucket,
      }),
      runtimeSubjectHandleFactory: () => sandbox,
    } as ApiBindings,
    bucket,
  };
}

const activeContext = {
  assertActiveConnection: () => undefined,
  connectionId: "connection-1",
} as never;

function createController(bindings: ApiBindings): DriverInstanceRpcEventIngestionController {
  const state = {
    hello: { pid: 1 },
    requireDriverGeneration: () => 1,
    requireDriverInstanceId: () => PUBLIC_API_TEST_IDS.driverOwner,
    runtimeSessionLink: null as RuntimeSessionLink | null,
    setRuntimeSessionLink(link: RuntimeSessionLink) {
      this.runtimeSessionLink = link;
    },
  };

  return new DriverInstanceRpcEventIngestionController({
    env: bindings,
    state,
    viewCache: new RuntimeSessionViewCache(),
    viewerEventDelivery: {
      enqueue: () => undefined,
      flush: async () => undefined,
      flushSafely: async () => undefined,
      requestStateSync: () => undefined,
      resetAfterFlush: () => undefined,
    },
  } as never);
}

async function createRuntimeSessionOutputFixture(
  files: ReadonlyMap<string, string> = new Map(),
): Promise<{
  readonly bindings: ApiBindings;
  readonly bucket: PublicApiMemoryFileBucket;
  readonly database: D1Database;
}> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await insertActiveSandboxSessionFixture(database, {
    cwd: "/workspace/session",
    ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await insertActiveRuntime(database);

  return { database, ...createBindings({ database, files }) };
}

async function dispatchRuntimeEvent(input: {
  bindings: ApiBindings;
  event: ReturnType<typeof createRuntimeEvent>;
}): Promise<void> {
  const eventId = input.event.sourceEventId ?? input.event.id;

  await createController(input.bindings).handlePushEvents(
    {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      events: [{ event: input.event, eventId, occurredAt: input.event.occurredAt }],
    },
    activeContext,
  );
}

describe("runtime session outputs", () => {
  test("preserves exact binary bytes in the memory R2 fixture", async () => {
    const bucket = new PublicApiMemoryFileBucket();
    const source = Uint8Array.of(0xaa, 0xff, 0, 0x80, 0x41, 0xbb);
    const expected = Uint8Array.of(0xff, 0, 0x80, 0x41);
    const customMetadata = { contentSha256: "binary-hash", sourcePath: "outputs/data.bin" };

    const stored = await bucket.put("binary", source.subarray(1, -1), {
      customMetadata,
      httpMetadata: { contentType: "application/octet-stream" },
    });
    source.fill(0);
    const body = await bucket.get("binary");

    expect(stored).toMatchObject({ customMetadata, size: expected.byteLength });
    expect(body).toMatchObject({ customMetadata, size: expected.byteLength });
    expect(new Uint8Array(await body!.arrayBuffer())).toEqual(expected);
  });

  test.each([
    ["If-None-Match", false],
    ["If-Match", true],
  ] as const)("serializes concurrent %s writes in the memory R2 fixture", async (name, seeded) => {
    const bucket = new PublicApiMemoryFileBucket();
    const key = "conditional";
    const previous = seeded ? await bucket.put(key, "previous") : null;
    const onlyIf = new Headers({ [name]: seeded ? previous!.httpEtag : "*" });
    const writes = await Promise.all([
      bucket.put(key, "first", { onlyIf }),
      bucket.put(key, "second", { onlyIf }),
    ]);
    const winner = writes.find((object) => object !== null);
    const stored = await bucket.get(key);

    expect(writes.filter((object) => object !== null)).toHaveLength(1);
    expect(stored?.etag).toBe(winner?.etag);
    expect(["first", "second"]).toContain(await stored?.text());
  });

  test("normalizes the session output directory contract", () => {
    expect(getRuntimeSessionOutputDirectory("/workspace/session")).toBe(
      "/workspace/session/outputs",
    );
    expect(normalizeRuntimeSessionOutputRelativePath("a/b.txt")).toBe("a/b.txt");
    expect(normalizeRuntimeSessionOutputRelativePath("a/./b.txt")).toBeNull();
    expect(normalizeRuntimeSessionOutputRelativePath("../b.txt")).toBeNull();
    expect(normalizeRuntimeSessionOutputRelativePath("/tmp/b.txt")).toBeNull();
    expect(
      readRuntimeSessionOutputInventory(
        ["./b.txt", "12", "./nested/report.pdf", "7", ""].join("\0"),
      ),
    ).toEqual([
      { relativePath: "b.txt", size: 12 },
      { relativePath: "nested/report.pdf", size: 7 },
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

  test.each([
    ["control character", "nested/tab\tline\n.txt"],
    ["trailing control character", "nested/report.txt\n"],
    ["backslash", "nested/back\\slash.txt"],
    ["non-canonical whitespace", "nested/ report.txt"],
    ["encoded traversal", "nested/%2e%2e/report.txt"],
    ["dot alias", "nested/./report.txt"],
    ["empty segment", "nested//report.txt"],
  ] as const)("rejects a %s that file records cannot represent", (_name, path) => {
    expect(normalizeRuntimeSessionOutputRelativePath(path)).toBeNull();
    expect(() => readRuntimeSessionOutputInventory([`./${path}`, "1", ""].join("\0"))).toThrow(
      "Runtime output inventory is invalid.",
    );
    expect(
      toRuntimeSessionOutputFile({ cwd: "/workspace/session", path: `outputs/${path}` }),
    ).toBeNull();
  });

  test("records files under outputs as session artifacts from file changes", async () => {
    const { bindings, bucket, database } = await createRuntimeSessionOutputFixture(
      new Map([
        ["/workspace/session/outputs/resume.txt", "Improved resume"],
        ["/workspace/session/outputs/nested/summary.md", "# Summary"],
      ]),
    );

    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/resume.txt")),
    });
    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/nested/summary.md", "text/markdown")),
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
    expect(
      [...bucket.objects.values()].filter((object) => !object.key.endsWith("/manifest.json")),
    ).toHaveLength(2);
  });

  test("atomically replaces delta artifact heads with the completed Run snapshot", async () => {
    const files = new Map([
      ["/workspace/session/outputs/current.txt", "delta version"],
      ["/workspace/session/outputs/obsolete.txt", "removed before completion"],
    ]);
    const { bindings, bucket, database } = await createRuntimeSessionOutputFixture(files);

    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/current.txt")),
    });
    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/obsolete.txt")),
    });

    files.set("/workspace/session/outputs/current.txt", "terminal version");
    files.delete("/workspace/session/outputs/obsolete.txt");
    await dispatchRuntimeEvent({ bindings, event: createCompletedRunEvent() });

    const heads = await database
      .prepare(
        `SELECT h.file_id, h.runtime_event_seq, h.source_path, f.object_key
           FROM session_artifact_head AS h
           LEFT JOIN file_record AS f ON f.id = h.file_id
          WHERE h.session_id = ?
          ORDER BY h.source_path`,
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .all<{
        file_id: string | null;
        object_key: string | null;
        runtime_event_seq: number;
        source_path: string;
      }>();

    expect(
      heads.results.map(({ file_id, runtime_event_seq, source_path }) => ({
        file_id: file_id === null ? null : "present",
        runtime_event_seq,
        source_path,
      })),
    ).toEqual([
      {
        file_id: "present",
        runtime_event_seq: 3,
        source_path: "outputs/current.txt",
      },
      {
        file_id: null,
        runtime_event_seq: 3,
        source_path: "outputs/obsolete.txt",
      },
    ]);
    expect(await (await bucket.get(heads.results[0]?.object_key ?? ""))?.text()).toBe(
      "terminal version",
    );
    expect(
      await database
        .prepare(
          `SELECT count(*) AS count
             FROM runtime_artifact_attempt
            WHERE status = 'accepted' AND owned_object_keys_json = '[]'`,
        )
        .first(),
    ).toEqual({ count: 3 });
  });

  test("does not resurrect a late headless legacy artifact after an empty snapshot", async () => {
    const { bindings, database } = await createRuntimeSessionOutputFixture();
    const staleFileId = createPlatformId();
    await database
      .prepare(
        `INSERT INTO file_record (
           committed, created_at, created_by_account_id, id, name, object_key,
           owner_id, owner_kind, parent_path, path, purpose, scope_id, scope_kind,
           session_kind, size, status, updated_at, version
         ) VALUES (
           1, ?, ?, ?, 'stale.txt', ?, ?, 'session', ?, ?, 'session_artifact',
           ?, 'session', 'artifact', 5, 'ready', ?, 1
         )`,
      )
      .bind(
        nowMsForTest(),
        PUBLIC_API_TEST_IDS.ownerAccount,
        staleFileId,
        `objects/${staleFileId}`,
        PUBLIC_API_TEST_IDS.ownerSession,
        `runtime-output/outputs/stale.txt/${"a".repeat(64)}`,
        `session-artifacts/${staleFileId}/stale.txt`,
        PUBLIC_API_TEST_IDS.ownerSession,
        nowMsForTest(),
      )
      .run();

    await dispatchRuntimeEvent({
      bindings,
      event: createCompletedRunEvent(),
    });

    await expect(
      database
        .prepare(
          `SELECT json_extract(manifest_json, '$.captureStatus') AS capture_status,
                  json_extract(manifest_json, '$.mode') AS mode,
                  status
             FROM runtime_artifact_attempt`,
        )
        .first(),
    ).resolves.toEqual({ capture_status: "complete", mode: "snapshot", status: "accepted" });
    expect(
      await fileStore.listReadySessionFiles(database, PUBLIC_API_TEST_IDS.ownerSession),
    ).toEqual([]);
    expect(
      await fileStore.listLatestReadySessionArtifactSources(
        database,
        PUBLIC_API_TEST_IDS.ownerSession,
      ),
    ).toEqual([]);
    await expect(
      database
        .prepare("SELECT count(*) AS count FROM file_record WHERE id = ?")
        .bind(staleFileId)
        .first(),
    ).resolves.toEqual({ count: 1 });
  });

  test("deduplicates runtime outputs by source path and content", async () => {
    const files = new Map([
      ["/workspace/session/outputs/one/report.txt", "alpha"],
      ["/workspace/session/outputs/two/report.txt", "bravo"],
    ]);
    const { bindings, database } = await createRuntimeSessionOutputFixture(files);
    const readReportCount = async () => {
      const row = await database
        .prepare(
          "SELECT count(*) AS count FROM file_record WHERE session_kind = 'artifact' AND name = 'report.txt' AND size = 5",
        )
        .first<{ count: number }>();

      return row?.count;
    };

    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/one/report.txt")),
    });

    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/two/report.txt")),
    });

    expect(await readReportCount()).toBe(2);

    files.set("/workspace/session/outputs/one/report.txt", "gamma");

    await dispatchRuntimeEvent({
      bindings,
      event: createFileChangedEvent(fileUpsert("outputs/one/report.txt")),
    });

    expect(await readReportCount()).toBe(3);
  });

  test.each([
    ["relative output path", "outputs/live.txt", [{ name: "live.txt", size: 11 }]],
    ["external relative path", "src/temp.txt", []],
    [
      "absolute output path",
      "/workspace/session/outputs/live.txt",
      [{ name: "live.txt", size: 11 }],
    ],
    ["external absolute path", "/workspace/session/src/temp.txt", []],
    ["output traversal", "outputs/../src/temp.txt", []],
  ] as const)(
    "keeps artifact writes inside outputs: %s",
    async (_label, eventPath, expectedRows) => {
      const { bindings, bucket, database } = await createRuntimeSessionOutputFixture(
        new Map([
          ["/workspace/session/outputs/live.txt", "download me"],
          ["/workspace/session/src/temp.txt", "ignore me"],
        ]),
      );

      await dispatchRuntimeEvent({
        bindings,
        event: createFileChangedEvent(fileUpsert(eventPath)),
      });

      const rows = await database
        .prepare("SELECT name, size FROM file_record WHERE session_kind = 'artifact'")
        .all<{ name: string; size: number }>();
      const artifactObjects = [...bucket.objects.values()].filter(
        (object) => !object.key.endsWith("/manifest.json"),
      );

      expect(rows.results).toEqual(expectedRows);
      expect(artifactObjects).toHaveLength(expectedRows.length);
    },
  );

  test("replays an artifact receipt without reopening its sandbox path", async () => {
    const files = new Map([["/workspace/session/outputs/result.txt", "R1 result"]]);
    const { bindings, bucket, database } = await createRuntimeSessionOutputFixture(files);
    const event = createFileChangedEvent(fileUpsert("outputs/result.txt"));

    await dispatchRuntimeEvent({ bindings, event });
    files.set("/workspace/session/outputs/result.txt", "R2 result");
    files.set("/workspace/session/outputs/later.txt", "created by R2");
    await dispatchRuntimeEvent({ bindings, event });

    const rows = await database
      .prepare(
        "SELECT name, object_key FROM file_record WHERE session_kind = 'artifact' ORDER BY name",
      )
      .all<{ name: string; object_key: string }>();
    expect(rows.results.map(({ name }) => name)).toEqual(["result.txt"]);
    expect(await (await bucket.get(rows.results[0]?.object_key ?? ""))?.text()).toBe("R1 result");
  });
});
