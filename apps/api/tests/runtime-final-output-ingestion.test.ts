import { afterEach, describe, expect, test } from "bun:test";

import { createMcpExecuteFailedEventIdentity } from "@mosoo/agent-driver/events";
import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import { createPlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  DriverCommandId,
  RuntimeEventId,
  RuntimeOperationId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEvent, createRuntimeToolResultMessageId } from "@mosoo/runtime-events";
import type { RuntimeEventKind } from "@mosoo/runtime-events";

import { readPublicThreadRunFinalOutput } from "../src/modules/public-api/public-thread-events";
import {
  recordCanonicalSessionRunFailure,
  recordCanonicalSessionRunTerminal,
} from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import {
  createFailedSessionRunRuntimeEvent,
  createSessionRunUpdatedEvent,
} from "../src/modules/runtime/application/session-runs/session-run-view-events.service";
import { prepareAssistantMessageProjection } from "../src/modules/runtime/infrastructure/driver-instance/assistant-message-projection";
import { commitTerminalRunProjection } from "../src/modules/runtime/infrastructure/driver-instance/completed-run-commit.repository";
import { canonicalizeDriverEventEnvelope } from "../src/modules/runtime/infrastructure/driver-instance/driver-event-canonicalization";
import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { DriverInstanceRpcEventIngestionController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller";
import {
  cleanupRuntimeArtifactAttempts,
  parseRuntimeArtifactManifest,
} from "../src/modules/runtime/infrastructure/driver-instance/runtime-artifact-attempt.repository";
import type { RuntimeArtifactManifest } from "../src/modules/runtime/infrastructure/driver-instance/runtime-artifact-attempt.repository";
import {
  RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES,
  RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES,
} from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-outputs";
import { RuntimeSessionViewCache } from "../src/modules/runtime/infrastructure/driver-instance/runtime-session-view-cache";
import {
  recordDriverInstanceCompletion,
  recordDriverInstanceFailure,
} from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import { createRuntimeCommandRecord } from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import { getSessionRunSummary } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import { loadSessionViewerState } from "../src/modules/sessions/application/session-live-state.service";
import type { SessionDeliveryEvent } from "../src/modules/sessions/application/session-live-state.service";
import { createSessionProcessEventsFromSessionEventRows } from "../src/modules/sessions/application/session-process-events.service";
import type { SessionEventProcessRow } from "../src/modules/sessions/application/session-process-events.service";
import { getSessionRuntimeRecoveryMessages } from "../src/modules/sessions/application/session-runtime-recovery-query.service";
import { syncSessionViewerState } from "../src/modules/sessions/infrastructure/session/client";
import { setServerProductAnalyticsTransportForTests } from "../src/platform/analytics/product-analytics";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings as createBasePublicHttpTestBindings,
  insertNonOwnerSession,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import { createRuntimeOutputSandbox } from "./helpers/runtime-output-sandbox";
import type { RuntimeOutputSandboxOptions } from "./helpers/runtime-output-sandbox";
import { insertRuntimeEvent } from "./public-thread-api-fixtures";

const DRIVER_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const RUN_ID = PUBLIC_API_TEST_IDS.run as SessionRunId;
const SESSION_ID = PUBLIC_API_TEST_IDS.ownerSession as SessionId;
const TERMINAL_SOURCE_EVENT_ID = `session-run-terminal:${RUN_ID}:run.completed`;
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
const LARGE_FINAL_TEXT = `${FINAL_TEXT}\n${"0123456789abcdef中文\n".repeat(90_000)}`;
const LARGE_FINAL_TEXT_CHUNK_CHARACTERS = 300;
const PROGRESS_TEXTS = [
  "进度 1：正在读取上游报告。",
  "进度 2：工具调用已经完成。",
  "进度 3：artifact 已创建。",
] as const;

afterEach(() => {
  setServerProductAnalyticsTransportForTests(null);
});

interface TestDriverState {
  hello: { pid: number };
  requireDriverGeneration(): number;
  requireDriverInstanceId(): DriverInstanceId;
  runtimeSessionLink: RuntimeSessionLink | null;
  setRuntimeSessionLink(link: RuntimeSessionLink): void;
}

function createDriverState(): TestDriverState {
  return {
    hello: { pid: 1 },
    requireDriverGeneration() {
      return 0;
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

function createController(
  bindings: ApiBindings,
  enqueue: (sessionId: SessionId | null, events: SessionDeliveryEvent[]) => void = () => undefined,
): DriverInstanceRpcEventIngestionController {
  return new DriverInstanceRpcEventIngestionController({
    env: bindings,
    state: createDriverState(),
    viewCache: new RuntimeSessionViewCache(),
    viewerEventDelivery: {
      enqueue,
      flush: async () => {},
      flushSafely: async () => {},
      requestStateSync: (sessionId) => {
        void syncSessionViewerState(bindings, sessionId);
      },
      resetAfterFlush: () => {},
    },
  } as never);
}

function createSessionSyncNamespace(syncedSessionIds: string[]): ApiBindings["Session"] {
  return {
    get: () => ({
      syncViewers: async (sessionId: string) => {
        syncedSessionIds.push(sessionId);
      },
    }),
    idFromName: (name: string) => name,
  } as never;
}

interface ArtifactSandboxOptions extends RuntimeOutputSandboxOptions {
  readonly resolveError?: Error;
}

type PublicHttpTestBindingOptions = NonNullable<
  Parameters<typeof createBasePublicHttpTestBindings>[1]
> & { readonly artifactSandbox?: ArtifactSandboxOptions };

function createPublicHttpTestBindings(
  database: D1Database,
  options: PublicHttpTestBindingOptions = {},
): Record<string, unknown> {
  const { artifactSandbox, ...baseOptions } = options;

  return {
    ...createBasePublicHttpTestBindings(database, baseOptions),
    runtimeSubjectHandleFactory: () => {
      if (artifactSandbox?.resolveError !== undefined) {
        throw artifactSandbox.resolveError;
      }
      return createRuntimeOutputSandbox(artifactSandbox);
    },
  };
}

async function readRuntimeArtifactManifest(
  database: D1Database,
  sourceEventId: string,
): Promise<RuntimeArtifactManifest> {
  const row = await database
    .prepare("SELECT artifact_manifest_json FROM session_event WHERE source_event_id = ?")
    .bind(sourceEventId)
    .first<{ artifact_manifest_json: string | null }>();
  if (row?.artifact_manifest_json === null || row?.artifact_manifest_json === undefined) {
    throw new Error(`Runtime artifact manifest is missing for ${sourceEventId}.`);
  }
  return parseRuntimeArtifactManifest(row.artifact_manifest_json);
}

function runtimeEvent(input: {
  correlationId?: string;
  kind: RuntimeEventKind;
  occurredAt?: number;
  payload: unknown;
  runId?: SessionRunId | null;
  sourceEventId: string;
  visibility?: "owner_debug";
}): DriverEventEnvelope {
  const occurredAt = input.occurredAt ?? Date.now();
  const event = createRuntimeEvent({
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    driverInstanceId: DRIVER_ID,
    id: createPlatformId<RuntimeEventId>(),
    kind: input.kind,
    occurredAt: new Date(occurredAt).toISOString(),
    payload: input.payload,
    ...(input.runId === null ? {} : { runId: input.runId ?? RUN_ID }),
    runtimeId: "openai-runtime",
    sessionId: SESSION_ID,
    sourceEventId: input.sourceEventId,
    traceId: "trace-canary",
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
  });

  return {
    event,
    eventId: input.sourceEventId,
    occurredAt: new Date(occurredAt).toISOString(),
  };
}

function messageEvents(input: {
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

function splitIntoBatches<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}

function measurePreparedQueries(database: D1Database): {
  database: D1Database;
  readCount: () => number;
} {
  let count = 0;
  const measured = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          count += 1;
          return target.prepare(query);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { database: measured, readCount: () => count };
}

async function insertRuntimeFixture(database: SqliteD1Database): Promise<void> {
  await insertOwnerSession(database);
  database.execute(`
    INSERT INTO sandbox (
      agent_id, project_id, id, incarnation, kind, network_constraints_hash,
      owner_account_id, subject_kind, subject_id, status, bind_mount_ready,
      global_mounts_json, created_at, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.agent}', '${PUBLIC_API_TEST_IDS.project}',
      '${PUBLIC_API_TEST_IDS.sandbox}', 1, 'pet', '${"0".repeat(64)}',
      '${PUBLIC_API_TEST_IDS.ownerAccount}', 'agent', '${PUBLIC_API_TEST_IDS.agent}',
      'active', 1, '[]', 1, 1
    );

    INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      sandbox_incarnation, session_id, status, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.operation}', 1, '/workspace',
      '{"callerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","entrypoint":"api","executionOwnerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","type":"agent"}',
      '${PUBLIC_API_TEST_IDS.sandbox}', 1, '${SESSION_ID}', 'active', 1
    );

    INSERT INTO driver_instance (
      id, boot_token_expires_at, boot_token_hash, connection_id, created_at,
      expires_at, heartbeat_count, protocol, protocol_version, runtime,
      sandbox_id, sandbox_incarnation, sandbox_session_id, status, updated_at
    )
    VALUES (
      '${DRIVER_ID}', 1, X'01', 'canary-connection', 1, 1, 0,
      'orpc-ws', 1, 'openai-runtime', '${PUBLIC_API_TEST_IDS.sandbox}',
      1, '${SESSION_ID}', 'ready', 1
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
            /insert\s+into\s+(?:["`]session_event["`]|session_event)/iu.test(query),
            false,
          );
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function rejectSessionEventContentReads(database: D1Database): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => {
          if (
            /^\s*select\b/iu.test(query) &&
            /\bcontent_text\b/iu.test(query) &&
            /\bfrom\s+["`]?session_event["`]?/iu.test(query)
          ) {
            throw new Error("Terminal ingestion attempted to materialize session event content.");
          }
          return target.prepare(query);
        };
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function failPreparedProjection(database: D1Database, pattern: RegExp): D1Database {
  function wrap(statement: D1PreparedStatement, shouldFail: boolean): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values), shouldFail);
        }
        if (property === "run" && shouldFail) {
          return async () => {
            throw new Error("injected durable side-effect projection failure");
          };
        }

        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => wrap(target.prepare(query), pattern.test(query));
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type RuntimeArtifactAckLossPhase = "claim" | "commit" | "create" | "put" | "seal";

function failAfterRuntimeArtifactDatabaseWrite(
  database: D1Database,
  phase: Exclude<RuntimeArtifactAckLossPhase, "commit" | "put">,
): { readonly database: D1Database; readonly wasInjected: () => boolean } {
  const pattern = {
    claim: "SET owned_object_keys_json = json_insert",
    create: "INSERT INTO runtime_artifact_attempt",
    seal: "SET manifest_json = ?, manifest_sha256 = ?, status = 'staged'",
  }[phase];
  let injected = false;

  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        if (property === "first") {
          return async (...arguments_: unknown[]) => {
            const result = await Reflect.apply(target.first, target, arguments_);
            if (!injected) {
              injected = true;
              throw new Error(`injected artifact ${phase} acknowledgement loss`);
            }
            return result;
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return query.includes(pattern) ? wrap(statement) : statement;
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    wasInjected: () => injected,
  };
}

function failAfterRuntimeArtifactCommit(
  database: D1Database,
  sourceEventId: string,
): { readonly database: D1Database; readonly wasInjected: () => boolean } {
  let injected = false;
  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            const receipt = await target
              .prepare("SELECT 1 AS found FROM session_event WHERE source_event_id = ?")
              .bind(sourceEventId)
              .first();
            if (!injected && receipt !== null) {
              injected = true;
              throw new Error("injected artifact commit acknowledgement loss");
            }
            return result;
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    wasInjected: () => injected,
  };
}

function mutateBeforeFirstDatabaseBatch(
  database: D1Database,
  mutation: (database: D1Database) => Promise<void>,
): { readonly database: D1Database; readonly wasInjected: () => boolean } {
  let injected = false;

  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!injected) {
              injected = true;
              await mutation(target);
            }
            return target.batch(statements);
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    wasInjected: () => injected,
  };
}

function failAfterRuntimeArtifactPut(bucket: PublicApiMemoryFileBucket): {
  readonly bucket: R2Bucket;
  readonly wasInjected: () => boolean;
} {
  let injected = false;
  return {
    bucket: new Proxy(bucket, {
      get(target, property) {
        if (property === "put") {
          return async (...arguments_: Parameters<R2Bucket["put"]>) => {
            const result = await target.put(...arguments_);
            if (!injected) {
              injected = true;
              throw new Error("injected artifact put acknowledgement loss");
            }
            return result;
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    wasInjected: () => injected,
  };
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

async function insertRepairableCompletedAuthority(
  database: D1Database,
  sourcePrefix: string,
): Promise<SessionMessageId> {
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const finalMessageId = createPlatformId<SessionMessageId>();
  await pushFreshController(bindings, [
    ...messageEvents({ messageId: finalMessageId, sourcePrefix, text: FINAL_TEXT }),
    runtimeEvent({
      kind: "run.completed",
      payload: { finalMessageId, stopReason: "end_turn" },
      sourceEventId: `${sourcePrefix}:terminal`,
    }),
  ]);
  await database.prepare("DELETE FROM session_message WHERE id = ?").bind(finalMessageId).run();
  await database
    .prepare("UPDATE session SET message_seq_cursor = 0 WHERE id = ?")
    .bind(SESSION_ID)
    .run();
  return finalMessageId;
}

const VALID_RUNTIME_ARTIFACT_MANIFEST = {
  captureStatus: "complete",
  files: [],
  mode: "delta",
  semanticHash: "0".repeat(64),
  sourceEventId: "artifact-manifest:valid",
  version: 1,
};

describe("runtime artifact manifest validation", () => {
  test.each([
    ["malformed JSON", "{"],
    ["non-object root", null],
    ["unsupported version", { ...VALID_RUNTIME_ARTIFACT_MANIFEST, version: 2 }],
    ["unsupported capture status", { ...VALID_RUNTIME_ARTIFACT_MANIFEST, captureStatus: "lost" }],
    ["unsupported mode", { ...VALID_RUNTIME_ARTIFACT_MANIFEST, mode: "append" }],
    ["non-array files", { ...VALID_RUNTIME_ARTIFACT_MANIFEST, files: {} }],
    ["empty source event ID", { ...VALID_RUNTIME_ARTIFACT_MANIFEST, sourceEventId: "" }],
    ["invalid semantic hash", { ...VALID_RUNTIME_ARTIFACT_MANIFEST, semanticHash: "invalid" }],
    [
      "invalid file operation",
      {
        ...VALID_RUNTIME_ARTIFACT_MANIFEST,
        files: [{ operation: "rename", sourcePath: "outputs/report.txt" }],
      },
    ],
    [
      "non-empty omitted capture",
      {
        ...VALID_RUNTIME_ARTIFACT_MANIFEST,
        captureStatus: "omitted_size_limit",
        files: [{ operation: "delete", sourcePath: "outputs/report.txt" }],
      },
    ],
    [
      "duplicate file identity",
      {
        ...VALID_RUNTIME_ARTIFACT_MANIFEST,
        files: [
          { operation: "delete", sourcePath: "outputs/report.txt" },
          { operation: "delete", sourcePath: "outputs/report.txt" },
        ],
      },
    ],
  ] as const)("rejects the %s boundary", (_name, value) => {
    const manifestJson = typeof value === "string" ? value : JSON.stringify(value);
    expect(() => parseRuntimeArtifactManifest(manifestJson)).toThrow();
  });
});

describe("runtime final output ingestion", () => {
  test("admits only canonical content-addressed MCP failures", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const commandId = "01J0000000000000000000000X" as DriverCommandId;
    const command = {
      argumentsJson: '{"issue":"A-1"}',
      commandId,
      kind: "mcp.execute",
      requestId: "request-A-1",
      runId: RUN_ID,
      serverId: "01J0000000000000000000000Y",
      toolCallId: "tool-A-1",
      toolName: "createIssue",
    } as const;
    await createRuntimeCommandRecord(database, {
      command,
      driverGeneration: 0,
      driverInstanceId: DRIVER_ID,
      status: "accepted",
    });
    const failed = createMcpExecuteFailedEventIdentity({
      commandId,
      rawInput: command.argumentsJson,
      rawOutput: "provider rejected the request",
      title: command.toolName,
      toolCallId: command.toolCallId,
    });
    const event = runtimeEvent({
      correlationId: commandId,
      kind: "tool.call.updated",
      payload: failed.payload,
      sourceEventId: failed.sourceEventId,
    });

    await expect(pushFreshController(bindings, [event])).resolves.toMatchObject([
      { eventId: failed.sourceEventId },
    ]);
    await expect(
      pushFreshController(bindings, [
        {
          ...event,
          event: {
            ...event.event,
            payload: { ...failed.payload, rawOutput: "tampered failure" },
          },
        },
      ]),
    ).rejects.toThrow("canonical content identity");
    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          correlationId: commandId,
          kind: "tool.call.updated",
          payload: failed.payload,
          sourceEventId: `mcp.execute.failed:${"0".repeat(64)}`,
        }),
      ]),
    ).rejects.toThrow("canonical content identity");
  });

  test("commits canonical durable state before enqueue and replays without projection writes", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    await database.prepare("UPDATE session SET title = NULL WHERE id = ?").bind(SESSION_ID).run();
    const syncedSessionIds: string[] = [];
    const bindings = createPublicHttpTestBindings(database, {
      sessionNamespace: createSessionSyncNamespace(syncedSessionIds),
    }) as ApiBindings;
    let durableCommitCompleted = false;
    const disconnectingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            const result = await target.batch(statements);
            durableCommitCompleted = true;
            return result;
          };
        }

        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let failureInjected = false;
    const disconnectAfterCommitContext = {
      ...activeContext,
      assertActiveConnection() {
        if (durableCommitCompleted && !failureInjected) {
          failureInjected = true;
          throw new Error("injected disconnect after durable event commit");
        }
      },
    } as never;
    const taskSourceEventId = "task-replay:tasks";
    const snapshotSourceEventId = "task-replay:message-snapshot";
    const deltaSourceEventId = "task-replay:message-delta";
    const messageId = createPlatformId<SessionMessageId>();
    const thoughtId = createPlatformId<SessionMessageId>();
    const userMessageId = createPlatformId<SessionMessageId>();
    const events = [
      runtimeEvent({
        kind: "agent.tasks.replaced",
        payload: { tasks: [{ taskId: "canonical-task", title: "Inspect" }] },
        sourceEventId: taskSourceEventId,
      }),
      runtimeEvent({
        kind: "message.added",
        payload: { content: "canonical ", messageId, role: "agent" },
        sourceEventId: snapshotSourceEventId,
      }),
      runtimeEvent({
        kind: "message.delta",
        payload: {
          contentDelta: "state",
          messageId,
          role: "agent",
        },
        sourceEventId: deltaSourceEventId,
      }),
      runtimeEvent({
        kind: "thought.started",
        payload: { thoughtId },
        sourceEventId: "task-replay:thought-started",
      }),
      runtimeEvent({
        kind: "thought.delta",
        payload: { contentDelta: "canonical reasoning", thoughtId },
        sourceEventId: "task-replay:thought-delta",
      }),
      runtimeEvent({
        kind: "thought.completed",
        payload: { thoughtId },
        sourceEventId: "task-replay:thought-completed",
      }),
      runtimeEvent({
        kind: "message.added",
        payload: { content: "canonical question", messageId: userMessageId, role: "user" },
        sourceEventId: "task-replay:user-message",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          parentMessageId: messageId,
          rawInputDelta: '{"command":',
          status: "running",
          title: "Shell",
          toolCallId: "stable-tool",
        },
        sourceEventId: "task-replay:tool-started",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          messageId,
          rawInput: '{"command":"pwd"}',
          status: "running",
          title: "Shell",
          toolCallId: "stable-tool",
        },
        sourceEventId: "task-replay:tool-snapshot",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          rawOutput: "canonical output",
          status: "completed",
          title: "Shell",
          toolCallId: "stable-tool",
        },
        sourceEventId: "task-replay:tool-completed",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          status: "running",
          title: "Orphan tool",
          toolCallId: "orphan-tool",
        },
        sourceEventId: "task-replay:orphan-tool-started",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          rawOutput: "orphan output",
          status: "completed",
          title: "Orphan tool",
          toolCallId: "orphan-tool",
        },
        sourceEventId: "task-replay:orphan-tool-completed",
      }),
      runtimeEvent({
        kind: "plan.updated",
        payload: {
          entries: [{ content: "Verify durable state", priority: "high", status: "completed" }],
        },
        sourceEventId: "task-replay:plan",
      }),
      runtimeEvent({
        kind: "session.commands.updated",
        payload: {
          commands: [{ description: "Inspect the workspace", name: "inspect" }],
        },
        sourceEventId: "task-replay:commands",
      }),
      runtimeEvent({
        kind: "session.config.updated",
        payload: {
          options: [
            {
              currentValue: "brief",
              id: "tone",
              name: "Tone",
              type: "select",
              values: [{ name: "Brief", value: "brief" }],
            },
          ],
        },
        sourceEventId: "task-replay:config",
      }),
      runtimeEvent({
        kind: "session.mode.updated",
        payload: {
          availableModes: [{ id: "plan", name: "Plan" }],
          currentMode: "plan",
        },
        sourceEventId: "task-replay:mode",
      }),
      runtimeEvent({
        kind: "session.info.updated",
        payload: { title: "Atomic durable title" },
        sourceEventId: "task-replay:title",
      }),
      runtimeEvent({
        kind: "usage.updated",
        payload: {
          callId: "atomic-call",
          inputTokens: 21,
          outputTokens: 4,
          source: "prompt_response",
          usageContract: "openai_total_with_cached_breakdown",
        },
        sourceEventId: "task-replay:usage",
      }),
      runtimeEvent({
        kind: "runtime.resume.updated",
        payload: { resumePointer: "atomic-thread" },
        sourceEventId: "task-replay:native-resume",
      }),
    ];
    const firstDelivery: SessionDeliveryEvent[] = [];

    await expect(
      createController(
        { ...bindings, DB: disconnectingDatabase } as ApiBindings,
        (_sessionId, deliveryEvents) => firstDelivery.push(...deliveryEvents),
      ).handlePushEvents({ driverInstanceId: DRIVER_ID, events }, disconnectAfterCommitContext),
    ).rejects.toThrow("injected disconnect after durable event commit");

    expect(failureInjected).toBe(true);
    expect(firstDelivery).toEqual([]);
    const durableRows = await database
      .prepare(
        `SELECT event_type, source_event_id FROM session_event WHERE source_event_id IN (${events
          .map(() => "?")
          .join(", ")}) ORDER BY seq`,
      )
      .bind(...events.map((event) => event.eventId))
      .all<{ event_type: string; source_event_id: string }>();

    expect(durableRows.results).toEqual(
      events.map((event) => ({
        event_type: event.event.kind,
        source_event_id: event.eventId,
      })),
    );
    const titleSeq = events.findIndex((event) => event.event.kind === "session.info.updated") + 1;
    const usageSeq = events.findIndex((event) => event.event.kind === "usage.updated") + 1;
    const nativeResumeSeq =
      events.findIndex((event) => event.event.kind === "runtime.resume.updated") + 1;
    const usageReceipt = await database
      .prepare("SELECT created_at FROM session_event WHERE source_event_id = ?")
      .bind("task-replay:usage")
      .first<{ created_at: number }>();

    expect(usageReceipt).not.toBeNull();

    expect(
      await database
        .prepare("SELECT auto_title_event_seq, title FROM session WHERE id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ auto_title_event_seq: titleSeq, title: "Atomic durable title" });
    expect(
      await database
        .prepare(
          `SELECT call_key, created_at, source_event_seq, status
             FROM session_model_call
            WHERE session_id = ? AND session_run_id = ?`,
        )
        .bind(SESSION_ID, RUN_ID)
        .first(),
    ).toEqual({
      call_key: "model_call:atomic-call",
      created_at: usageReceipt?.created_at,
      source_event_seq: usageSeq,
      status: "started",
    });
    expect(
      await database
        .prepare(
          `SELECT created_at, input_tokens, output_tokens, source_event_seq
             FROM usage_event
            WHERE session_id = ? AND session_run_id = ?`,
        )
        .bind(SESSION_ID, RUN_ID)
        .first(),
    ).toEqual({
      created_at: usageReceipt?.created_at,
      input_tokens: 21,
      output_tokens: 4,
      source_event_seq: usageSeq,
    });
    expect(
      await database
        .prepare(
          `SELECT observed_event_seq, observed_session_run_id, value
             FROM native_resume_ref
            WHERE session_id = ?`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual({
      observed_event_seq: nativeResumeSeq,
      observed_session_run_id: RUN_ID,
      value: "atomic-thread",
    });

    const viewerUsageSeq = events.length + 1;
    await insertRuntimeEvent(database, {
      kind: "usage.updated",
      occurredAt: Date.now(),
      payload: { source: "session_update", totalTokens: 42 },
      runId: RUN_ID,
      seq: viewerUsageSeq,
      sessionId: SESSION_ID,
    });
    await database
      .prepare("UPDATE session SET runtime_event_seq_cursor = ? WHERE id = ?")
      .bind(viewerUsageSeq, SESSION_ID)
      .run();

    const replayDelivery: SessionDeliveryEvent[] = [];
    const replay = await createController(
      {
        ...bindings,
        DB: failPreparedProjection(
          database,
          /SET auto_title_event_seq =|INSERT INTO ["`]?session_model_call|INSERT INTO native_resume_ref/iu,
        ),
      } as ApiBindings,
      (_sessionId, deliveryEvents) => replayDelivery.push(...deliveryEvents),
    ).handlePushEvents({ driverInstanceId: DRIVER_ID, events }, activeContext);

    expect(replay.accepted.map((receipt) => receipt.eventId)).toEqual(
      events.map((event) => event.eventId),
    );
    expect(replayDelivery).toEqual([]);
    expect(syncedSessionIds).toEqual([SESSION_ID]);
    expect(
      await database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM session_model_call WHERE session_id = ?) AS model_call_count,
             (SELECT created_at FROM session_model_call WHERE session_id = ?) AS model_call_created_at,
             (SELECT COUNT(*) FROM usage_event WHERE session_id = ?) AS usage_event_count,
             (SELECT created_at FROM usage_event WHERE session_id = ?) AS usage_event_created_at,
             (SELECT observed_event_seq FROM native_resume_ref WHERE session_id = ?) AS native_seq,
             (SELECT auto_title_event_seq FROM session WHERE id = ?) AS title_seq`,
        )
        .bind(SESSION_ID, SESSION_ID, SESSION_ID, SESSION_ID, SESSION_ID, SESSION_ID)
        .first(),
    ).toEqual({
      model_call_count: 1,
      model_call_created_at: usageReceipt?.created_at,
      native_seq: nativeResumeSeq,
      title_seq: titleSeq,
      usage_event_count: 1,
      usage_event_created_at: usageReceipt?.created_at,
    });
    const hydrated = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect(hydrated.taskSnapshot).toEqual({
      driverInstanceId: DRIVER_ID,
      runId: RUN_ID,
      tasks: [{ taskId: "canonical-task", title: "Inspect" }],
    });
    expect(hydrated.commands).toEqual([{ description: "Inspect the workspace", name: "inspect" }]);
    expect(hydrated.configOptions).toEqual([
      {
        currentValue: "brief",
        id: "tone",
        name: "Tone",
        type: "select",
        values: [{ name: "Brief", value: "brief" }],
      },
    ]);
    expect(hydrated.currentModeId).toBe("plan");
    expect(hydrated.visibleModes).toEqual([{ id: "plan", name: "Plan" }]);
    expect(hydrated.usage).toMatchObject({ source: "session_update", totalTokens: 42 });
    expect(hydrated.plan).toEqual([
      { content: "Verify durable state", priority: "high", status: "completed" },
    ]);
    expect(hydrated.messages.find((message) => message.id === userMessageId)).toMatchObject({
      content: "canonical question",
      role: "user",
    });
    expect(hydrated.messages.find((message) => message.id === thoughtId)?.segments).toEqual([
      { kind: "reasoning", text: "canonical reasoning" },
    ]);
    expect(hydrated.messages.find((message) => message.id === messageId)).toMatchObject({
      content: "canonical state",
      role: "assistant",
      segments: expect.arrayContaining([
        {
          argsText: '{"command":"pwd"}',
          kind: "tool_use",
          path: null,
          runId: RUN_ID,
          tool: "Shell",
          toolCallId: "stable-tool",
        },
        {
          kind: "tool_result",
          output: "canonical output",
          runId: RUN_ID,
          tool: "Shell",
          toolCallId: "stable-tool",
        },
      ]),
    });
    const orphanResultMessageId = createRuntimeToolResultMessageId({
      runId: RUN_ID,
      toolCallId: "orphan-tool",
    });
    expect(
      hydrated.messages.find((message) => message.id === orphanResultMessageId)?.segments,
    ).toEqual([
      {
        kind: "tool_result",
        output: "orphan output",
        runId: RUN_ID,
        tool: "Orphan tool",
        toolCallId: "orphan-tool",
      },
    ]);

    await expect(
      createController(bindings).handlePushEvents(
        {
          driverInstanceId: DRIVER_ID,
          events: [
            runtimeEvent({
              kind: "agent.tasks.replaced",
              payload: { tasks: [{ taskId: "non-canonical-retry-payload" }] },
              sourceEventId: taskSourceEventId,
            }),
          ],
        },
        activeContext,
      ),
    ).rejects.toThrow("conflicts with its durable receipt");

    await database
      .prepare("UPDATE session_run SET completed_at = ?, status = 'completed' WHERE id = ?")
      .bind(Date.now(), RUN_ID)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE' WHERE id = ?")
      .bind(SESSION_ID)
      .run();
    const terminalHydrated = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect({
      commands: terminalHydrated.commands,
      configOptions: terminalHydrated.configOptions,
      currentModeId: terminalHydrated.currentModeId,
      plan: terminalHydrated.plan,
      usage: terminalHydrated.usage,
      visibleModes: terminalHydrated.visibleModes,
    }).toEqual({
      commands: hydrated.commands,
      configOptions: hydrated.configOptions,
      currentModeId: hydrated.currentModeId,
      plan: hydrated.plan,
      usage: hydrated.usage,
      visibleModes: hydrated.visibleModes,
    });
  });

  test("rolls back receipts and every side effect when a durable projection fails", async () => {
    const projectionPatterns = [
      /SET auto_title_event_seq =/iu,
      /INSERT INTO ["`]?session_model_call/iu,
      /INSERT INTO native_resume_ref/iu,
    ];

    for (const pattern of projectionPatterns) {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      await database.prepare("UPDATE session SET title = NULL WHERE id = ?").bind(SESSION_ID).run();
      const events = [
        runtimeEvent({
          kind: "session.info.updated",
          payload: { title: "Must roll back" },
          sourceEventId: "atomic-rollback:title",
        }),
        runtimeEvent({
          kind: "usage.updated",
          payload: {
            inputTokens: 8,
            outputTokens: 2,
            source: "prompt_response",
            usageContract: "openai_total_with_cached_breakdown",
          },
          sourceEventId: "atomic-rollback:usage",
        }),
        runtimeEvent({
          kind: "runtime.resume.updated",
          payload: { resumePointer: "must-roll-back" },
          sourceEventId: "atomic-rollback:native-resume",
        }),
      ];

      await expect(
        pushFreshController(
          {
            ...createPublicHttpTestBindings(database),
            DB: failPreparedProjection(database, pattern),
          } as ApiBindings,
          events,
        ),
      ).rejects.toThrow("injected durable side-effect projection failure");

      expect(
        await database
          .prepare(
            `SELECT runtime_event_seq_cursor, title,
               (SELECT COUNT(*) FROM session_event) AS receipt_count,
               (SELECT COUNT(*) FROM session_model_call) AS model_call_count,
               (SELECT COUNT(*) FROM usage_event) AS usage_event_count,
               (SELECT COUNT(*) FROM native_resume_ref) AS native_ref_count
             FROM session WHERE id = ?`,
          )
          .bind(SESSION_ID)
          .first(),
      ).toEqual({
        model_call_count: 0,
        native_ref_count: 0,
        receipt_count: 0,
        runtime_event_seq_cursor: 0,
        title: null,
        usage_event_count: 0,
      });
    }
  });

  test("finalizes durable usage only with the terminal Run commit", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const events = [
      runtimeEvent({
        kind: "usage.updated",
        payload: {
          inputTokens: 13,
          outputTokens: 3,
          source: "prompt_response",
          usageContract: "openai_total_with_cached_breakdown",
        },
        sourceEventId: "terminal-usage:usage",
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { stopReason: "end_turn" },
        sourceEventId: "terminal-usage:completed",
      }),
    ];

    await expect(
      pushFreshController(
        {
          ...createPublicHttpTestBindings(database),
          DB: failPreparedProjection(database, /completed-run:model-calls/iu),
        } as ApiBindings,
        events,
      ),
    ).rejects.toThrow("injected durable side-effect projection failure");
    expect(
      await database
        .prepare(
          `SELECT r.status AS run_status, s.status AS session_status,
                  model_call.completed_at, model_call.status AS model_call_status,
                  (SELECT COUNT(*) FROM session_event
                    WHERE session_id = ?
                      AND event_type IN ('run.cancelled', 'run.completed', 'run.failed'))
                    AS terminal_count
             FROM session_run AS r
             JOIN session AS s ON s.id = r.session_id
             JOIN session_model_call AS model_call ON model_call.session_run_id = r.id
            WHERE r.id = ?`,
        )
        .bind(SESSION_ID, RUN_ID)
        .first(),
    ).toEqual({
      completed_at: null,
      model_call_status: "started",
      run_status: "running",
      session_status: "RUNNING",
      terminal_count: 0,
    });

    await expect(
      pushFreshController(createPublicHttpTestBindings(database) as ApiBindings, events),
    ).resolves.toHaveLength(2);
    await expect(
      pushFreshController(createPublicHttpTestBindings(database) as ApiBindings, events),
    ).resolves.toHaveLength(2);
    expect(
      await database
        .prepare(
          `SELECT r.status AS run_status, model_call.completed_at,
                  model_call.status AS model_call_status,
                  (SELECT COUNT(*) FROM session_event
                    WHERE session_id = ? AND event_type = 'run.completed') AS terminal_count
             FROM session_run AS r
             JOIN session_model_call AS model_call ON model_call.session_run_id = r.id
            WHERE r.id = ?`,
        )
        .bind(SESSION_ID, RUN_ID)
        .first(),
    ).toEqual({
      completed_at: expect.any(Number),
      model_call_status: "completed",
      run_status: "completed",
      terminal_count: 1,
    });

    await database
      .prepare(
        `UPDATE session_model_call
            SET completed_at = NULL, status = 'started'
          WHERE session_id = ? AND session_run_id = ?`,
      )
      .bind(SESSION_ID, RUN_ID)
      .run();
    const terminalEnvelope = events[1];

    if (terminalEnvelope === undefined) {
      throw new Error("Missing terminal usage test event.");
    }
    const canonicalTerminal = canonicalizeDriverEventEnvelope(
      { event: terminalEnvelope.event, eventId: terminalEnvelope.eventId },
      { traceId: "trace-canary" },
    );
    await expect(
      commitTerminalRunProjection(database, {
        assistantMessage: null,
        error: null,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        source: "driver",
        targetStatus: "completed",
        terminalEvent: {
          event: canonicalTerminal.event,
          occurredAt: Date.parse(canonicalTerminal.event.occurredAt),
          sourceEventId: canonicalTerminal.event.sourceEventId ?? null,
        },
      }),
    ).resolves.toMatchObject({ kind: "duplicate" });
    expect(
      await database
        .prepare(
          `SELECT completed_at, status
             FROM session_model_call
            WHERE session_id = ? AND session_run_id = ?`,
        )
        .bind(SESSION_ID, RUN_ID)
        .first(),
    ).toEqual({ completed_at: expect.any(Number), status: "completed" });
  });

  test("fails closed when active hydration sees a private row in a public stream", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const messageId = createPlatformId<SessionMessageId>();

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "message.added",
        payload: { content: "public", messageId, role: "agent" },
        sourceEventId: "active-mixed-visibility:public",
      }),
      runtimeEvent({
        kind: "message.delta",
        payload: { contentDelta: "private", messageId, role: "agent" },
        sourceEventId: "active-mixed-visibility:private",
        visibility: "owner_debug",
      }),
    ]);

    await expect(
      loadSessionViewerState(database, {
        sessionId: SESSION_ID,
        viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
      }),
    ).rejects.toThrow("mixed-visibility");
  });

  test("rejects an event batch after another Driver connection takes ownership", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    await database
      .prepare("UPDATE session_run SET started_at = NULL, status = 'booting' WHERE id = ?")
      .bind(RUN_ID)
      .run();
    await database.prepare("UPDATE session SET title = NULL WHERE id = ?").bind(SESSION_ID).run();
    let replaced = false;
    const replacedDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!replaced) {
              replaced = true;
              await target
                .prepare("UPDATE driver_instance SET connection_id = ? WHERE id = ?")
                .bind("replacement-connection", DRIVER_ID)
                .run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const bindings = createPublicHttpTestBindings(replacedDatabase) as ApiBindings;
    const events = [
      runtimeEvent({
        kind: "run.started",
        payload: { startedAt: new Date(1).toISOString() },
        sourceEventId: "superseded-driver:run-started",
      }),
      runtimeEvent({
        kind: "message.added",
        payload: {
          content: "must not persist",
          messageId: createPlatformId<SessionMessageId>(),
          role: "agent",
        },
        sourceEventId: "superseded-driver:message",
      }),
      runtimeEvent({
        kind: "session.info.updated",
        payload: { title: "Must not persist" },
        sourceEventId: "superseded-driver:title",
      }),
    ];

    await expect(pushFreshController(bindings, events)).rejects.toThrow(
      "lost its atomic session or active-run fence",
    );
    expect(replaced).toBe(true);
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 0 });
    expect(
      await database
        .prepare(
          `SELECT COUNT(*) AS count FROM session_event WHERE source_event_id IN (${events
            .map(() => "?")
            .join(", ")})`,
        )
        .bind(...events.map((event) => event.eventId))
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT started_at, status FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).toEqual({ started_at: null, status: "booting" });
    expect(
      await database.prepare("SELECT title FROM session WHERE id = ?").bind(SESSION_ID).first(),
    ).toEqual({ title: null });
  });

  test("commits run.started and its Run transition in one receipt batch", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    await database
      .prepare(
        "UPDATE session_run SET started_at = NULL, status = 'booting', status_seq = 0 WHERE id = ?",
      )
      .bind(RUN_ID)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const event = runtimeEvent({
      kind: "run.started",
      payload: { startedAt: new Date(1).toISOString() },
      sourceEventId: "atomic-run-started",
    });

    await pushFreshController(bindings, [event]);
    await pushFreshController(bindings, [event]);

    expect(
      await database
        .prepare(
          `SELECT r.started_at, r.status, r.status_seq, s.runtime_event_seq_cursor
           FROM session_run AS r
           INNER JOIN session AS s ON s.id = r.session_id
           WHERE r.id = ?`,
        )
        .bind(RUN_ID)
        .first(),
    ).toEqual({
      runtime_event_seq_cursor: 1,
      started_at: 1,
      status: "running",
      status_seq: 1,
    });
  });

  test("fences a runless Session event to the exact Driver connection", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    await database
      .prepare("UPDATE session_run SET completed_at = 2, status = 'completed' WHERE id = ?")
      .bind(RUN_ID)
      .run();
    await database
      .prepare("UPDATE session SET status = 'IDLE', title = NULL WHERE id = ?")
      .bind(SESSION_ID)
      .run();
    let replaced = false;
    const replacedDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!replaced) {
              replaced = true;
              await target
                .prepare("UPDATE driver_instance SET connection_id = ? WHERE id = ?")
                .bind("replacement-connection", DRIVER_ID)
                .run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const bindings = createPublicHttpTestBindings(replacedDatabase) as ApiBindings;
    const event = runtimeEvent({
      kind: "session.info.updated",
      payload: { title: "Must not persist" },
      runId: null,
      sourceEventId: "superseded-driver:runless-title",
    });

    await expect(pushFreshController(bindings, [event])).rejects.toThrow(
      "lost its atomic session or active-run fence",
    );
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor, title FROM session WHERE id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 0, title: null });
  });

  test("does not complete a Run after another Driver connection takes ownership", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const healthyBindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(
      healthyBindings,
      messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "superseded-terminal:message",
        text: "Sealed before reconnect.",
      }),
    );

    let replaced = false;
    const replacedDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!replaced) {
              replaced = true;
              await target
                .prepare("UPDATE driver_instance SET connection_id = ? WHERE id = ?")
                .bind("replacement-connection", DRIVER_ID)
                .run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const bindings = createPublicHttpTestBindings(replacedDatabase) as ApiBindings;

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId: TERMINAL_SOURCE_EVENT_ID,
        }),
      ]),
    ).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).toEqual({ status: "running" });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE source_event_id = ?")
        .bind(TERMINAL_SOURCE_EVENT_ID)
        .first(),
    ).toEqual({ count: 0 });
  });

  test.each([
    {
      artifactSandbox: { resolveError: new Error("injected missing sandbox") },
      name: "sandbox resolution",
    },
    {
      name: "conversation lookup",
      removeConversation: true,
    },
    {
      artifactSandbox: { listError: new Error("injected output listing failure") },
      name: "output listing",
    },
    {
      artifactSandbox: {
        files: new Map([["report.txt", "uncommitted"]]),
        readError: new Error("injected output read failure"),
      },
      name: "output read",
    },
    {
      artifactSandbox: {
        files: new Map([
          ["valid.txt", "capturable"],
          ["nested/tab\tline\n.txt", "unrepresentable"],
        ]),
      },
      name: "output filename",
    },
  ] as const)("commits terminal authority when artifact $name is unavailable", async (failure) => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(
      database,
      failure.artifactSandbox === undefined ? {} : { artifactSandbox: failure.artifactSandbox },
    ) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(
      bindings,
      messageEvents({
        messageId: finalMessageId,
        sourcePrefix: `artifact-failure:${failure.name}:message`,
        text: "This answer must remain canonical.",
      }),
    );
    if ("removeConversation" in failure) {
      await database
        .prepare("DELETE FROM sandbox_session WHERE session_id = ?")
        .bind(SESSION_ID)
        .run();
    }
    const sourceEventId = `artifact-failure:${failure.name}:run-completed`;

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId,
        }),
      ]),
    ).resolves.toHaveLength(1);
    expect(await readRuntimeArtifactManifest(database, TERMINAL_SOURCE_EVENT_ID)).toMatchObject({
      captureStatus: "omitted_runtime_unavailable",
      files: [],
      mode: "snapshot",
      sourceEventId: TERMINAL_SOURCE_EVENT_ID,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_artifact_head WHERE session_id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).toEqual({ status: "completed" });
  });

  test("accepts a mixed message and unavailable file change before a later terminal event", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const files = new Map([["report.txt", "existing artifact"]]);
    const bucket = new PublicApiMemoryFileBucket();
    const healthyBindings = createPublicHttpTestBindings(database, {
      artifactSandbox: { files },
      fileBucket: bucket,
    }) as ApiBindings;
    await pushFreshController(healthyBindings, [
      runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
        sourceEventId: "artifact-unavailable:existing",
      }),
    ]);
    const headBefore = await database
      .prepare(
        `SELECT file_id, runtime_event_seq, source_event_id
         FROM session_artifact_head
         WHERE session_id = ? AND source_path = 'outputs/report.txt'`,
      )
      .bind(SESSION_ID)
      .first();
    const messageId = createPlatformId<SessionMessageId>();
    const messageSourceEventId = "artifact-unavailable:message";
    const artifactSourceEventId = "artifact-unavailable:file";
    files.set("report.txt", "must not replace the existing head");

    await expect(
      pushFreshController(
        createPublicHttpTestBindings(database, {
          artifactSandbox: {
            files,
            readError: new Error("injected unavailable artifact content"),
          },
          fileBucket: bucket,
        }) as ApiBindings,
        [
          runtimeEvent({
            kind: "message.added",
            payload: { content: "Canonical despite artifact loss.", messageId, role: "agent" },
            sourceEventId: messageSourceEventId,
          }),
          runtimeEvent({
            kind: "file.changed",
            payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
            sourceEventId: artifactSourceEventId,
          }),
        ],
      ),
    ).resolves.toHaveLength(2);

    expect(await readRuntimeArtifactManifest(database, artifactSourceEventId)).toMatchObject({
      captureStatus: "omitted_runtime_unavailable",
      files: [],
      mode: "delta",
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE source_event_id = ?")
        .bind(messageSourceEventId)
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await database
        .prepare(
          `SELECT file_id, runtime_event_seq, source_event_id
           FROM session_artifact_head
           WHERE session_id = ? AND source_path = 'outputs/report.txt'`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual(headBefore);

    await expect(
      pushFreshController(healthyBindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId: "artifact-unavailable:terminal",
        }),
      ]),
    ).resolves.toHaveLength(1);
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).toEqual({ status: "completed" });
  });

  test.each(["create", "claim", "put", "seal", "commit"] as const)(
    "converges after artifact %s acknowledgement loss and collects losers",
    async (phase) => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const sourceEventId = `artifact-ack-loss:${phase}`;
      const files = new Map([["report.txt", "before-receipt"]]);
      const bucket = new PublicApiMemoryFileBucket();
      const databaseFailure =
        phase === "commit"
          ? failAfterRuntimeArtifactCommit(database, sourceEventId)
          : phase === "put"
            ? { database, wasInjected: () => false }
            : failAfterRuntimeArtifactDatabaseWrite(database, phase);
      const putFailure =
        phase === "put"
          ? failAfterRuntimeArtifactPut(bucket)
          : { bucket: bucket as unknown as R2Bucket, wasInjected: () => false };
      const event = runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
        sourceEventId,
      });

      const firstPush = pushFreshController(
        createPublicHttpTestBindings(databaseFailure.database, {
          artifactSandbox: { files },
          fileBucket: putFailure.bucket,
        }) as ApiBindings,
        [event],
      );
      if (phase === "put") {
        await expect(firstPush).resolves.toHaveLength(1);
      } else {
        await expect(firstPush).rejects.toThrow(`injected artifact ${phase} acknowledgement loss`);
      }
      expect(databaseFailure.wasInjected() || putFailure.wasInjected()).toBe(true);

      files.set("report.txt", "canonical-after-retry");
      const replayReads: string[] = [];
      await expect(
        pushFreshController(
          createPublicHttpTestBindings(database, {
            artifactSandbox: { files, onRead: (path) => replayReads.push(path) },
            fileBucket: bucket as unknown as R2Bucket,
          }) as ApiBindings,
          [event],
        ),
      ).resolves.toHaveLength(1);

      const attempts = await database
        .prepare(
          `SELECT accepted_event_id, id, owned_object_keys_json, status
         FROM runtime_artifact_attempt
         WHERE session_id = ? AND source_event_id = ?
         ORDER BY id`,
        )
        .bind(SESSION_ID, sourceEventId)
        .all<{
          accepted_event_id: string | null;
          id: string;
          owned_object_keys_json: string;
          status: string;
        }>();
      const accepted = attempts.results.filter((attempt) => attempt.status === "accepted");
      const losers = attempts.results.filter((attempt) => attempt.status !== "accepted");
      expect(accepted).toHaveLength(1);
      expect(losers).toHaveLength(phase === "commit" ? 0 : 1);
      expect(
        await database
          .prepare("SELECT COUNT(*) AS count FROM session_event WHERE source_event_id = ?")
          .bind(sourceEventId)
          .first(),
      ).toEqual({ count: 1 });
      expect(
        await database
          .prepare(
            `SELECT COUNT(*) AS count
           FROM session_artifact_head
           WHERE session_id = ? AND source_path = 'outputs/report.txt'
             AND source_event_id = ? AND file_id IS NOT NULL`,
          )
          .bind(SESSION_ID, sourceEventId)
          .first(),
      ).toEqual({ count: phase === "put" ? 0 : 1 });

      const acceptedManifest = await readRuntimeArtifactManifest(database, sourceEventId);
      const winnerObjectKey = acceptedManifest.files[0]?.objectKey;
      expect(acceptedManifest.captureStatus).toBe(
        phase === "put" ? "omitted_runtime_unavailable" : "complete",
      );
      if (winnerObjectKey !== undefined) {
        const winner = await bucket.get(winnerObjectKey);
        expect(await winner?.text()).toBe(
          phase === "commit" ? "before-receipt" : "canonical-after-retry",
        );
      }
      expect(replayReads).toEqual(
        phase === "commit" || phase === "put" ? [] : ["/workspace/outputs/report.txt"],
      );

      if (losers.length > 0) {
        await database
          .prepare(
            `UPDATE runtime_artifact_attempt
           SET created_at = 0, expires_at = 0, updated_at = 0
           WHERE id = ? AND status IN ('staging', 'staged')`,
          )
          .bind(losers[0]!.id)
          .run();
        await cleanupRuntimeArtifactAttempts(
          createPublicHttpTestBindings(database, {
            fileBucket: bucket as unknown as R2Bucket,
          }) as ApiBindings,
        );
        expect(
          await database
            .prepare("SELECT status FROM runtime_artifact_attempt WHERE id = ?")
            .bind(losers[0]!.id)
            .first(),
        ).toEqual({ status: "deleting" });
        if (winnerObjectKey !== undefined) {
          expect(await bucket.head(winnerObjectKey)).not.toBeNull();
        }
        for (const objectKey of JSON.parse(losers[0]!.owned_object_keys_json) as string[]) {
          expect(await bucket.head(objectKey)).toBeNull();
        }

        await database
          .prepare(
            `UPDATE runtime_artifact_attempt
           SET delete_after = 0, updated_at = 0
           WHERE id = ? AND status = 'deleting'`,
          )
          .bind(losers[0]!.id)
          .run();
        await cleanupRuntimeArtifactAttempts(
          createPublicHttpTestBindings(database, {
            fileBucket: bucket as unknown as R2Bucket,
          }) as ApiBindings,
        );
        expect(
          await database
            .prepare("SELECT id FROM runtime_artifact_attempt WHERE id = ?")
            .bind(losers[0]!.id)
            .first(),
        ).toBeNull();
      }
      if (winnerObjectKey !== undefined) {
        expect(await bucket.head(winnerObjectKey)).not.toBeNull();
      }
    },
  );

  test("accepts a 101-file completion omission without hiding prior artifacts", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const files = new Map([["existing.txt", "previous artifact"]]);
    const readPaths: string[] = [];
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: { files, onRead: (path) => readPaths.push(path) },
      fileBucket: new PublicApiMemoryFileBucket(),
    }) as ApiBindings;

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "upsert", path: "outputs/existing.txt" }] },
        sourceEventId: "artifact-quota:file-before-completion",
      }),
    ]);
    files.clear();
    for (let index = 0; index < 101; index += 1) {
      files.set(`generated-${String(index).padStart(3, "0")}.txt`, "x");
    }
    const sourceEventId = "artifact-quota:101-files-completed";

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId,
        }),
      ]),
    ).resolves.toHaveLength(1);

    const row = await database
      .prepare(
        `SELECT head.file_id, head.runtime_event_seq, attempt.status AS attempt_status,
                run.status AS run_status
           FROM session_event AS event
           INNER JOIN runtime_artifact_attempt AS attempt
             ON attempt.id = event.artifact_attempt_id
           INNER JOIN session_run AS run ON run.id = event.run_id
           INNER JOIN session_artifact_head AS head
             ON head.session_id = event.session_id
            AND head.source_path = 'outputs/existing.txt'
          WHERE event.source_event_id = ?`,
      )
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .first<{
        attempt_status: string;
        file_id: string | null;
        run_status: string;
        runtime_event_seq: number;
      }>();
    expect(await readRuntimeArtifactManifest(database, TERMINAL_SOURCE_EVENT_ID)).toMatchObject({
      captureStatus: "omitted_file_limit",
      files: [],
      mode: "snapshot",
    });
    expect(row).toMatchObject({
      attempt_status: "accepted",
      file_id: expect.any(String),
      run_status: "completed",
      runtime_event_seq: 1,
    });
    expect(readPaths).toEqual(["/workspace/outputs/existing.txt"]);
  });

  test.each([
    {
      fileSizes: new Map([["large.bin", RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES + 1]]),
      files: new Map([["large.bin", "must not be read"]]),
      name: "single-file limit",
    },
    {
      fileSizes: new Map([
        ["one.bin", Math.floor(RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES / 2) + 1],
        ["two.bin", Math.floor(RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES / 2) + 1],
      ]),
      files: new Map([
        ["one.bin", "must not be read"],
        ["two.bin", "must not be read"],
      ]),
      name: "total-byte limit",
    },
  ])("accepts a completion omitted by the artifact $name", async ({ fileSizes, files, name }) => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: {
        fileSizes,
        files,
        readError: new Error("quota omission must not read content"),
      },
    }) as ApiBindings;
    const sourceEventId = `artifact-quota:${name}`;

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId,
        }),
      ]),
    ).resolves.toHaveLength(1);

    const row = await database
      .prepare(
        `SELECT attempt.status AS attempt_status, run.status AS run_status
           FROM session_event AS event
           INNER JOIN runtime_artifact_attempt AS attempt
             ON attempt.id = event.artifact_attempt_id
           INNER JOIN session_run AS run ON run.id = event.run_id
          WHERE event.source_event_id = ?`,
      )
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .first<{
        attempt_status: string;
        run_status: string;
      }>();
    expect(await readRuntimeArtifactManifest(database, TERMINAL_SOURCE_EVENT_ID)).toMatchObject({
      captureStatus: "omitted_size_limit",
      files: [],
      mode: "snapshot",
    });
    expect(row).toMatchObject({ attempt_status: "accepted", run_status: "completed" });
  });

  test("accepts an oversized file change before the terminal event", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const files = new Map([["large.bin", "must not be read"]]);
    const fileSizes = new Map([["large.bin", RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES + 1]]);
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: {
        fileSizes,
        files,
        readError: new Error("quota omission must not read content"),
      },
    }) as ApiBindings;
    const deltaSourceEventId = "artifact-quota:oversized-delta";

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "file.changed",
          payload: { changes: [{ change: "upsert", path: "outputs/large.bin" }] },
          sourceEventId: deltaSourceEventId,
        }),
      ]),
    ).resolves.toHaveLength(1);
    files.clear();
    fileSizes.clear();
    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId: "artifact-quota:terminal-after-oversized-delta",
        }),
      ]),
    ).resolves.toHaveLength(1);

    expect(await readRuntimeArtifactManifest(database, deltaSourceEventId)).toMatchObject({
      captureStatus: "omitted_size_limit",
      files: [],
      mode: "delta",
    });
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).toEqual({ status: "completed" });
  });

  test("deduplicates a missing upsert before the later delete does sandbox I/O", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: { files: new Map() },
    }) as ApiBindings;
    const events = [
      runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "upsert", path: "outputs/removed.txt" }] },
        sourceEventId: "artifact-missing:upsert",
      }),
      runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "delete", path: "outputs/removed.txt" }] },
        sourceEventId: "artifact-missing:delete",
      }),
    ];

    await expect(pushFreshController(bindings, events)).resolves.toHaveLength(2);
    expect(
      await database
        .prepare(
          `SELECT file_id, source_event_id
             FROM session_artifact_head
            WHERE session_id = ? AND source_path = 'outputs/removed.txt'`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ file_id: null, source_event_id: "artifact-missing:delete" });
    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId: "artifact-missing:terminal-after-delete",
        }),
      ]),
    ).resolves.toHaveLength(1);

    expect(
      await database
        .prepare(
          `SELECT file_id, source_event_id
             FROM session_artifact_head
            WHERE session_id = ? AND source_path = 'outputs/removed.txt'`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ file_id: null, source_event_id: TERMINAL_SOURCE_EVENT_ID });
  });

  test("accepts a file upsert whose historical sandbox source is gone", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: { files: new Map() },
    }) as ApiBindings;
    const sourceEventId = "artifact-missing:historical-upsert";

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "file.changed",
          payload: { changes: [{ change: "upsert", path: "outputs/gone.txt" }] },
          sourceEventId,
        }),
      ]),
    ).resolves.toHaveLength(1);
    expect(await readRuntimeArtifactManifest(database, sourceEventId)).toMatchObject({
      captureStatus: "omitted_source_missing",
      files: [],
      mode: "delta",
    });

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId: "artifact-missing:terminal-after-historical-upsert",
        }),
      ]),
    ).resolves.toHaveLength(1);
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).toEqual({ status: "completed" });
  });

  test("bounds a file that grows beyond quota between stat and read", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const files = new Map([["growing.bin", "x".repeat(RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES + 1)]]);
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: {
        fileSizes: new Map([["growing.bin", 1]]),
        files,
      },
    }) as ApiBindings;

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId: "artifact-quota:growing-file",
        }),
      ]),
    ).resolves.toHaveLength(1);

    expect(await readRuntimeArtifactManifest(database, TERMINAL_SOURCE_EVENT_ID)).toMatchObject({
      captureStatus: "omitted_size_limit",
      files: [],
      mode: "snapshot",
    });
  });

  test("omits a source that changes below quota between stat and read", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const files = new Map([["report.txt", "old"]]);
    const fileSizes = new Map<string, number>();
    const bindings = createPublicHttpTestBindings(database, {
      artifactSandbox: { fileSizes, files },
      fileBucket: new PublicApiMemoryFileBucket(),
    }) as ApiBindings;
    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
        sourceEventId: "artifact-changed:existing",
      }),
    ]);
    const headBefore = await database
      .prepare(
        `SELECT file_id, runtime_event_seq, source_event_id
         FROM session_artifact_head
         WHERE session_id = ? AND source_path = 'outputs/report.txt'`,
      )
      .bind(SESSION_ID)
      .first();
    files.set("report.txt", "x");
    fileSizes.set("report.txt", 2);
    const sourceEventId = "artifact-changed:delta";

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "file.changed",
          payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
          sourceEventId,
        }),
      ]),
    ).resolves.toHaveLength(1);
    expect(await readRuntimeArtifactManifest(database, sourceEventId)).toMatchObject({
      captureStatus: "omitted_source_changed",
      files: [],
      mode: "delta",
    });
    expect(
      await database
        .prepare(
          `SELECT file_id, runtime_event_seq, source_event_id
           FROM session_artifact_head
           WHERE session_id = ? AND source_path = 'outputs/report.txt'`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual(headBefore);

    fileSizes.clear();
    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { stopReason: "end_turn" },
          sourceEventId: "artifact-changed:terminal",
        }),
      ]),
    ).resolves.toHaveLength(1);
    expect(
      await database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).toEqual({ status: "completed" });
  });

  test("omits an artifact delta batch when a later same-path capture is unavailable", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const files = new Map([["report.txt", "existing"]]);
    const bucket = new PublicApiMemoryFileBucket();
    const healthyBindings = createPublicHttpTestBindings(database, {
      artifactSandbox: { files },
      fileBucket: bucket,
    }) as ApiBindings;
    await pushFreshController(healthyBindings, [
      runtimeEvent({
        kind: "file.changed",
        payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
        sourceEventId: "artifact-batch-unavailable:existing",
      }),
    ]);
    const headBefore = await database
      .prepare(
        `SELECT file_id, runtime_event_seq, source_event_id
         FROM session_artifact_head
         WHERE session_id = ? AND source_path = 'outputs/report.txt'`,
      )
      .bind(SESSION_ID)
      .first();
    const sourceEventIds = [
      "artifact-batch-unavailable:earlier",
      "artifact-batch-unavailable:later",
    ];

    await expect(
      pushFreshController(
        createPublicHttpTestBindings(database, {
          artifactSandbox: {
            files,
            resolveError: new Error("injected unavailable later capture"),
          },
          fileBucket: bucket,
        }) as ApiBindings,
        sourceEventIds.map((sourceEventId) =>
          runtimeEvent({
            kind: "file.changed",
            payload: { changes: [{ change: "upsert", path: "outputs/report.txt" }] },
            sourceEventId,
          }),
        ),
      ),
    ).resolves.toHaveLength(2);
    expect(
      await Promise.all(sourceEventIds.map((id) => readRuntimeArtifactManifest(database, id))),
    ).toEqual([
      expect.objectContaining({
        captureStatus: "omitted_runtime_unavailable",
        files: [],
        mode: "delta",
      }),
      expect.objectContaining({
        captureStatus: "omitted_runtime_unavailable",
        files: [],
        mode: "delta",
      }),
    ]);
    expect(
      await database
        .prepare(
          `SELECT file_id, runtime_event_seq, source_event_id
           FROM session_artifact_head
           WHERE session_id = ? AND source_path = 'outputs/report.txt'`,
        )
        .bind(SESSION_ID)
        .first(),
    ).toEqual(headBefore);
  });

  test("rejects fresh run events after terminal repair already won", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const failureSourceEventId = `session-run-terminal:${RUN_ID}:run.failed`;
    await recordCanonicalSessionRunFailure(bindings, {
      error: {
        code: "runtime.driver_terminal",
        details: {},
        message: "Driver disconnected.",
        retryable: true,
      },
      runId: RUN_ID,
      sessionId: SESSION_ID,
      source: "api",
    });
    await expect(
      loadSessionViewerState(database, {
        sessionId: SESSION_ID,
        viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
      }),
    ).resolves.toMatchObject({
      run: { error: { retryable: true } },
    });
    const messageId = createPlatformId<SessionMessageId>();
    const delta = runtimeEvent({
      kind: "message.delta",
      payload: { contentDelta: "durable prefix", messageId, role: "agent" },
      sourceEventId: "recovered-message-delta",
    });
    const failed = runtimeEvent({
      kind: "run.failed",
      payload: {
        error: {
          code: "runtime.driver_terminal",
          details: {},
          message: "Driver disconnected.",
          retryable: true,
        },
        recoverable: true,
      },
      sourceEventId: "driver-run-failed",
    });

    await expect(
      createController(bindings).handlePushEvents(
        { driverInstanceId: DRIVER_ID, events: [delta, failed] },
        activeContext,
      ),
    ).rejects.toThrow("conflicts with its durable receipt");

    const rows = await database
      .prepare(
        `SELECT event_type, source_event_id
           FROM session_event
          WHERE source_event_id IN (?, ?)
          ORDER BY seq`,
      )
      .bind(delta.eventId, failureSourceEventId)
      .all<{ event_type: string; source_event_id: string }>();
    expect(rows.results).toEqual([
      { event_type: "run.failed", source_event_id: failureSourceEventId },
    ]);
  });

  test.each([
    ["in the terminal RPC", false],
    ["before the terminal RPC", true],
  ] as const)(
    "persists one final assistant snapshot when the sealed stream arrives %s",
    async (_arrival, persistBeforeTerminal) => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const capturedEvents: unknown[] = [];
      setServerProductAnalyticsTransportForTests(async (_input, init) => {
        capturedEvents.push(JSON.parse(init.body as string) as unknown);
        return new Response(null, { status: 200 });
      });
      const bindings = {
        ...createPublicHttpTestBindings(database),
        POSTHOG_PROJECT_KEY: "phc_test",
      } as ApiBindings;
      const finalText = "The final answer.";
      const finalMessageId = createPlatformId<SessionMessageId>();
      const stream = messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "final-stream",
        text: finalText,
      });
      const terminal = runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: "final-stream:run-completed",
      });

      if (persistBeforeTerminal) {
        await pushFreshController(bindings, stream);
        await pushFreshController(bindings, [terminal]);
      } else {
        await pushFreshController(bindings, [...stream, terminal]);
      }

      const rows = await database
        .prepare(
          `SELECT content_text, ended_at, event_type, id, occurred_at, process_status,
                process_type, run_id, seq, stream_id, tokens
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
            sandbox_kind: "pet",
            sandbox_subject_kind: "agent",
            session_type: "ui",
          }),
        }),
      ]);
    },
  );

  test("keeps equal text from distinct progress and final message streams", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const progressMessageId = createPlatformId<SessionMessageId>();
    const finalMessageId = createPlatformId<SessionMessageId>();
    const text = "The same text belongs to two messages.";

    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: progressMessageId,
        sourcePrefix: "equal-text:progress",
        text,
      }),
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "equal-text:final",
        text,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: "equal-text:run-completed",
      }),
    ]);

    const rows = await database
      .prepare(
        `SELECT content_text, ended_at, event_type, id, occurred_at, process_status,
                process_type, run_id, seq, stream_id, tokens
           FROM session_event
          WHERE session_id = ? AND run_id = ?
          ORDER BY seq`,
      )
      .bind(SESSION_ID, RUN_ID)
      .all<SessionEventProcessRow>();
    const messageRows = rows.results.filter((row) => row.event_type === "message.added");
    const messages = createSessionProcessEventsFromSessionEventRows(rows.results).filter(
      (event) => event.type === "agent.message.delta",
    );

    expect(messageRows.map((row) => [row.stream_id, row.content_text])).toEqual([
      [progressMessageId, text],
      [finalMessageId, text],
    ]);
    expect(messages.map((message) => message.content)).toEqual([text, text]);
  });

  test("atomically seals a multi-megabyte final reference across hibernation and replay", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const syncedSessionIds: string[] = [];
    const bindings = createPublicHttpTestBindings(database, {
      sessionNamespace: createSessionSyncNamespace(syncedSessionIds),
    }) as ApiBindings;
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

    expect(
      (await pushFreshController(bindings, progressEvents)).map((receipt) => receipt.eventId),
    ).toEqual(progressEvents.map((event) => event.eventId));

    const toolEvents = [
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          parentMessageId: finalMessageId,
          rawInputDelta: '{"path":',
          status: "running",
          title: "Create artifact",
          toolCallId: "tool-canary",
        },
        sourceEventId: "canary:tool:started",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          rawInputDelta: '"report.md"}',
          rawOutputDelta: "creating ",
          status: "running",
          toolCallId: "tool-canary",
        },
        sourceEventId: "canary:tool:streamed",
      }),
    ];
    expect(await pushFreshController(bindings, toolEvents)).toHaveLength(toolEvents.length);

    const finalTextChunks = Array.from(
      { length: Math.ceil(LARGE_FINAL_TEXT.length / LARGE_FINAL_TEXT_CHUNK_CHARACTERS) },
      (_, index) =>
        LARGE_FINAL_TEXT.slice(
          index * LARGE_FINAL_TEXT_CHUNK_CHARACTERS,
          (index + 1) * LARGE_FINAL_TEXT_CHUNK_CHARACTERS,
        ),
    );
    const finalStreamEvents = [
      runtimeEvent({
        kind: "message.started",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "canary:final:started",
      }),
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
    expect(finalStreamEvents.length).toBeGreaterThan(1_000);
    const finalBatches = splitIntoBatches(finalStreamEvents, 64);

    for (const batch of finalBatches.slice(0, -1)) {
      expect(await pushFreshController(bindings, batch)).toHaveLength(batch.length);
    }

    const terminalBatch = [
      ...(finalBatches.at(-1) ?? []),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          rawInput: '{"path":"report.md"}',
          rawOutput: "artifact created",
          status: "completed",
          toolCallId: "tool-canary",
        },
        sourceEventId: "canary:tool:completed",
      }),
      runtimeEvent({
        kind: "message.completed",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "canary:final:completed",
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
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
    const driverReleaseBeforeReplay = await database
      .prepare("SELECT status_operation_id FROM driver_instance WHERE id = ?")
      .bind(DRIVER_ID)
      .first<{ status_operation_id: string | null }>();

    expect(completedRun?.status).toBe("running");
    expect(projectedMessagesBeforeReplay.results).toEqual([]);
    expect(new TextEncoder().encode(LARGE_FINAL_TEXT).byteLength).toBeGreaterThan(2_000_000);
    expect(finalOutputBeforeReplay).toBeNull();
    expect(terminalRowsBeforeReplay.results).toEqual([]);
    expect(driverReleaseBeforeReplay).toEqual({ status_operation_id: null });

    const crossBootTerminalBatch = [
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];
    const expectedCrossBootReceiptIds = crossBootTerminalBatch.map((event) => event.eventId);
    const crossBootDelivery: SessionDeliveryEvent[] = [];
    const structuralTerminalBindings = {
      ...bindings,
      DB: rejectSessionEventContentReads(database),
    } as ApiBindings;

    expect(
      (
        await createController(structuralTerminalBindings, (_sessionId, events) =>
          crossBootDelivery.push(...events),
        ).handlePushEvents(
          { driverInstanceId: DRIVER_ID, events: crossBootTerminalBatch },
          activeContext,
        )
      ).accepted.map((receipt) => receipt.eventId),
    ).toEqual(expectedCrossBootReceiptIds);
    expect(crossBootDelivery).toEqual([]);
    expect(syncedSessionIds).toEqual([SESSION_ID]);
    expect(
      (await pushFreshController(bindings, terminalBatch)).map((receipt) => receipt.eventId),
    ).toEqual(terminalBatch.map((event) => event.eventId));
    expect(syncedSessionIds).toEqual([SESSION_ID, SESSION_ID]);
    await expect(
      database
        .prepare("SELECT status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_ID)
        .first(),
    ).resolves.toEqual({ status_operation_id: RUN_ID });

    const projectedMessagesAfterReplay = await database
      .prepare(
        "SELECT content_text, id, plan_json, projection_format, segments_json FROM session_message WHERE session_run_id = ? ORDER BY seq",
      )
      .bind(RUN_ID)
      .all<{
        content_text: string;
        id: string;
        plan_json: string | null;
        projection_format: string;
        segments_json: string | null;
      }>();
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
      (message) => message.role === "assistant" && message.content === LARGE_FINAL_TEXT,
    );
    const measuredRecovery = measurePreparedQueries(database);
    const recoveryMessages = await getSessionRuntimeRecoveryMessages(measuredRecovery.database, {
      excludeRunId: null,
      sessionId: SESSION_ID,
    });

    expect(projectedMessagesAfterReplay.results).toEqual([
      {
        content_text: "",
        id: finalMessageId,
        plan_json: null,
        projection_format: "event_stream_v3",
        segments_json: null,
      },
    ]);
    expect(terminalRowsAfterReplay.results).toEqual([
      { source_event_id: TERMINAL_SOURCE_EVENT_ID },
    ]);
    expect(finalTranscriptMessage?.content).toBe(LARGE_FINAL_TEXT);
    expect(canonicalTranscriptMessages.map((message) => message.id)).toEqual([finalMessageId]);
    expect(finalTranscriptMessage?.content).not.toContain(PROGRESS_TEXTS.join(""));
    expect(finalTranscriptMessage?.segments.filter((segment) => segment.kind !== "text")).toEqual([
      {
        argsText: '{"path":"report.md"}',
        kind: "tool_use",
        path: null,
        runId: RUN_ID,
        tool: "Create artifact",
        toolCallId: "tool-canary",
      },
      {
        kind: "tool_result",
        output: "artifact created",
        runId: RUN_ID,
        tool: "Create artifact",
        toolCallId: "tool-canary",
      },
    ]);
    expect(LARGE_FINAL_TEXT.split("\n")).toContain("160|中文长文本校验-Aa9-表格字符|END160");
    expect(recoveryMessages).toEqual([
      { content: LARGE_FINAL_TEXT.slice(0, 32_000), role: "assistant" },
    ]);
    expect(measuredRecovery.readCount()).toBeLessThanOrEqual(10);
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

    expect(persistedMessage?.content_text).toBe("");
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

  test("fails closed when a v3 terminal coexists with a legacy terminal", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "mixed-terminal:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ]);
    const session = await database
      .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = ?")
      .bind(SESSION_ID)
      .first<{ runtime_event_seq_cursor: number }>();
    if (session === null) {
      throw new Error("Missing Session cursor fixture.");
    }
    await database
      .prepare(
        `UPDATE session_event
            SET artifact_attempt_id = NULL,
                artifact_manifest_json = NULL,
                artifact_manifest_sha256 = NULL,
                semantic_hash = NULL,
                terminal_event_json = NULL,
                source_event_id = 'legacy-terminal'
          WHERE source_event_id = ?`,
      )
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .run();
    const v3TerminalSeq = session.runtime_event_seq_cursor + 1;
    await insertRuntimeEvent(database, {
      eventId: createPlatformId<RuntimeEventId>(),
      kind: "run.completed",
      occurredAt: Date.now(),
      payload: { finalMessageId, stopReason: "end_turn" },
      runId: RUN_ID,
      seq: v3TerminalSeq,
      sessionId: SESSION_ID,
    });
    await database
      .prepare("UPDATE session SET runtime_event_seq_cursor = ? WHERE id = ?")
      .bind(v3TerminalSeq, SESSION_ID)
      .run();

    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).rejects.toThrow("not immutable");
    await expect(
      loadSessionViewerState(database, {
        sessionId: SESSION_ID,
        viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
      }),
    ).rejects.toThrow("terminal");
  });

  test("budgets v3 recovery text after streaming private-citation removal", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const visiblePrefix = "a".repeat(31_998);
    const visibleTail = "VISIBLE";
    const events = [
      runtimeEvent({
        kind: "message.added",
        payload: {
          content: `${visiblePrefix}\uE200ci`,
          messageId: finalMessageId,
          role: "agent",
        },
        sourceEventId: "recovery-citation:message-added",
      }),
      runtimeEvent({
        kind: "message.delta",
        payload: {
          contentDelta: `te\uE202${"private".repeat(800)}`,
          messageId: finalMessageId,
          role: "agent",
        },
        sourceEventId: "recovery-citation:message-delta-private",
      }),
      runtimeEvent({
        kind: "message.delta",
        payload: {
          contentDelta: `\uE201${visibleTail}`,
          messageId: finalMessageId,
          role: "agent",
        },
        sourceEventId: "recovery-citation:message-delta-tail",
      }),
      runtimeEvent({
        kind: "message.completed",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "recovery-citation:message-completed",
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];

    await pushFreshController(bindings, events);

    const stored = await database
      .prepare("SELECT projection_format FROM session_message WHERE id = ?")
      .bind(finalMessageId)
      .first<{ projection_format: string }>();
    const recoveryMessages = await getSessionRuntimeRecoveryMessages(database, {
      excludeRunId: null,
      sessionId: SESSION_ID,
    });

    expect(stored?.projection_format).toBe("event_stream_v3");
    expect(recoveryMessages).toEqual([
      { content: `${visiblePrefix}${visibleTail.slice(0, 2)}`, role: "assistant" },
    ]);
    expect(recoveryMessages[0]?.content).not.toContain("\uE200");
  });

  test.each([1_000, 2_000])(
    "seals bounded recovery at an exact %i-row page boundary",
    async (streamRowCount) => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const finalMessageId = createPlatformId<SessionMessageId>();
      const events = [
        runtimeEvent({
          kind: "message.added",
          payload: { content: "A", messageId: finalMessageId, role: "agent" },
          sourceEventId: `exact-page:${streamRowCount}:added`,
        }),
        ...Array.from({ length: streamRowCount - 2 }, (_, index) =>
          runtimeEvent({
            kind: "message.delta",
            payload: { contentDelta: "b", messageId: finalMessageId, role: "agent" },
            sourceEventId: `exact-page:${streamRowCount}:delta:${index}`,
          }),
        ),
        runtimeEvent({
          kind: "message.completed",
          payload: { messageId: finalMessageId, role: "agent" },
          sourceEventId: `exact-page:${streamRowCount}:completed`,
        }),
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId: TERMINAL_SOURCE_EVENT_ID,
        }),
      ];

      for (const batch of splitIntoBatches(events, 64)) {
        await pushFreshController(bindings, batch);
      }

      const measured = measurePreparedQueries(database);
      const recoveryMessages = await getSessionRuntimeRecoveryMessages(measured.database, {
        excludeRunId: null,
        sessionId: SESSION_ID,
      });

      expect(recoveryMessages).toEqual([
        { content: `A${"b".repeat(streamRowCount - 2)}`, role: "assistant" },
      ]);
      expect(measured.readCount()).toBeLessThanOrEqual(streamRowCount === 1_000 ? 8 : 10);
    },
  );

  test("omits live-only reasoning from stored final assistant segments", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const privateReasoningText = "Private reasoning should stay out of stored history.";
    const thoughtId = "private-reasoning";
    const events = [
      runtimeEvent({
        kind: "thought.started",
        payload: { messageId: finalMessageId, thoughtId },
        sourceEventId: "reasoning:started",
      }),
      runtimeEvent({
        kind: "thought.delta",
        payload: { contentDelta: privateReasoningText, messageId: finalMessageId, thoughtId },
        sourceEventId: "reasoning:delta",
      }),
      runtimeEvent({
        kind: "thought.completed",
        payload: { messageId: finalMessageId, thoughtId },
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
          stopReason: "end_turn",
        },
        sourceEventId: "reasoning:run-completed",
      }),
    ];

    await pushFreshController(bindings, events);

    const persistedMessage = await database
      .prepare(
        "SELECT content_text, projection_format, segments_json FROM session_message WHERE id = ?",
      )
      .bind(finalMessageId)
      .first<{ content_text: string; projection_format: string; segments_json: string | null }>();

    expect(persistedMessage).toEqual({
      content_text: "",
      projection_format: "event_stream_v3",
      segments_json: null,
    });
    const transcript = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    const finalMessage = transcript.messages.find((message) => message.id === finalMessageId);
    expect(finalMessage?.segments).toEqual([{ kind: "text", text: FINAL_TEXT }]);
    expect(JSON.stringify(finalMessage?.segments)).not.toContain(privateReasoningText);
  });

  test("rehydrates the shared failed-tool fallback without explicit output", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "message.added",
        payload: { content: "Finished.", messageId: finalMessageId, role: "agent" },
        sourceEventId: "failed-tool:message",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: {
          parentMessageId: finalMessageId,
          status: "running",
          title: "Shell",
          toolCallId: "failed-tool",
        },
        sourceEventId: "failed-tool:running",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: { status: "failed", toolCallId: "failed-tool" },
        sourceEventId: "failed-tool:failed",
      }),
      runtimeEvent({
        kind: "message.completed",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "failed-tool:message-completed",
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ]);

    const transcript = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    const finalMessage = transcript.messages.find((message) => message.id === finalMessageId);
    expect(finalMessage?.segments.filter((segment) => segment.kind !== "text")).toEqual([
      {
        argsText: "",
        kind: "tool_use",
        path: null,
        runId: RUN_ID,
        tool: "Shell",
        toolCallId: "failed-tool",
      },
      {
        kind: "tool_result",
        output: "Tool failed.",
        runId: RUN_ID,
        tool: "Shell",
        toolCallId: "failed-tool",
      },
    ]);
  });

  test("keeps a completed run's identity-free tool result after a newer run becomes latest", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const syncedSessionIds: string[] = [];
    const bindings = createPublicHttpTestBindings(database, {
      sessionNamespace: createSessionSyncNamespace(syncedSessionIds),
    }) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const toolCallId = "terminal-orphan-tool";
    const resultMessageId = createRuntimeToolResultMessageId({ runId: RUN_ID, toolCallId });
    const toolOutputOccurredAt = Date.parse("2026-08-30T04:00:00.000Z");

    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "terminal-orphan:message",
        text: "Finished.",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        payload: { status: "running", title: "Shell", toolCallId },
        sourceEventId: "terminal-orphan:running",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: toolOutputOccurredAt,
        payload: { rawOutputDelta: "A", status: "running", toolCallId },
        sourceEventId: "terminal-orphan:output-a",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: toolOutputOccurredAt + 1,
        payload: { rawOutputDelta: "B", status: "completed", toolCallId },
        sourceEventId: "terminal-orphan:output-b",
      }),
    ]);

    const active = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    const activeResult = active.messages.find((message) => message.id === resultMessageId);

    const terminalDelivery: SessionDeliveryEvent[] = [];
    await createController(bindings, (_sessionId, events) =>
      terminalDelivery.push(...events),
    ).handlePushEvents(
      {
        driverInstanceId: DRIVER_ID,
        events: [
          runtimeEvent({
            kind: "run.completed",
            payload: { finalMessageId, stopReason: "end_turn" },
            sourceEventId: TERMINAL_SOURCE_EVENT_ID,
          }),
        ],
      },
      activeContext,
    );
    expect(terminalDelivery).toEqual([]);
    expect(syncedSessionIds).toEqual([SESSION_ID]);

    const terminal = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect(terminal.messages.find((message) => message.id === resultMessageId)?.segments).toEqual(
      activeResult?.segments,
    );
    expect(activeResult?.segments).toEqual([
      {
        kind: "tool_result",
        output: "AB",
        runId: RUN_ID,
        tool: "Tool",
        toolCallId,
      },
    ]);

    const nextRunId = createPlatformId<SessionRunId>();
    await database
      .prepare(
        `INSERT INTO session_run (
           id, session_id, agent_id, created_by_account_id, deployment_version_id,
           deployment_version_number, driver_instance_id, trigger, status, provider,
           model, runtime_id, trace_id, started_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, 'user_prompt', 'running', 'openai',
                   'gpt-5.4', 'openai-runtime', 'trace-next', 2, 2, 2)`,
      )
      .bind(
        nextRunId,
        SESSION_ID,
        PUBLIC_API_TEST_IDS.agent,
        PUBLIC_API_TEST_IDS.ownerAccount,
        PUBLIC_API_TEST_IDS.deployment,
        DRIVER_ID,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING' WHERE id = ?")
      .bind(nextRunId, SESSION_ID)
      .run();

    const freshNextRun = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    const freshResults = freshNextRun.messages.filter((message) => message.id === resultMessageId);
    const carrierIndex = freshNextRun.messages.findIndex(
      (message) => message.id === finalMessageId,
    );
    expect(freshResults).toHaveLength(1);
    expect(freshResults[0]?.segments).toEqual(activeResult?.segments);
    expect(freshNextRun.messages.indexOf(freshResults[0])).toBe(carrierIndex + 1);
    expect(freshResults[0]?.createdAt).toBe(new Date(toolOutputOccurredAt).toISOString());

    const repeatedFreshNextRun = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect(repeatedFreshNextRun.messages).toEqual(freshNextRun.messages);
    const publicFreshNextRun = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.outsiderAccount,
    });
    expect(publicFreshNextRun.messages).toEqual(freshNextRun.messages);
  });

  test("canonicalizes nonfinal and result-first tools into one terminal carrier", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const syncedSessionIds: string[] = [];
    const bindings = createPublicHttpTestBindings(database, {
      sessionNamespace: createSessionSyncNamespace(syncedSessionIds),
    }) as ApiBindings;
    const progressMessageId = createPlatformId<SessionMessageId>();
    const finalMessageId = createPlatformId<SessionMessageId>();
    const finalOccurredAt = Date.parse("2026-08-30T07:00:00.000Z");
    const carrierOccurredAt = finalOccurredAt + 2;

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "message.added",
        occurredAt: finalOccurredAt - 2,
        payload: { content: "Progress", messageId: progressMessageId, role: "agent" },
        sourceEventId: "carrier-routes:progress",
      }),
      runtimeEvent({
        kind: "message.completed",
        occurredAt: finalOccurredAt - 1,
        payload: { messageId: progressMessageId, role: "agent" },
        sourceEventId: "carrier-routes:progress-completed",
      }),
      runtimeEvent({
        kind: "message.added",
        occurredAt: finalOccurredAt,
        payload: { content: "Final", messageId: finalMessageId, role: "agent" },
        sourceEventId: "carrier-routes:final",
      }),
      runtimeEvent({
        kind: "message.completed",
        occurredAt: finalOccurredAt + 1,
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "carrier-routes:final-completed",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt,
        payload: {
          parentMessageId: progressMessageId,
          rawInput: '{"a":1}',
          status: "running",
          title: "Progress tool",
          toolCallId: "progress-tool",
        },
        sourceEventId: "carrier-routes:progress-use",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt + 1,
        payload: { rawOutput: "progress output", status: "completed", toolCallId: "progress-tool" },
        sourceEventId: "carrier-routes:progress-result",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt + 2,
        payload: {
          parentMessageId: progressMessageId,
          rawInput: '{"b":2}',
          status: "running",
          title: "Use only",
          toolCallId: "use-only-tool",
        },
        sourceEventId: "carrier-routes:use-only",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt + 3,
        payload: {
          rawOutput: "result first",
          status: "completed",
          toolCallId: "result-first-tool",
        },
        sourceEventId: "carrier-routes:result-first",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt + 4,
        payload: {
          parentMessageId: finalMessageId,
          rawInput: '{"c":3}',
          status: "completed",
          title: "Result first",
          toolCallId: "result-first-tool",
        },
        sourceEventId: "carrier-routes:result-later-parent",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt + 5,
        payload: {
          parentMessageId: finalMessageId,
          rawInput: '{"d":4}',
          status: "running",
          title: "Final tool",
          toolCallId: "final-tool",
        },
        sourceEventId: "carrier-routes:final-use",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt + 6,
        payload: { rawOutput: "final output", status: "completed", toolCallId: "final-tool" },
        sourceEventId: "carrier-routes:final-result",
      }),
    ]);

    const active = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect(
      active.messages.find((message) => message.id === progressMessageId)?.segments,
    ).toHaveLength(4);
    expect(active.messages.find((message) => message.id === RUN_ID)?.segments).toHaveLength(2);
    expect(active.messages.find((message) => message.id === finalMessageId)?.segments).toHaveLength(
      3,
    );

    const terminalDelivery: SessionDeliveryEvent[] = [];
    await createController(bindings, (_sessionId, events) =>
      terminalDelivery.push(...events),
    ).handlePushEvents(
      {
        driverInstanceId: DRIVER_ID,
        events: [
          runtimeEvent({
            kind: "run.completed",
            payload: { finalMessageId, stopReason: "end_turn" },
            sourceEventId: "carrier-routes:terminal",
          }),
        ],
      },
      activeContext,
    );
    expect(terminalDelivery).toEqual([]);
    expect(syncedSessionIds).toEqual([SESSION_ID]);

    const fresh = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.ownerAccount,
    });
    expect(fresh.messages.find((message) => message.id === progressMessageId)).toBeUndefined();
    expect(
      fresh.messages
        .filter((message) => message.id === finalMessageId || message.id === RUN_ID)
        .map(({ createdAt, id }) => ({ createdAt, id })),
    ).toEqual([
      { createdAt: new Date(finalOccurredAt).toISOString(), id: finalMessageId },
      { createdAt: new Date(carrierOccurredAt).toISOString(), id: RUN_ID },
    ]);
    expect(fresh.messages.find((message) => message.id === finalMessageId)?.segments).toEqual([
      { kind: "text", text: "Final" },
      {
        argsText: '{"d":4}',
        kind: "tool_use",
        path: null,
        runId: RUN_ID,
        tool: "Final tool",
        toolCallId: "final-tool",
      },
      {
        kind: "tool_result",
        output: "final output",
        runId: RUN_ID,
        tool: "Final tool",
        toolCallId: "final-tool",
      },
    ]);
    expect(fresh.messages.find((message) => message.id === RUN_ID)?.segments).toEqual([
      {
        argsText: '{"a":1}',
        kind: "tool_use",
        path: null,
        runId: RUN_ID,
        tool: "Progress tool",
        toolCallId: "progress-tool",
      },
      {
        kind: "tool_result",
        output: "progress output",
        runId: RUN_ID,
        tool: "Progress tool",
        toolCallId: "progress-tool",
      },
      {
        argsText: '{"b":2}',
        kind: "tool_use",
        path: null,
        runId: RUN_ID,
        tool: "Use only",
        toolCallId: "use-only-tool",
      },
      {
        argsText: '{"c":3}',
        kind: "tool_use",
        path: null,
        runId: RUN_ID,
        tool: "Result first",
        toolCallId: "result-first-tool",
      },
      {
        kind: "tool_result",
        output: "result first",
        runId: RUN_ID,
        tool: "Result first",
        toolCallId: "result-first-tool",
      },
    ]);
    const publicFresh = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.outsiderAccount,
    });
    expect(publicFresh.messages).toEqual(fresh.messages);
  });

  for (const toolFirst of [false, true]) {
    test(`merges a ${toolFirst ? "tool-before-final" : "final-before-tool"} carrier when the final id is the run id`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const finalMessageId = RUN_ID as unknown as SessionMessageId;
      const firstOccurredAt = Date.parse("2026-08-30T08:00:00.000Z");
      const message = runtimeEvent({
        kind: "message.added",
        occurredAt: firstOccurredAt + (toolFirst ? 2 : 0),
        payload: { content: "Same id final", messageId: finalMessageId, role: "agent" },
        sourceEventId: `same-id:${toolFirst}:message`,
      });
      const completed = runtimeEvent({
        kind: "message.completed",
        occurredAt: firstOccurredAt + (toolFirst ? 3 : 1),
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: `same-id:${toolFirst}:message-completed`,
      });
      const tool = runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: firstOccurredAt + (toolFirst ? 0 : 2),
        payload: {
          rawOutput: "same id output",
          status: "completed",
          toolCallId: "same-id-tool",
        },
        sourceEventId: `same-id:${toolFirst}:tool`,
      });

      await pushFreshController(bindings, [
        ...(toolFirst ? [tool, message, completed] : [message, completed, tool]),
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId: `same-id:${toolFirst}:terminal`,
        }),
      ]);

      const rows = await database
        .prepare(
          `SELECT created_at, id
           FROM session_message
           WHERE session_id = ? AND session_run_id = ? AND role = 'assistant'
           ORDER BY seq`,
        )
        .bind(SESSION_ID, RUN_ID)
        .all<{ created_at: number; id: string }>();
      expect(rows.results).toEqual([{ created_at: firstOccurredAt, id: RUN_ID }]);
      const fresh = await loadSessionViewerState(database, {
        sessionId: SESSION_ID,
        viewerId: PUBLIC_API_TEST_IDS.outsiderAccount,
      });
      const merged = fresh.messages.filter((candidate) => candidate.id === RUN_ID);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.createdAt).toBe(new Date(firstOccurredAt).toISOString());
      expect(merged[0]?.segments).toEqual(
        toolFirst
          ? [
              {
                kind: "tool_result",
                output: "same id output",
                runId: RUN_ID,
                tool: "Tool",
                toolCallId: "same-id-tool",
              },
              { kind: "text", text: "Same id final" },
            ]
          : [
              { kind: "text", text: "Same id final" },
              {
                kind: "tool_result",
                output: "same id output",
                runId: RUN_ID,
                tool: "Tool",
                toolCallId: "same-id-tool",
              },
            ],
      );
    });
  }

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
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];
    await expect(pushFreshController(bindings, terminalBatch)).resolves.toHaveLength(
      terminalBatch.length,
    );

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
          stopReason: "end_turn",
        },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ];

    await expect(pushFreshController(bindings, conflictingReplay)).rejects.toBeInstanceOf(Error);

    const messages = await database
      .prepare("SELECT content_text, id FROM session_message WHERE session_run_id = ? ORDER BY seq")
      .bind(RUN_ID)
      .all<{ content_text: string; id: string }>();
    const terminalRows = await database
      .prepare("SELECT source_event_id FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .all<{ source_event_id: string }>();

    expect(messages.results).toEqual([{ content_text: "", id: finalMessageId }]);
    expect(terminalRows.results).toEqual([{ source_event_id: TERMINAL_SOURCE_EVENT_ID }]);
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
    await expect(
      recordDriverInstanceCompletion(bindings, {
        driverInstanceId: DRIVER_ID,
        sessionRunId: RUN_ID,
      }),
    ).rejects.toThrow("Completed Session Run is missing its canonical terminal event.");

    await expect(
      readPublicThreadRunFinalOutput({
        database,
        runId: RUN_ID,
        sessionId: SESSION_ID,
      }),
    ).resolves.toBeNull();
    const messages = await database
      .prepare("SELECT id FROM session_message WHERE session_run_id = ?")
      .bind(RUN_ID)
      .all<{ id: string }>();

    expect(messages.results).toEqual([]);
  });

  test("rejects a failure RPC after another Driver connection takes ownership", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare("UPDATE driver_instance SET connection_id = ?, generation = 1 WHERE id = ?")
      .bind("replacement-connection", DRIVER_ID)
      .run();

    await expect(
      recordDriverInstanceFailure(bindings, {
        driverConnectionId: "canary-connection",
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        sessionRunId: RUN_ID,
        error: {
          code: "driver.disconnected",
          details: {},
          message: "The superseded Driver disconnected.",
          retryable: true,
        },
      }),
    ).rejects.toThrow("lost a concurrent running race");

    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    const terminalEvents = await database
      .prepare(
        "SELECT id FROM session_event WHERE run_id = ? AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')",
      )
      .bind(RUN_ID)
      .all();

    expect(run?.status).toBe("running");
    expect(terminalEvents.results).toEqual([]);
  });

  test("a late run-one terminal RPC cannot touch the active run-two lease", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const nextRunId = createPlatformId<SessionRunId>();

    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      error: null,
      runId: RUN_ID,
      sessionId: SESSION_ID,
      source: "api",
      status: "completed",
    });
    await database
      .prepare(
        `INSERT INTO session_run (
           id, session_id, agent_id, created_by_account_id, deployment_version_id,
           deployment_version_number, driver_instance_id, trigger, status, provider,
           model, runtime_id, trace_id, started_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, 'user_prompt', 'running', 'openai',
                   'gpt-5.4', 'openai-runtime', 'trace-next', 2, 2, 2)`,
      )
      .bind(
        nextRunId,
        SESSION_ID,
        PUBLIC_API_TEST_IDS.agent,
        PUBLIC_API_TEST_IDS.ownerAccount,
        PUBLIC_API_TEST_IDS.deployment,
        DRIVER_ID,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING' WHERE id = ?")
      .bind(nextRunId, SESSION_ID)
      .run();

    await expect(
      recordDriverInstanceCompletion(bindings, {
        driverConnectionId: "canary-connection",
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        sessionRunId: RUN_ID,
      }),
    ).rejects.toThrow("lost a concurrent completed race");
    await expect(
      database.prepare("SELECT status FROM session_run WHERE id = ?").bind(nextRunId).first(),
    ).resolves.toEqual({ status: "running" });
    await expect(
      database
        .prepare("SELECT last_run_id, status, status_operation_id FROM session WHERE id = ?")
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual({
      last_run_id: nextRunId,
      status: "RUNNING",
      status_operation_id: null,
    });
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_ID)
        .first(),
    ).resolves.toEqual({ status: "ready", status_operation_id: null });
  });

  test("returns no final output for a canonical completion without a final message", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "run.completed",
        payload: { stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ]);

    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toBeNull();
  });

  for (const terminalCase of [
    {
      kind: "run.completed" as const,
      payload: { stopReason: "end_turn" },
      status: "completed",
    },
    {
      kind: "run.failed" as const,
      payload: {
        error: {
          code: "driver.provider_failed",
          details: {},
          message: "Provider failed after tool output.",
          retryable: false,
        },
        recoverable: false,
      },
      status: "failed",
    },
    {
      kind: "run.cancelled" as const,
      payload: { reason: "session.stop" },
      status: "cancelled",
    },
  ]) {
    test(`persists a ${terminalCase.status} run's parentless tool deltas without a final message`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const toolOccurredAt = Date.parse("2026-08-30T06:00:00.000Z");

      await pushFreshController(bindings, [
        runtimeEvent({
          kind: "tool.call.updated",
          occurredAt: toolOccurredAt,
          payload: {
            rawOutputDelta: "A",
            status: "running",
            toolCallId: "terminal-no-final-tool",
          },
          sourceEventId: `${terminalCase.status}:tool-output-a`,
        }),
        runtimeEvent({
          kind: "tool.call.updated",
          occurredAt: toolOccurredAt + 1,
          payload: {
            rawOutputDelta: "B",
            status: "completed",
            toolCallId: "terminal-no-final-tool",
          },
          sourceEventId: `${terminalCase.status}:tool-output-b`,
        }),
        runtimeEvent({
          kind: terminalCase.kind,
          payload: terminalCase.payload,
          sourceEventId: `${terminalCase.status}:terminal`,
        }),
      ]);

      const rows = await database
        .prepare(
          `SELECT created_at, id, projection_format
           FROM session_message
           WHERE session_id = ? AND session_run_id = ? AND role = 'assistant'
           ORDER BY seq`,
        )
        .bind(SESSION_ID, RUN_ID)
        .all<{ created_at: number; id: string; projection_format: string }>();
      expect(rows.results).toEqual([
        {
          created_at: toolOccurredAt,
          id: RUN_ID,
          projection_format: "event_stream_v3",
        },
      ]);
      const fresh = await loadSessionViewerState(database, {
        sessionId: SESSION_ID,
        viewerId: PUBLIC_API_TEST_IDS.outsiderAccount,
      });
      expect(fresh.messages.find((message) => message.id === RUN_ID)).toEqual(
        expect.objectContaining({
          content: "",
          createdAt: new Date(toolOccurredAt).toISOString(),
          segments: [
            {
              kind: "tool_result",
              output: "AB",
              runId: RUN_ID,
              tool: "Tool",
              toolCallId: "terminal-no-final-tool",
            },
          ],
        }),
      );
    });
  }

  test("adopts a canonical completion RPC replay without creating another terminal event", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();

    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "completion-rpc-replay:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: "provider-completion-id",
      }),
    ]);

    const operationId = createPlatformId<RuntimeOperationId>();
    await database
      .prepare(
        `UPDATE session
         SET status = 'RESCHEDULING', status_operation_id = ?, status_seq = status_seq + 1
         WHERE id = ?`,
      )
      .bind(operationId, SESSION_ID)
      .run();
    const sessionBeforeReplay = await database
      .prepare(
        `SELECT last_run_id, message_seq_cursor, runtime_event_seq_cursor,
                status, status_operation_id, status_seq
         FROM session WHERE id = ?`,
      )
      .bind(SESSION_ID)
      .first();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await recordDriverInstanceCompletion(bindings, {
        driverInstanceId: DRIVER_ID,
        sessionRunId: RUN_ID,
      });
    }
    const sessionAfterReplay = await database
      .prepare(
        `SELECT last_run_id, message_seq_cursor, runtime_event_seq_cursor,
                status, status_operation_id, status_seq
         FROM session WHERE id = ?`,
      )
      .bind(SESSION_ID)
      .first();

    const terminalEvents = await database
      .prepare(
        "SELECT semantic_hash, source_event_id FROM session_event WHERE run_id = ? AND event_type = 'run.completed'",
      )
      .bind(RUN_ID)
      .all<{ semantic_hash: string; source_event_id: string }>();

    expect(terminalEvents.results).toEqual([
      {
        semantic_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        source_event_id: TERMINAL_SOURCE_EVENT_ID,
      },
    ]);
    expect(sessionAfterReplay).toEqual(sessionBeforeReplay);
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: FINAL_TEXT });
  });

  for (const rpcKind of ["completion", "failure"] as const) {
    test(`rejects a stale ${rpcKind} RPC when a same-generation Driver connection replaced its terminal winner`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const terminalError = {
        code: "driver.api_winner",
        details: {},
        message: "The API terminal winner is durable.",
        retryable: false,
      } as const;

      if (rpcKind === "completion") {
        const finalMessageId = createPlatformId<SessionMessageId>();
        await pushFreshController(
          bindings,
          messageEvents({
            messageId: finalMessageId,
            sourcePrefix: "same-generation-winner:final",
            text: FINAL_TEXT,
          }),
        );
        await recordCanonicalSessionRunTerminal(bindings, {
          assistantMessage: prepareAssistantMessageProjection({
            createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
            messageId: finalMessageId,
            sessionId: SESSION_ID,
            sessionRunId: RUN_ID,
          }),
          error: null,
          runId: RUN_ID,
          sessionId: SESSION_ID,
          source: "api",
          status: "completed",
        });
      } else {
        await recordCanonicalSessionRunFailure(bindings, {
          error: terminalError,
          runId: RUN_ID,
          sessionId: SESSION_ID,
          source: "api",
        });
      }
      await database
        .prepare("UPDATE driver_instance SET connection_id = ? WHERE id = ?")
        .bind("replacement-connection", DRIVER_ID)
        .run();
      const driverBefore = await database
        .prepare(
          "SELECT connection_id, generation, status, status_operation_id FROM driver_instance WHERE id = ?",
        )
        .bind(DRIVER_ID)
        .first();
      const sessionBefore = await database
        .prepare(
          `SELECT message_seq_cursor, runtime_event_seq_cursor, status,
                  status_operation_id, status_seq, updated_at
           FROM session WHERE id = ?`,
        )
        .bind(SESSION_ID)
        .first();

      await expect(
        rpcKind === "completion"
          ? recordDriverInstanceCompletion(bindings, {
              driverConnectionId: "canary-connection",
              driverGeneration: 0,
              driverInstanceId: DRIVER_ID,
              sessionRunId: RUN_ID,
            })
          : recordDriverInstanceFailure(bindings, {
              driverConnectionId: "canary-connection",
              driverGeneration: 0,
              driverInstanceId: DRIVER_ID,
              sessionRunId: RUN_ID,
              error: {
                code: "driver.stale_rpc",
                details: {},
                message: "The old connection reported terminal.",
                retryable: true,
              },
            }),
      ).rejects.toThrow("lost a concurrent");

      await expect(
        database
          .prepare(
            "SELECT connection_id, generation, status, status_operation_id FROM driver_instance WHERE id = ?",
          )
          .bind(DRIVER_ID)
          .first(),
      ).resolves.toEqual(driverBefore);
      await expect(
        database
          .prepare(
            `SELECT message_seq_cursor, runtime_event_seq_cursor, status,
                    status_operation_id, status_seq, updated_at
             FROM session WHERE id = ?`,
          )
          .bind(SESSION_ID)
          .first(),
      ).resolves.toEqual(sessionBefore);
      await expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM session_event
             WHERE run_id = ? AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')`,
          )
          .bind(RUN_ID)
          .first(),
      ).resolves.toEqual({ count: 1 });
    });
  }

  test("atomically claims an exact terminal Driver without rewriting a newer Session lifecycle", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(
      bindings,
      messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "atomic-adoption-claim:final",
        text: FINAL_TEXT,
      }),
    );
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: prepareAssistantMessageProjection({
        createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        messageId: finalMessageId,
        sessionId: SESSION_ID,
        sessionRunId: RUN_ID,
      }),
      error: null,
      runId: RUN_ID,
      sessionId: SESSION_ID,
      source: "api",
      status: "completed",
    });
    const operationId = createPlatformId<RuntimeOperationId>();
    await database
      .prepare(
        `UPDATE session
         SET status = 'RESCHEDULING', status_operation_id = ?, status_seq = status_seq + 1
         WHERE id = ?`,
      )
      .bind(operationId, SESSION_ID)
      .run();
    const sessionBefore = await database
      .prepare(
        `SELECT last_run_id, message_seq_cursor, runtime_event_seq_cursor,
                status, status_operation_id, status_seq, updated_at
         FROM session WHERE id = ?`,
      )
      .bind(SESSION_ID)
      .first();

    await recordDriverInstanceCompletion(bindings, {
      driverConnectionId: "canary-connection",
      driverGeneration: 0,
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
    });

    await expect(
      database
        .prepare(
          `SELECT last_run_id, message_seq_cursor, runtime_event_seq_cursor,
                  status, status_operation_id, status_seq, updated_at
           FROM session WHERE id = ?`,
        )
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual(sessionBefore);
  });

  test("atomically claims the persisted receipt while repairing an exact failure replay", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const durableError = {
      code: "driver.api_failure",
      details: {},
      message: "The API failure receipt is durable.",
      retryable: false,
    } as const;
    await recordCanonicalSessionRunFailure(bindings, {
      error: durableError,
      runId: RUN_ID,
      sessionId: SESSION_ID,
      source: "api",
    });
    await database
      .prepare("UPDATE session SET status = 'RUNNING', updated_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    await recordDriverInstanceFailure(bindings, {
      driverConnectionId: "canary-connection",
      driverGeneration: 0,
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
      error: {
        code: "driver.late_failure",
        details: {},
        message: "The exact Driver replay arrived later.",
        retryable: true,
      },
    });

    await expect(
      database.prepare("SELECT status FROM session WHERE id = ?").bind(SESSION_ID).first(),
    ).resolves.toEqual({ status: "IDLE" });
    await expect(
      database
        .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ error_code: durableError.code, status: "failed" });
    await expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM session_event WHERE run_id = ? AND event_type = 'run.failed'",
        )
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ count: 1 });
  });

  test("records a fresh Driver failure while the exact connection is still connecting", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await database
      .prepare("UPDATE driver_instance SET status = 'connecting' WHERE id = ?")
      .bind(DRIVER_ID)
      .run();

    await recordDriverInstanceFailure(bindings, {
      driverConnectionId: "canary-connection",
      driverGeneration: 0,
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
      error: {
        code: "driver.connect_failed",
        details: {},
        message: "The Driver failed before ready.",
        retryable: true,
      },
    });

    await expect(
      database
        .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ error_code: "driver.connect_failed", status: "failed" });
    await expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM session_event WHERE run_id = ? AND event_type = 'run.failed'",
        )
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ count: 1 });
  });

  test("repairs a missing final reference behind the exact terminal adoption barrier", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const finalMessageId = await insertRepairableCompletedAuthority(
      database,
      "adoption-barrier:exact",
    );
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await recordDriverInstanceCompletion(bindings, {
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
    });

    await expect(
      database
        .prepare(
          "SELECT id, projection_format, seq, session_id FROM session_message WHERE session_run_id = ?",
        )
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({
      id: finalMessageId,
      projection_format: "event_stream_v3",
      seq: 1,
      session_id: SESSION_ID,
    });
  });

  for (const corruptedStream of ["null", "progress"] as const) {
    test(`rejects a pre-corrupted ${corruptedStream} terminal stream before missing-final adoption`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const progressMessageId = createPlatformId<SessionMessageId>();
      await pushFreshController(
        bindings,
        messageEvents({
          messageId: progressMessageId,
          sourcePrefix: `adoption-corrupt-${corruptedStream}:progress`,
          text: PROGRESS_TEXTS[0],
        }),
      );
      await insertRepairableCompletedAuthority(
        database,
        `adoption-corrupt-${corruptedStream}:final`,
      );
      await database
        .prepare(
          "UPDATE session_event SET stream_id = ? WHERE run_id = ? AND event_type = 'run.completed'",
        )
        .bind(corruptedStream === "null" ? null : progressMessageId, RUN_ID)
        .run();
      const messagesBefore = await database
        .prepare(
          "SELECT content_text, id, projection_format FROM session_message WHERE session_run_id = ? AND role = 'assistant' ORDER BY seq",
        )
        .bind(RUN_ID)
        .all<{ content_text: string; id: string; projection_format: string }>();

      let rejected = false;
      try {
        await recordDriverInstanceCompletion(bindings, {
          driverInstanceId: DRIVER_ID,
          sessionRunId: RUN_ID,
        });
      } catch {
        rejected = true;
      }
      const messages = await database
        .prepare(
          "SELECT content_text, id, projection_format FROM session_message WHERE session_run_id = ? AND role = 'assistant' ORDER BY seq",
        )
        .bind(RUN_ID)
        .all<{ content_text: string; id: string; projection_format: string }>();
      expect({ messages: messages.results, rejected }).toEqual({
        messages: messagesBefore.results,
        rejected: true,
      });
    });
  }

  test("preserves the durable TERMINATED lifecycle while adopting a partial RUNNING Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(
      bindings,
      messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "adoption-terminated:final",
        text: FINAL_TEXT,
      }),
    );
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: prepareAssistantMessageProjection({
        createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        messageId: finalMessageId,
        sessionId: SESSION_ID,
        sessionRunId: RUN_ID,
      }),
      error: null,
      lifecycle: "TERMINATED",
      runId: RUN_ID,
      sessionId: SESSION_ID,
      source: "api",
      status: "completed",
    });
    await database.prepare("DELETE FROM session_message WHERE id = ?").bind(finalMessageId).run();
    await database
      .prepare("UPDATE session SET message_seq_cursor = 0, status = 'RUNNING' WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    await recordDriverInstanceCompletion(bindings, {
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
    });

    await expect(
      database.prepare("SELECT status FROM session WHERE id = ?").bind(SESSION_ID).first(),
    ).resolves.toEqual({ status: "TERMINATED" });
  });

  for (const receiptMutation of [
    {
      field: "source",
      sql: "UPDATE session_event SET source = 'system' WHERE run_id = ? AND event_type = 'run.completed'",
    },
    {
      field: "stream",
      sql: "UPDATE session_event SET stream_id = '01J000000000000000000000ZZ' WHERE run_id = ? AND event_type = 'run.completed'",
    },
    {
      field: "sequence",
      sql: "UPDATE session_event SET seq = seq + 1000 WHERE run_id = ? AND event_type = 'run.completed'",
    },
    {
      field: "visibility",
      sql: "UPDATE session_event SET visibility = 'owner_debug' WHERE run_id = ? AND event_type = 'run.completed'",
    },
    {
      field: "artifact",
      sql: `UPDATE session_event
            SET artifact_manifest_sha256 = '${"0".repeat(64)}'
            WHERE run_id = ? AND event_type = 'run.completed'`,
    },
  ] as const) {
    test(`rolls back terminal adoption when its ${receiptMutation.field} receipt field changes before the batch`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      await insertRepairableCompletedAuthority(
        database,
        `adoption-barrier:${receiptMutation.field}`,
      );
      await expect(
        database
          .prepare(
            "SELECT artifact_manifest_sha256 FROM session_event WHERE run_id = ? AND event_type = 'run.completed'",
          )
          .bind(RUN_ID)
          .first<{ artifact_manifest_sha256: string | null }>(),
      ).resolves.toEqual({ artifact_manifest_sha256: expect.any(String) });
      const sessionBefore = await database
        .prepare(
          `SELECT last_message_at, message_seq_cursor, runtime_event_seq_cursor,
                  status, status_operation_id, status_seq, updated_at
           FROM session WHERE id = ?`,
        )
        .bind(SESSION_ID)
        .first();
      const injected = mutateBeforeFirstDatabaseBatch(database, async (target) => {
        await target.prepare(receiptMutation.sql).bind(RUN_ID).run();
      });
      const bindings = createPublicHttpTestBindings(injected.database) as ApiBindings;

      await expect(
        recordDriverInstanceCompletion(bindings, {
          driverInstanceId: DRIVER_ID,
          sessionRunId: RUN_ID,
        }),
      ).rejects.toThrow();

      expect(injected.wasInjected()).toBe(true);
      await expect(
        database
          .prepare(
            `SELECT last_message_at, message_seq_cursor, runtime_event_seq_cursor,
                    status, status_operation_id, status_seq, updated_at
             FROM session WHERE id = ?`,
          )
          .bind(SESSION_ID)
          .first(),
      ).resolves.toEqual(sessionBefore);
      await expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM session_message WHERE session_run_id = ? AND role = 'assistant'",
          )
          .bind(RUN_ID)
          .first(),
      ).resolves.toEqual({ count: 0 });
      await expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM session_event
             WHERE run_id = ? AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')`,
          )
          .bind(RUN_ID)
          .first(),
      ).resolves.toEqual({ count: 1 });
    });
  }

  for (const corruptedAuthority of ["final", "carrier"] as const) {
    test(`rejects a canonical replay whose ${corruptedAuthority} row belongs to another session`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      await insertNonOwnerSession(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const finalMessageId = createPlatformId<SessionMessageId>();
      const terminal = runtimeEvent({
        kind: "run.completed",
        payload:
          corruptedAuthority === "final"
            ? { finalMessageId, stopReason: "end_turn" }
            : { stopReason: "end_turn" },
        sourceEventId: `cross-session-authority:${corruptedAuthority}:terminal`,
      });

      await pushFreshController(bindings, [
        ...(corruptedAuthority === "final"
          ? messageEvents({
              messageId: finalMessageId,
              sourcePrefix: "cross-session-authority:final",
              text: "Final authority",
            })
          : [
              runtimeEvent({
                kind: "tool.call.updated",
                payload: {
                  rawOutput: "carrier authority",
                  status: "completed",
                  toolCallId: "cross-session-carrier",
                },
                sourceEventId: "cross-session-authority:carrier",
              }),
            ]),
        terminal,
      ]);

      await database
        .prepare("UPDATE session_message SET session_id = ? WHERE id = ?")
        .bind(
          PUBLIC_API_TEST_IDS.nonOwnerSession,
          corruptedAuthority === "final" ? finalMessageId : RUN_ID,
        )
        .run();
      await database
        .prepare(
          `UPDATE session
           SET status = 'RESCHEDULING', status_operation_id = ?, status_seq = status_seq + 1
           WHERE id = ?`,
        )
        .bind(createPlatformId<RuntimeOperationId>(), SESSION_ID)
        .run();

      await expect(
        recordDriverInstanceCompletion(bindings, {
          driverInstanceId: DRIVER_ID,
          sessionRunId: RUN_ID,
        }),
      ).rejects.toThrow("Canonical assistant messages");
    });
  }

  test("rejects a legacy materialized final authority from another session on RPC replay", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    await insertNonOwnerSession(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "legacy-cross-session:final",
        text: "Legacy final authority",
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: "legacy-cross-session:terminal",
      }),
    ]);
    await database
      .prepare(
        `UPDATE session_message
         SET content_text = 'Legacy final authority', projection_format = 'materialized',
             session_id = ?
         WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession, finalMessageId)
      .run();
    await database
      .prepare(
        `UPDATE session_event
         SET artifact_attempt_id = NULL, artifact_manifest_json = NULL,
             artifact_manifest_sha256 = NULL, semantic_hash = NULL,
             terminal_event_json = NULL
         WHERE run_id = ? AND event_type = 'run.completed'`,
      )
      .bind(RUN_ID)
      .run();

    await expect(
      recordDriverInstanceCompletion(bindings, {
        driverInstanceId: DRIVER_ID,
        sessionRunId: RUN_ID,
      }),
    ).rejects.toThrow("Legacy terminal assistant messages conflict");
  });

  test("does not repair a missing terminal event across a newer Session operation", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const terminal = runtimeEvent({
      kind: "run.completed",
      payload: { finalMessageId, stopReason: "end_turn" },
      sourceEventId: TERMINAL_SOURCE_EVENT_ID,
    });

    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "partial-repair:final",
        text: FINAL_TEXT,
      }),
      terminal,
    ]);
    await database
      .prepare("DELETE FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .run();
    const completedRun = await getSessionRunSummary(database, RUN_ID);
    if (completedRun === null) {
      throw new Error("Missing completed Session Run fixture.");
    }
    const runEvent = createSessionRunUpdatedEvent(
      completedRun,
      SESSION_ID,
      "IDLE",
      TERMINAL_SOURCE_EVENT_ID,
    );
    const repairEvent = {
      ...runEvent,
      payload: { ...runEvent.payload, finalMessageId, stopReason: "end_turn" },
    };
    const run = await database
      .prepare("SELECT updated_at FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ updated_at: number }>();
    if (run === null) {
      throw new Error("Missing completed Session Run fixture.");
    }
    const operationId = createPlatformId<RuntimeOperationId>();
    await database
      .prepare(
        `UPDATE session
         SET status = 'RESCHEDULING', status_operation_id = ?,
             status_seq = status_seq + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(operationId, run.updated_at + 1, SESSION_ID)
      .run();
    const before = await database
      .prepare(
        `SELECT last_run_id, message_seq_cursor, runtime_event_seq_cursor,
                status, status_operation_id, status_seq, updated_at
         FROM session WHERE id = ?`,
      )
      .bind(SESSION_ID)
      .first();

    await expect(
      commitTerminalRunProjection(database, {
        assistantMessage: prepareAssistantMessageProjection({
          createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
          messageId: finalMessageId,
          sessionId: SESSION_ID,
          sessionRunId: RUN_ID,
        }),
        error: null,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        source: "driver",
        targetStatus: "completed",
        terminalEvent: {
          event: repairEvent,
          occurredAt: Date.parse(repairEvent.occurredAt),
          sourceEventId: TERMINAL_SOURCE_EVENT_ID,
        },
      }),
    ).rejects.toThrow("not safely repairable");

    const after = await database
      .prepare(
        `SELECT last_run_id, message_seq_cursor, runtime_event_seq_cursor,
                status, status_operation_id, status_seq, updated_at
         FROM session WHERE id = ?`,
      )
      .bind(SESSION_ID)
      .first();
    const terminalRows = await database
      .prepare("SELECT id FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .all();
    expect(after).toEqual(before);
    expect(terminalRows.results).toEqual([]);
  });

  test("repairs a missing terminal event from an unchanged RUNNING Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();

    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "partial-repair-running:final",
        text: FINAL_TEXT,
      }),
      runtimeEvent({
        kind: "run.completed",
        payload: { finalMessageId, stopReason: "end_turn" },
        sourceEventId: TERMINAL_SOURCE_EVENT_ID,
      }),
    ]);
    await database
      .prepare("DELETE FROM session_event WHERE source_event_id = ?")
      .bind(TERMINAL_SOURCE_EVENT_ID)
      .run();
    const completedRun = await getSessionRunSummary(database, RUN_ID);
    if (completedRun === null) {
      throw new Error("Missing completed Session Run fixture.");
    }
    const repairEvent = createSessionRunUpdatedEvent(
      completedRun,
      SESSION_ID,
      "IDLE",
      TERMINAL_SOURCE_EVENT_ID,
    );
    await database
      .prepare(
        `UPDATE session
         SET status = 'RUNNING', status_operation_id = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(completedRun.updatedAt, SESSION_ID)
      .run();

    await expect(
      commitTerminalRunProjection(database, {
        assistantMessage: prepareAssistantMessageProjection({
          createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
          messageId: finalMessageId,
          sessionId: SESSION_ID,
          sessionRunId: RUN_ID,
        }),
        error: null,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        source: "driver",
        targetStatus: "completed",
        terminalEvent: {
          event: {
            ...repairEvent,
            payload: { ...repairEvent.payload, finalMessageId, stopReason: "end_turn" },
          },
          occurredAt: Date.parse(repairEvent.occurredAt),
          sourceEventId: TERMINAL_SOURCE_EVENT_ID,
        },
      }),
    ).resolves.toMatchObject({ kind: "applied" });

    await expect(
      database
        .prepare(
          `SELECT status, status_operation_id
           FROM session WHERE id = ?`,
        )
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual({ status: "IDLE", status_operation_id: null });
    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: FINAL_TEXT });
  });

  test("rejects an explicit terminal Run view after its observed Run advances", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    await database
      .prepare(
        `UPDATE session_run
         SET started_at = NULL, status = 'queued', status_seq = status_seq + 1
         WHERE id = ?`,
      )
      .bind(RUN_ID)
      .run();
    const observed = await getSessionRunSummary(database, RUN_ID);
    if (observed === null) {
      throw new Error("Missing Session Run race fixture.");
    }
    const error = {
      code: "runtime.stale_projection",
      details: {},
      message: "Stale terminal projection.",
      retryable: true,
    };
    const terminalTimestampMs = 2_000;
    const staleTerminalRun = {
      ...observed,
      completedAt: new Date(terminalTimestampMs).toISOString(),
      error,
      startedAt: new Date(terminalTimestampMs).toISOString(),
      status: "failed" as const,
      updatedAt: new Date(terminalTimestampMs).toISOString(),
    };
    const terminalEvent = createFailedSessionRunRuntimeEvent({
      lifecycle: "IDLE",
      run: staleTerminalRun,
      runError: error,
      sessionId: SESSION_ID,
      sourceEventId: `session-run-terminal:${RUN_ID}:run.failed`,
    });

    await database
      .prepare(
        `UPDATE session_run
         SET started_at = 1500, status = 'booting', status_seq = status_seq + 1,
             updated_at = 1500
         WHERE id = ?`,
      )
      .bind(RUN_ID)
      .run();

    await expect(
      commitTerminalRunProjection(database, {
        assistantMessage: null,
        error,
        runId: RUN_ID,
        sessionId: SESSION_ID,
        source: "api",
        targetStatus: "failed",
        terminalEvent: {
          event: terminalEvent,
          occurredAt: terminalTimestampMs,
          sourceEventId: `session-run-terminal:${RUN_ID}:run.failed`,
        },
        timestampMs: terminalTimestampMs,
      }),
    ).resolves.toMatchObject({ currentStatus: "booting", kind: "stale" });
    await expect(getSessionRunSummary(database, RUN_ID)).resolves.toMatchObject({
      error: null,
      startedAt: new Date(1_500).toISOString(),
      status: "booting",
    });
    const terminalRows = await database
      .prepare("SELECT id FROM session_event WHERE run_id = ? AND event_type = 'run.failed'")
      .bind(RUN_ID)
      .all();
    expect(terminalRows.results).toEqual([]);
  });

  test("adopts a canonical cancellation when a later completion RPC loses the race", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "run.cancelled",
        payload: { reason: "session.stop" },
        sourceEventId: "provider-cancellation-id",
      }),
    ]);
    await recordDriverInstanceCompletion(bindings, {
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
    });

    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    const terminalEvents = await database
      .prepare(
        "SELECT event_type, source_event_id FROM session_event WHERE run_id = ? AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')",
      )
      .bind(RUN_ID)
      .all<{ event_type: string; source_event_id: string }>();

    expect(run).toEqual({ status: "cancelled" });
    expect(terminalEvents.results).toEqual([
      {
        event_type: "run.cancelled",
        source_event_id: `session-run-terminal:${RUN_ID}:run.cancelled`,
      },
    ]);
  });

  test("adopts the canonical provider failure when its terminal RPC acknowledgement is lost", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const providerError = {
      code: "driver.provider_failed",
      details: { phase: "stream" },
      message: "The provider stream failed.",
      retryable: false,
    } as const;

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "run.failed",
        payload: { error: providerError, recoverable: false },
        sourceEventId: "provider-failure-id",
      }),
    ]);
    await recordDriverInstanceFailure(bindings, {
      driverInstanceId: DRIVER_ID,
      sessionRunId: RUN_ID,
      error: {
        code: "driver.rpc_failed",
        details: {},
        message: "The later terminal RPC failed.",
        retryable: false,
      },
    });

    const run = await database
      .prepare("SELECT error_code, error_message, status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string; error_message: string; status: string }>();
    const terminalEvents = await database
      .prepare(
        "SELECT content_text, source_event_id FROM session_event WHERE run_id = ? AND event_type = 'run.failed'",
      )
      .bind(RUN_ID)
      .all<{ content_text: string; source_event_id: string }>();

    expect(run).toEqual({
      error_code: providerError.code,
      error_message: providerError.message,
      status: "failed",
    });
    expect(terminalEvents.results).toEqual([
      {
        content_text: providerError.message,
        source_event_id: `session-run-terminal:${RUN_ID}:run.failed`,
      },
    ]);
  });

  for (const corruption of ["legacy hash", "noncanonical source"] as const) {
    test(`rejects ${corruption} when the completion RPC adopts a terminal event`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const finalMessageId = createPlatformId<SessionMessageId>();

      await pushFreshController(bindings, [
        ...messageEvents({
          messageId: finalMessageId,
          sourcePrefix: `corrupt-completion:${corruption}`,
          text: FINAL_TEXT,
        }),
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId: "provider-completion-id",
        }),
      ]);
      await database
        .prepare(
          corruption === "legacy hash"
            ? `UPDATE session_event
                  SET artifact_attempt_id = NULL,
                      artifact_manifest_json = NULL,
                      artifact_manifest_sha256 = NULL,
                      semantic_hash = NULL,
                      terminal_event_json = NULL
                WHERE run_id = ? AND event_type = 'run.completed'`
            : `UPDATE session_event
                  SET artifact_attempt_id = NULL,
                      artifact_manifest_json = NULL,
                      artifact_manifest_sha256 = NULL,
                      source_event_id = 'provider-completion-id'
                WHERE run_id = ? AND event_type = 'run.completed'`,
        )
        .bind(RUN_ID)
        .run();

      await expect(
        recordDriverInstanceCompletion(bindings, {
          driverInstanceId: DRIVER_ID,
          sessionRunId: RUN_ID,
        }),
      ).rejects.toThrow(
        corruption === "legacy hash"
          ? "Legacy terminal assistant messages conflict"
          : "terminal semantic authority is invalid",
      );
    });
  }

  test("requires an authoritative message snapshot to be sealed before run completion", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const terminal = runtimeEvent({
      kind: "run.completed",
      payload: { finalMessageId, stopReason: "end_turn" },
      sourceEventId: "unsealed:run-completed",
    });
    const unsealed = [
      runtimeEvent({
        kind: "message.added",
        payload: { content: "Authoritative prefix", messageId: finalMessageId, role: "agent" },
        sourceEventId: "unsealed:snapshot",
      }),
      runtimeEvent({
        kind: "message.delta",
        payload: { contentDelta: " plus delta", messageId: finalMessageId, role: "agent" },
        sourceEventId: "unsealed:delta",
      }),
    ];

    await expect(pushFreshController(bindings, [...unsealed, terminal])).rejects.toThrow(
      "has no sealed authoritative snapshot",
    );

    const runBeforeSeal = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    expect(runBeforeSeal?.status).toBe("running");

    const completed = runtimeEvent({
      kind: "message.completed",
      payload: { messageId: finalMessageId, role: "agent" },
      sourceEventId: "unsealed:completed",
    });
    await pushFreshController(bindings, [completed, terminal]);

    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: "Authoritative prefix plus delta" });
  });

  test("requires an authoritative replacement snapshot to be sealed again", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const originalOccurredAt = Date.parse("2026-08-30T05:00:00.000Z");
    const carrierOccurredAt = originalOccurredAt + 2;
    const replacementOccurredAt = originalOccurredAt + 3;

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "message.added",
        occurredAt: originalOccurredAt,
        payload: { content: "Original answer", messageId: finalMessageId, role: "agent" },
        sourceEventId: "replacement:original:snapshot",
      }),
      runtimeEvent({
        kind: "message.completed",
        occurredAt: originalOccurredAt + 1,
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "replacement:original:completed",
      }),
      runtimeEvent({
        kind: "tool.call.updated",
        occurredAt: carrierOccurredAt,
        payload: {
          rawOutputDelta: "carrier output",
          status: "completed",
          toolCallId: "replacement-orphan-tool",
        },
        sourceEventId: "replacement:carrier-output",
      }),
    ]);

    const replacement = runtimeEvent({
      kind: "message.added",
      occurredAt: replacementOccurredAt,
      payload: { content: "Replacement answer", messageId: finalMessageId, role: "agent" },
      sourceEventId: "replacement:snapshot",
    });
    const terminal = runtimeEvent({
      kind: "run.completed",
      payload: { finalMessageId, stopReason: "end_turn" },
      sourceEventId: "replacement:run-completed",
    });

    await expect(pushFreshController(bindings, [replacement, terminal])).rejects.toThrow(
      "has no sealed authoritative snapshot",
    );

    await pushFreshController(bindings, [
      runtimeEvent({
        kind: "message.completed",
        occurredAt: replacementOccurredAt + 1,
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "replacement:completed",
      }),
      terminal,
    ]);

    await expect(
      readPublicThreadRunFinalOutput({ database, runId: RUN_ID, sessionId: SESSION_ID }),
    ).resolves.toEqual({ text: "Replacement answer" });
    const assistantRows = await database
      .prepare(
        `SELECT created_at, id, seq
         FROM session_message
         WHERE session_id = ? AND session_run_id = ? AND role = 'assistant'
         ORDER BY seq`,
      )
      .bind(SESSION_ID, RUN_ID)
      .all<{ created_at: number; id: string; seq: number }>();
    expect(assistantRows.results.map(({ created_at, id }) => ({ created_at, id }))).toEqual([
      { created_at: carrierOccurredAt, id: RUN_ID },
      { created_at: replacementOccurredAt, id: finalMessageId },
    ]);
    expect(assistantRows.results.map(({ seq }) => seq)).toEqual([
      assistantRows.results[0]?.seq,
      (assistantRows.results[0]?.seq ?? 0) + 1,
    ]);
    const fresh = await loadSessionViewerState(database, {
      sessionId: SESSION_ID,
      viewerId: PUBLIC_API_TEST_IDS.outsiderAccount,
    });
    expect(
      fresh.messages
        .filter((message) => message.id === RUN_ID || message.id === finalMessageId)
        .map(({ createdAt, id }) => ({ createdAt, id })),
    ).toEqual([
      { createdAt: new Date(carrierOccurredAt).toISOString(), id: RUN_ID },
      { createdAt: new Date(replacementOccurredAt).toISOString(), id: finalMessageId },
    ]);
  });

  test("rejects a final stream identity shared with owner-only message rows", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();

    await pushFreshController(bindings, [
      ...messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "mixed-visibility:public",
        text: "Public answer",
      }),
      runtimeEvent({
        kind: "message.added",
        payload: { content: "Owner-only replacement", messageId: finalMessageId, role: "agent" },
        sourceEventId: "mixed-visibility:owner:snapshot",
        visibility: "owner_debug",
      }),
      runtimeEvent({
        kind: "message.completed",
        payload: { messageId: finalMessageId, role: "agent" },
        sourceEventId: "mixed-visibility:owner:completed",
        visibility: "owner_debug",
      }),
    ]);

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId: "mixed-visibility:run-completed",
        }),
      ]),
    ).rejects.toThrow("mixed visibility");

    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    const messages = await database
      .prepare("SELECT id FROM session_message WHERE session_run_id = ?")
      .bind(RUN_ID)
      .all<{ id: string }>();

    expect(run?.status).toBe("running");
    expect(messages.results).toEqual([]);
  });

  test.each(["unknown", "user"] as const)(
    "rejects a final message ID that references an %s stream",
    async (boundary) => {
      const database = await createPublicHttpContractDatabase();
      await insertRuntimeFixture(database);
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const finalMessageId = createPlatformId<SessionMessageId>();
      const otherMessageId = createPlatformId<SessionMessageId>();
      const stream =
        boundary === "unknown"
          ? messageEvents({
              messageId: otherMessageId,
              sourcePrefix: "invalid-final:other",
              text: "Another assistant message",
            })
          : [
              runtimeEvent({
                kind: "message.added",
                payload: { content: "User input", messageId: finalMessageId, role: "user" },
                sourceEventId: "invalid-final:user-snapshot",
              }),
              runtimeEvent({
                kind: "message.completed",
                payload: { messageId: finalMessageId, role: "user" },
                sourceEventId: "invalid-final:user-completed",
              }),
            ];

      await expect(
        pushFreshController(bindings, [
          ...stream,
          runtimeEvent({
            kind: "run.completed",
            payload: { finalMessageId, stopReason: "end_turn" },
            sourceEventId: `invalid-final:${boundary}:run-completed`,
          }),
        ]),
      ).rejects.toThrow(
        boundary === "user" ? "conflicting identity rows" : "has no sealed authoritative snapshot",
      );

      const run = await database
        .prepare("SELECT status FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first<{ status: string }>();
      expect(run?.status).toBe("running");
    },
  );

  test("rejects a sealed message stream from another run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertRuntimeFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const finalMessageId = createPlatformId<SessionMessageId>();
    const otherRunId = createPlatformId<SessionRunId>();

    await pushFreshController(
      bindings,
      messageEvents({
        messageId: finalMessageId,
        sourcePrefix: "cross-run:message",
        text: "Another run's answer",
      }),
    );
    await database
      .prepare(
        `INSERT INTO session_run (
           id, session_id, agent_id, created_by_account_id, trigger, status,
           trace_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'user_prompt', 'completed', ?, 1, 1)`,
      )
      .bind(
        otherRunId,
        SESSION_ID,
        PUBLIC_API_TEST_IDS.agent,
        PUBLIC_API_TEST_IDS.ownerAccount,
        "trace-other-run",
      )
      .run();
    await database
      .prepare("UPDATE session_event SET run_id = ? WHERE session_id = ? AND stream_id = ?")
      .bind(otherRunId, SESSION_ID, finalMessageId)
      .run();

    await expect(
      pushFreshController(bindings, [
        runtimeEvent({
          kind: "run.completed",
          payload: { finalMessageId, stopReason: "end_turn" },
          sourceEventId: "cross-run:run-completed",
        }),
      ]),
    ).rejects.toThrow("conflicting identity rows");
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
          stopReason: "end_turn",
        },
        sourceEventId: "stale-completion:run-completed",
      }),
    ];

    await expect(pushFreshController(bindings, events)).rejects.toThrow(
      "requires its exact active Session Run",
    );

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
