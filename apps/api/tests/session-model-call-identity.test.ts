import { describe, expect, test } from "bun:test";

import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  OrganizationId,
  ProjectId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import { upsertSessionModelCallUsage } from "../src/modules/sessions/infrastructure/session-model-call.repository";
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
const USAGE_CREATED_AT_MS = 1_500;

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
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      project_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      type text DEFAULT 'ui' NOT NULL
    );

    CREATE TABLE session_run (
      agent_id text NOT NULL,
      completed_at integer,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      deployment_version_id text,
      id text PRIMARY KEY NOT NULL,
      model text,
      provider text,
      runtime_id text,
      session_id text NOT NULL,
      started_at integer,
      status text NOT NULL,
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
      source_event_seq integer DEFAULT 0 NOT NULL,
      session_id text NOT NULL,
      session_run_id text NOT NULL,
      started_at integer,
      status text NOT NULL,
      total_cost_usd_micros integer,
      trace_id text NOT NULL,
      updated_at integer NOT NULL,
      UNIQUE (session_run_id, call_key)
    );

    CREATE TABLE usage_event (
      actor_user_id text NOT NULL,
      agent_id text NOT NULL,
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
      source_event_seq integer DEFAULT 0 NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      usage_contract text NOT NULL,
      UNIQUE (source, source_event_id)
    );

    CREATE TABLE usage_event_rollup_receipt (
      rolled_up_at integer NOT NULL,
      source text NOT NULL,
      source_event_id text NOT NULL,
      PRIMARY KEY (source, source_event_id)
    );
  `);

  return database;
}

function createUsageLedgerFailingDatabase(database: D1Database): D1Database {
  let shouldFailUsageLedgerWrite = true;

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
            if (isUsageLedgerInsert && shouldFailUsageLedgerWrite) {
              shouldFailUsageLedgerWrite = false;
              throw new Error("injected usage ledger write failure");
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
        INSERT INTO project (id, organization_id)
        VALUES (?, ?)
      `,
    )
    .bind(PROJECT_ID, ORGANIZATION_ID)
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
          created_at,
          created_by_account_id,
          deployment_version_id,
          id,
          model,
          provider,
          runtime_id,
          session_id,
          started_at,
          status,
          trigger
        )
        VALUES (?, 1800, 1000, ?, ?, ?, 'gpt-5.4', 'openai', 'openai-runtime', ?, 1200, 'completed', 'user_prompt')
      `,
    )
    .bind(AGENT_ID, createdByAccountId, deploymentVersionId, SESSION_RUN_ID, SESSION_ID)
    .run();
}

describe("session model call identity", () => {
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
      createdAtMs: USAGE_CREATED_AT_MS,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      sourceEventSeq: 5,
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
      total_cost_usd_micros: 5_400,
    });
    expect(JSON.parse(usageEvent?.price_snapshot_json ?? "{}")).toMatchObject({
      model: "gpt-5.4",
      provider: "openai",
    });
  });

  test("fails closed when a usage run cannot prove Agent and Session Project equality", async () => {
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

    await expect(
      upsertSessionModelCallUsage(database, {
        createdAtMs: USAGE_CREATED_AT_MS,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionId: SESSION_ID,
        sessionRunId: SESSION_RUN_ID,
        sourceEventSeq: 5,
        traceId: "trace-wrong-project",
        usage,
      }),
    ).rejects.toThrow("Session run not found for model call usage.");
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
      createdAtMs: USAGE_CREATED_AT_MS,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      sourceEventSeq: 5,
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

  test.each([
    ["running", null, "started"],
    ["waiting_input", null, "started"],
    ["completed", 1_800, "completed"],
    ["failed", 1_800, "failed"],
    ["cancelled", 1_800, "failed"],
    ["expired", 1_800, "failed"],
  ] as const)(
    "derives model-call status from durable Run status %s",
    async (runStatus, completedAt, expectedStatus) => {
      const database = createSessionModelCallDatabase();
      await seedRunIdentity(database);
      await database
        .prepare("UPDATE session_run SET completed_at = ?, status = ? WHERE id = ?")
        .bind(completedAt, runStatus, SESSION_RUN_ID)
        .run();

      await upsertSessionModelCallUsage(database, {
        createdAtMs: USAGE_CREATED_AT_MS,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionId: SESSION_ID,
        sessionRunId: SESSION_RUN_ID,
        sourceEventSeq: 5,
        traceId: "trace-status",
        usage: {
          callId: "status-call",
          inputTokens: 10,
          source: "prompt_response",
          usageContract: "openai_total_with_cached_breakdown",
        },
      });

      expect(
        await database
          .prepare("SELECT completed_at, status FROM session_model_call")
          .first<{ completed_at: number | null; status: string }>(),
      ).toEqual({ completed_at: completedAt, status: expectedStatus });
    },
  );

  test("converges model-call and usage rows by durable event seq", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    const input = {
      createdAtMs: USAGE_CREATED_AT_MS,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      sourceEventSeq: 5,
      traceId: "trace-sequenced",
      usage: {
        callId: "sequenced-call",
        inputTokens: 10,
        outputTokens: 5,
        source: "prompt_response" as const,
        usageContract: "openai_total_with_cached_breakdown" as const,
      },
    };

    await upsertSessionModelCallUsage(database, input);
    await upsertSessionModelCallUsage(database, {
      ...input,
      sourceEventSeq: 4,
      usage: { ...input.usage, inputTokens: 1 },
    });
    await upsertSessionModelCallUsage(database, input);
    await expect(
      upsertSessionModelCallUsage(database, {
        ...input,
        usage: { ...input.usage, inputTokens: 20 },
      }),
    ).rejects.toThrow("replayed with conflicting content");
    await upsertSessionModelCallUsage(database, {
      ...input,
      sourceEventSeq: 6,
      usage: { ...input.usage, inputTokens: 30 },
    });

    expect(
      await database
        .prepare(
          "SELECT input_tokens, source_event_seq, status FROM session_model_call WHERE call_key = ?",
        )
        .bind("model_call:sequenced-call")
        .first<{ input_tokens: number; source_event_seq: number; status: string }>(),
    ).toEqual({ input_tokens: 30, source_event_seq: 6, status: "completed" });
    expect(
      await database
        .prepare("SELECT input_tokens, source_event_seq FROM usage_event WHERE source_event_id = ?")
        .bind(`${DRIVER_INSTANCE_ID}:sequenced-call`)
        .first<{ input_tokens: number; source_event_seq: number }>(),
    ).toEqual({ input_tokens: 30, source_event_seq: 6 });
  });

  test("merges higher partial usage identically into the model call and ledger", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    const input = {
      createdAtMs: USAGE_CREATED_AT_MS,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      sourceEventSeq: 5,
      traceId: "trace-partial",
      usage: {
        callId: "partial-call",
        inputTokens: 10,
        outputTokens: 5,
        source: "prompt_response" as const,
        usageContract: "openai_total_with_cached_breakdown" as const,
      },
    };

    const partialInput = {
      ...input,
      createdAtMs: USAGE_CREATED_AT_MS + 100,
      sourceEventSeq: 6,
      usage: {
        callId: "partial-call",
        outputTokens: 7,
        source: "prompt_response",
        usageContract: "openai_total_with_cached_breakdown",
      },
    };

    await upsertSessionModelCallUsage(database, input);
    await upsertSessionModelCallUsage(database, partialInput);
    await upsertSessionModelCallUsage(database, partialInput);

    expect(
      await database
        .prepare(
          `SELECT created_at, input_tokens, output_tokens, source_event_seq
             FROM session_model_call WHERE call_key = ?`,
        )
        .bind("model_call:partial-call")
        .first(),
    ).toEqual({
      created_at: USAGE_CREATED_AT_MS,
      input_tokens: 10,
      output_tokens: 7,
      source_event_seq: 6,
    });
    expect(
      await database
        .prepare(
          `SELECT created_at, input_tokens, output_tokens, source_event_seq
             FROM usage_event WHERE source_event_id = ?`,
        )
        .bind(`${DRIVER_INSTANCE_ID}:partial-call`)
        .first(),
    ).toEqual({
      created_at: USAGE_CREATED_AT_MS,
      input_tokens: 10,
      output_tokens: 7,
      source_event_seq: 6,
    });

    await database
      .prepare("UPDATE session_run SET model = 'gpt-5.5' WHERE id = ?")
      .bind(SESSION_RUN_ID)
      .run();
    await expect(
      upsertSessionModelCallUsage(database, {
        ...partialInput,
        sourceEventSeq: 7,
        usage: { ...partialInput.usage, outputTokens: 9 },
      }),
    ).rejects.toThrow();

    expect(
      await database
        .prepare(
          `SELECT model, output_tokens, source_event_seq
             FROM session_model_call WHERE call_key = ?`,
        )
        .bind("model_call:partial-call")
        .first(),
    ).toEqual({ model: "gpt-5.4", output_tokens: 7, source_event_seq: 6 });
    expect(
      await database
        .prepare(
          `SELECT model, output_tokens, source_event_seq
             FROM usage_event WHERE source_event_id = ?`,
        )
        .bind(`${DRIVER_INSTANCE_ID}:partial-call`)
        .first(),
    ).toEqual({ model: "gpt-5.4", output_tokens: 7, source_event_seq: 6 });
  });

  test("never replaces raw usage after its durable call was rolled up", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    const input = {
      createdAtMs: USAGE_CREATED_AT_MS,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      sourceEventSeq: 5,
      traceId: "trace-rolled",
      usage: {
        callId: "rolled-call",
        inputTokens: 10,
        outputTokens: 5,
        source: "prompt_response" as const,
        usageContract: "openai_total_with_cached_breakdown" as const,
      },
    };

    await upsertSessionModelCallUsage(database, input);
    await database
      .prepare(
        "INSERT INTO usage_event_rollup_receipt (source, source_event_id, rolled_up_at) VALUES (?, ?, ?)",
      )
      .bind("runtime_driver", `${DRIVER_INSTANCE_ID}:rolled-call`, 2_000)
      .run();
    await database
      .prepare("DELETE FROM usage_event WHERE source_event_id = ?")
      .bind(`${DRIVER_INSTANCE_ID}:rolled-call`)
      .run();

    await upsertSessionModelCallUsage(database, input);
    await expect(
      upsertSessionModelCallUsage(database, {
        ...input,
        sourceEventSeq: 6,
        usage: { ...input.usage, inputTokens: 20 },
      }),
    ).rejects.toThrow("already rolled up");

    expect(
      await database
        .prepare("SELECT source_event_seq FROM session_model_call WHERE call_key = ?")
        .bind("model_call:rolled-call")
        .first<{ source_event_seq: number }>(),
    ).toEqual({ source_event_seq: 5 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });
});
