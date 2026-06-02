import { describe, expect, test } from "bun:test";

import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getThreadSessionProcessEvents } from "../src/modules/sessions/application/session-process-events.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};

function createProcessEventQueryDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
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

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
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
      occurred_at integer NOT NULL,
      process_status text NOT NULL,
      process_type text NOT NULL,
      seq integer NOT NULL,
      session_id text NOT NULL,
      tokens integer,
      visibility text NOT NULL
    );

    INSERT INTO session (
      id,
      organization_id,
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
      'session-1',
      '01J00000000000000000000006',
      'viewer-1',
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
      'session-attributed',
      '01J00000000000000000000006',
      'creator-1',
      'viewer-1',
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

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES (
      '01J00000000000000000000006',
      'viewer-1',
      'member',
      NULL
    );
  `);

  return database;
}

async function insertSessionProcessEvent(
  database: SqliteD1Database,
  input: {
    content?: string;
    endedAt?: number;
    id: string;
    occurredAt?: number;
    processStatus?: SessionProcessEventStatus;
    processType?: SessionProcessEventType;
    seq: number;
    tokens?: number | null;
    visibility?: SessionRuntimeEventVisibility;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? input.seq * 1000;

  await database
    .prepare(
      `
        INSERT INTO session_event (
          id,
          content_text,
          ended_at,
          occurred_at,
          process_status,
          process_type,
          seq,
          session_id,
          tokens,
          visibility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.content ?? `run-${input.seq}`,
      input.endedAt ?? occurredAt,
      occurredAt,
      input.processStatus ?? "available",
      input.processType ?? "run.started",
      input.seq,
      "session-1",
      input.tokens ?? null,
      input.visibility ?? "all_consumers",
    )
    .run();
}

describe("session process event projection", () => {
  test("rejects invalid process event limits", async () => {
    await expect(
      getThreadSessionProcessEvents(createProcessEventQueryDatabase(), VIEWER, "session-1", {
        limit: 0,
      }),
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

    const events = await getThreadSessionProcessEvents(database, VIEWER, "session-1", {
      limit: 10,
    });

    expect(events.map((event) => event.type)).toEqual(["run.started"]);
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
      content: "run-1",
      id: "event-public",
      occurredAt: 1000,
      seq: 2,
    });

    const events = await getThreadSessionProcessEvents(innerDatabase, VIEWER, "session-1", {
      limit: 10,
    });

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

    const events = await getThreadSessionProcessEvents(innerDatabase, VIEWER, "session-1", {
      limit: 1,
    });

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

    const events = await getThreadSessionProcessEvents(innerDatabase, VIEWER, "session-1", {
      limit: 2000,
    });

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

  test("admits attributed participants through the shared thread access path", async () => {
    const events = await getThreadSessionProcessEvents(
      createProcessEventQueryDatabase(),
      VIEWER,
      "session-attributed",
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
