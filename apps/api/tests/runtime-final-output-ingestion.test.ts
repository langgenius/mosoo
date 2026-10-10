import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import type { DriverEventReceipt } from "@mosoo/agent-driver/orpc";
import { createPlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  RuntimeEventId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

import { readPublicThreadRunFinalOutput } from "../src/modules/public-api/public-thread-events";
import {
  reconcileTerminalSessionRuns,
  repairTerminalSessionRunProjections,
} from "../src/modules/runtime/application/session-runs/terminal-run-reconciliation.service";
import { DriverInstanceRpcEventIngestionController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller";
import { DriverInstanceRuntimeState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state";
import { recordDriverInstanceCompletion } from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import { isSessionTerminalCheckpointReadyForNextRun } from "../src/modules/runtime/infrastructure/session-runs/session-run-admission.repository";
import { getSessionRunSummary } from "../src/modules/runtime/infrastructure/session-runs/session-run-read.repository";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-write.repository";
import { createSessionRuntimeEvent } from "../src/modules/sessions/application/session-event-write.service";
import { loadSessionViewerState } from "../src/modules/sessions/application/session-live-state.service";
import { createSessionProcessEventsFromSessionEventRows } from "../src/modules/sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../src/modules/sessions/application/session-process-events.service";
import { persistSessionRuntimeEvents } from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const DRIVER_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const RUN_ID = PUBLIC_API_TEST_IDS.run as SessionRunId;
const SESSION_ID = PUBLIC_API_TEST_IDS.ownerSession as SessionId;
const TERMINAL_SOURCE_EVENT_ID = "canary:run-completed";
const CHECKPOINT = {
  formatVersion: 1,
  runId: RUN_ID,
  nativeRef: {
    kind: "openai_thread_id",
    runtimeId: "openai-runtime",
    value: "thread-durable-completion",
  },
} as const;
const CANARY_LINES = Array.from({ length: 160 }, (_, index) => {
  const lineNumber = String(index + 1).padStart(3, "0");
  return `${lineNumber}|中文长文本校验-Aa${index % 10}-表格字符|END${lineNumber}`;
});
const FINAL_TEXT_LINES = [
  "CANARY-FINAL-START：中文与 ASCII 最终回答必须逐字保留。",
  "",
  "| 校验项 | 结果 |",
  "| --- | --- |",
  "| 多字节 | ✅ 中文😀 |",
  "",
  "链接：https://example.com/final-output",
  "",
  "```text",
  "CANARY-CODE-START|中文😀|END",
  "```",
  ...CANARY_LINES,
  "CANARY-FINAL-END",
];
const FINAL_TEXT = FINAL_TEXT_LINES.join("\n");
const PROGRESS_TEXTS = [
  "进度 1：正在读取上游报告。",
  "进度 2：工具调用已经完成。",
  "进度 3：artifact 已创建。",
] as const;

let fetchSpy: { mockRestore(): void } | null = null;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

function createController(bindings: ApiBindings): DriverInstanceRpcEventIngestionController {
  const state = new DriverInstanceRuntimeState({ storage: {} as never });
  state.driverInstanceId = DRIVER_ID;
  state.hello = {} as never;

  return new DriverInstanceRpcEventIngestionController({ env: bindings, state } as never);
}

function runtimeEvent(input: {
  kind: RuntimeEventKind;
  payload: unknown;
  sourceEventId: string;
}): DriverEventEnvelope {
  const occurredAt = Date.now();
  const event = createRuntimeEvent({
    driverInstanceId: DRIVER_ID,
    id: createPlatformId<RuntimeEventId>(),
    kind: input.kind,
    occurredAt: new Date(occurredAt).toISOString(),
    payload:
      input.kind === "run.completed"
        ? { checkpoint: CHECKPOINT, ...(input.payload as Record<string, unknown>) }
        : input.payload,
    runId: RUN_ID,
    runtimeId: "openai-runtime",
    sessionId: SESSION_ID,
    sourceEventId: input.sourceEventId,
  });

  return {
    event,
    eventId: input.sourceEventId,
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

function usageEvent(sourceEventId: string, callId?: string): DriverEventEnvelope {
  return runtimeEvent({
    kind: "usage.updated",
    payload: {
      source: "session_update",
      inputTokens: 100,
      outputTokens: 20,
      usageContract: "openai_total_with_cached_breakdown",
      ...(callId === undefined ? {} : { callId }),
    },
    sourceEventId,
  });
}

function messageEvents(input: {
  messageId: SessionMessageId;
  sourcePrefix: string;
  text: string;
}): DriverEventEnvelope[] {
  return [
    runtimeEvent({
      kind: "message.started",
      payload: { messageId: input.messageId, role: "agent" },
      sourceEventId: `${input.sourcePrefix}:started`,
    }),
    runtimeEvent({
      kind: "message.delta",
      payload: { contentDelta: input.text, messageId: input.messageId, role: "agent" },
      sourceEventId: `${input.sourcePrefix}:delta`,
    }),
    runtimeEvent({
      kind: "message.completed",
      payload: { messageId: input.messageId, role: "agent" },
      sourceEventId: `${input.sourcePrefix}:completed`,
    }),
  ];
}

function finalMessageEvents(input: {
  messageId: SessionMessageId;
  sourcePrefix: string;
  text: string;
}): DriverEventEnvelope[] {
  return [
    runtimeEvent({
      kind: "message.added",
      payload: { content: input.text, messageId: input.messageId, role: "agent" },
      sourceEventId: `${input.sourcePrefix}:snapshot`,
    }),
    runtimeEvent({
      kind: "message.completed",
      payload: { messageId: input.messageId, role: "agent" },
      sourceEventId: `${input.sourcePrefix}:completed`,
    }),
  ];
}

function completionEvents(text = "Done."): DriverEventEnvelope[] {
  const finalMessageId = createPlatformId<SessionMessageId>();
  return [
    ...finalMessageEvents({
      messageId: finalMessageId,
      sourcePrefix: "completion:final",
      text,
    }),
    runtimeEvent({
      kind: "run.completed",
      payload: { finalMessageId, stopReason: "end_turn" },
      sourceEventId: TERMINAL_SOURCE_EVENT_ID,
    }),
  ];
}

function splitIntoBatches<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}

async function insertRuntimeFixture(database: SqliteD1Database): Promise<void> {
  await insertOwnerSession(database);
  database.execute(`
    INSERT INTO sandbox (
      id, kind, subject_kind, subject_id, project_id, owner_account_id, status, bind_mount_ready,
      global_mounts_json, created_at, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.sandbox}', 'pet', 'session', '${SESSION_ID}',
      '${PUBLIC_API_TEST_IDS.project}', '${PUBLIC_API_TEST_IDS.ownerAccount}', 'active', 1, '[]', 1, 1
    );

    INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      session_id, status, updated_at
    )
    VALUES (
      '01J0000000000000000000000Z', 1, '/workspace',
      '{"callerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","entrypoint":"api","executionOwnerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","type":"agent"}',
      '${PUBLIC_API_TEST_IDS.sandbox}', '${SESSION_ID}', 'active', 1
    );

    INSERT INTO driver_instance (
      id, boot_token_expires_at, boot_token_hash, connection_id, created_at,
      expires_at, heartbeat_count, protocol, protocol_version, runtime,
      sandbox_id, sandbox_session_id, status, updated_at
    )
    VALUES (
      '${DRIVER_ID}', 1, X'01', 'canary-connection', 1, 1, 0,
      'orpc-ws', 1, 'openai-runtime', '${PUBLIC_API_TEST_IDS.sandbox}',
      '${SESSION_ID}', 'ready', 1
    );

    INSERT INTO session_run (
      id, session_id, agent_id, created_by_account_id, deployment_version_id,
      deployment_version_number, driver_instance_id, trigger, status, provider,
      model, runtime_id, trace_id, started_at, created_at, updated_at
    )
    VALUES (
      '${RUN_ID}', '${SESSION_ID}', '${PUBLIC_API_TEST_IDS.agent}',
      '${PUBLIC_API_TEST_IDS.ownerAccount}', '${PUBLIC_API_TEST_IDS.deployment}',
      1, '${DRIVER_ID}', 'user_prompt', 'running', 'openai', 'gpt-5.4',
      'openai-runtime', 'trace-canary', 1, 1, 1
    );

    UPDATE session
    SET last_run_id = '${RUN_ID}', status = 'RUNNING'
    WHERE id = '${SESSION_ID}';
  `);
}

async function createCheckpointCompletionFixture(
  createBackup: SandboxHandle["createBackup"] = async ({ dir }) => ({
    dir,
    id: crypto.randomUUID(),
  }),
) {
  const database = await createPublicHttpContractDatabase({ maxBoundParams: 100 });
  await insertRuntimeFixture(database);
  database.execute(`
    UPDATE session SET kind = 'cattle', last_message_at = 1 WHERE id = '${SESSION_ID}';
    UPDATE sandbox SET kind = 'cattle', subject_kind = 'session', subject_id = '${SESSION_ID}';
    UPDATE sandbox_session SET cwd = '/workspace/se/${SESSION_ID}';
    INSERT INTO native_resume_ref (
      created_at, kind, observed_driver_instance_id, observed_session_run_id,
      runtime_id, session_id, updated_at, value
    ) VALUES (
      1, 'openai_thread_id', '${DRIVER_ID}', '${RUN_ID}',
      'openai-runtime', '${SESSION_ID}', 1, 'thread-durable-completion'
    );
  `);
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected sandbox operation during completion.");
  };
  const sandbox: SandboxHandle = {
    configureNetworkConstraints: unavailable,
    createBackup,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: unavailable,
    exec: async () => {
      const nativeRef = await database
        .prepare("SELECT value FROM native_resume_ref")
        .first<{ value: string }>();
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          ...CHECKPOINT,
          nativeRef: {
            ...CHECKPOINT.nativeRef,
            value: nativeRef?.value ?? CHECKPOINT.nativeRef.value,
          },
          files: [{ path: "thread.json", size: 2, sha256: "a".repeat(64) }],
        }),
        success: true,
      };
    },
    getSession: unavailable,
    mkdir: unavailable,
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: unavailable,
    ensureContainerReady: unavailable,
    startProcess: unavailable,
    unmountBucket: async () => {},
    writeFile: unavailable,
  };
  const deletedBackupKeys: string[] = [];
  const baseBindings = createPublicHttpTestBindings(database);
  const bindings: ApiBindings = {
    ...baseBindings,
    SANDBOX_STATE_BUCKET: new Proxy(baseBindings.SANDBOX_STATE_BUCKET, {
      get(target, property) {
        if (property === "delete") {
          return async (keys: string | string[]) => {
            deletedBackupKeys.push(...(typeof keys === "string" ? [keys] : keys));
          };
        }
        return Reflect.get(target, property);
      },
    }),
    runtimeSubjectHandleFactory: () => sandbox,
  };
  return { bindings, database, deletedBackupKeys };
}

