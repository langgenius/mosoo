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
