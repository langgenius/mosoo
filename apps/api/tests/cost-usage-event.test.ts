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
const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000008", "project ID");
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
  project_id: string;
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

const RUN_CONTEXT: RuntimeUsageRunContext = {
  actorUserId: ACTOR_ID,
  agentId: AGENT_ID,
  agentOwnerUserId: OWNER_ID,
  agentRevisionId: null,
  agentStatus: "draft",
  createdAtMs: Date.UTC(2026, 5, 1, 12),
  model: "run-model",
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  provider: "run-provider",
  runtimeId: "custom-runtime",
  sessionId: SESSION_ID,
  sessionRunId: SESSION_RUN_ID,
  trigger: "user_prompt",
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
            project_id,
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
      project_id: PROJECT_ID,
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
      total_cost_usd_micros: 5_400,
    });
    const priceSnapshot = JSON.parse(row?.price_snapshot_json ?? "{}") as Record<string, unknown>;
    expect(priceSnapshot).toMatchObject({
      billableInputTokens: 900,
      cacheReadUsdPerMillion: 0.25,
      cacheWriteUsdPerMillion: 3.125,
      inputUsdPerMillion: 2.5,
      longContextApplied: false,
      model: "gpt-5.4",
      outputUsdPerMillion: 15,
      provider: "openai",
      source: "mosoo_seed_2026_07_10",
    });
  });

  test("prices OpenCode-run Kimi usage from the persisted provider identity", async () => {
    const database = createUsageEventDatabase();
    const runContext = {
      ...RUN_CONTEXT,
      model: "kimi-k2.6",
      provider: "kimi",
      runtimeId: "opencode",
    };
    const usage = {
      cachedReadTokens: 100,
      cachedWriteTokens: 40,
      inputTokens: 1_000,
      model: "opencode/kimi-k2.6",
      outputTokens: 200,
      provider: "opencode",
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    await recordRuntimeUsageEvent(database, {
      callKey: "opencode-kimi-call",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: null,
      run: runContext,
      usage,
    });

    const row = await database
      .prepare(
        `
          SELECT
            model,
            price_snapshot_json,
            pricing_status,
            provider,
            runtime_id,
            total_cost_usd_micros
          FROM usage_event
        `,
      )
      .first<
        Pick<
          UsageEventProjection,
          | "model"
          | "price_snapshot_json"
          | "pricing_status"
          | "provider"
          | "runtime_id"
          | "total_cost_usd_micros"
        >
      >();

    expect(row).toMatchObject({
      model: "kimi-k2.6",
      pricing_status: "priced",
      provider: "kimi",
      runtime_id: "opencode",
      total_cost_usd_micros: 1_671,
    });
    const priceSnapshot = JSON.parse(row?.price_snapshot_json ?? "{}") as Record<string, unknown>;
    expect(priceSnapshot).toMatchObject({
      billableInputTokens: 900,
      cacheReadUsdPerMillion: 0.16,
      inputUsdPerMillion: 0.95,
      model: "kimi-k2.6",
      outputUsdPerMillion: 4,
      provider: "kimi",
    });
  });

  test("persists and idempotently updates reported USD cost without token counters", async () => {
    const database = createUsageEventDatabase();
    const usage = {
      costAmount: 0.42,
      costCurrency: "USD",
      source: "session_update",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;
    const input = {
      callKey: "cost-only-call",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: "cost-only-native-call",
      run: RUN_CONTEXT,
      usage,
    };

    await recordRuntimeUsageEvent(database, input);
    await recordRuntimeUsageEvent(database, {
      ...input,
      usage: {
        ...usage,
        costAmount: 0.84,
      },
    });

    const row = await database
      .prepare(
        `
          SELECT
            COUNT(*) AS count,
            cache_creation_tokens,
            cache_read_tokens,
            input_tokens,
            output_tokens,
            pricing_status,
            total_cost_usd_micros,
            usage_contract
          FROM usage_event
        `,
      )
      .first<{
        count: number;
        cache_creation_tokens: number;
        cache_read_tokens: number;
        input_tokens: number;
        output_tokens: number;
        pricing_status: string;
        total_cost_usd_micros: number;
        usage_contract: string;
      }>();

    expect(row).toEqual({
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      count: 1,
      input_tokens: 0,
      output_tokens: 0,
      pricing_status: "unknown",
      total_cost_usd_micros: 840_000,
      usage_contract: "openai_total_with_cached_breakdown",
    });
  });

  test("preserves reported USD cost across explicit zero token corrections", async () => {
    const database = createUsageEventDatabase();
    const usage = {
      costAmount: 0.42,
      costCurrency: "USD",
      source: "session_update",
      usageContract: "openai_total_with_cached_breakdown",
    } satisfies SessionUsageSummary;

    const input = {
      callKey: "known-cost-only-call",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: "known-cost-only-native-call",
      run: {
        ...RUN_CONTEXT,
        model: "gpt-5.4",
        provider: "openai",
      },
      sourceEventSeq: 1,
      usage,
    };

    await recordRuntimeUsageEvent(database, input);
    await recordRuntimeUsageEvent(database, {
      ...input,
      sourceEventSeq: 2,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        source: "session_update",
        usageContract: "openai_total_with_cached_breakdown",
      },
    });

    const row = await database
      .prepare(
        `
          SELECT price_snapshot_json, pricing_status, source_event_seq, total_cost_usd_micros
          FROM usage_event
        `,
      )
      .first<{
        price_snapshot_json: string | null;
        pricing_status: string;
        source_event_seq: number;
        total_cost_usd_micros: number;
      }>();

    expect(row).toMatchObject({
      pricing_status: "priced",
      source_event_seq: 2,
      total_cost_usd_micros: 420_000,
    });
    expect(JSON.parse(row?.price_snapshot_json ?? "{}")).toEqual({
      model: "gpt-5.4",
      provider: "openai",
      reportedCostUsd: 0.42,
      source: "runtime_reported_usd",
      tokenCountersUnavailable: true,
    });
  });

  test("updates durable usage only from a higher source event seq", async () => {
    const database = createUsageEventDatabase();
    const input = {
      callKey: "sequenced-usage",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: "sequenced-native-call",
      run: RUN_CONTEXT,
      sourceEventSeq: 5,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        source: "prompt_response" as const,
        usageContract: "openai_total_with_cached_breakdown" as const,
      },
    };

    await recordRuntimeUsageEvent(database, input);
    await recordRuntimeUsageEvent(database, {
      ...input,
      sourceEventSeq: 4,
      usage: { ...input.usage, inputTokens: 1 },
    });
    await recordRuntimeUsageEvent(database, input);
    await expect(
      recordRuntimeUsageEvent(database, {
        ...input,
        usage: { ...input.usage, inputTokens: 20 },
      }),
    ).rejects.toThrow("replayed with conflicting content");
    await recordRuntimeUsageEvent(database, {
      ...input,
      sourceEventSeq: 6,
      usage: { ...input.usage, inputTokens: 30 },
    });

    expect(
      await database
        .prepare("SELECT input_tokens, source_event_seq FROM usage_event")
        .first<{ input_tokens: number; source_event_seq: number }>(),
    ).toEqual({ input_tokens: 30, source_event_seq: 6 });
  });

  test("merges partial Anthropic cache buckets without losing prior counters", async () => {
    const database = createUsageEventDatabase();
    const input = {
      callKey: "partial-anthropic",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: "partial-anthropic",
      run: {
        ...RUN_CONTEXT,
        createdAtMs: Date.UTC(2026, 7, 31),
        model: "claude-sonnet-5",
        provider: "anthropic",
      },
      sourceEventSeq: 5,
      usage: {
        cachedReadTokens: 2,
        inputTokens: 10,
        outputTokens: 5,
        source: "prompt_response" as const,
        usageContract: "anthropic_bucketed" as const,
      },
    };
    const partialInput = {
      ...input,
      run: { ...input.run, createdAtMs: Date.UTC(2026, 8, 1) },
      sourceEventSeq: 6,
      usage: {
        cachedReadTokens: 3,
        source: "prompt_response" as const,
        usageContract: "anthropic_bucketed" as const,
      },
    };

    await recordRuntimeUsageEvent(database, input);
    await recordRuntimeUsageEvent(database, partialInput);
    await recordRuntimeUsageEvent(database, partialInput);

    expect(
      await database
        .prepare(
          `SELECT cache_read_tokens, input_tokens, output_tokens, price_snapshot_json,
                  source_event_seq, total_cost_usd_micros
             FROM usage_event`,
        )
        .first(),
    ).toEqual({
      cache_read_tokens: 3,
      input_tokens: 13,
      output_tokens: 5,
      price_snapshot_json: JSON.stringify({
        billableInputTokens: 10,
        cacheReadUsdPerMillion: 0.2,
        cacheWriteUsdPerMillion: 2.5,
        inputUsdPerMillion: 2,
        longContextApplied: false,
        model: "claude-sonnet-5",
        outputUsdPerMillion: 10,
        provider: "anthropic",
        source: "mosoo_seed_2026_07_10",
      }),
      source_event_seq: 6,
      total_cost_usd_micros: 71,
    });
  });

  test("applies explicit zero corrections without creating empty ledger rows", async () => {
    const database = createUsageEventDatabase();
    const input = {
      callKey: "zero-correction",
      driverInstanceId: DRIVER_INSTANCE_ID,
      nativeCallId: "zero-correction",
      run: { ...RUN_CONTEXT, model: "gpt-5.4", provider: "openai" },
      sourceEventSeq: 1,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        source: "prompt_response" as const,
        usageContract: "openai_total_with_cached_breakdown" as const,
      },
    };

    await recordRuntimeUsageEvent(database, input);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 0,
    });

    await recordRuntimeUsageEvent(database, {
      ...input,
      usage: { ...input.usage, inputTokens: 10, outputTokens: 5 },
    });
    await recordRuntimeUsageEvent(database, { ...input, sourceEventSeq: 2 });

    expect(
      await database
        .prepare(
          `SELECT input_tokens, output_tokens, source_event_seq, total_cost_usd_micros
           FROM usage_event`,
        )
        .first(),
    ).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      source_event_seq: 2,
      total_cost_usd_micros: 0,
    });
  });
});
