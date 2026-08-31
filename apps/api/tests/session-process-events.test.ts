import { describe, expect, test } from "bun:test";

import {
  createNoRuntimeEventsRecordedEventId,
  createProcessEventsTruncatedEventId,
} from "@mosoo/contracts/session";
import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getThreadSessionProcessEvents } from "../src/modules/sessions/application/session-process-events.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = "01J00000000000000000000006";
const PROJECT_ID = "01J0000000000000000000000Q";
const SESSION_ID = "01J0000000000000000000000B";
const ATTRIBUTED_SESSION_ID = "01J0000000000000000000000C";
const VIEWER_ID = "01J00000000000000000000001";
const CREATOR_ID = "01J00000000000000000000002";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Viewer",
};

function createProcessEventQueryDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      creator_account_id text NOT NULL,
      attributed_user_id text,
      agent_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      kind text NOT NULL,
      last_message_at integer,
      last_run_id text,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived_at integer
    );

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      completed_at integer,
      created_at integer,
      deployment_version_id text,
      deployment_version_number integer,
      error_code text,
      error_details_json text,
      error_message text,
      model text,
      provider text,
      started_at integer,
      status text,
      trace_id text,
      trigger text,
      updated_at integer
    );

    CREATE TABLE session_event (
      id text PRIMARY KEY NOT NULL,
      content_text text NOT NULL,
      ended_at integer NOT NULL,
      event_type text NOT NULL,
      occurred_at integer NOT NULL,
      process_status text NOT NULL,
      process_type text NOT NULL,
      run_id text,
      seq integer NOT NULL,
      session_id text NOT NULL,
      stream_id text,
      tokens integer,
      visibility text NOT NULL
    );

    INSERT INTO session (
      id,
      project_id,
      creator_account_id,
      attributed_user_id,
      agent_id,
      deployment_version_id,
      deployment_version_number,
      kind,
      last_message_at,
      last_run_id,
      metadata_json,
      model,
      provider,
      runtime_id,
      status,
      title,
      type,
      created_at,
      updated_at,
      archived_at
    ) VALUES (
      '${SESSION_ID}',
      '${PROJECT_ID}',
      '${VIEWER_ID}',
      NULL,
      '01J00000000000000000000009',
      NULL,
      NULL,
      'pet',
      NULL,
      NULL,
      '{}',
      'model-1',
      'openai',
      'openai-runtime',
      'IDLE',
      'Empty session',
      'ui',
      1,
      2000,
      NULL
    ), (
      '${ATTRIBUTED_SESSION_ID}',
      '${PROJECT_ID}',
      '${CREATOR_ID}',
      '${VIEWER_ID}',
      '01J00000000000000000000009',
      NULL,
      NULL,
      'pet',
      NULL,
      NULL,
      '{}',
      'model-1',
      'openai',
      'openai-runtime',
      'IDLE',
      'Shared session',
      'ui',
      1,
      3000,
      NULL
    );

    INSERT INTO project (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    ) VALUES (
      '${PROJECT_ID}',
      '${ORGANIZATION_ID}',
      '${VIEWER_ID}',
      'Default Project',
      NULL,
      1,
      1
    );
  `);

  return database;
}

async function insertSessionProcessEvent(
  database: SqliteD1Database,
  input: {
    content?: string;
    endedAt?: number;
    eventType?: string;
    id: string;
    occurredAt?: number;
    processStatus?: SessionProcessEventStatus;
    processType?: SessionProcessEventType;
    runId?: string | null;
    seq: number;
    sessionId?: string;
    streamId?: string | null;
    tokens?: number | null;
    visibility?: SessionRuntimeEventVisibility;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? input.seq * 1000;
  const processType = input.processType ?? "run.started";
  const eventType = input.eventType ?? processType;
  const streamId =
    input.streamId === undefined && /^(?:message|thought)\./u.test(eventType)
      ? "stream-1"
      : (input.streamId ?? null);

  await database
    .prepare(
      `
        INSERT INTO session_event (
          id,
          content_text,
          ended_at,
          event_type,
          occurred_at,
          process_status,
          process_type,
          run_id,
          seq,
          session_id,
          stream_id,
          tokens,
          visibility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.content ?? `run-${input.seq}`,
      input.endedAt ?? occurredAt,
      eventType,
      occurredAt,
      input.processStatus ?? "available",
      processType,
      input.runId ?? null,
      input.seq,
      input.sessionId ?? SESSION_ID,
      streamId,
      input.tokens ?? null,
      input.visibility ?? "all_consumers",
    )
    .run();
}

