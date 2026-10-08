import { describe, expect, test } from "bun:test";

import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  OrganizationId,
  ProjectId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { persistProjectedRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/event-persistence";
import { createBaseLiveState } from "../src/modules/runtime/infrastructure/driver-instance/event-projection";
import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { projectRuntimeDriverEvents } from "../src/modules/runtime/infrastructure/driver-instance/events";
import { upsertSessionModelCallUsage } from "../src/modules/sessions/infrastructure/session-model-call.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ACTOR_ID = parsePlatformId<AccountId>("01J00000000000000000000011", "actor ID");
const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000012", "owner ID");
const AGENT_ID = parsePlatformId<AgentId>("01J00000000000000000000013", "agent ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000014",
  "organization ID",
);
const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000019", "project ID");
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000015", "session ID");
const SESSION_RUN_ID = parsePlatformId<SessionRunId>(
  "01J00000000000000000000016",
  "session run ID",
);
const DEPLOYMENT_ID = parsePlatformId<AgentDeploymentVersionId>(
  "01J00000000000000000000018",
  "deployment ID",
);
const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J00000000000000000000017",
  "driver instance ID",
);

interface IdentityProjection {
  metadata_json: string | null;
  model: string;
  provider: string;
}

interface UsageEventProjection {
  actor_user_id: string;
  model: string;
  price_snapshot_json: string | null;
  pricing_status: string;
  project_id: string;
  provider: string;
  run_purpose: string;
  runtime_id: string | null;
  source_event_id: string;
  total_cost_usd_micros: number;
}

function createSessionModelCallDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      owner_account_id text NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      owner_account_id text NOT NULL,
      project_id text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text,
      archived_at integer,
      runtime_event_seq_cursor integer DEFAULT 0 NOT NULL,
      status text DEFAULT 'IDLE' NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      project_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      type text DEFAULT 'ui' NOT NULL
    );

    CREATE TABLE session_run (
      created_by_key_id text,
      agent_id text,
      completed_at integer,
      status text DEFAULT 'completed' NOT NULL,
      created_by_account_id text NOT NULL,
      deployment_version_id text,
      id text PRIMARY KEY NOT NULL,
      model text,
      provider text,
      runtime_id text,
      session_id text NOT NULL,
      started_at integer,
      trigger text NOT NULL
    );

    CREATE TABLE session_model_call (
      cache_creation_tokens integer,
      cache_read_tokens integer,
      call_key text NOT NULL,
      completed_at integer,
      cost_currency text,
      created_at integer NOT NULL,
      driver_instance_id text,
      error_code text,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      input_tokens integer,
      metadata_json text,
      model text NOT NULL,
      native_call_id text,
      output_tokens integer,
      provider text NOT NULL,
      session_id text NOT NULL,
      session_run_id text NOT NULL,
      started_at integer,
      status text NOT NULL,
      total_cost_usd_micros integer,
      trace_id text NOT NULL,
      updated_at integer NOT NULL,
      UNIQUE (session_run_id, call_key)
    );

