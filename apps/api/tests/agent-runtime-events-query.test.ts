import { describe, expect, test } from "bun:test";

import { createRuntimeEvent } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope, RuntimeEventKind } from "@mosoo/runtime-events";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getAgentRuntimeEvents } from "../src/modules/sessions/application/agent-runtime-events.service";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

const RUNTIME_EVENTS_QUERY_IDS = {
  configEvent: "01J00000000000000000000072",
  driverEvent: "01J00000000000000000000071",
  driverInstance: "01J0000000000000000000000E",
  ownerDebugEvent: "01J00000000000000000000073",
  session: "01J0000000000000000000000B",
  visibleEvent: "01J00000000000000000000074",
} as const;

const EVENT_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function runtimeEventsQueryGeneratedEventId(index: number): string {
  const high = Math.floor(index / (EVENT_ID_ALPHABET.length * EVENT_ID_ALPHABET.length));
  const middle = Math.floor(index / EVENT_ID_ALPHABET.length) % EVENT_ID_ALPHABET.length;
  const low = index % EVENT_ID_ALPHABET.length;

  if (high >= EVENT_ID_ALPHABET.length) {
    throw new Error("Runtime events query fixture exhausted generated event IDs.");
  }

  return `01J00000000000000000010${EVENT_ID_ALPHABET[high]}${EVENT_ID_ALPHABET[middle]}${EVENT_ID_ALPHABET[low]}`;
}

function runtimeEventJson(input: {
  id: string;
  kind: RuntimeEventKind;
  payload: unknown;
  visibility?: "owner_debug" | "participant";
}): string {
  return JSON.stringify(
    createRuntimeEvent({
      actor: "system",
      id: input.id,
      kind: input.kind,
      occurredAt: "2026-05-26T00:00:00.000Z",
      origin: "system",
      payload: input.payload,
      sessionId: RUNTIME_EVENTS_QUERY_IDS.session,
      visibility: input.visibility ?? "owner_debug",
    }),
  );
}

function createAgentRuntimeEventsDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      image_url text,
      name text
    );

    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      created_at integer NOT NULL,
      joined_at integer NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      description text,
      environment_id text,
      live_deployment_version_id text,
      kind text NOT NULL,
      runtime_id text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      prompt text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      config_json text NOT NULL,
      status text NOT NULL,
      visibility text NOT NULL
    );

    CREATE TABLE resource_acl (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      role text NOT NULL,
      assigned_by_account_id text,
      created_at integer NOT NULL,
      PRIMARY KEY (resource_type, resource_id, target_kind, target_id)
    );

    CREATE TABLE agent_mcp_binding (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      server_id text NOT NULL,
      agent_credential_id text,
      credential_mode text NOT NULL,
      enabled integer NOT NULL,
      sort_order integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE mcp_server (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      creator_account_id text NOT NULL,
      agent_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      kind text NOT NULL,
      last_message_at integer,
      last_run_id text,
      model text NOT NULL,
      provider text NOT NULL,
      renamed integer DEFAULT 0 NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text,
      type text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      archived_at integer
    );

    CREATE TABLE session_event (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      content_text text NOT NULL,
      ended_at integer NOT NULL,
      session_id text NOT NULL,
      source_event_id text NOT NULL,
      event_type text NOT NULL,
      family text NOT NULL,
      occurred_at integer NOT NULL,
      created_at integer NOT NULL,
      process_status text NOT NULL,
      process_type text NOT NULL,
      run_id text,
      seq integer NOT NULL,
      source text NOT NULL,
      tokens integer,
      trace_id text,
      visibility text NOT NULL
    );

    INSERT INTO account (id, image_url, name)
    VALUES ('01J00000000000000000000001', NULL, 'Owner');

    INSERT INTO organization (
      id,
      join_policy,
      name,
      slug,
      created_at,
      updated_at
    ) VALUES (
      '01J00000000000000000000006',
      'invite_only',
      'Test Org',
      'test-org',
      1,
      1
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      created_at,
      joined_at
    ) VALUES (
      '01J00000000000000000000006',
      '01J00000000000000000000001',
      'member',
      1,
      1
    );

    INSERT INTO agent (
      id,
      organization_id,
      owner_account_id,
      name,
      kind,
      runtime_id,
      provider,
      model,
      prompt,
      created_at,
      updated_at,
      config_json,
      status,
      visibility
    ) VALUES (
      '01J00000000000000000000009',
      '01J00000000000000000000006',
      '01J00000000000000000000001',
      'Runtime Agent',
      'pet',
      'openai-runtime',
      'openai',
      'gpt-5.1',
      'prompt',
      1,
      1,
      '{}',
      'published',
      'private'
    );

    INSERT INTO session (
      id,
      organization_id,
      creator_account_id,
      agent_id,
      kind,
      model,
      provider,
      renamed,
      runtime_id,
      status,
      type,
      created_at,
      updated_at
    ) VALUES (
      '${RUNTIME_EVENTS_QUERY_IDS.session}',
      '01J00000000000000000000006',
      '01J00000000000000000000001',
      '01J00000000000000000000009',
      'pet',
      'gpt-5.1',
      'openai',
      0,
      'openai-runtime',
      'IDLE',
      'preview',
      1,
      1
    );
  `);

  return database;
}

async function insertRuntimeEvent(
  database: SqliteD1Database,
  input: {
    createdAt: number;
    eventJson: string;
    id: string;
    seq: number;
  },
): Promise<void> {
  const projection = createSessionRuntimeEventProjection(
    JSON.parse(input.eventJson) as RuntimeEventEnvelope,
  );

  await database
    .prepare(
      `
        INSERT INTO session_event (
          id,
          agent_id,
          content_text,
          ended_at,
          session_id,
          source_event_id,
          event_type,
          family,
          occurred_at,
          created_at,
          process_status,
          process_type,
          run_id,
          seq,
          source,
          tokens,
          trace_id,
          visibility
        ) VALUES (?, '01J00000000000000000000009', ?, ?, '${RUNTIME_EVENTS_QUERY_IDS.session}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      projection.contentText,
      input.createdAt,
      `source-${input.id}`,
      projection.eventType,
      projection.family,
      input.createdAt,
      input.createdAt,
      projection.processStatus,
      projection.processType,
      projection.runId,
      input.seq,
      projection.source,
      projection.tokens,
      projection.traceId,
      projection.visibility,
    )
    .run();
}