describe("session process event projection", () => {
  test("rejects invalid process event limits", async () => {
    await expect(
      getThreadSessionProcessEvents(
        createProcessEventQueryDatabase(),
        VIEWER,
        {
          projectId: PROJECT_ID,
          sessionId: SESSION_ID,
        },
        {
          limit: 0,
        },
      ),
    ).rejects.toThrow();
  });

  test("loads thread process events", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      content: "run-1",
      id: "event-1",
      occurredAt: 1000,
      seq: 1,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
      {
        limit: 10,
      },
    );

    expect(events.map((event) => event.type)).toEqual(["run.started"]);
  });

  test("keeps valid explicit durations authoritative", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      endedAt: 901_000,
      id: "event-1",
      occurredAt: 1_000,
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      id: "event-2",
      occurredAt: 2_000,
      runId: "run-2",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(database, VIEWER, {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(events[0]?.durationMs).toBe(900_000);
  });

  test("infers adjacent event durations within the same run", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      id: "event-1",
      occurredAt: 1_000,
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      id: "event-2",
      occurredAt: 2_500,
      runId: "run-1",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(database, VIEWER, {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(events.map((event) => event.durationMs)).toEqual([1_500, 0]);
  });

  test("does not infer durations without an identified shared run", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      id: "event-1",
      occurredAt: 1_000,
      runId: null,
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      id: "event-2",
      occurredAt: 2_000,
      runId: "run-1",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(database, VIEWER, {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(events.map((event) => event.durationMs)).toEqual([0, 0]);
  });

  test("does not infer same-run durations across waits longer than five minutes", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      id: "event-1",
      occurredAt: 1_000,
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      id: "event-2",
      occurredAt: 301_001,
      runId: "run-1",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(database, VIEWER, {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(events.map((event) => event.durationMs)).toEqual([0, 0]);
  });

  test("excludes a twelve-day idle gap between runs from total duration", async () => {
    const database = createProcessEventQueryDatabase();
    const runBStartMs = 12 * 24 * 60 * 60 * 1000;
    await insertSessionProcessEvent(database, {
      endedAt: 1_000,
      id: "run-a-started",
      occurredAt: 0,
      runId: "run-a",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      id: "run-a-files-updated",
      occurredAt: 2_000,
      processType: "session.files.updated",
      runId: "run-a",
      seq: 2,
    });
    await insertSessionProcessEvent(database, {
      id: "run-b-started",
      occurredAt: runBStartMs,
      runId: "run-b",
      seq: 3,
    });
    await insertSessionProcessEvent(database, {
      id: "run-b-completed",
      occurredAt: runBStartMs + 2_000,
      processType: "run.completed",
      runId: "run-b",
      seq: 4,
    });

    const events = await getThreadSessionProcessEvents(database, VIEWER, {
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });

    expect(events.map((event) => event.durationMs)).toEqual([1_000, 0, 2_000, 0]);
    expect(events.reduce((total, event) => total + (event.durationMs ?? 0), 0)).toBe(3_000);
  });

  test("folds persisted assistant message fragments into one process event", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.started",
      id: "event-run-started",
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.started",
      id: "event-message-started",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 2,
    });
    await insertSessionProcessEvent(database, {
      content: "你",
      eventType: "message.delta",
      id: "event-delta-1",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 3,
    });
    await insertSessionProcessEvent(database, {
      content: "好",
      eventType: "message.delta",
      id: "event-delta-2",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 4,
    });
    await insertSessionProcessEvent(database, {
      content: "，世界。",
      eventType: "message.delta",
      id: "event-delta-3",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 5,
    });
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.completed",
      id: "event-message-completed",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 6,
    });
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.completed",
      id: "event-run-completed",
      processType: "run.completed",
      runId: "run-1",
      seq: 7,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
      {
        limit: 100,
      },
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "agent.message.delta",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      content: "你好，世界。",
      id: "event-message-completed",
    });
  });

  test("pages raw stream rows until the latest logical events are complete", async () => {
    const database = createProcessEventQueryDatabase();
    const fragmentCount = 1_005;
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.started",
      id: "event-run-started",
      runId: "run-1",
      seq: 1,
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      await insertSessionProcessEvent(database, {
        content: "x",
        eventType: "message.delta",
        id: `event-message-delta-${index}`,
        processType: "agent.message.delta",
        runId: "run-1",
        seq: index + 2,
      });
    }

    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.completed",
      id: "event-message-completed",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: fragmentCount + 2,
    });
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.completed",
      id: "event-run-completed",
      processType: "run.completed",
      runId: "run-1",
      seq: fragmentCount + 3,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 2 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "agent.message.delta",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      content: "x".repeat(fragmentCount),
      id: "event-message-completed",
    });
  });

  test("does not cut a retained stream at a page boundary", async () => {
    const database = createProcessEventQueryDatabase();
    const fragmentCount = 550;
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.started",
      id: "event-run-started",
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      content: "Agent thinking updated.",
      eventType: "thought.started",
      id: "event-thought-a-started",
      processType: "agent.thinking.delta",
      runId: "run-1",
      seq: 2,
      streamId: "thought-a",
    });
    await insertSessionProcessEvent(database, {
      content: "Agent thinking updated.",
      eventType: "thought.started",
      id: "event-thought-b-started",
      processType: "agent.thinking.delta",
      runId: "run-1",
      seq: 3,
      streamId: "thought-b",
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      await insertSessionProcessEvent(database, {
        content: "a",
        eventType: "thought.delta",
        id: `event-thought-a-delta-${index}`,
        processType: "agent.thinking.delta",
        runId: "run-1",
        seq: index * 2 + 4,
        streamId: "thought-a",
      });
      await insertSessionProcessEvent(database, {
        content: "b",
        eventType: "thought.delta",
        id: `event-thought-b-delta-${index}`,
        processType: "agent.thinking.delta",
        runId: "run-1",
        seq: index * 2 + 5,
        streamId: "thought-b",
      });
    }

    const firstTerminalSeq = fragmentCount * 2 + 4;
    await insertSessionProcessEvent(database, {
      content: "Agent thinking updated.",
      eventType: "thought.completed",
      id: "event-thought-a-completed",
      processType: "agent.thinking.delta",
      runId: "run-1",
      seq: firstTerminalSeq,
      streamId: "thought-a",
    });
    await insertSessionProcessEvent(database, {
      content: "Agent thinking updated.",
      eventType: "thought.completed",
      id: "event-thought-b-completed",
      processType: "agent.thinking.delta",
      runId: "run-1",
      seq: firstTerminalSeq + 1,
      streamId: "thought-b",
    });
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.completed",
      id: "event-run-completed",
      processType: "run.completed",
      runId: "run-1",
      seq: firstTerminalSeq + 2,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 2 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "agent.thinking.delta",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      content: "b".repeat(fragmentCount),
      id: "event-thought-b-completed",
    });
  });

  test("does not expose an incomplete stream when the raw scan ceiling is reached", async () => {
    const database = createProcessEventQueryDatabase();
    const fragmentCount = 20_001;
    await insertSessionProcessEvent(database, {
      content: "Agent thinking updated.",
      eventType: "thought.started",
      id: "event-thought-started",
      processType: "agent.thinking.delta",
      runId: "run-1",
      seq: 1,
      streamId: "ceiling-thought",
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      await insertSessionProcessEvent(database, {
        content: "x",
        eventType: "thought.delta",
        id: `event-thought-delta-${index}`,
        processType: "agent.thinking.delta",
        runId: "run-1",
        seq: index + 2,
        streamId: "ceiling-thought",
      });
    }

    await insertSessionProcessEvent(database, {
      content: "Agent thinking updated.",
      eventType: "thought.completed",
      id: "event-thought-completed",
      processType: "agent.thinking.delta",
      runId: "run-1",
      seq: fragmentCount + 2,
      streamId: "ceiling-thought",
    });
    await insertSessionProcessEvent(database, {
      content: "Complete final answer",
      eventType: "message.added",
      id: "event-final-message",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: fragmentCount + 3,
      streamId: "complete-final-message",
    });
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.completed",
      id: "event-run-completed",
      processType: "run.completed",
      runId: "run-1",
      seq: fragmentCount + 4,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 2 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "agent.message.delta",
      "run.completed",
    ]);
    expect(events[0]?.content).toContain("Earlier runtime events are hidden");
    expect(events[1]?.content).toBe("Complete final answer");
  }, 15_000);

  test("recognizes the database start at the exact raw scan ceiling", async () => {
    const database = createProcessEventQueryDatabase();
    const fillerCount = 19_997;

    for (let seq = 1; seq <= fillerCount; seq += 1) {
      await insertSessionProcessEvent(database, {
        content: `filler-${seq}`,
        id: `exact-ceiling-filler-${seq}`,
        processType: "usage.updated",
        seq,
      });
    }

    await insertSessionProcessEvent(database, {
      content: "retained",
      eventType: "message.delta",
      id: "exact-ceiling-message-delta",
      processType: "agent.message.delta",
      runId: null,
      seq: fillerCount + 1,
      streamId: "exact-ceiling-message",
    });
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.completed",
      id: "exact-ceiling-message-completed",
      processType: "agent.message.delta",
      runId: null,
      seq: fillerCount + 2,
      streamId: "exact-ceiling-message",
    });
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.completed",
      id: "exact-ceiling-run-completed",
      processType: "run.completed",
      runId: "run-1",
      seq: fillerCount + 3,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 2 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "agent.message.delta",
      "run.completed",
    ]);
    expect(events[1]?.content).toBe("retained");
  }, 15_000);

  test("orders paged events by durable sequence rather than driver time", async () => {
    const database = createProcessEventQueryDatabase();
    const fragmentCount = 1_002;
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.started",
      id: "out-of-order-run-started",
      occurredAt: 1_000,
      processType: "run.started",
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.started",
      id: "out-of-order-message-started",
      occurredAt: 100_000,
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 2,
      streamId: "out-of-order-message",
    });

    for (let index = 0; index < fragmentCount; index += 1) {
      await insertSessionProcessEvent(database, {
        content: "x",
        eventType: "message.delta",
        id: `out-of-order-message-delta-${index}`,
        occurredAt: 101_000 + index,
        processType: "agent.message.delta",
        runId: "run-1",
        seq: index + 3,
        streamId: "out-of-order-message",
      });
    }

    await insertSessionProcessEvent(database, {
      content: "Read file",
      eventType: "tool.call.updated",
      id: "out-of-order-tool",
      occurredAt: 2_000,
      processType: "tool.use.started",
      runId: "run-1",
      seq: fragmentCount + 3,
    });
    await insertSessionProcessEvent(database, {
      content: "run-1",
      eventType: "run.completed",
      id: "out-of-order-run-completed",
      occurredAt: 3_000,
      processType: "run.completed",
      runId: "run-1",
      seq: fragmentCount + 4,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 2 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "tool.use.started",
      "run.completed",
    ]);
    expect(events[1]?.id).toBe("out-of-order-tool");
  });

  test.each([
    ["message.cancelled", "available"],
    ["message.failed", "error"],
  ] as const)("folds persisted streams closed by %s", async (eventType, processStatus) => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      content: "Partial answer",
      eventType: "message.delta",
      id: "event-message-delta",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType,
      id: "event-message-end",
      processStatus,
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 100 },
    );

    expect(events).toEqual([
      expect.objectContaining({
        content: "Partial answer",
        id: "event-message-end",
        status: processStatus,
        type: "agent.message.delta",
      }),
    ]);
  });

  test("keeps a terminal message without deltas", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.completed",
      id: "event-message-completed",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 1,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 100 },
    );

    expect(events).toEqual([
      expect.objectContaining({
        content: "",
        id: "event-message-completed",
        type: "agent.message.delta",
      }),
    ]);
  });

  test("folds interleaved messages by stream identity", async () => {
    const database = createProcessEventQueryDatabase();

    for (const event of [
      { content: "A1", id: "a-1", seq: 1, streamId: "message-a" },
      { content: "B1", id: "b-1", seq: 2, streamId: "message-b" },
      { content: "A2", id: "a-2", seq: 3, streamId: "message-a" },
    ]) {
      await insertSessionProcessEvent(database, {
        ...event,
        eventType: "message.delta",
        processType: "agent.message.delta",
        runId: "run-1",
      });
    }

    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.completed",
      id: "b-end",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 4,
      streamId: "message-b",
    });
    await insertSessionProcessEvent(database, {
      content: "Message updated.",
      eventType: "message.completed",
      id: "a-end",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 5,
      streamId: "message-a",
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      { projectId: PROJECT_ID, sessionId: SESSION_ID },
      { limit: 100 },
    );

    expect(events.map((event) => event.content)).toEqual(["A1A2", "B1"]);
  });

  test("shows an in-flight streamed message as a single folded process event", async () => {
    const database = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(database, {
      content: "写到一",
      eventType: "message.delta",
      id: "event-delta-1",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 1,
    });
    await insertSessionProcessEvent(database, {
      content: "半",
      eventType: "message.delta",
      id: "event-delta-2",
      processType: "agent.message.delta",
      runId: "run-1",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(
      database,
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
      {
        limit: 100,
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      content: "写到一半",
      type: "agent.message.delta",
    });
  });

  test("hides owner-debug session events from participant process feeds", async () => {
    const innerDatabase = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(innerDatabase, {
      content: "debug details",
      id: "event-debug",
      occurredAt: 900,
      processType: "session.status",
      seq: 1,
      visibility: "owner_debug",
    });
    await insertSessionProcessEvent(innerDatabase, {
      content: "1 background task active.",
      eventType: "agent.tasks.replaced",
      id: "event-task-state",
      occurredAt: 950,
      processType: "session.status",
      seq: 2,
      visibility: "owner_debug",
    });
    await insertSessionProcessEvent(innerDatabase, {
      content: "run-1",
      id: "event-public",
      occurredAt: 1000,
      seq: 3,
    });

    const events = await getThreadSessionProcessEvents(
      innerDatabase,
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
      {
        limit: 10,
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "event-public",
      type: "run.started",
    });
  });

  test("marks process event queries when older runtime events are hidden", async () => {
    const innerDatabase = createProcessEventQueryDatabase();
    await insertSessionProcessEvent(innerDatabase, {
      content: "run-1",
      id: "event-1",
      occurredAt: 1000,
      seq: 1,
    });
    await insertSessionProcessEvent(innerDatabase, {
      content: "run-1",
      id: "event-2",
      occurredAt: 1100,
      processType: "run.completed",
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(
      innerDatabase,
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
      {
        limit: 1,
      },
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      status: "unsupported",
      type: "session.status",
    });
    expect(events[0]?.content).toBeString();
    expect(events[0]?.content.length).toBeGreaterThan(0);
    expect(events[1]).toMatchObject({
      id: "event-2",
      type: "run.completed",
    });
  });

  test("caps process event reads to the latest bounded window", async () => {
    const innerDatabase = createProcessEventQueryDatabase();

    for (let seq = 1; seq <= 1001; seq += 1) {
      await insertSessionProcessEvent(innerDatabase, {
        id: `event-${seq}`,
        processType: seq === 1001 ? "run.completed" : "run.started",
        seq,
      });
    }

    const events = await getThreadSessionProcessEvents(
      innerDatabase,
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      },
      {
        limit: 2000,
      },
    );

    expect(events).toHaveLength(1001);
    expect(events[0]).toMatchObject({
      status: "unsupported",
      type: "session.status",
    });
    expect(events[0]?.content).toBeString();
    expect(events[0]?.content.length).toBeGreaterThan(0);
    expect(events[1]?.id).toBe("event-2");
    expect(events.at(-1)).toMatchObject({
      id: "event-1001",
      type: "run.completed",
    });
  });

  test("keeps synthetic process event ids valid and stable across repeated reads", async () => {
    const innerDatabase = createProcessEventQueryDatabase();

    for (let seq = 1; seq <= 3; seq += 1) {
      await insertSessionProcessEvent(innerDatabase, {
        id: `event-${seq}`,
        seq,
      });
    }

    const readTruncated = async () =>
      getThreadSessionProcessEvents(
        innerDatabase,
        VIEWER,
        {
          projectId: PROJECT_ID,
          sessionId: SESSION_ID,
        },
        {
          limit: 2,
        },
      );
    const readEmpty = async () =>
      getThreadSessionProcessEvents(
        innerDatabase,
        VIEWER,
        {
          projectId: PROJECT_ID,
          sessionId: ATTRIBUTED_SESSION_ID,
        },
        {
          limit: 10,
        },
      );

    const firstTruncated = await readTruncated();
    const secondTruncated = await readTruncated();

    expect(firstTruncated[0]?.id).toBe(createProcessEventsTruncatedEventId(SESSION_ID));
    expect(secondTruncated[0]?.id).toBe(firstTruncated[0]?.id ?? "");
    expect(() => parsePlatformId(firstTruncated[0]?.id, "truncated marker id")).not.toThrow();

    const firstEmpty = await readEmpty();
    const secondEmpty = await readEmpty();

    expect(firstEmpty[0]?.id).toBe(createNoRuntimeEventsRecordedEventId(ATTRIBUTED_SESSION_ID));
    expect(secondEmpty[0]?.id).toBe(firstEmpty[0]?.id ?? "");
    expect(() => parsePlatformId(firstEmpty[0]?.id, "empty placeholder id")).not.toThrow();
  });

  test("admits attributed participants through the shared thread access path", async () => {
    const events = await getThreadSessionProcessEvents(
      createProcessEventQueryDatabase(),
      VIEWER,
      {
        projectId: PROJECT_ID,
        sessionId: ATTRIBUTED_SESSION_ID,
      },
      {
        limit: 10,
      },
    );

    expect(events).toHaveLength(1);

    const event = events[0];

    if (event === undefined) {
      throw new Error("Expected an empty process event placeholder.");
    }

    expect(() => parsePlatformId(event.id, "empty process event id")).not.toThrow();
    expect(event).toMatchObject({
      durationMs: null,
      status: "unsupported",
      tokens: null,
      type: "session.status",
    });
    expect(event.content).toBeString();
    expect(event.content.length).toBeGreaterThan(0);
  });
});
