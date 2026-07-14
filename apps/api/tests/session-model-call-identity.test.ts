import { describe, expect, test } from "bun:test";

import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  OrganizationId,
  AppId,
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
const APP_ID = parsePlatformId<AppId>("01J00000000000000000000019", "app ID");
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
  app_id: string;
  provider: string;
  run_purpose: string;
  runtime_id: string | null;
  source_event_id: string;
  total_cost_usd_micros: number;
}

function createSessionModelCallDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      type text DEFAULT 'ui' NOT NULL
    );

    CREATE TABLE session_run (
      agent_id text NOT NULL,
      completed_at integer,
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
      app_id text NOT NULL,
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
        INSERT INTO app (id, organization_id)
        VALUES (?, ?)
      `,
    )
    .bind(APP_ID, ORGANIZATION_ID)
    .run();
  await database
    .prepare(
      `
        INSERT INTO agent (id, owner_account_id, app_id, status)
        VALUES (?, ?, ?, 'published')
      `,
    )
    .bind(AGENT_ID, OWNER_ID, APP_ID)
    .run();
  await database
    .prepare(
      `
        INSERT INTO session (
          id,
          metadata_json,
          model,
          app_id,
          provider,
          runtime_id,
          type
        )
        VALUES (?, ?, 'session-model', ?, 'session-provider', 'session-runtime', ?)
      `,
    )
    .bind(SESSION_ID, sessionMetadataJson, APP_ID, sessionType)
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
      status: "completed",
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
            app_id,
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
      app_id: APP_ID,
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

  test("apps Telegram channel session usage into external run purpose", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database, {
      createdByAccountId: OWNER_ID,
      deploymentVersionId: DEPLOYMENT_ID,
      sessionMetadataJson: JSON.stringify({
        triggered_by: {
          binding_id: "telegram-binding-1",
          event_id: "telegram:update:1",
          external_actor_id: "telegram:user:42",
          external_message_id: "42:77",
          external_thread_id: "42:main",
          external_workspace_id: "42",
          provider: "telegram",
        },
      }),
      sessionType: "api_channel",
    });
    const usage = {
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      callId: "telegram-call-1",
      inputTokens: 50,
      outputTokens: 20,
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await upsertSessionModelCallUsage(database, {
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      status: "completed",
      traceId: "trace-telegram",
      usage,
    });

    const usageEvent = await database
      .prepare(
        `
          SELECT
            actor_user_id,
            run_purpose
          FROM usage_event
        `,
      )
      .first<Pick<UsageEventProjection, "actor_user_id" | "run_purpose">>();

    expect(usageEvent).toEqual({
      actor_user_id: OWNER_ID,
      run_purpose: "channel",
    });
  });

  test("fails closed when a usage run cannot prove Agent and Session App equality", async () => {
    const database = createSessionModelCallDatabase();
    await seedRunIdentity(database);
    await database
      .prepare(
        `
          UPDATE agent
          SET app_id = '01J00000000000000000000020'
          WHERE id = ?
        `,
      )
      .bind(AGENT_ID)
      .run();

    const usage = {
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      callId: "wrong-app-call",
      inputTokens: 50,
      outputTokens: 20,
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await expect(
      upsertSessionModelCallUsage(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionId: SESSION_ID,
        sessionRunId: SESSION_RUN_ID,
        status: "completed",
        traceId: "trace-wrong-app",
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
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionId: SESSION_ID,
      sessionRunId: SESSION_RUN_ID,
      status: "completed" as const,
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