CREATE TABLE session_event (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  run_id text,
  agent_id text,
  seq integer NOT NULL,
  content_text text NOT NULL,
  ended_at integer NOT NULL,
  event_type text NOT NULL,
  family text NOT NULL,
  process_status text NOT NULL,
  process_type text NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  tool_call_id text,
  tool_input_json text,
  tool_name text,
  tokens integer,
  trace_id text,
  visibility text NOT NULL,
  occurred_at integer NOT NULL,
  created_at integer NOT NULL
);

    CREATE UNIQUE INDEX session_event_session_source_idx ON session_event (session_id, source_event_id);
    CREATE UNIQUE INDEX session_event_session_seq_idx ON session_event (session_id, seq);

    CREATE TABLE usage_event (
      actor_user_id text NOT NULL,
      agent_id text,
      agent_owner_user_id text NOT NULL,
      agent_publication_state_at_run text NOT NULL,
      agent_revision_id text,
      cache_creation_tokens integer NOT NULL,
      cache_read_tokens integer NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      input_tokens integer NOT NULL,
      model text NOT NULL,
      organization_id text NOT NULL,
      project_id text NOT NULL,
      output_tokens integer NOT NULL,
      price_snapshot_json text,
      pricing_status text NOT NULL,
      provider text NOT NULL,
      run_purpose text NOT NULL,
      runtime_id text,
      session_id text,
      session_run_id text,
      source text NOT NULL,
      source_event_id text NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      usage_contract text NOT NULL,
      UNIQUE (source, source_event_id)
    );
  `);

  return database;
}

function createUsageLedgerFailingDatabase(database: D1Database, failAtWrite = 1): D1Database {
  let usageLedgerWriteCount = 0;

  function wrapStatement(
    statement: D1PreparedStatement,
    isUsageLedgerInsert: boolean,
  ): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) =>
            wrapStatement(target.bind(...values), isUsageLedgerInsert);
        }

        const value = Reflect.get(target, property);

        if (property === "run" && typeof value === "function") {
          return (...arguments_: unknown[]) => {
            if (isUsageLedgerInsert) {
              usageLedgerWriteCount += 1;
              if (usageLedgerWriteCount === failAtWrite) {
                throw new Error("injected usage ledger write failure");
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
          wrapStatement(target.prepare(query), /insert\s+into\s+["`]usage_event["`]/iu.test(query));
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function seedRunIdentity(
  database: SqliteD1Database,
  input: {
    createdByAccountId?: AccountId;
    deploymentVersionId?: AgentDeploymentVersionId | null;
    sessionMetadataJson?: string;
    sessionType?: string;
  } = {},
): Promise<void> {
  const createdByAccountId = input.createdByAccountId ?? ACTOR_ID;
  const deploymentVersionId = input.deploymentVersionId ?? null;
  const sessionMetadataJson = input.sessionMetadataJson ?? "{}";
  const sessionType = input.sessionType ?? "ui";

  await database
    .prepare(
      `
        INSERT INTO project (id, organization_id, owner_account_id)
        VALUES (?, ?, ?)
      `,
    )
    .bind(PROJECT_ID, ORGANIZATION_ID, OWNER_ID)
    .run();
  await database
    .prepare(
      `
        INSERT INTO agent (id, owner_account_id, project_id, status)
        VALUES (?, ?, ?, 'published')
      `,
    )
    .bind(AGENT_ID, OWNER_ID, PROJECT_ID)
    .run();
  await database
    .prepare(
      `
        INSERT INTO session (
          id,
          metadata_json,
          model,
          project_id,
          provider,
          runtime_id,
          type
        )
        VALUES (?, ?, 'session-model', ?, 'session-provider', 'session-runtime', ?)
      `,
    )
    .bind(SESSION_ID, sessionMetadataJson, PROJECT_ID, sessionType)
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_run (
          agent_id,
          completed_at,
          created_by_account_id,
          deployment_version_id,
          id,
          model,
          provider,
          runtime_id,
          session_id,
          started_at,
          trigger
        )
        VALUES (?, 1800, ?, ?, ?, 'gpt-5.4', 'openai', 'openai-runtime', ?, 1200, 'user_prompt')
      `,
    )
    .bind(AGENT_ID, createdByAccountId, deploymentVersionId, SESSION_RUN_ID, SESSION_ID)
    .run();
}

describe("session model call identity", () => {
  test("records direct model usage under the Project without an Agent row", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    await database
      .prepare("UPDATE session_run SET agent_id = NULL, deployment_version_id = NULL")
      .run();
    await database.prepare("DELETE FROM agent").run();
    const input = {
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "direct-usage",
      usage: {
        callId: "direct-call",
        inputTokens: 50,
        outputTokens: 20,
        usageContract: "openai_total_with_cached_breakdown",
      } satisfies SessionUsageSummary,
    };
    await upsertSessionModelCallUsage(database, input);
    await upsertSessionModelCallUsage(database, input);
    expect(
      await database
        .prepare(
          "SELECT agent_id, agent_owner_user_id, project_id, agent_publication_state_at_run, run_purpose FROM usage_event",
        )
        .all(),
    ).toMatchObject({
      results: [
        {
          agent_id: null,
          agent_owner_user_id: OWNER_ID,
          project_id: PROJECT_ID,
          agent_publication_state_at_run: "not_applicable",
          run_purpose: "production",
        },
      ],
    });
  });

  test("rejects usage that pairs a Run with a different Session", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    await expect(
      upsertSessionModelCallUsage(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionId: parsePlatformId<SessionId>("01J00000000000000000000099", "unrelated Session"),
        sessionRunId: SESSION_RUN_ID,
        traceId: "wrong-session",
        usage: {
          callId: "wrong-session-call",
          inputTokens: 10,
          outputTokens: 5,
          usageContract: "openai_total_with_cached_breakdown",
        },
      }),
    ).rejects.toThrow("Session run not found for model call usage");
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 0,
    });
  });

  test("persists run identity when usage payload provider and model disagree", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    const usage = {
      cachedReadTokens: 100,
      cachedWriteTokens: 40,
      callId: " native-call-1 ",
      costAmount: 99,
      costCurrency: "USD",
      inputTokens: 1_000,
      model: "claude-sonnet-4-5",
      outputTokens: 200,
      provider: "anthropic",
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await upsertSessionModelCallUsage(database, {
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "trace-1",
      usage,
    });

    const modelCall = await database
      .prepare(
        `
          SELECT metadata_json, model, provider
          FROM session_model_call
        `,
      )
      .first<IdentityProjection>();
    const usageEvent = await database
      .prepare(
        `
          SELECT
            model,
            price_snapshot_json,
            pricing_status,
            project_id,
            provider,
            run_purpose,
            runtime_id,
            source_event_id,
            total_cost_usd_micros
          FROM usage_event
        `,
      )
      .first<UsageEventProjection>();

    expect(modelCall).toMatchObject({
      model: "gpt-5.4",
      provider: "openai",
    });
    expect(JSON.parse(modelCall?.metadata_json ?? "{}")).toMatchObject({
      model: "claude-sonnet-4-5",
      provider: "anthropic",
    });
    expect(usageEvent).toMatchObject({
      model: "gpt-5.4",
      pricing_status: "priced",
      project_id: PROJECT_ID,
      provider: "openai",
      run_purpose: "preview",
      runtime_id: "openai-runtime",
      source_event_id: `${DRIVER_INSTANCE_ID}:native-call-1`,
      total_cost_usd_micros: 5_300,
    });
    expect(JSON.parse(usageEvent?.price_snapshot_json ?? "{}")).toMatchObject({
      model: "gpt-5.4",
      provider: "openai",
    });
  });

  test("retains Session Project attribution when its preset moves to another Project", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    await database
      .prepare(
        `
          UPDATE agent
          SET project_id = '01J00000000000000000000020'
          WHERE id = ?
        `,
      )
      .bind(AGENT_ID)
      .run();

    const usage = {
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      callId: "wrong-project-call",
      inputTokens: 50,
      outputTokens: 20,
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await upsertSessionModelCallUsage(database, {
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "trace-wrong-project",
      usage,
    });
    expect(
      await database.prepare("SELECT project_id, agent_owner_user_id FROM usage_event").first(),
    ).toEqual({
      project_id: PROJECT_ID,
      agent_owner_user_id: OWNER_ID,
    });
  });

  test("rolls back the model call when its usage ledger write fails, then recovers once", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    const usage = {
      callId: "atomic-ledger-call",
      inputTokens: 10,
      outputTokens: 5,
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;
    const input = {
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "trace-atomic-ledger",
      usage,
    };

    await expect(
      upsertSessionModelCallUsage(createUsageLedgerFailingDatabase(database), input),
    ).rejects.toThrow("injected usage ledger write failure");

    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_model_call")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });

    await upsertSessionModelCallUsage(database, input);
    await upsertSessionModelCallUsage(database, input);

    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_model_call")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });
});

// Totals reproduce the staging regression; the first three bucket splits are fixtures.
const PI_USAGE_SAMPLES: readonly SessionUsageSummary[] = [
  { inputTokens: 100, outputTokens: 142, cachedReadTokens: 1_800, totalTokens: 2_042 },
  { inputTokens: 150, outputTokens: 112, cachedReadTokens: 1_900, totalTokens: 2_162 },
  { inputTokens: 200, outputTokens: 68, cachedReadTokens: 2_000, totalTokens: 2_268 },
  { inputTokens: 246, outputTokens: 129, cachedReadTokens: 2_048, totalTokens: 2_423 },
].map(({ inputTokens, outputTokens, cachedReadTokens, totalTokens }) => ({
  inputTokens,
  outputTokens,
  cachedReadTokens,
  totalTokens,
  source: "session_update",
  usageContract: "anthropic_bucketed",
}));

function createUsageEnvelopes(
  usages: readonly SessionUsageSummary[],
  runtimeId = "pi",
  eventPrefix = "usage-message",
  sessionRunId = SESSION_RUN_ID,
): DriverEventEnvelope[] {
  return usages.map((usage, index) => {
    const eventId = `${eventPrefix}-${index + 1}`;
    const occurredAt = new Date(1_300 + index).toISOString();
    return {
      eventId,
      occurredAt,
      event: createRuntimeEvent({
        id: createPlatformId<RuntimeEventId>(),
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionId: SESSION_ID,
        runId: sessionRunId,
        runtimeId,
        occurredAt,
        sourceEventId: eventId,
        kind: "usage.updated",
        payload: usage,
      }),
    };
  });
}

async function seedUsageRuntime(database: SqliteD1Database, runtimeId = "pi"): Promise<void> {
  await seedRunIdentity(database);
  await database.prepare("UPDATE session SET runtime_id = ?").bind(runtimeId).run();
  await database.prepare("UPDATE session_run SET runtime_id = ?").bind(runtimeId).run();
}

async function persistUsageEnvelopes(
  database: D1Database,
  events: readonly DriverEventEnvelope[],
  sessionRunId = SESSION_RUN_ID,
) {
  const link: RuntimeSessionLink = {
    agentId: AGENT_ID,
    projectId: PROJECT_ID,
    callerId: ACTOR_ID,
    creatorId: OWNER_ID,
    executionOwnerId: OWNER_ID,
    sandboxId: null,
    sandboxSubjectKind: "session",
    sessionId: SESSION_ID,
    sessionRunId,
    sessionRunStatus: "completed",
    sessionType: "ui",
    traceId: "usage-regression",
  };
  const bindings = { DB: database } as ApiBindings;
  const projection = await projectRuntimeDriverEvents(bindings, {
    driverInstanceId: DRIVER_INSTANCE_ID,
    events,
    link,
    currentLiveState: createBaseLiveState({
      callerId: ACTOR_ID,
      creatorId: OWNER_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
    }),
  });
  const result = await persistProjectedRuntimeDriverEvents(bindings, {
    driverInstanceId: DRIVER_INSTANCE_ID,
    projection,
  });
  return { projection, result };
}

async function readUsageTotals(database: D1Database) {
  return {
    calls: await database
      .prepare(`SELECT COUNT(*) AS count,
      SUM(input_tokens + output_tokens + COALESCE(cache_read_tokens, 0)
        + COALESCE(cache_creation_tokens, 0)) AS tokens FROM session_model_call`)
      .first(),
    ledger: await database
      .prepare(`SELECT COUNT(*) AS count,
      SUM(input_tokens + output_tokens + cache_creation_tokens) AS tokens FROM usage_event`)
      .first(),
  };
}

describe("runtime model usage batch accounting", () => {
  test("persists all four Pi assistant usages through projection and canonical event persistence", async () => {
    const database = createSessionModelCallDatabase();
    await seedUsageRuntime(database);
    const events = createUsageEnvelopes(PI_USAGE_SAMPLES);
    const expectedPayloads = structuredClone(PI_USAGE_SAMPLES);
    const { projection, result } = await persistUsageEnvelopes(database, events);
    expect(projection.runtimeEvents.map(({ event }) => event.payload)).toEqual(expectedPayloads);
    expect(result.persistedSourceEventIds).toEqual(events.map(({ eventId }) => eventId));
    expect(await readUsageTotals(database)).toEqual({
      calls: { count: 4, tokens: 8_895 },
      ledger: { count: 4, tokens: 8_895 },
    });
  });

  test("deduplicates Pi messages across batches, retry order, and new canonical IDs", async () => {
    const database = createSessionModelCallDatabase();
    await seedUsageRuntime(database);
    const events = createUsageEnvelopes(PI_USAGE_SAMPLES);
    await persistUsageEnvelopes(database, events.slice(0, 2));
    await persistUsageEnvelopes(database, events.slice(2));
    // Transport identity remains stable when replay reconstructs canonical events.
    const replay: DriverEventEnvelope[] = [];
    for (const envelope of events.toReversed()) {
      replay.push({
        ...envelope,
        event: { ...envelope.event, id: createPlatformId<RuntimeEventId>() },
      });
    }
    await persistUsageEnvelopes(database, replay);
    await persistUsageEnvelopes(database, events);
    expect(await readUsageTotals(database)).toEqual({
      calls: { count: 4, tokens: 8_895 },
      ledger: { count: 4, tokens: 8_895 },
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 4,
    });
    expect(
      (await database.prepare("SELECT call_key FROM session_model_call ORDER BY call_key").all())
        .results,
    ).toEqual(events.map(({ eventId }) => ({ call_key: `model_call:pi-usage:${eventId}` })));
  });

  test.each(["pi", "openai-runtime"])(
    "keeps distinct native call IDs and replaces repeated call updates for %s",
    async (runtimeId) => {
      const database = createSessionModelCallDatabase();
      await seedUsageRuntime(database, runtimeId);
      const usages: SessionUsageSummary[] = [
        {
          callId: "native-call-a",
          inputTokens: 100,
          outputTokens: 20,
          source: "session_update",
          usageContract: "anthropic_bucketed",
        },
        {
          callId: "native-call-b",
          inputTokens: 200,
          outputTokens: 30,
          source: "session_update",
          usageContract: "anthropic_bucketed",
        },
      ];
      await persistUsageEnvelopes(database, createUsageEnvelopes(usages, runtimeId));
      expect(await readUsageTotals(database)).toEqual({
        calls: { count: 2, tokens: 350 },
        ledger: { count: 2, tokens: 350 },
      });
      const updates: SessionUsageSummary[] = [
        {
          callId: "native-call-a",
          inputTokens: 130,
          outputTokens: 30,
          source: "session_update",
          usageContract: "anthropic_bucketed",
        },
        {
          callId: "native-call-a",
          inputTokens: 140,
          outputTokens: 40,
          source: "session_update",
          usageContract: "anthropic_bucketed",
        },
      ];
      const updateEvents = createUsageEnvelopes(updates, runtimeId, "usage-update");
      await persistUsageEnvelopes(database, updateEvents);
      await persistUsageEnvelopes(database, updateEvents);
      expect(await readUsageTotals(database)).toEqual({
        calls: { count: 2, tokens: 410 },
        ledger: { count: 2, tokens: 410 },
      });
      expect(
        (
          await database
            .prepare("SELECT call_key, native_call_id FROM session_model_call ORDER BY call_key")
            .all()
        ).results,
      ).toEqual([
        { call_key: "model_call:native-call-a", native_call_id: "native-call-a" },
        { call_key: "model_call:native-call-b", native_call_id: "native-call-b" },
      ]);
    },
  );

  test.each(["openai-runtime", "claude-agent-sdk", "acp-fallback"])(
    "preserves cumulative no-ID replacement for %s",
    async (runtimeId) => {
      const database = createSessionModelCallDatabase();
      await seedUsageRuntime(database, runtimeId);
      const snapshots: SessionUsageSummary[] = [
        {
          inputTokens: 100,
          outputTokens: 20,
          source: "session_update",
          usageContract: "anthropic_bucketed",
        },
        {
          inputTokens: 300,
          outputTokens: 70,
          source: "session_update",
          usageContract: "anthropic_bucketed",
        },
      ];
      await persistUsageEnvelopes(database, createUsageEnvelopes(snapshots, runtimeId));
      expect(await readUsageTotals(database)).toEqual({
        calls: { count: 1, tokens: 370 },
        ledger: { count: 1, tokens: 370 },
      });
      const updateEvents = createUsageEnvelopes(
        [
          {
            inputTokens: 450,
            outputTokens: 80,
            source: "session_update",
            usageContract: "anthropic_bucketed",
          },
        ],
        runtimeId,
        "cumulative-update",
      );
      await persistUsageEnvelopes(database, updateEvents);
      await persistUsageEnvelopes(database, updateEvents);
      expect(await readUsageTotals(database)).toEqual({
        calls: { count: 1, tokens: 530 },
        ledger: { count: 1, tokens: 530 },
      });
      expect(
        await database.prepare("SELECT call_key, native_call_id FROM session_model_call").first(),
      ).toEqual({
        call_key: "run_usage",
        native_call_id: null,
      });
    },
  );

  test("rolls back every Pi call and ledger row when the final ledger write fails, then retries once", async () => {
    const database = createSessionModelCallDatabase();
    await seedUsageRuntime(database);
    const events = createUsageEnvelopes(PI_USAGE_SAMPLES);
    await expect(
      persistUsageEnvelopes(createUsageLedgerFailingDatabase(database, 4), events),
    ).rejects.toThrow("injected usage ledger write failure");
    expect(await readUsageTotals(database)).toEqual({
      calls: { count: 0, tokens: null },
      ledger: { count: 0, tokens: null },
    });
    // No canonical receipt can acknowledge a batch whose usage did not commit.
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 0,
    });
    await persistUsageEnvelopes(database, events);
    await persistUsageEnvelopes(database, events);
    expect(await readUsageTotals(database)).toEqual({
      calls: { count: 4, tokens: 8_895 },
      ledger: { count: 4, tokens: 8_895 },
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 4,
    });
  });

  test("retains a legacy Pi Run snapshot after an unacknowledged upgrade replay and uses per-call rows for a new Run", async () => {
    const database = createSessionModelCallDatabase();
    await seedUsageRuntime(database);
    // Old Host committed the Run snapshot but crashed before canonical events/ACK.
    await upsertSessionModelCallUsage(database, {
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      traceId: "legacy-usage",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        source: "session_update",
        usageContract: "anthropic_bucketed",
      },
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 0,
    });
    const events = createUsageEnvelopes(PI_USAGE_SAMPLES);
    await persistUsageEnvelopes(database, events);
    await persistUsageEnvelopes(database, events);
    expect(await readUsageTotals(database)).toEqual({
      calls: { count: 1, tokens: 2_423 },
      ledger: { count: 1, tokens: 2_423 },
    });
    expect(
      await database.prepare("SELECT call_key, native_call_id FROM session_model_call").first(),
    ).toEqual({
      call_key: "run_usage",
      native_call_id: null,
    });
    const nextRunId = parsePlatformId<SessionRunId>("01J00000000000000000000021", "next run ID");
    await database
      .prepare(`INSERT INTO session_run
      (id, created_by_account_id, agent_id, model, provider, runtime_id, session_id, trigger, started_at, completed_at)
      SELECT ?, created_by_account_id, agent_id, model, provider, runtime_id, session_id, trigger, started_at, completed_at
      FROM session_run WHERE id = ?`)
      .bind(nextRunId, SESSION_RUN_ID)
      .run();
    await persistUsageEnvelopes(
      database,
      createUsageEnvelopes(PI_USAGE_SAMPLES, "pi", "next-run-usage", nextRunId),
      nextRunId,
    );
    expect(await readUsageTotals(database)).toEqual({
      calls: { count: 5, tokens: 11_318 },
      ledger: { count: 5, tokens: 11_318 },
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_model_call WHERE session_run_id = ?")
        .bind(nextRunId)
        .first(),
    ).toEqual({ count: 4 });
  });
});
