import { describe, expect, spyOn, test } from "bun:test";

import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AgentDeploymentVersionId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { API_COMMAND_QUEUE_SEND_FAILED_CODE } from "../src/modules/api-command/application/api-command-ledger";
import { getAccountViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { queueSessionRun } from "../src/modules/runtime/application/session-run.service";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import { persistSessionRuntimeEvents } from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { API_ERROR_CODE } from "../src/platform/errors";
import { systemClock } from "../src/time";
import {
  PUBLIC_API_TEST_IDS,
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { ApiCommandQueueStub, SqliteD1Database } from "./helpers/public-api-http-test-fixture";

interface AdmissionCounts {
  apiCommand: number;
  event: number;
  message: number;
  run: number;
}

interface SessionAdmissionState {
  lastMessageAt: number | null;
  lastRunId: string | null;
  messageSeqCursor: number;
  runtimeEventSeqCursor: number;
  status: string;
}

const FAILURE_POINTS = [
  {
    label: "Run insert",
    pattern: /\bINSERT\s+INTO\s+(?:"session_run"|session_run)(?:\s|\()/iu,
  },
  {
    label: "Session state update",
    pattern: /\bUPDATE\s+"session"\s+SET\b/iu,
  },
  {
    label: "user message insert",
    pattern: /\bINSERT\s+INTO\s+"session_message"/iu,
  },
  {
    label: "runtime event insert",
    pattern: /\bINSERT\s+INTO\s+"session_event"/iu,
  },
  {
    label: "dispatch command insert",
    pattern: /\bINSERT\s+INTO\s+"api_command"/iu,
  },
] as const;

function failFirstMatchingStatement(database: D1Database, pattern: RegExp): D1Database {
  let failed = false;

  function wrapStatement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrapStatement(target.bind(...values), query);
        }

        if (!failed && pattern.test(query) && property === "run") {
          return async () => {
            failed = true;
            throw new Error(`Injected D1 admission failure for: ${query}`);
          };
        }

        return Reflect.get(target, property, receiver);
      },
    });
  }

  return {
    batch: database.batch.bind(database),
    prepare: (query) => wrapStatement(database.prepare(query), query),
  } as D1Database;
}

function serializeD1Batches(database: D1Database): D1Database {
  let previousBatch = Promise.resolve();

  return {
    batch: <T = unknown>(statements: D1PreparedStatement[]) => {
      const batch = previousBatch.then(() => database.batch<T>(statements));
      previousBatch = batch.then(
        () => undefined,
        () => undefined,
      );
      return batch;
    },
    prepare: database.prepare.bind(database),
  } as D1Database;
}

async function readAdmissionCounts(database: SqliteD1Database): Promise<AdmissionCounts> {
  const [run, message, event, apiCommand] = await Promise.all(
    ["session_run", "session_message", "session_event", "api_command"].map((table) =>
      database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>(),
    ),
  );

  if (run === null || message === null || event === null || apiCommand === null) {
    throw new Error("Admission count query did not return a row.");
  }

  return {
    apiCommand: apiCommand.count,
    event: event.count,
    message: message.count,
    run: run.count,
  };
}