describe("agent runtime events query", () => {
  test("rejects invalid runtime event limits", async () => {
    await expect(
      getAgentRuntimeEvents(createAgentRuntimeEventsDatabase(), VIEWER, {
        agentId: "01J00000000000000000000009",
        limit: 0,
      }),
    ).rejects.toThrow();
  });

  test("filters by requested runtime event families", async () => {
    const database = createAgentRuntimeEventsDatabase();

    await insertRuntimeEvent(database, {
      createdAt: 1000,
      eventJson: runtimeEventJson({
        id: RUNTIME_EVENTS_QUERY_IDS.driverEvent,
        kind: "runtime.driver.updated",
        payload: {
          agentId: "01J00000000000000000000009",
          driverInstanceId: "01J0000000000000000000000E",
          port: 33809,
          sessionId: "01J0000000000000000000000B",
        },
      }),
      id: RUNTIME_EVENTS_QUERY_IDS.driverEvent,
      seq: 1,
    });
    await insertRuntimeEvent(database, {
      createdAt: 1001,
      eventJson: runtimeEventJson({
        id: RUNTIME_EVENTS_QUERY_IDS.configEvent,
        kind: "runtime.config.updated",
        payload: {
          agentId: "01J00000000000000000000009",
          provider: "anthropic",
          reason: "active_key_revoked",
          sessionId: "01J0000000000000000000000B",
        },
      }),
      id: RUNTIME_EVENTS_QUERY_IDS.configEvent,
      seq: 2,
    });

    const page = await getAgentRuntimeEvents(database, VIEWER, {
      agentId: "01J00000000000000000000009",
      families: ["driver"],
      limit: 10,
    });

    expect(page.nodes.map((event) => [event.id, event.family])).toEqual([
      [RUNTIME_EVENTS_QUERY_IDS.driverEvent, "driver"],
    ]);
  });

  test("returns an empty page for empty family filters", async () => {
    const database = createAgentRuntimeEventsDatabase();

    await insertRuntimeEvent(database, {
      createdAt: 1000,
      eventJson: runtimeEventJson({
        id: RUNTIME_EVENTS_QUERY_IDS.driverEvent,
        kind: "runtime.driver.updated",
        payload: {
          agentId: "01J00000000000000000000009",
          driverInstanceId: "01J0000000000000000000000E",
          port: 33809,
          sessionId: "01J0000000000000000000000B",
        },
      }),
      id: RUNTIME_EVENTS_QUERY_IDS.driverEvent,
      seq: 1,
    });

    const page = await getAgentRuntimeEvents(database, VIEWER, {
      agentId: "01J00000000000000000000009",
      families: [],
      limit: 10,
    });

    expect(page).toEqual({
      nodes: [],
      pageInfo: {
        endCursor: null,
        hasMore: false,
        startCursor: null,
      },
    });
  });

  test("shows owner debug events to agent owners", async () => {
    const database = createAgentRuntimeEventsDatabase();

    await insertRuntimeEvent(database, {
      createdAt: 1000,
      eventJson: runtimeEventJson({
        id: RUNTIME_EVENTS_QUERY_IDS.ownerDebugEvent,
        kind: "runtime.driver.updated",
        payload: {
          agentId: "01J00000000000000000000009",
          driverInstanceId: "01J0000000000000000000000E",
          sessionId: "01J0000000000000000000000B",
        },
      }),
      id: RUNTIME_EVENTS_QUERY_IDS.ownerDebugEvent,
      seq: 1,
    });
    await insertRuntimeEvent(database, {
      createdAt: 1001,
      eventJson: runtimeEventJson({
        id: RUNTIME_EVENTS_QUERY_IDS.visibleEvent,
        kind: "runtime.driver.updated",
        payload: {
          agentId: "01J00000000000000000000009",
          driverInstanceId: "01J0000000000000000000000E",
          port: 33809,
          sessionId: "01J0000000000000000000000B",
        },
      }),
      id: RUNTIME_EVENTS_QUERY_IDS.visibleEvent,
      seq: 2,
    });

    const page = await getAgentRuntimeEvents(database, VIEWER, {
      agentId: "01J00000000000000000000009",
      limit: 10,
    });

    expect(page.nodes.map((event) => event.id)).toEqual([
      RUNTIME_EVENTS_QUERY_IDS.visibleEvent,
      RUNTIME_EVENTS_QUERY_IDS.ownerDebugEvent,
    ]);
  });

  test("finds sparse family matches beyond recent unrelated events", async () => {
    const database = createAgentRuntimeEventsDatabase();

    await insertRuntimeEvent(database, {
      createdAt: 1000,
      eventJson: runtimeEventJson({
        id: RUNTIME_EVENTS_QUERY_IDS.driverEvent,
        kind: "runtime.driver.updated",
        payload: {
          agentId: "01J00000000000000000000009",
          driverInstanceId: "01J0000000000000000000000E",
          port: 33809,
          sessionId: "01J0000000000000000000000B",
        },
      }),
      id: RUNTIME_EVENTS_QUERY_IDS.driverEvent,
      seq: 1,
    });

    for (let index = 0; index < 5010; index += 1) {
      await insertRuntimeEvent(database, {
        createdAt: 2000 + index,
        eventJson: runtimeEventJson({
          id: runtimeEventsQueryGeneratedEventId(index),
          kind: "runtime.config.updated",
          payload: {
            agentId: "01J00000000000000000000009",
            provider: "anthropic",
            reason: "active_key_revoked",
            sessionId: "01J0000000000000000000000B",
          },
        }),
        id: runtimeEventsQueryGeneratedEventId(index),
        seq: index + 2,
      });
    }

    const firstPage = await getAgentRuntimeEvents(database, VIEWER, {
      agentId: "01J00000000000000000000009",
      families: ["driver"],
      limit: 10,
    });

    expect(firstPage.nodes.map((event) => event.id)).toEqual([
      RUNTIME_EVENTS_QUERY_IDS.driverEvent,
    ]);
    expect(firstPage.pageInfo.hasMore).toBe(false);
    expect(firstPage.pageInfo.endCursor).not.toBeNull();
  });

  test("caps runtime event pages to the latest bounded window", async () => {
    const database = createAgentRuntimeEventsDatabase();

    for (let index = 0; index < 501; index += 1) {
      await insertRuntimeEvent(database, {
        createdAt: 1000 + index,
        eventJson: runtimeEventJson({
          id: runtimeEventsQueryGeneratedEventId(index),
          kind: "runtime.driver.updated",
          payload: {
            agentId: "01J00000000000000000000009",
            driverInstanceId: "01J0000000000000000000000E",
            sessionId: "01J0000000000000000000000B",
          },
        }),
        id: runtimeEventsQueryGeneratedEventId(index),
        seq: index + 1,
      });
    }

    const page = await getAgentRuntimeEvents(database, VIEWER, {
      agentId: "01J00000000000000000000009",
      limit: 1000,
    });

    expect(page.nodes).toHaveLength(500);
    expect(page.nodes[0]?.id).toBe(runtimeEventsQueryGeneratedEventId(500));
    expect(page.nodes.at(-1)?.id).toBe(runtimeEventsQueryGeneratedEventId(1));
    expect(page.pageInfo.hasMore).toBe(true);
    expect(page.pageInfo.endCursor).not.toBeNull();
    expect(page.pageInfo.startCursor).not.toBeNull();
  });
});
