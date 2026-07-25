import { describe, expect, test } from "bun:test";

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
  createReceiptsForDriverEvents,
  filterNewDriverEvents,
  readReceiptsForProcessedDriverEvents,
  rememberDriverEventReceipts,
} from "../src/modules/runtime/infrastructure/driver-instance/driver-event-receipts";
import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { DriverInstanceRpcEventIngestionController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller";
import { RuntimeSessionViewCache } from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-view-cache";
import { recordDriverInstanceCompletion } from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import { loadSessionViewerState } from "../src/modules/sessions/application/session-live-state.service";
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

interface TestDriverState {
  createDriverEventReceipts(events: readonly DriverEventEnvelope[]): DriverEventReceipt[];
  filterUnprocessedDriverEvents(events: readonly DriverEventEnvelope[]): DriverEventEnvelope[];
  hello: { pid: number };
  readProcessedDriverEventReceipts(events: readonly DriverEventEnvelope[]): DriverEventReceipt[];
  rememberProcessedDriverEventReceipts(receipts: DriverEventReceipt[]): void;
  requireDriverInstanceId(): DriverInstanceId;
  runtimeSessionLink: RuntimeSessionLink | null;
  setRuntimeSessionLink(link: RuntimeSessionLink): void;
}

function createDriverState(): TestDriverState {
  const processedReceipts = new Map<string, DriverEventReceipt>();
  let nextSeq = 0;

  return {
    createDriverEventReceipts(events) {
      const result = createReceiptsForDriverEvents({ events, nextSeq });
      nextSeq = result.nextSeq;
      return result.receipts;
    },
    filterUnprocessedDriverEvents(events) {
      return filterNewDriverEvents({ events, processedReceipts });
    },
    hello: { pid: 1 },
    readProcessedDriverEventReceipts(events) {
      return readReceiptsForProcessedDriverEvents({ events, processedReceipts });
    },
    rememberProcessedDriverEventReceipts(receipts) {
      rememberDriverEventReceipts({ processedReceipts, receipts });
    },
    requireDriverInstanceId() {
      return DRIVER_ID;
    },
    runtimeSessionLink: null,
    setRuntimeSessionLink(link) {
      this.runtimeSessionLink = link;
    },
  };
}

function createController(bindings: ApiBindings): DriverInstanceRpcEventIngestionController {
  return new DriverInstanceRpcEventIngestionController({
    env: bindings,
    state: createDriverState(),
    viewCache: new RuntimeSessionViewCache(),
    viewerEventDelivery: {
      enqueue: () => undefined,
    },
  } as never);
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
    payload: input.payload,
    runId: RUN_ID,
    sessionId: SESSION_ID,
    sourceEventId: input.sourceEventId,
  });

  return {
    event,
    eventId: input.sourceEventId,
    occurredAt,
  };
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
      id, kind, subject_kind, subject_id, status, bind_mount_ready,
      global_mounts_json, created_at, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.sandbox}', 'pet', 'agent', '${PUBLIC_API_TEST_IDS.agent}',
      'active', 1, '[]', 1, 1
    );

    INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      session_id, status, updated_at
    )
    VALUES (
      'canary-cloudflare-session', 1, '/workspace',
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

function failSecondSessionEventInsert(database: D1Database): D1Database {
  let sessionEventInsertCount = 0;

  function wrapStatement(
    statement: D1PreparedStatement,
    isSessionEventInsert: boolean,
  ): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(target.bind(...values), isSessionEventInsert);
        }

        const value = Reflect.get(target, property);

        if (
          typeof value === "function" &&
          (property === "all" || property === "first" || property === "raw" || property === "run")
        ) {
          return (...arguments_: unknown[]) => {
            if (isSessionEventInsert) {
              sessionEventInsertCount += 1;

              if (sessionEventInsertCount === 2) {
                throw new Error("injected terminal session_event persistence failure");
              }
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
  test("preserves a long final snapshot across hibernation, terminal failure, and replay", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
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
        kind: "message.started",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "canary:final:started",
      }),
      ...finalTextChunks.map((contentDelta, index) =>
        runtimeEvent({
          kind: "message.delta",
          payload: { contentDelta, messageId: finalMessageId, role: "agent" },
          sourceEventId: `canary:final:delta:${index + 1}`,
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
          finalMessageText: FINAL_TEXT,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];
    const failingBindings = {
      ...bindings,
      DB: failSecondSessionEventInsert(database),
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

    expect(completedRun?.status).toBe("completed");
    expect(projectedMessagesBeforeReplay.results).toEqual([
      { content_text: FINAL_TEXT, id: finalMessageId },
    ]);
    expect(finalOutputBeforeReplay?.text).toBe(FINAL_TEXT);
    expect(new TextEncoder().encode(finalOutputBeforeReplay?.text)).toEqual(
      new TextEncoder().encode(FINAL_TEXT),
    );
    expect(terminalRowsBeforeReplay.results).toEqual([]);

    const replayedFinalMessageId = createPlatformId<SessionMessageId>();
    const crossBootTerminalBatch = [
      ...messageEvents({
        messageId: replayedFinalMessageId,
        sourcePrefix: "canary:reconnected-final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId: replayedFinalMessageId,
          finalMessageText: FINAL_TEXT,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];

    expect(await pushFreshController(bindings, crossBootTerminalBatch)).toHaveLength(
      crossBootTerminalBatch.length,
    );
    expect(await pushFreshController(bindings, crossBootTerminalBatch)).toHaveLength(
      crossBootTerminalBatch.length,
    );

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

    expect(projectedMessagesAfterReplay.results).toEqual(projectedMessagesBeforeReplay.results);
    expect(terminalRowsAfterReplay.results).toEqual([
      { source_event_id: TERMINAL_SOURCE_EVENT_ID },
    ]);
    expect(finalTranscriptMessage?.content).toBe(FINAL_TEXT);
    expect(canonicalTranscriptMessages.map((message) => message.id)).toEqual([finalMessageId]);
    expect(finalTranscriptMessage?.content).not.toContain(PROGRESS_TEXTS.join(""));
    expect(FINAL_TEXT.split("\n")).toContain("160|中文长文本校验-Aa9-表格字符|END160");
  });

  test("removes provider-private citations at the public final-output boundary", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const privateCitation = "\uE200cite\uE202turn2view0\uE202turn8view0\uE201";
    const providerText = `before${privateCitation}after`;
    const events = [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "private-citation:final",
        text: providerText,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          finalMessageText: providerText,
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
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const privateReasoningText = "Private reasoning should stay out of stored history.";
    const events = [
      runtimeEvent({
        kind: "thought.started",
        payload: { messageId: finalMessageId },
        sourceEventId: "reasoning:started",
      }),
      runtimeEvent({
        kind: "thought.delta",
        payload: { contentDelta: privateReasoningText, messageId: finalMessageId },
        sourceEventId: "reasoning:delta",
      }),
      runtimeEvent({
        kind: "thought.completed",
        payload: { messageId: finalMessageId },
        sourceEventId: "reasoning:completed",
      }),
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "reasoning:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          finalMessageText: FINAL_TEXT,
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
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const terminalBatch = [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "conflict:original-final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          finalMessageText: FINAL_TEXT,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];
    const failingBindings = {
      ...bindings,
      DB: failSecondSessionEventInsert(database),
    } as ApiBindings;

    await expect(pushFreshController(failingBindings, terminalBatch)).rejects.toBeInstanceOf(Error);

    const replayedFinalMessageId = createPlatformId<SessionMessageId>();
    const conflictingText = `${FINAL_TEXT}\nCONFLICTING-REPLAY`;
    const conflictingReplay = [
      ...messageEvents({
        messageId: replayedFinalMessageId,
        sourcePrefix: "conflict:reconnected-final",
        text: conflictingText,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId: replayedFinalMessageId,
          finalMessageText: conflictingText,
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];

    await expect(pushFreshController(bindings, conflictingReplay)).rejects.toThrow(
      "Canonical final assistant message conflicts with the persisted projection",
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
    expect(terminalRows.results).toEqual([]);
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: FINAL_TEXT });
  });

  test("does not guess a progress message when the terminal RPC has no final identity", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const progressMessageId = createPlatformId<SessionMessageId>();
    const progressEvents = messageEvents({
      messageId: progressMessageId,
      sourcePrefix: "fallback:progress",
      text: PROGRESS_TEXTS[0],
    });

    await pushFreshController(bindings, progressEvents);
    await recordDriverInstanceCompletion(bindings, {
      driverInstanceId: DRIVER_ID,
      driverReady: true,
    });

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

  test("fails closed when run completion omits the final text snapshot", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const progressMessageId = createPlatformId<SessionMessageId>();
    const events = [
      ...messageEvents({
        messageId: progressMessageId,
        sourcePrefix: "missing-snapshot:progress",
        text: PROGRESS_TEXTS[0],
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId: progressMessageId, stopReason: "end_turn" },
        sourceEventId: "missing-snapshot:run-completed",
      }),
    ];

    await pushFreshController(bindings, events);

    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toBeNull();
  });

  test("does not persist canonical output after another terminal status wins", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    database.execute(`UPDATE session_run SET status = 'failed' WHERE id = '${RUN_ID}'`);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const events = [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "stale-completion:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: {
          finalMessageId,
          finalMessageText: FINAL_TEXT,
          stopReason: "end_turn",
        },
        sourceEventId: "stale-completion:run-completed",
      }),
    ];

    await pushFreshController(bindings, events);

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