async function readSessionState(database: SqliteD1Database): Promise<SessionAdmissionState> {
  const state = await database
    .prepare(
      `SELECT
        last_message_at AS lastMessageAt,
        last_run_id AS lastRunId,
        message_seq_cursor AS messageSeqCursor,
        runtime_event_seq_cursor AS runtimeEventSeqCursor,
        status
      FROM session
      WHERE id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .first<SessionAdmissionState>();

  if (state === null) {
    throw new Error("Owner Session is missing.");
  }

  return state;
}

function queueOwnerRun(input: {
  bindings: ApiBindings;
  clientRequestId?: string;
  withoutPreset?: boolean;
  viewer: AuthenticatedViewer;
}) {
  return queueSessionRun({
    bindings: input.bindings,
    executionContext: null,
    input: {
      accessViewer: input.viewer,
      attachmentIds: [],
      clientRequestId: input.clientRequestId ?? "issue-329-request",
      prompt: "Admit this request atomically.",
      session: {
        agent_id: input.withoutPreset ? null : PUBLIC_API_TEST_IDS.agent,
        project_id: PUBLIC_API_TEST_IDS.project,
        deployment_version_id: input.withoutPreset
          ? null
          : parsePlatformId<AgentDeploymentVersionId>(
              PUBLIC_API_TEST_IDS.deployment,
              "fixture deployment version",
            ),
        deployment_version_number: input.withoutPreset ? null : 1,
        id: parsePlatformId<SessionId>(PUBLIC_API_TEST_IDS.ownerSession, "fixture session"),
        model: "gpt-5.4",
        provider: "openai",
        runtime_id: "openai-runtime",
      },
    },
    requestUrl: "https://api.example.com/api/graphql",
    viewer: input.viewer,
  });
}

async function createFixture() {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  const viewer = await getAccountViewer(database, PUBLIC_API_TEST_IDS.ownerAccount);

  if (viewer === null) {
    throw new Error("Owner test viewer is missing.");
  }

  return { database, viewer };
}

async function completeRun(
  database: D1Database,
  runId: SessionRunId,
  checkpointReady = true,
): Promise<void> {
  for (const status of ["booting", "running", "completed"] as const) {
    const outcome = await setSessionRunStatus(database, {
      runId,
      source: "driver",
      status,
    });
    expect(outcome.kind).toBe("applied");
  }
  if (!checkpointReady) return;

  // These admission tests start after execution. Seed the completed workspace
  // and output receipt as well as the Run; a terminal status alone is incomplete.
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO sandbox
      (id, kind, subject_kind, subject_id, status, bind_mount_ready,
       global_mounts_json, created_at, updated_at)
      VALUES ('${PUBLIC_API_TEST_IDS.sandbox}', 'cattle', 'session',
        '${PUBLIC_API_TEST_IDS.ownerSession}', 'active', 1, '[]', 1, 1)`),
    database.prepare(`INSERT OR IGNORE INTO sandbox_session
      (cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
       session_id, status, updated_at)
      VALUES ('01J0000000000000000000000Z', 1,
        '/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}', '{}',
        '${PUBLIC_API_TEST_IDS.sandbox}', '${PUBLIC_API_TEST_IDS.ownerSession}', 'active', 1)`),
    database
      .prepare(`INSERT INTO sandbox_backup
      (created_at, dir, id, keep, sandbox_id, session_run_id, status, ttl_seconds, updated_at)
      VALUES (1, '/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}', ?, 0,
        '${PUBLIC_API_TEST_IDS.sandbox}', ?, 'ready', 315360000, 1)`)
      .bind(createPlatformId(), runId),
  ]);
  await persistSessionRuntimeEvents(database, {
    records: [
      {
        event: createRuntimeEvent({
          id: createPlatformId<RuntimeEventId>(),
          kind: "run.completed",
          occurredAt: new Date().toISOString(),
          payload: { stopReason: "end_turn" },
          runId,
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        }),
        occurredAt: null,
        sourceEventId: null,
      },
    ],
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
}

describe("Session Run atomic admission", () => {
  test("admits and deduplicates a Project-owned Session with no Agent preset", async () => {
    const { database, viewer } = await createFixture();
    await database
      .prepare(
        "UPDATE session SET agent_id = NULL, deployment_version_id = NULL, deployment_version_number = NULL, kind = 'cattle' WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.binding.agentId', NULL, '$.binding.deploymentVersionId', NULL, '$.binding.deploymentVersionNumber', NULL, '$.binding.kind', 'cattle', '$.configJson', '{}') WHERE session_id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database.prepare("DELETE FROM agent").run();
    const apiCommandQueue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;
    await queueOwnerRun({ bindings, viewer, withoutPreset: true });
    const firstCounts = await readAdmissionCounts(database);
    expect(firstCounts).toMatchObject({ apiCommand: 1, message: 1, run: 1 });
    expect(await database.prepare("SELECT agent_id FROM session_run").first()).toEqual({
      agent_id: null,
    });
    expect(await database.prepare("SELECT agent_id FROM session_event LIMIT 1").first()).toEqual({
      agent_id: null,
    });
    expect((await readSessionState(database)).status).toBe("RUNNING");
    await expect(queueOwnerRun({ bindings, viewer, withoutPreset: true })).rejects.toThrow();
    expect(await readAdmissionCounts(database)).toEqual(firstCounts);
  });

  test("rechecks Preview expiry inside the native admission batch without enqueuing work", async () => {
    const { database, viewer } = await createFixture();
    const now = Date.now();
    await database
      .prepare(
        "UPDATE session SET type = 'preview', created_at = ?, last_message_at = NULL WHERE id = ?",
      )
      .bind(now, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.previewRetentionMs', ?) WHERE session_id = ?",
      )
      .bind(30 * 86_400_000, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    let changed = false;
    const interleaved = {
      prepare: database.prepare.bind(database),
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        if (!changed) {
          changed = true;
          await database
            .prepare("UPDATE session SET created_at = ? WHERE id = ?")
            .bind(now - 30 * 86_400_000 - 1, PUBLIC_API_TEST_IDS.ownerSession)
            .run();
        }
        return database.batch<T>(statements);
      },
    } as D1Database;
    await expect(
      queueOwnerRun({
        bindings: createPublicHttpTestBindings(interleaved) as ApiBindings,
        viewer,
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.sessionPreviewExpired });
    expect(changed).toBe(true);
    expect(await readAdmissionCounts(database)).toEqual({
      apiCommand: 0,
      event: 0,
      message: 0,
      run: 0,
    });
  });

  test("successful continuation renews recovery while a later failed turn does not", async () => {
    const { database, viewer } = await createFixture();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: createApiCommandQueueStub(),
    }) as ApiBindings;
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.recoveryRetentionMs', ?) WHERE session_id = ?",
      )
      .bind(30 * 24 * 60 * 60 * 1000, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const start = Date.now();
    const clock = spyOn(systemClock, "nowMs");
    try {
      clock.mockReturnValue(start);
      const first = await queueOwnerRun({ bindings, clientRequestId: "day-0", viewer });
      await completeRun(database, first.run.id);
      clock.mockReturnValue(start + 29 * 24 * 60 * 60 * 1000);
      const renewed = await queueOwnerRun({ bindings, clientRequestId: "day-29", viewer });
      await completeRun(database, renewed.run.id);
      clock.mockReturnValue(start + 31 * 24 * 60 * 60 * 1000);
      const later = await queueOwnerRun({ bindings, clientRequestId: "day-31", viewer });
      expect(later.run.status).toBe("queued");
      await setSessionRunStatus(database, {
        runId: later.run.id,
        source: "driver",
        status: "failed",
      });
      clock.mockReturnValue(start + 60 * 24 * 60 * 60 * 1000);
      await expect(
        queueOwnerRun({ bindings, clientRequestId: "day-60", viewer }),
      ).rejects.toMatchObject({ code: "SESSION_RECOVERY_EXPIRED" });
    } finally {
      clock.mockRestore();
    }
  });

  test("does not retroactively expire existing Sessions without an admitted retention policy", async () => {
    const { database, viewer } = await createFixture();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: createApiCommandQueueStub(),
    }) as ApiBindings;
    const first = await queueOwnerRun({ bindings, clientRequestId: "legacy-original", viewer });
    await completeRun(database, first.run.id);
    const clock = spyOn(systemClock, "nowMs");
    try {
      clock.mockReturnValue(Date.now() + 90 * 24 * 60 * 60 * 1000);
      expect(
        (await queueOwnerRun({ bindings, clientRequestId: "legacy-90-days", viewer })).run.status,
      ).toBe("queued");
    } finally {
      clock.mockRestore();
    }
  });

  test("rejects expired continuation without admitting another message or changing history", async () => {
    const { database, viewer } = await createFixture();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: createApiCommandQueueStub(),
    }) as ApiBindings;
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.recoveryRetentionMs', ?) WHERE session_id = ?",
      )
      .bind(30 * 24 * 60 * 60 * 1000, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const first = await queueOwnerRun({ bindings, clientRequestId: "retained-first", viewer });
    await completeRun(database, first.run.id);
    const completed = await database
      .prepare("SELECT completed_at FROM session_run WHERE id = ?")
      .bind(first.run.id)
      .first<number>("completed_at");
    if (completed === null) throw new Error("Completed turn is missing its timestamp.");
    const before = await readAdmissionCounts(database);
    const clock = spyOn(systemClock, "nowMs");
    try {
      clock.mockReturnValue(completed + 30 * 24 * 60 * 60 * 1000);
      await expect(
        queueOwnerRun({ bindings, clientRequestId: "after-expiry", viewer }),
      ).rejects.toMatchObject({ code: "SESSION_RECOVERY_EXPIRED", status: 409 });
      expect(await readAdmissionCounts(database)).toEqual(before);
      expect((await readSessionState(database)).lastRunId).toBe(first.run.id);
    } finally {
      clock.mockRestore();
    }
  });

  test.each(["pet", "cattle"])(
    "blocks follow-up until a %s-labeled Session has its committed checkpoint and completion history",
    async (legacyKind) => {
      const { database, viewer } = await createFixture();
      const apiCommandQueue = createApiCommandQueueStub();
      const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;
      await database
        .prepare("UPDATE session SET kind = ? WHERE id = ?")
        .bind(legacyKind, PUBLIC_API_TEST_IDS.ownerSession)
        .run();
      const first = await queueOwnerRun({
        bindings,
        clientRequestId: "checkpoint-run-a",
        viewer,
      });
      await completeRun(database, first.run.id, false);

      await expect(
        database
          .prepare("SELECT workspace_checkpoint_required FROM session WHERE id = ?")
          .bind(PUBLIC_API_TEST_IDS.ownerSession)
          .first<number>("workspace_checkpoint_required"),
      ).resolves.toBe(1);

      await expect(
        queueOwnerRun({ bindings, clientRequestId: "checkpoint-run-b", viewer }),
      ).rejects.toMatchObject({
        code: API_ERROR_CODE.sessionRunCheckpointPending,
        message: expect.stringContaining("still saving its previous turn"),
        status: 409,
      });

      database.execute(`
      INSERT INTO sandbox (
        id, kind, subject_kind, subject_id, status, bind_mount_ready,
        global_mounts_json, created_at, updated_at
      )
      VALUES (
        '${PUBLIC_API_TEST_IDS.sandbox}', 'cattle', 'session', '${PUBLIC_API_TEST_IDS.ownerSession}',
        'active', 1, '[]', 1, 1
      );

      INSERT INTO sandbox_session (
        cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
        session_id, status, updated_at
      )
      VALUES (
        '01J0000000000000000000000Z', 1, '/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}', '{}',
        '${PUBLIC_API_TEST_IDS.sandbox}', '${PUBLIC_API_TEST_IDS.ownerSession}', 'active', 1
      );

      INSERT INTO sandbox_backup (
        created_at, dir, id, keep, sandbox_id, session_run_id, status, ttl_seconds, updated_at
      )
      VALUES (
        1, '/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}', '${PUBLIC_API_TEST_IDS.operation}',
        0, '${PUBLIC_API_TEST_IDS.sandbox}', '${first.run.id}', 'ready', 315360000, 1
      );
    `);

      await expect(
        queueOwnerRun({ bindings, clientRequestId: "checkpoint-run-b", viewer }),
      ).rejects.toMatchObject({ code: API_ERROR_CODE.sessionRunCheckpointPending, status: 409 });
      await persistSessionRuntimeEvents(database, {
        records: [
          {
            event: createRuntimeEvent({
              id: createPlatformId<RuntimeEventId>(),
              kind: "run.completed",
              occurredAt: new Date().toISOString(),
              payload: { stopReason: "end_turn" },
              runId: first.run.id,
              sessionId: PUBLIC_API_TEST_IDS.ownerSession,
            }),
            occurredAt: null,
            sourceEventId: null,
          },
        ],
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      });
      const second = await queueOwnerRun({
        bindings,
        clientRequestId: "checkpoint-run-b",
        viewer,
      });
      expect(second.run.status).toBe("queued");
    },
  );

  test("grandfathers a completed cattle Run from before the checkpoint rollout", async () => {
    const { database, viewer } = await createFixture();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: createApiCommandQueueStub(),
    }) as ApiBindings;
    await database
      .prepare("UPDATE session SET kind = 'cattle' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const first = await queueOwnerRun({
      bindings,
      clientRequestId: "legacy-checkpoint-run-a",
      viewer,
    });
    await database
      .prepare("UPDATE session_run SET status = 'completed' WHERE id = ?")
      .bind(first.run.id)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    const second = await queueOwnerRun({
      bindings,
      clientRequestId: "legacy-checkpoint-run-b",
      viewer,
    });

    expect(second.run.status).toBe("queued");
    await expect(
      database
        .prepare("SELECT workspace_checkpoint_required FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first<number>("workspace_checkpoint_required"),
    ).resolves.toBe(0);
  });

  for (const failurePoint of FAILURE_POINTS) {
    test(`rolls back every durable admission record when the ${failurePoint.label} fails`, async () => {
      const { database, viewer } = await createFixture();
      const apiCommandQueue = createApiCommandQueueStub();
      const bindings = createPublicHttpTestBindings(
        failFirstMatchingStatement(database, failurePoint.pattern),
        { apiCommandQueue },
      ) as ApiBindings;

      await expect(queueOwnerRun({ bindings, viewer })).rejects.toThrow(
        "Injected D1 admission failure",
      );
      await expect(readAdmissionCounts(database)).resolves.toEqual({
        apiCommand: 0,
        event: 0,
        message: 0,
        run: 0,
      });
      await expect(readSessionState(database)).resolves.toEqual({
        lastMessageAt: null,
        lastRunId: null,
        messageSeqCursor: 0,
        runtimeEventSeqCursor: 0,
        status: "IDLE",
      });
      expect(apiCommandQueue.sent).toHaveLength(0);

      const retried = await queueOwnerRun({ bindings, viewer });

      expect(retried.run.status).toBe("queued");
      await expect(readAdmissionCounts(database)).resolves.toEqual({
        apiCommand: 1,
        event: 2,
        message: 1,
        run: 1,
      });
      await expect(readSessionState(database)).resolves.toMatchObject({
        lastRunId: retried.run.id,
        messageSeqCursor: 1,
        runtimeEventSeqCursor: 2,
        status: "RUNNING",
      });
      expect(apiCommandQueue.sent).toHaveLength(1);
    });
  }

  test("admits exactly one complete Run when two requests race for an idle Session", async () => {
    const { database, viewer } = await createFixture();
    const apiCommandQueue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(serializeD1Batches(database), {
      apiCommandQueue,
    }) as ApiBindings;

    const outcomes = await Promise.allSettled([
      queueOwnerRun({ bindings, clientRequestId: "issue-329-race-a", viewer }),
      queueOwnerRun({ bindings, clientRequestId: "issue-329-race-b", viewer }),
    ]);
    const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("already has an active run");
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
    await expect(readSessionState(database)).resolves.toMatchObject({
      messageSeqCursor: 1,
      runtimeEventSeqCursor: 2,
      status: "RUNNING",
    });
    expect(apiCommandQueue.sent).toHaveLength(1);
  });

  test("classifies a completed client request replay without creating a second Run", async () => {
    const { database, viewer } = await createFixture();
    const apiCommandQueue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;
    const first = await queueOwnerRun({ bindings, viewer });

    await database
      .prepare("UPDATE session_run SET status = 'completed' WHERE id = ?")
      .bind(first.run.id)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await expect(queueOwnerRun({ bindings, viewer })).rejects.toMatchObject({
      code: API_ERROR_CODE.sessionRunClientRequestDuplicate,
      status: 409,
    });
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
    await expect(readSessionState(database)).resolves.toMatchObject({
      lastRunId: first.run.id,
      messageSeqCursor: 1,
      runtimeEventSeqCursor: 2,
      status: "IDLE",
    });
    expect(apiCommandQueue.sent).toHaveLength(1);
  });

  test("retains a complete durable admission when Queue delivery fails", async () => {
    const { database, viewer } = await createFixture();
    const sent: ApiCommandQueueStub["sent"] = [];
    const apiCommandQueue: ApiCommandQueueStub = {
      sent,
      async send(body, options): Promise<void> {
        sent.push({
          body,
          contentType: options?.contentType ?? "json",
          delaySeconds: options?.delaySeconds ?? null,
          id: `ambiguous-${sent.length + 1}`,
        });
        throw new Error("Injected Queue producer failure.");
      },
    };
    const bindings = createPublicHttpTestBindings(database, { apiCommandQueue }) as ApiBindings;

    const result = await queueOwnerRun({ bindings, viewer });

    expect(result.run.status).toBe("queued");
    await expect(readAdmissionCounts(database)).resolves.toEqual({
      apiCommand: 1,
      event: 2,
      message: 1,
      run: 1,
    });
    await expect(
      database.prepare("SELECT last_error_code AS lastErrorCode, status FROM api_command").first(),
    ).resolves.toEqual({
      lastErrorCode: API_COMMAND_QUEUE_SEND_FAILED_CODE,
      status: "queued",
    });
    expect(sent).toHaveLength(1);
  });
});
