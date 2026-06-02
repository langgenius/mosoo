import { describe, expect, test } from "bun:test";

import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  OrganizationId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import { recordRuntimeUsageEvent } from "../src/modules/cost/application/cost-usage-event.service";
import type { RuntimeUsageRunContext } from "../src/modules/cost/application/cost-usage-event.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ACTOR_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "actor ID");
const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000002", "owner ID");
const AGENT_ID = parsePlatformId<AgentId>("01J00000000000000000000003", "agent ID");
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000004",
  "organization ID",
);
const SESSION_ID = parsePlatformId<SessionId>("01J00000000000000000000005", "session ID");
const SESSION_RUN_ID = parsePlatformId<SessionRunId>(
  "01J00000000000000000000006",
  "session run ID",
);
const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J00000000000000000000007",
  "driver instance ID",
);

interface UsageEventProjection {
  agent_publication_state_at_run: string;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  input_tokens: number;
  model: string;
  output_tokens: number;
  price_snapshot_json: string | null;
  pricing_status: string;
  provider: string;
  run_purpose: string;
  runtime_id: string | null;
  total_cost_usd_micros: number;
  usage_contract: string;
}

function createUsageEventDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
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

const RUN_CONTEXT: RuntimeUsageRunContext = {
  actorUserId: ACTOR_ID,
  agentId: AGENT_ID,
  agentOwnerUserId: OWNER_ID,
  agentRevisionId: null,
  agentStatus: "draft",
  createdAtMs: Date.UTC(2026, 5, 1, 12),
  model: "run-model",
  organizationId: ORGANIZATION_ID,
  provider: "run-provider",
  runtimeId: "custom-runtime",
  sessionId: SESSION_ID,
  sessionType: "ui",
  sessionRunId: SESSION_RUN_ID,
  trigger: "user_prompt",
  triggerProvider: null,
};

describe("cost usage event", () => {
  test("persists unknown pricing with persisted run identity and provided cost", async () => {
    const database = createUsageEventDatabase();
    const usage = {
      cachedReadTokens: 2,
      cachedWriteTokens: 1,
      costAmount: 0.123456,
      costCurrency: "USD",
      inputTokens: 10,
      model: "custom-model",
      outputTokens: 4,
      provider: "custom-provider",
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await recordRuntimeUsageEvent(database, {
      callKey: "fallback-call",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: "native-call-1",
      run: RUN_CONTEXT,
      usage,
    });

    const row = await database
      .prepare(
        `
          SELECT
            agent_publication_state_at_run,
            cache_creation_tokens,
            cache_read_tokens,
            input_tokens,
            model,
            output_tokens,
            price_snapshot_json,
            pricing_status,
            provider,
            run_purpose,
            runtime_id,
            total_cost_usd_micros,
            usage_contract
          FROM usage_event
        `,
      )
      .first<UsageEventProjection>();

    expect(row).toMatchObject({
      agent_publication_state_at_run: "unpublished",
      cache_creation_tokens: 1,
      cache_read_tokens: 2,
      input_tokens: 10,
      model: "run-model",
      output_tokens: 4,
      price_snapshot_json: null,
      pricing_status: "unknown",
      provider: "run-provider",
      run_purpose: "debug",
      runtime_id: "custom-runtime",
      total_cost_usd_micros: 123456,
      usage_contract: "openai_total_with_cached_breakdown",
    });
  });

  test("prices known model usage from the persisted provider identity", async () => {
    const database = createUsageEventDatabase();
    const runContext = {
      ...RUN_CONTEXT,
      model: "gpt-5.4",
      provider: "openai",
    };
    const usage = {
      cachedReadTokens: 100,
      cachedWriteTokens: 40,
      costAmount: 99,
      costCurrency: "USD",
      inputTokens: 1_000,
      model: "claude-sonnet-4-5",
      outputTokens: 200,
      provider: "anthropic",
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await recordRuntimeUsageEvent(database, {
      callKey: "priced-call",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: null,
      run: runContext,
      usage,
    });

    const row = await database
      .prepare(
        `
          SELECT
            cache_creation_tokens,
            cache_read_tokens,
            input_tokens,
            model,
            output_tokens,
            price_snapshot_json,
            pricing_status,
            provider,
            total_cost_usd_micros
          FROM usage_event
        `,
      )
      .first<
        Pick<
          UsageEventProjection,
          | "cache_creation_tokens"
          | "cache_read_tokens"
          | "input_tokens"
          | "model"
          | "output_tokens"
          | "price_snapshot_json"
          | "pricing_status"
          | "provider"
          | "total_cost_usd_micros"
        >
      >();

    expect(row).toMatchObject({
      cache_creation_tokens: 40,
      cache_read_tokens: 100,
      input_tokens: 1_000,
      model: "gpt-5.4",
      output_tokens: 200,
      pricing_status: "priced",
      provider: "openai",
      total_cost_usd_micros: 9_800,
    });
    const priceSnapshot = JSON.parse(row?.price_snapshot_json ?? "{}") as Record<string, unknown>;
    expect(priceSnapshot).toMatchObject({
      billableInputTokens: 900,
      cacheReadUsdPerMillion: 0.5,
      cacheWriteUsdPerMillion: 6.25,
      inputUsdPerMillion: 5,
      model: "gpt-5.4",
      outputUsdPerMillion: 25,
      provider: "openai",
    });
  });

  test("projects channel session usage into channel run purpose", async () => {
    const database = createUsageEventDatabase();
    const usage = {
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      inputTokens: 10,
      outputTokens: 4,
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await recordRuntimeUsageEvent(database, {
      callKey: "telegram-channel-call",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: null,
      run: {
        ...RUN_CONTEXT,
        agentRevisionId: parsePlatformId<AgentDeploymentVersionId>(
          "01J00000000000000000000008",
          "deployment ID",
        ),
        agentStatus: "published",
        sessionType: "api_channel",
        triggerProvider: "telegram",
      },
      usage,
    });

    const row = await database
      .prepare(
        `
          SELECT run_purpose
          FROM usage_event
        `,
      )
      .first<Pick<UsageEventProjection, "run_purpose">>();

    expect(row).toEqual({
      run_purpose: "channel",
    });
  });
});