function failTerminalSessionEventInsert(database: D1Database): D1Database {
  function wrapStatement(
    statement: D1PreparedStatement,
    isSessionEventInsert: boolean,
    shouldFail: boolean,
  ): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(
              target.bind(...values),
              isSessionEventInsert,
              isSessionEventInsert && values.includes(TERMINAL_SOURCE_EVENT_ID),
            );
        }

        const value = Reflect.get(target, property);

        if (
          typeof value === "function" &&
          (property === "all" || property === "first" || property === "raw" || property === "run")
        ) {
          return (...arguments_: unknown[]) => {
            if (shouldFail) {
              throw new Error("injected terminal session_event persistence failure");
            }

            return Reflect.apply(value, target, arguments_);
          };
        }

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) =>
          wrapStatement(
            target.prepare(query),
            /insert\s+into\s+["`]session_event["`]/iu.test(query),
            false,
          );
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const activeContext = {
  assertActiveConnection: () => undefined,
  connectionId: "canary-connection",
} as never;

async function pushFreshController(
  bindings: ApiBindings,
  events: DriverEventEnvelope[],
): Promise<DriverEventReceipt[]> {
  const result = await createController(bindings).handlePushEvents(
    { driverInstanceId: DRIVER_ID, events },
    activeContext,
  );
  return result.accepted;
}

describe("runtime final output ingestion", () => {
  test.each([
    undefined,
    { ...CHECKPOINT, formatVersion: 2 },
    { ...CHECKPOINT, runId: PUBLIC_API_TEST_IDS.runAlt },
    {
      ...CHECKPOINT,
      nativeRef: {
        kind: "claude_session_id",
        runtimeId: "claude-agent-sdk",
        value: "wrong-runtime",
      },
    },
  ])("rejects missing or mismatched checkpoint identity before success", async (checkpoint) => {
    let backupCalls = 0;
    const { bindings, database } = await createCheckpointCompletionFixture(async ({ dir }) => {
      backupCalls += 1;
      return { dir, id: crypto.randomUUID() };
    });
    const finalMessageId = createPlatformId<SessionMessageId>();
    await expect(
      pushFreshController(bindings, [
        ...finalMessageEvents({
          messageId: finalMessageId,
          sourcePrefix: "invalid-checkpoint:final",
          text: "Done.",
        }),
        runtimeEvent({
          kind: "run.completed",
          payload: { checkpoint, finalMessageId, stopReason: "end_turn" },
          sourceEventId: TERMINAL_SOURCE_EVENT_ID,
        }),
      ]),
    ).rejects.toThrow();
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'run.completed'")
        .first(),
    ).toEqual({ count: 0 });
    expect(backupCalls).toBe(0);
  });

  test("returns the original terminal receipt without rereading the live checkpoint bundle", async () => {
    let backupCalls = 0;
    const { bindings, database } = await createCheckpointCompletionFixture(async ({ dir }) => {
      backupCalls += 1;
      return { dir, id: crypto.randomUUID() };
    });
    const events = completionEvents();
    const accepted = await pushFreshController(bindings, events);
    const unavailableBindings = {
      ...bindings,
      runtimeSubjectHandleFactory: () => {
        throw new Error("The live bundle has been removed.");
      },
    } as ApiBindings;
    expect(await pushFreshController(unavailableBindings, events)).toEqual(accepted);
    expect(backupCalls).toBe(1);
    const changedDescriptor = [
      {
        ...events.at(-1)!,
        event: {
          ...events.at(-1)!.event,
          payload: {
            ...(events.at(-1)!.event.payload as Record<string, unknown>),
            checkpoint: { ...CHECKPOINT, nativeRef: { ...CHECKPOINT.nativeRef, value: "changed" } },
          },
        },
      },
    ];
    await expect(pushFreshController(unavailableBindings, changedDescriptor)).rejects.toMatchObject(
      { code: "terminal_conflict" },
    );
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("completed");
  });

  test("finalizes usage received before the terminal event in a separate batch", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    await pushFreshController(bindings, [usageEvent("usage:before-completion")]);
    expect(await database.prepare("SELECT status FROM session_model_call").first()).toEqual({
      status: "started",
    });

    await pushFreshController(bindings, completionEvents());
    const run = await getSessionRunSummary(database, RUN_ID);
    expect(run?.status).toBe("completed");
    expect(
      await database
        .prepare("SELECT status, completed_at, input_tokens, output_tokens FROM session_model_call")
        .first(),
    ).toEqual({
      status: "completed",
      completed_at: Date.parse(run?.completedAt ?? ""),
      input_tokens: 100,
      output_tokens: 20,
    });
  });

  test("acknowledges a replay mixing new and durable events in submission order", async () => {
    const { bindings } = await createCheckpointCompletionFixture();
    const durableEvents = messageEvents({
      messageId: createPlatformId<SessionMessageId>(),
      sourcePrefix: "replay:durable",
      text: "Already persisted.",
    });
    await pushFreshController(bindings, durableEvents);
    const replay = [usageEvent("replay:new"), ...durableEvents];

    const accepted = await pushFreshController(bindings, replay);

    expect(accepted.map((receipt) => [receipt.eventId, receipt.type])).toEqual(
      replay.map((envelope) => [envelope.eventId, envelope.event.kind]),
    );
  });

  test("replays equivalent Unicode metadata regardless of key insertion order", async () => {
    const { bindings } = await createCheckpointCompletionFixture();
    const envelope = runtimeEvent({
      kind: "message.added",
      payload: {
        content: "Unicode metadata replay.",
        messageId: createPlatformId<SessionMessageId>(),
        role: "agent",
        metadata: { é: "composed", "e\u0301": "decomposed" },
      },
      sourceEventId: "unicode:metadata",
    });
    const accepted = await pushFreshController(bindings, [envelope]);
    const replay = {
      ...envelope,
      event: {
        ...envelope.event,
        payload: {
          ...(envelope.event.payload as Record<string, unknown>),
          metadata: { "e\u0301": "decomposed", é: "composed" },
        },
      },
    };
    expect(await pushFreshController(bindings, [replay])).toEqual(accepted);
  });

  test("late usage follows the persisted terminal outcome and does not duplicate the ledger", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    await pushFreshController(bindings, completionEvents());
    await pushFreshController(bindings, [usageEvent("usage:late")]);
    await pushFreshController(bindings, [usageEvent("usage:late-again")]);
    const run = await getSessionRunSummary(database, RUN_ID);
    expect(
      await database.prepare("SELECT status, completed_at FROM session_model_call").all(),
    ).toMatchObject({
      results: [{ status: "completed", completed_at: Date.parse(run?.completedAt ?? "") }],
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 1,
    });
  });

  test("replays a failed usage finalization before acknowledging completion", async () => {
    let backupCount = 0;
    const { bindings, database } = await createCheckpointCompletionFixture(async ({ dir }) => {
      backupCount += 1;
      return { dir, id: "550e8400-e29b-41d4-a716-446655440002" };
    });
    await pushFreshController(bindings, [usageEvent("usage:before-failed-finalization")]);
    database.execute(`CREATE TRIGGER reject_usage_finalization BEFORE UPDATE ON session_model_call
      WHEN NEW.status != 'started' BEGIN SELECT RAISE(ABORT, 'injected usage finalization failure'); END;`);
    const events = completionEvents();
    await expect(pushFreshController(bindings, events)).rejects.toThrow();
    expect(await database.prepare("SELECT status FROM session_run").first()).toEqual({
      status: "completed",
    });
    expect(await database.prepare("SELECT status FROM session_model_call").first()).toEqual({
      status: "started",
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'run.completed'")
        .first(),
    ).toEqual({ count: 1 });
    database.execute("DROP TRIGGER reject_usage_finalization");
    await pushFreshController(bindings, events);
    expect(await database.prepare("SELECT status FROM session_model_call").first()).toEqual({
      status: "completed",
    });
    expect(backupCount).toBe(1);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 1,
    });
  });

  test.each(["failed", "cancelled", "expired"] as const)(
    "terminal repair closes prior usage with the original %s Run outcome and time",
    async (status) => {
      const { bindings, database } = await createCheckpointCompletionFixture();
      await pushFreshController(bindings, [usageEvent("usage:before-repair", "first-call")]);
      await pushFreshController(bindings, [usageEvent("usage:before-repair-2", "second-call")]);
      database.execute(`UPDATE session_run SET status = '${status}', completed_at = 1800, updated_at = 1800;
        UPDATE session SET status = 'IDLE';`);
      const run = await getSessionRunSummary(database, RUN_ID);
      if (run === null) throw new Error("Fixture Run missing");
      await repairTerminalSessionRunProjections(bindings, {
        preserveSessionLifecycle: true,
        run,
        sessionId: SESSION_ID,
      });
      await repairTerminalSessionRunProjections(bindings, {
        preserveSessionLifecycle: true,
        run,
        sessionId: SESSION_ID,
      });
      expect(
        await database.prepare("SELECT status, completed_at FROM session_model_call").all(),
      ).toMatchObject({
        results: Array.from({ length: 2 }, () => ({
          status: "failed",
          completed_at: 1800,
        })),
      });
      expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
        count: 2,
      });
    },
  );

  test("rejects usage repair for a completed Run without its checkpoint receipt", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    await pushFreshController(bindings, [usageEvent("usage:unverified-completion")]);
    database.execute(
      "UPDATE session_run SET status = 'completed', completed_at = 1800, updated_at = 1800",
    );
    const run = await getSessionRunSummary(database, RUN_ID);
    if (run === null) throw new Error("Fixture Run missing");
    await expect(
      repairTerminalSessionRunProjections(bindings, {
        preserveSessionLifecycle: true,
        run,
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow("requires its committed checkpoint");
    expect(
      await database.prepare("SELECT status, completed_at FROM session_model_call").first(),
    ).toEqual({ status: "started", completed_at: null });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 1,
    });
  });

  test("maintenance repairs unfinished usage even when the terminal history already exists", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    await pushFreshController(bindings, [usageEvent("usage:old-version")]);
    await pushFreshController(bindings, completionEvents());
    const originalRun = await getSessionRunSummary(database, RUN_ID);
    database.execute(`UPDATE session_model_call SET status = 'started', completed_at = NULL;
      UPDATE driver_instance SET status = 'stopped';`);
    expect(await reconcileTerminalSessionRuns(bindings, { limit: 10 })).toEqual({
      reconciledRunIds: [RUN_ID],
      reconciledSessionIds: [SESSION_ID],
    });
    expect(
      await database.prepare("SELECT status, completed_at FROM session_model_call").first(),
    ).toEqual({
      status: "completed",
      completed_at: Date.parse(originalRun?.completedAt ?? ""),
    });
    expect(await getSessionRunSummary(database, RUN_ID)).toEqual(originalRun);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'run.completed'")
        .first(),
    ).toEqual({ count: 1 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 1,
    });
    expect(await reconcileTerminalSessionRuns(bindings, { limit: 10 })).toEqual({
      reconciledRunIds: [],
      reconciledSessionIds: [],
    });
  });

  test.each(["pet", "cattle"])(
    "keeps a %s-labeled Session's success and output unavailable until its checkpoint commits",
    async (legacyKind) => {
      const started = Promise.withResolvers<void>();
      const backup = Promise.withResolvers<{ dir: string; id: string }>();
      const { bindings, database } = await createCheckpointCompletionFixture(async () => {
        started.resolve();
        return backup.promise;
      });
      await database.batch([
        database.prepare("UPDATE session SET kind = ?").bind(legacyKind),
        database.prepare("UPDATE sandbox SET kind = ?").bind(legacyKind),
      ]);
      const completion = pushFreshController(bindings, [
        usageEvent("usage:co-batched"),
        ...completionEvents("The report is ready."),
      ]);

      await started.promise;
      try {
        expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
        expect(
          await database.prepare("SELECT status, completed_at FROM session_model_call").first(),
        ).toEqual({ status: "started", completed_at: null });
        await expect(
          readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
        ).resolves.toBeNull();
      } finally {
        backup.resolve({
          dir: `/workspace/se/${SESSION_ID}`,
          id: "550e8400-e29b-41d4-a716-446655440002",
        });
        await completion;
      }
      expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("completed");
      expect(await database.prepare("SELECT status FROM session_model_call").first()).toEqual({
        status: "completed",
      });
      expect(
        await readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
      ).toMatchObject({ text: "The report is ready." });
    },
  );

  test.each(["completion", "file update"] as const)(
    "keeps a delayed %s visible after an SSE cursor observes the other writer",
    async (delayedWriter) => {
      const paused = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const { bindings, database } = await createCheckpointCompletionFixture(async ({ dir }) => {
        if (delayedWriter === "completion") {
          paused.resolve();
          await resume.promise;
        }
        return { dir, id: crypto.randomUUID() };
      });
      const fileDatabase =
        delayedWriter === "file update"
          ? new Proxy(database, {
              get(target, property) {
                if (property === "batch") {
                  return async (statements: D1PreparedStatement[]) => {
                    paused.resolve();
                    await resume.promise;
                    return target.batch(statements);
                  };
                }
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
              },
            })
          : database;
      const fileSourceEventId = "concurrent:file-update";
      const fileEvent = createSessionRuntimeEvent({
        kind: "session.files.updated",
        origin: "file",
        payload: { change: { change: "delete", fileId: PUBLIC_API_TEST_IDS.file } },
        sessionId: SESSION_ID,
        sourceEventId: fileSourceEventId,
      });
      const writeFileEvent = () =>
        persistSessionRuntimeEvents(fileDatabase, {
          records: [
            {
              event: fileEvent,
              occurredAt: Date.parse(fileEvent.occurredAt),
              sourceEventId: fileSourceEventId,
            },
          ],
          sessionId: SESSION_ID,
        });
      const completeRun = () => pushFreshController(bindings, completionEvents());
      const readAfterCursor = async (cursor: number) => {
        const result = await database
          .prepare(`
          SELECT event_type, seq, source_event_id FROM session_event
          WHERE session_id = ? AND visibility = 'all_consumers' AND seq > ?
          ORDER BY seq ASC
        `)
          .bind(SESSION_ID, cursor)
          .all<{ event_type: string; seq: number; source_event_id: string }>();
        return result.results;
      };
      const delayed = delayedWriter === "completion" ? completeRun() : writeFileEvent();
      await paused.promise;
      let seenCursor = 0;
      try {
        await (delayedWriter === "completion" ? writeFileEvent() : completeRun());
        const visible = await readAfterCursor(0);
        const lastSeen = visible.at(-1);
        expect(lastSeen?.source_event_id).toBe(
          delayedWriter === "completion" ? fileSourceEventId : TERMINAL_SOURCE_EVENT_ID,
        );
        seenCursor = lastSeen!.seq;
      } finally {
        resume.resolve();
        await delayed;
      }

      const later = await readAfterCursor(seenCursor);
      expect(later.map((row) => row.source_event_id)).toEqual([
        delayedWriter === "completion" ? TERMINAL_SOURCE_EVENT_ID : fileSourceEventId,
      ]);
      expect(later[0]?.seq).toBeGreaterThan(seenCursor);
    },
  );

  test("archiving a Session during checkpoint creation prevents completion from committing", async () => {
    const paused = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const { bindings, database, deletedBackupKeys } = await createCheckpointCompletionFixture(
      async ({ dir }) => {
        paused.resolve();
        await resume.promise;
        return { dir, id: crypto.randomUUID() };
      },
    );
    const completion = pushFreshController(bindings, completionEvents());
    await paused.promise;
    try {
      await database
        .prepare("UPDATE session SET archived_at = ? WHERE id = ?")
        .bind(Date.now(), SESSION_ID)
        .run();
    } finally {
      resume.resolve();
      await expect(completion).rejects.toMatchObject({ code: "terminal_conflict" });
    }

    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'run.completed'")
        .first(),
    ).toEqual({ count: 0 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_message").first()).toEqual(
      { count: 0 },
    );
    expect(await database.prepare("SELECT COUNT(*) AS count FROM sandbox_backup").first()).toEqual({
      count: 0,
    });
    expect(
      await database
        .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
        .first(),
    ).toEqual({ committed_session_run_id: null, committed_value: null });
    expect(deletedBackupKeys).toHaveLength(2);
  });

  test("a cancellation during checkpoint creation cannot publish a successful result or resume cursor", async () => {
    const started = Promise.withResolvers<void>();
    const backup = Promise.withResolvers<{ dir: string; id: string }>();
    const { bindings, database, deletedBackupKeys } = await createCheckpointCompletionFixture(
      async () => {
        started.resolve();
        return backup.promise;
      },
    );
    const completion = pushFreshController(bindings, [
      usageEvent("usage:cancel-race"),
      ...completionEvents(FINAL_TEXT),
    ]);
    await started.promise;
    try {
      await setSessionRunStatus(database, { runId: RUN_ID, status: "cancelled" });
    } finally {
      backup.resolve({
        dir: `/workspace/se/${SESSION_ID}`,
        id: "550e8400-e29b-41d4-a716-446655440002",
      });
      await expect(completion).rejects.toMatchObject({ code: "terminal_conflict" });
    }
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("cancelled");
    expect(await database.prepare("SELECT status FROM session_model_call").first()).toEqual({
      status: "started",
    });
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare("SELECT id FROM sandbox_backup WHERE session_run_id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toBeNull();
    await expect(
      database
        .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
        .first(),
    ).resolves.toEqual({ committed_session_run_id: null, committed_value: null });
    expect(deletedBackupKeys).toEqual([
      "backups/550e8400-e29b-41d4-a716-446655440002/data.sqsh",
      "backups/550e8400-e29b-41d4-a716-446655440002/meta.json",
    ]);
  });

  test.each(["backup", "database"] as const)(
    "retries a %s failure without publishing partial completion or losing the previous cursor",
    async (failure) => {
      let failBackup = failure === "backup";
      const { bindings, database } = await createCheckpointCompletionFixture(async (options) => {
        if (failBackup) {
          throw new Error("backup service unavailable");
        }
        return { dir: options.dir, id: crypto.randomUUID() };
      });
      const priorRunId = createPlatformId<SessionRunId>();
      database.execute(`
        UPDATE native_resume_ref SET committed_session_run_id = '${priorRunId}', committed_value = 'thread-previous';
      `);
      if (failure === "database") {
        database.execute(`
          CREATE TRIGGER reject_completion BEFORE UPDATE OF committed_value ON native_resume_ref
          BEGIN SELECT RAISE(ABORT, 'injected native cursor commit failure'); END;
        `);
      }
      const events = completionEvents(FINAL_TEXT);
      await expect(pushFreshController(bindings, events)).rejects.toBeInstanceOf(Error);
      expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
      await expect(
        readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
      ).resolves.toBeNull();
      await expect(
        database
          .prepare("SELECT id FROM sandbox_backup WHERE session_run_id = ?")
          .bind(RUN_ID)
          .first(),
      ).resolves.toBeNull();
      await expect(
        database
          .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
          .first(),
      ).resolves.toEqual({
        committed_session_run_id: priorRunId,
        committed_value: "thread-previous",
      });

      failBackup = false;
      database.execute("DROP TRIGGER IF EXISTS reject_completion");
      await pushFreshController(bindings, events);
      expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("completed");
      await expect(
        readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
      ).resolves.toEqual({ text: FINAL_TEXT });
      await expect(
        database
          .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
          .first(),
      ).resolves.toEqual({
        committed_session_run_id: RUN_ID,
        committed_value: "thread-durable-completion",
      });
    },
  );

  test("rejects a cursor changed during backup and retries with a matching workspace snapshot", async () => {
    let changeCursor = true;
    const { bindings, database, deletedBackupKeys } = await createCheckpointCompletionFixture(
      async (options) => {
        if (changeCursor) {
          database.execute("UPDATE native_resume_ref SET value = 'thread-updated'");
        }
        return { dir: options.dir, id: crypto.randomUUID() };
      },
    );
    const events = completionEvents(FINAL_TEXT);
    await expect(pushFreshController(bindings, events)).rejects.toMatchObject({
      code: "terminal_conflict",
    });
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
    await expect(
      database
        .prepare("SELECT id FROM sandbox_backup WHERE session_run_id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toBeNull();
    await expect(
      database.prepare("SELECT committed_value FROM native_resume_ref").first(),
    ).resolves.toEqual({ committed_value: null });
    expect(deletedBackupKeys).toHaveLength(2);

    changeCursor = false;
    const retryEvents = [
      runtimeEvent({
        kind: "run.completed",
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
        payload: {
          ...(events.at(-1)!.event.payload as Record<string, unknown>),
          checkpoint: {
            ...CHECKPOINT,
            nativeRef: { ...CHECKPOINT.nativeRef, value: "thread-updated" },
          },
        },
      }),
    ];
    await pushFreshController(bindings, retryEvents);
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("completed");
    await expect(
      database.prepare("SELECT committed_value FROM native_resume_ref").first(),
    ).resolves.toEqual({ committed_value: "thread-updated" });
  });

  test("the terminal RPC requires a committed canonical completion", async () => {
    let backupCalls = 0;
    const { bindings, database } = await createCheckpointCompletionFixture(async ({ dir }) => {
      backupCalls += 1;
      return { dir, id: crypto.randomUUID() };
    });
    await expect(
      recordDriverInstanceCompletion(bindings, { driverInstanceId: DRIVER_ID, runId: RUN_ID }),
    ).rejects.toMatchObject({ code: "terminal_conflict" });
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
    expect(backupCalls).toBe(0);
    await pushFreshController(bindings, completionEvents());
    await recordDriverInstanceCompletion(bindings, { driverInstanceId: DRIVER_ID, runId: RUN_ID });
    expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("completed");
    expect(backupCalls).toBe(1);
  });

  test.each(["missing", "uncommitted previous turn", "different runtime"] as const)(
    "cannot complete with a %s native resume cursor",
    async (cursorState) => {
      let backupCalls = 0;
      const { bindings, database } = await createCheckpointCompletionFixture(async (options) => {
        backupCalls += 1;
        return { dir: options.dir, id: crypto.randomUUID() };
      });
      if (cursorState === "missing") {
        database.execute("DELETE FROM native_resume_ref");
      } else if (cursorState === "uncommitted previous turn") {
        database.execute("UPDATE native_resume_ref SET observed_session_run_id = NULL");
      } else {
        database.execute(
          "UPDATE native_resume_ref SET runtime_id = 'claude-agent-sdk', kind = 'claude_session_id'",
        );
      }
      await expect(pushFreshController(bindings, completionEvents())).rejects.toMatchObject({
        code: "terminal_conflict",
      });
      expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
      expect(backupCalls).toBe(0);
    },
  );

  test("commits a stable cursor re-observed by the current turn", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture(async (options) => ({
      dir: options.dir,
      id: crypto.randomUUID(),
    }));
    const previousRunId = createPlatformId<SessionRunId>();
    database.execute(
      `UPDATE native_resume_ref SET committed_session_run_id = '${previousRunId}', committed_value = value`,
    );
    await pushFreshController(bindings, completionEvents());
    await expect(
      database
        .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
        .first(),
    ).resolves.toEqual({
      committed_session_run_id: RUN_ID,
      committed_value: "thread-durable-completion",
    });
  });

  test.each(["assistant", "terminal event"] as const)(
    "rolls back completion after %s persistence fails and retries the checkpoint",
    async (failure) => {
      let backupCalls = 0;
      const { bindings, database } = await createCheckpointCompletionFixture(async (options) => {
        backupCalls += 1;
        return { dir: options.dir, id: crypto.randomUUID() };
      });
      database.execute(
        failure === "assistant"
          ? `
        CREATE TRIGGER reject_final_output BEFORE INSERT ON session_message WHEN NEW.role = 'assistant'
        BEGIN SELECT RAISE(ABORT, 'injected assistant persistence failure'); END;
      `
          : `
        CREATE TRIGGER reject_final_output BEFORE INSERT ON session_event WHEN NEW.event_type = 'run.completed'
        BEGIN SELECT RAISE(ABORT, 'injected terminal history persistence failure'); END;
      `,
      );
      const events = completionEvents(FINAL_TEXT);
      await expect(pushFreshController(bindings, events)).rejects.toBeInstanceOf(Error);
      await expect(
        recordDriverInstanceCompletion(bindings, { driverInstanceId: DRIVER_ID, runId: RUN_ID }),
      ).rejects.toMatchObject({ code: "terminal_conflict" });
      expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
      expect(
        await database
          .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
          .first(),
      ).toEqual({ committed_session_run_id: null, committed_value: null });
      expect(
        await database.prepare("SELECT COUNT(*) AS count FROM sandbox_backup").first(),
      ).toEqual({ count: 0 });
      expect(
        await database.prepare("SELECT COUNT(*) AS count FROM session_message").first(),
      ).toEqual({ count: 0 });
      database.execute("DROP TRIGGER reject_final_output");
      await pushFreshController(bindings, events);
      await expect(isSessionTerminalCheckpointReadyForNextRun(database, SESSION_ID)).resolves.toBe(
        true,
      );
      await expect(
        readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
      ).resolves.toEqual({ text: FINAL_TEXT });
      expect(backupCalls).toBe(2);
    },
  );

  test.each([
    ["omits", false],
    ["provides", true],
  ] as const)(
    "requires a durable final snapshot when the driver %s it",
    async (_driverBehavior, driverProvidesSnapshot) => {
      const { bindings: fixtureBindings, database } = await createCheckpointCompletionFixture();
      const capturedEvents: unknown[] = [];
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        capturedEvents.push(JSON.parse(init?.body as string) as unknown);
        return new Response(null, { status: 200 });
      });
      const bindings = {
        ...fixtureBindings,
        POSTHOG_API_HOST: "https://us.i.posthog.com",
        POSTHOG_PROJECT_KEY: "phc_test",
      } as ApiBindings;
      const finalText = "The final answer.";
      const fragmentTexts = ["The ", "final ", "answer."];
      const finalMessageId = createPlatformId<SessionMessageId>();
      const events = [
        ...fragmentTexts.flatMap((text, index) =>
          messageEvents({
            messageId: createPlatformId<SessionMessageId>(),
            sourcePrefix: `fractured:${index + 1}`,
            text,
          }),
        ),
        ...(driverProvidesSnapshot
          ? finalMessageEvents({
              messageId: finalMessageId,
              sourcePrefix: "fractured:final",
              text: finalText,
            })
          : []),
        runtimeEvent({
          kind: "run.completed",
          payload: {
            finalMessageId,
            stopReason: "end_turn",
          },
          sourceEventId: "fractured:run-completed",
        }),
      ];

      if (!driverProvidesSnapshot) {
        await expect(pushFreshController(bindings, events)).rejects.toMatchObject({
          code: "terminal_conflict",
        });
        expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
        expect(
          await database.prepare("SELECT COUNT(*) AS count FROM session_message").first(),
        ).toEqual({ count: 0 });
        expect(capturedEvents).toEqual([]);
        return;
      }
      await pushFreshController(bindings, events);

      const rows = await database
        .prepare(
          `SELECT content_text, ended_at, event_type, id, occurred_at, process_status,
                process_type, run_id, seq, tokens
         FROM session_event
         WHERE session_id = ? AND run_id = ?
         ORDER BY seq`,
        )
        .bind(SESSION_ID, RUN_ID)
        .all<SessionEventProcessRow>();
      const assistantMessages = createSessionProcessEventsFromSessionEventRows(rows.results).filter(
        (event) => event.type === "agent.message.delta",
      );

      expect(
        rows.results
          .filter((row) => row.event_type === "message.added")
          .map((row) => row.content_text),
      ).toEqual([finalText]);
      expect(assistantMessages.map((event) => event.content)).toEqual([finalText]);
      expect(capturedEvents).toEqual([
        expect.objectContaining({
          event: "task_succeeded",
          properties: expect.objectContaining({
            run_duration_ms: expect.any(Number),
            sandbox_id: PUBLIC_API_TEST_IDS.sandbox,
            sandbox_subject_kind: "session",
            session_type: "ui",
          }),
        }),
      ]);
    },
  );

  test("replaces a streamed draft with the latest chunked final snapshot", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(
      bindings,
      messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "snapshot-replacement:stream",
        text: "An earlier complete draft.",
      }),
    );
    const chunks = ["The final ", "answer differs."];
    const finalText = chunks.join("");
    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "message.added",
        payload: { content: chunks[0], messageId: finalMessageId, role: "agent" },
        sourceEventId: "snapshot-replacement:added",
      }),
      runtimeEvent({
        kind: "message.delta",
        payload: { contentDelta: chunks[1], messageId: finalMessageId, role: "agent" },
        sourceEventId: "snapshot-replacement:delta",
      }),
      runtimeEvent({
        kind: "message.completed",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "snapshot-replacement:completed",
      }),
    ]);
    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ]);

    expect(
      await database
        .prepare("SELECT content_text FROM session_message WHERE id = ?")
        .bind(finalMessageId)
        .first(),
    ).toEqual({ content_text: finalText });
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: finalText });
    const transcript = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect(
      transcript.messages
        .filter((message) => message.id === finalMessageId)
        .map(({ content, segments }) => ({ content, segments })),
    ).toEqual([{ content: finalText, segments: [{ kind: "text", text: finalText }] }]);
  });

  test("preserves a long final snapshot across hibernation, terminal failure, and replay", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    const progressMessageIds = PROGRESS_TEXTS.map(() => createPlatformId<SessionMessageId>());
    const finalMessageId = createPlatformId<SessionMessageId>();
    const progressEvents = [
      runtimeEvent({
        kind: "run.started",
        payload: { startedAt: new Date(1).toISOString() },
        sourceEventId: "canary:run-started",
      }),
      ...PROGRESS_TEXTS.flatMap((text, index) =>
        messageEvents({
          messageId: progressMessageIds[index],
          sourcePrefix: `canary:progress:${index + 1}`,
          text,
        }),
      ),
    ];

    expect(await pushFreshController(bindings, progressEvents)).toHaveLength(progressEvents.length);

    const toolEvents = [
      runtimeEvent({
        kind: "item.started",
        payload: {
          itemId: "tool-canary",
          itemType: "tool_call",
          parentMessageId: finalMessageId,
          title: "Create artifact",
        },
        sourceEventId: "canary:tool:started",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          rawOutput: "artifact created",
          status: "completed",
          toolCallId: "tool-canary",
        },
        sourceEventId: "canary:tool:updated",
      }),
      runtimeEvent({
        kind: "item.completed",
        payload: { itemId: "tool-canary", itemType: "tool_call", status: "completed" },
        sourceEventId: "canary:tool:completed",
      }),
    ];
    expect(await pushFreshController(bindings, toolEvents)).toHaveLength(toolEvents.length);

    const finalTextChunks = FINAL_TEXT_LINES.map((line, index) =>
      index === FINAL_TEXT_LINES.length - 1 ? line : `${line}\n`,
    );
    const finalStreamEvents = [
      runtimeEvent({
        kind: "message.added",
        payload: { content: finalTextChunks[0], messageId: finalMessageId, role: "agent" },
        sourceEventId: "canary:final:snapshot",
      }),
      ...finalTextChunks.slice(1).map((contentDelta, index) =>
        runtimeEvent({
          kind: "message.delta",
          payload: { contentDelta, messageId: finalMessageId, role: "agent" },
          sourceEventId: `canary:final:delta:${index + 2}`,
        }),
      ),
    ];
    const finalBatches = splitIntoBatches(finalStreamEvents, 50);

    for (const batch of finalBatches.slice(0, -1)) {
      expect(await pushFreshController(bindings, batch)).toHaveLength(batch.length);
    }

    const terminalBatch = [
      ...(finalBatches.at(-1) ?? []),
      runtimeEvent({
        kind: "message.completed",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "canary:final:completed",
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];
    const failingBindings = {
      ...bindings,
      DB: failTerminalSessionEventInsert(database),
    } as ApiBindings;

    await expect(pushFreshController(failingBindings, terminalBatch)).rejects.toBeInstanceOf(Error);

    const completedRun = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    const projectedMessagesBeforeReplay = await database
      .prepare("SELECT content_text, id FROM session_message WHERE session_run_id = ? ORDER BY seq")
      .bind(RUN_ID)
      .all<{ content_text: string; id: string }>();
    const finalOutputBeforeReplay = await readPublicThreadRunFinalOutput({
      database,
      runId: RUN_ID,
      sessionId: SESSION_ID,
    });
    const terminalRowsBeforeReplay = await database
      .prepare("SELECT source_event_id FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .all<{ source_event_id: string }>();

    expect(completedRun?.status).toBe("running");
    expect(projectedMessagesBeforeReplay.results).toEqual([]);
    expect(finalOutputBeforeReplay).toBeNull();
    expect(terminalRowsBeforeReplay.results).toEqual([]);

    const accepted = await pushFreshController(bindings, terminalBatch);
    expect(accepted).toHaveLength(terminalBatch.length);
    expect(await pushFreshController(bindings, terminalBatch)).toEqual(accepted);

    const projectedMessagesAfterReplay = await database
      .prepare("SELECT content_text, id FROM session_message WHERE session_run_id = ? ORDER BY seq")
      .bind(RUN_ID)
      .all<{ content_text: string; id: string }>();
    const terminalRowsAfterReplay = await database
      .prepare("SELECT source_event_id FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .all<{ source_event_id: string }>();
    const transcript = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    const finalTranscriptMessage = transcript.messages.find(
      (message) => message.id === finalMessageId,
    );
    const canonicalTranscriptMessages = transcript.messages.filter(
      (message) => message.role === "assistant" && message.content === FINAL_TEXT,
    );

    expect(projectedMessagesAfterReplay.results).toEqual([
      { content_text: FINAL_TEXT, id: finalMessageId },
    ]);
    expect(terminalRowsAfterReplay.results).toEqual([
      { source_event_id: TERMINAL_SOURCE_EVENT_ID },
    ]);
    expect(finalTranscriptMessage?.content).toBe(FINAL_TEXT);
    expect(canonicalTranscriptMessages.map((message) => message.id)).toEqual([finalMessageId]);
    expect(finalTranscriptMessage?.content).not.toContain(PROGRESS_TEXTS.join(""));
    expect(FINAL_TEXT.split("\n")).toContain("160|中文长文本校验-Aa9-表格字符|END160");
  });

  test("removes provider-private citations at the public final-output boundary", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    const finalMessageId = createPlatformId<SessionMessageId>();
    const privateCitation = "\uE200cite\uE202turn2view0\uE202turn8view0\uE201";
    const providerText = `before${privateCitation}after`;
    const events = [
      ...finalMessageEvents({
        messageId: finalMessageId,
        sourcePrefix: "private-citation:final",
        text: providerText,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          stopReason: "end_turn",
        },
        sourceEventId: "private-citation:run-completed",
      }),
    ];

    await pushFreshController(bindings, events);

    const persistedMessage = await database
      .prepare("SELECT content_text FROM session_message WHERE id = ?")
      .bind(finalMessageId)
      .first<{ content_text: string }>();

    expect(persistedMessage?.content_text).toBe(providerText);
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({
      text: "beforeafter",
      warnings: [
        {
          code: "unresolved_provider_citation",
          count: 1,
        },
      ],
    });
  });

  test("omits live-only reasoning from stored final assistant segments", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    const finalMessageId = createPlatformId<SessionMessageId>();
    const privateReasoningText = "Private reasoning should stay out of stored history.";
    const events = [
      runtimeEvent({
        kind: "thought.started",
        payload: { thoughtId: "private-reasoning" },
        sourceEventId: "reasoning:started",
      }),
      runtimeEvent({
        kind: "thought.delta",
        payload: { contentDelta: privateReasoningText, thoughtId: "private-reasoning" },
        sourceEventId: "reasoning:delta",
      }),
      runtimeEvent({
        kind: "thought.completed",
        payload: { thoughtId: "private-reasoning" },
        sourceEventId: "reasoning:completed",
      }),
      ...finalMessageEvents({
        messageId: finalMessageId,
        sourcePrefix: "reasoning:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          stopReason: "end_turn",
        },
        sourceEventId: "reasoning:run-completed",
      }),
    ];

    await pushFreshController(bindings, events);

    const persistedMessage = await database
      .prepare("SELECT content_text, segments_json FROM session_message WHERE id = ?")
      .bind(finalMessageId)
      .first<{ content_text: string; segments_json: string }>();

    expect(persistedMessage?.content_text).toBe(FINAL_TEXT);
    expect(JSON.parse(persistedMessage?.segments_json ?? "[]")).toEqual([
      { kind: "text", text: FINAL_TEXT },
    ]);
    expect(persistedMessage?.segments_json).not.toContain(privateReasoningText);
  });

  test("fails closed when a cross-boot replay conflicts with the persisted final snapshot", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    const finalMessageId = createPlatformId<SessionMessageId>();
    const terminalBatch = [
      ...finalMessageEvents({
        messageId: finalMessageId,
        sourcePrefix: "conflict:original-final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];
    await pushFreshController(bindings, terminalBatch);

    const replayedFinalMessageId = createPlatformId<SessionMessageId>();
    const conflictingText = `${FINAL_TEXT}\nCONFLICTING-REPLAY`;
    const conflictingReplay = [
      ...finalMessageEvents({
        messageId: replayedFinalMessageId,
        sourcePrefix: "conflict:reconnected-final",
        text: conflictingText,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId: replayedFinalMessageId,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];

    await expect(pushFreshController(bindings, conflictingReplay)).rejects.toThrow(
      "Source event identity already belongs to a different runtime event",
    );

    const messages = await database
      .prepare("SELECT content_text, id FROM session_message WHERE session_run_id = ? ORDER BY seq")
      .bind(RUN_ID)
      .all<{ content_text: string; id: string }>();
    const terminalRows = await database
      .prepare("SELECT source_event_id FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .all<{ source_event_id: string }>();

    expect(messages.results).toEqual([{ content_text: FINAL_TEXT, id: finalMessageId }]);
    expect(terminalRows.results).toEqual([{ source_event_id: TERMINAL_SOURCE_EVENT_ID }]);
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: FINAL_TEXT });
  });

  test("does not guess a progress message when the terminal RPC has no final identity", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    const progressMessageId = createPlatformId<SessionMessageId>();
    const progressEvents = messageEvents({
      messageId: progressMessageId,
      sourcePrefix: "fallback:progress",
      text: PROGRESS_TEXTS[0],
    });

    await pushFreshController(bindings, progressEvents);
    await expect(
      recordDriverInstanceCompletion(bindings, { driverInstanceId: DRIVER_ID, runId: RUN_ID }),
    ).rejects.toMatchObject({ code: "terminal_conflict" });

    const finalOutput = await readPublicThreadRunFinalOutput({
      database,
      runId: RUN_ID,
      sessionId: SESSION_ID,
    });
    const messages = await database
      .prepare("SELECT id FROM session_message WHERE session_run_id = ?")
      .bind(RUN_ID)
      .all<{ id: string }>();

    expect(finalOutput).toBeNull();
    expect(messages.results).toEqual([]);
  });

  test.each(["different Run", "missing completion marker"] as const)(
    "rejects a final snapshot with %s",
    async (invalidSnapshot) => {
      const { bindings, database } = await createCheckpointCompletionFixture();
      const events = completionEvents(FINAL_TEXT);
      await pushFreshController(
        bindings,
        invalidSnapshot === "different Run" ? events.slice(0, -1) : events.slice(0, 1),
      );
      if (invalidSnapshot === "different Run") {
        database.execute(
          `UPDATE session_event SET run_id = '${PUBLIC_API_TEST_IDS.runAlt}' WHERE run_id = '${RUN_ID}'`,
        );
      }
      await expect(pushFreshController(bindings, [events.at(-1)!])).rejects.toMatchObject({
        code: "terminal_conflict",
      });
      expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
      expect(
        await database.prepare("SELECT COUNT(*) AS count FROM session_message").first(),
      ).toEqual({ count: 0 });
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'run.completed'")
          .first(),
      ).toEqual({ count: 0 });
    },
  );

  test.each(["snapshot", "identity"] as const)(
    "does not infer final output when the final message %s is absent",
    async (missing) => {
      const { bindings, database } = await createCheckpointCompletionFixture();
      const progressMessageId = createPlatformId<SessionMessageId>();
      const events = [
        ...(missing === "snapshot" ? messageEvents : finalMessageEvents)({
          messageId: progressMessageId,
          sourcePrefix: "missing-snapshot:progress",
          text: PROGRESS_TEXTS[0],
        }),
        runtimeEvent({
          kind: "run.completed",
          payload: {
            ...(missing === "identity" ? {} : { finalMessageId: progressMessageId }),
            stopReason: "end_turn",
          },
          sourceEventId: "missing-snapshot:run-completed",
        }),
      ];

      if (missing === "snapshot") {
        await expect(pushFreshController(bindings, events)).rejects.toMatchObject({
          code: "terminal_conflict",
        });
        expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("running");
        expect(
          await database
            .prepare(
              "SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'run.completed'",
            )
            .first(),
        ).toEqual({ count: 0 });
      } else {
        await pushFreshController(bindings, events);
        expect((await getSessionRunSummary(database, RUN_ID))?.status).toBe("completed");
      }
      expect(
        await database.prepare("SELECT COUNT(*) AS count FROM session_message").first(),
      ).toEqual({ count: 0 });

      await expect(
        readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
      ).resolves.toBeNull();
    },
  );

  test("does not persist canonical output after another terminal status wins", async () => {
    const { bindings, database } = await createCheckpointCompletionFixture();
    database.execute(`UPDATE session_run SET status = 'failed' WHERE id = '${RUN_ID}'`);
    const finalMessageId = createPlatformId<SessionMessageId>();
    const events = [
      ...finalMessageEvents({
        messageId: finalMessageId,
        sourcePrefix: "stale-completion:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          stopReason: "end_turn",
        },
        sourceEventId: "stale-completion:run-completed",
      }),
    ];

    await expect(pushFreshController(bindings, events)).rejects.toMatchObject({
      code: "terminal_conflict",
    });

    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    const messages = await database
      .prepare("SELECT id FROM session_message WHERE session_run_id = ?")
      .bind(RUN_ID)
      .all<{ id: string }>();

    expect(run?.status).toBe("failed");
    expect(messages.results).toEqual([]);
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toBeNull();
  });
});
