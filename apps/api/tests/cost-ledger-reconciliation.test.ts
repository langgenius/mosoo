import { describe, expect, test } from "bun:test";

import { apiCommandsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { enqueueCostLedgerReconciliationCommand } from "../src/modules/api-command/application/api-command-enqueue";
import type { ApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { parseApiCommandPayload } from "../src/modules/api-command/application/api-command-payload";
import { processApiCommandMessage } from "../src/modules/api-command/application/api-command-processor";
import {
  parseCostLedgerReconciliationActivationMode,
  reconcileCostLedgerPage,
} from "../src/modules/cost/application/cost-ledger-reconciliation.service";
import { runUsageDailyRollup } from "../src/modules/cost/application/cost-rollup.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createApiCommandQueueStub,
  createPublicHttpTestBindings,
  createRecordedQueueMessage,
} from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const NOW_MS = Date.parse("2026-06-10T12:00:00.000Z");
const RECENT_MS = Date.parse("2026-06-09T12:00:00.000Z");
const BEFORE_RETENTION_MS = Date.parse("2026-06-02T23:59:59.999Z");

const ACTOR_ID = "01J00000000000000000000001";
const OWNER_ID = "01J00000000000000000000002";
const ORGANIZATION_ID = "01J00000000000000000000003";
const APP_ID = "01J00000000000000000000004";
const AGENT_ID = "01J00000000000000000000005";
const SESSION_ID = "01J00000000000000000000006";
const RUN_ID = "01J00000000000000000000007";
const DEPLOYMENT_ID = "01J00000000000000000000008";
const DRIVER_INSTANCE_ID = "01J00000000000000000000009";
const RUN_WITHOUT_REVISION_ID = "01J0000000000000000000000A";
const HISTORICAL_DRIVER_INSTANCE_ID = "01J0000000000000000000000B";

const MODEL_CALL_IDS = {
  auditRepairable: "01J00000000000000000000101",
  auditPresent: "01J00000000000000000000102",
  auditSkipped: "01J00000000000000000000103",
  auditInvalidMetadata: "01J00000000000000000000104",
  auditNoRevision: "01J00000000000000000000105",
  old: "01J00000000000000000000106",
  nativeRepair: "01J00000000000000000000107",
  fallbackRepair: "01J00000000000000000000108",
  race: "01J00000000000000000000109",
  batchFirst: "01J0000000000000000000010A",
  batchSecond: "01J0000000000000000000010B",
  pageFirst: "01J0000000000000000000010C",
  pageSecond: "01J0000000000000000000010D",
  pageThird: "01J0000000000000000000010E",
  command: "01J0000000000000000000010F",
  future: "01J0000000000000000000010G",
  oldCreatedRecentCompletion: "01J0000000000000000000010H",
  historicalDriver: "01J0000000000000000000010J",
  invalidValues: "01J0000000000000000000010K",
  validAfterInvalidId: "01J0000000000000000000010M",
} as const;

const VALID_USAGE_METADATA = JSON.stringify({
  source: "prompt_response",
  usageContract: "openai_total_with_cached_breakdown",
});

interface ModelCallInput {
  callKey?: string;
  completedAt?: number | null;
  costCurrency?: string | null;
  createdAt?: number;
  driverInstanceId?: string | null;
  id: string;
  inputTokens?: number | null;
  metadataJson?: string | null;
  nativeCallId: string | null;
  outputTokens?: number | null;
  runId?: string;
  totalCostUsdMicros?: number | null;
}

interface UsageEventProjection {
  created_at: number;
  source_event_id: string;
  total_cost_usd_micros: number;
}

async function createReconciliationDatabase(): Promise<SqliteD1Database> {
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

    CREATE TABLE agent_deployment_version (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      type text NOT NULL
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

    CREATE TABLE usage_daily_rollup (
      organization_id text NOT NULL,
      app_id text NOT NULL,
      agent_id text NOT NULL,
      actor_user_id text NOT NULL,
      agent_owner_user_id text NOT NULL,
      date text NOT NULL,
      agent_publication_state_at_run text NOT NULL,
      run_purpose text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      request_count integer NOT NULL,
      input_tokens integer NOT NULL,
      output_tokens integer NOT NULL,
      cache_read_tokens integer NOT NULL,
      cache_creation_tokens integer NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      unpriced_request_count integer NOT NULL,
      PRIMARY KEY (
        organization_id,
        app_id,
        agent_id,
        actor_user_id,
        agent_owner_user_id,
        date,
        agent_publication_state_at_run,
        run_purpose,
        provider,
        model
      )
    );

    CREATE TABLE api_command (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      dedupe_key text NOT NULL,
      payload_json text NOT NULL,
      status text NOT NULL,
      attempt_count integer DEFAULT 0 NOT NULL,
      claim_owner text,
      claim_expires_at integer,
      last_error_code text,
      last_error_message text,
      completed_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX api_command_dedupe_idx ON api_command (dedupe_key);
  `);

  database.execute(`
    INSERT INTO app (id, organization_id)
    VALUES ('${APP_ID}', '${ORGANIZATION_ID}');

    INSERT INTO agent (id, owner_account_id, app_id, status)
    VALUES ('${AGENT_ID}', '${OWNER_ID}', '${APP_ID}', 'published');

    INSERT INTO agent_deployment_version (id, agent_id)
    VALUES ('${DEPLOYMENT_ID}', '${AGENT_ID}');

    INSERT INTO session (id, metadata_json, model, app_id, provider, runtime_id, type)
    VALUES (
      '${SESSION_ID}',
      '{}',
      'custom-model',
      '${APP_ID}',
      'custom-provider',
      'session-runtime',
      'ui'
    );
  `);

  await insertRun(database, RUN_ID, DEPLOYMENT_ID);
  return database;
}

async function insertRun(
  database: SqliteD1Database,
  runId: string,
  deploymentVersionId: string | null,
): Promise<void> {
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
        VALUES (?, ?, ?, ?, ?, 'custom-model', 'custom-provider', 'run-runtime', ?, ?, 'user_prompt')
      `,
    )
    .bind(AGENT_ID, RECENT_MS, ACTOR_ID, deploymentVersionId, runId, SESSION_ID, RECENT_MS - 1_000)
    .run();
}

async function insertModelCall(database: D1Database, input: ModelCallInput): Promise<void> {
  const createdAt = input.createdAt ?? RECENT_MS;
  const completedAt = input.completedAt === undefined ? createdAt : input.completedAt;
  const inputTokens = input.inputTokens === undefined ? 10 : input.inputTokens;
  const outputTokens = input.outputTokens === undefined ? 5 : input.outputTokens;
  const costCurrency = input.costCurrency === undefined ? "USD" : input.costCurrency;
  const totalCostUsdMicros =
    input.totalCostUsdMicros === undefined ? 123_456 : input.totalCostUsdMicros;
  const metadataJson = input.metadataJson === undefined ? VALID_USAGE_METADATA : input.metadataJson;
  const callKey =
    input.callKey ??
    (input.nativeCallId === null ? `run_usage_${input.id}` : `model_call:${input.nativeCallId}`);

  await database
    .prepare(
      `
        INSERT INTO session_model_call (
          cache_creation_tokens,
          cache_read_tokens,
          call_key,
          completed_at,
          cost_currency,
          created_at,
          driver_instance_id,
          id,
          input_tokens,
          metadata_json,
          model,
          native_call_id,
          output_tokens,
          provider,
          session_id,
          session_run_id,
          started_at,
          status,
          total_cost_usd_micros,
          trace_id,
          updated_at
        )
        VALUES (0, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'custom-model', ?, ?, 'custom-provider', ?, ?, ?, 'completed', ?, ?, ?)
      `,
    )
    .bind(
      callKey,
      completedAt,
      costCurrency,
      createdAt,
      input.driverInstanceId === undefined ? DRIVER_INSTANCE_ID : input.driverInstanceId,
      input.id,
      inputTokens,
      metadataJson,
      input.nativeCallId,
      outputTokens,
      SESSION_ID,
      input.runId ?? RUN_ID,
      createdAt - 1_000,
      totalCostUsdMicros,
      `trace-${input.id}`,
      createdAt,
    )
    .run();
}

async function insertUsageEvent(
  database: D1Database,
  input: {
    createdAt?: number;
    id: string;
    sourceEventId: string;
    totalCostUsdMicros?: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO usage_event (
          actor_user_id,
          agent_id,
          agent_owner_user_id,
          agent_publication_state_at_run,
          agent_revision_id,
          cache_creation_tokens,
          cache_read_tokens,
          created_at,
          id,
          input_tokens,
          model,
          organization_id,
          app_id,
          output_tokens,
          price_snapshot_json,
          pricing_status,
          provider,
          run_purpose,
          runtime_id,
          session_id,
          session_run_id,
          source,
          source_event_id,
          total_cost_usd_micros,
          usage_contract
        )
        VALUES (?, ?, ?, 'published', ?, 0, 0, ?, ?, 10, 'custom-model', ?, ?, 5, NULL, 'unknown', 'custom-provider', 'production', 'run-runtime', ?, ?, 'runtime_driver', ?, ?, 'openai_total_with_cached_breakdown')
      `,
    )
    .bind(
      ACTOR_ID,
      AGENT_ID,
      OWNER_ID,
      DEPLOYMENT_ID,
      input.createdAt ?? RECENT_MS,
      input.id,
      ORGANIZATION_ID,
      APP_ID,
      SESSION_ID,
      RUN_ID,
      input.sourceEventId,
      input.totalCostUsdMicros ?? 123_456,
    )
    .run();
}

function createConcurrentRuntimeWriteDatabase(
  database: SqliteD1Database,
  input: { sourceEventId: string },
): D1Database {
  let inserted = false;

  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return async <T = unknown>(statements: D1PreparedStatement[]) => {
          if (!inserted) {
            inserted = true;
            await insertUsageEvent(target, {
              id: "01J00000000000000000000201",
              sourceEventId: input.sourceEventId,
              totalCostUsdMicros: 999_999,
            });
          }

          return target.batch<T>(statements);
        };
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createInterruptedBatchDatabase(database: SqliteD1Database): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return async <T = unknown>(statements: D1PreparedStatement[]) => {
          let runCount = 0;
          const interruptedStatements = statements.map(
            (statement) =>
              new Proxy(statement, {
                get(statementTarget, statementProperty) {
                  if (statementProperty === "run") {
                    return async <R = unknown>() => {
                      runCount += 1;

                      if (runCount === 2) {
                        throw new Error("injected reconciliation batch interruption");
                      }

                      return statementTarget.run<R>();
                    };
                  }

                  const value = Reflect.get(statementTarget, statementProperty);
                  return typeof value === "function" ? value.bind(statementTarget) : value;
                },
              }),
          );

          return target.batch<T>(interruptedStatements);
        };
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function countUsageEvents(database: D1Database): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS count FROM usage_event")
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("cost ledger reconciliation", () => {
  test("audits present, repairable, skipped, and indeterminate history without writing", async () => {
    const database = await createReconciliationDatabase();
    await insertRun(database, RUN_WITHOUT_REVISION_ID, null);

    await insertModelCall(database, {
      id: MODEL_CALL_IDS.auditRepairable,
      nativeCallId: "audit-repairable",
    });
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.auditPresent,
      nativeCallId: "audit-present",
    });
    await insertUsageEvent(database, {
      id: "01J00000000000000000000202",
      sourceEventId: `${DRIVER_INSTANCE_ID}:audit-present`,
    });
    await insertModelCall(database, {
      costCurrency: null,
      id: MODEL_CALL_IDS.auditSkipped,
      inputTokens: 0,
      nativeCallId: "audit-skipped",
      outputTokens: 0,
      totalCostUsdMicros: null,
    });
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.auditInvalidMetadata,
      metadataJson: "{invalid",
      nativeCallId: "audit-invalid-metadata",
    });
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.auditNoRevision,
      nativeCallId: "audit-no-revision",
      runId: RUN_WITHOUT_REVISION_ID,
    });
    await insertModelCall(database, {
      completedAt: NOW_MS + 1,
      createdAt: NOW_MS + 1,
      id: MODEL_CALL_IDS.future,
      nativeCallId: "future-call",
    });
    await insertModelCall(database, {
      completedAt: BEFORE_RETENTION_MS,
      createdAt: BEFORE_RETENTION_MS,
      id: MODEL_CALL_IDS.old,
      nativeCallId: "old-history",
    });

    const result = await reconcileCostLedgerPage(database, {
      limit: 10,
      now: new Date(NOW_MS),
    });

    expect(result).toEqual({
      failed: 0,
      hasMore: false,
      historyBeforeRetentionIndeterminate: true,
      indeterminate: 3,
      indeterminateByReason: {
        invalid_usage_metadata: 1,
        invalid_usage_timestamp: 1,
        missing_published_revision: 1,
      },
      mode: "audit",
      nextCursor: null,
      present: 1,
      repairable: 1,
      repaired: 0,
      scanned: 6,
      skipped: 1,
    });
    expect(await countUsageEvents(database)).toBe(1);
  });

  test("repairs native and fallback source identities exactly once", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.nativeRepair,
      nativeCallId: "native-repair",
    });
    await insertModelCall(database, {
      callKey: "run_usage",
      id: MODEL_CALL_IDS.fallbackRepair,
      nativeCallId: null,
    });

    const first = await reconcileCostLedgerPage(database, {
      limit: 10,
      mode: "repair",
      now: new Date(NOW_MS),
    });
    const rows = await database
      .prepare(
        `
          SELECT created_at, source_event_id, total_cost_usd_micros
          FROM usage_event
          ORDER BY source_event_id
        `,
      )
      .all<UsageEventProjection>();
    const second = await reconcileCostLedgerPage(database, {
      limit: 10,
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(first).toMatchObject({
      present: 0,
      repairable: 2,
      repaired: 2,
      scanned: 2,
    });
    expect(rows.results).toEqual([
      {
        created_at: RECENT_MS,
        source_event_id: `${DRIVER_INSTANCE_ID}:${RUN_ID}:run_usage`,
        total_cost_usd_micros: 123_456,
      },
      {
        created_at: RECENT_MS,
        source_event_id: `${DRIVER_INSTANCE_ID}:native-repair`,
        total_cost_usd_micros: 123_456,
      },
    ]);
    expect(second).toMatchObject({
      present: 2,
      repairable: 0,
      repaired: 0,
      scanned: 2,
    });
    expect(await countUsageEvents(database)).toBe(2);
  });

  test("never repairs history outside the raw-detail retention window", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      completedAt: BEFORE_RETENTION_MS,
      createdAt: BEFORE_RETENTION_MS,
      id: MODEL_CALL_IDS.old,
      nativeCallId: "old-history",
    });

    const result = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(result).toMatchObject({
      historyBeforeRetentionIndeterminate: true,
      repaired: 0,
      scanned: 0,
    });
    expect(await countUsageEvents(database)).toBe(0);
  });

  test("does not resurrect detail that the daily rollup already consumed", async () => {
    const database = await createReconciliationDatabase();
    const sourceEventId = `${DRIVER_INSTANCE_ID}:rolled-history`;
    await insertModelCall(database, {
      completedAt: BEFORE_RETENTION_MS,
      createdAt: BEFORE_RETENTION_MS,
      id: MODEL_CALL_IDS.old,
      nativeCallId: "rolled-history",
    });
    await insertUsageEvent(database, {
      createdAt: BEFORE_RETENTION_MS,
      id: "01J00000000000000000000203",
      sourceEventId,
    });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await runUsageDailyRollup(bindings, new Date(NOW_MS));
    const beforeReconciliation = await database
      .prepare("SELECT request_count, total_cost_usd_micros FROM usage_daily_rollup ORDER BY date")
      .all<{ request_count: number; total_cost_usd_micros: number }>();
    const result = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });
    const afterReconciliation = await database
      .prepare("SELECT request_count, total_cost_usd_micros FROM usage_daily_rollup ORDER BY date")
      .all<{ request_count: number; total_cost_usd_micros: number }>();

    expect(beforeReconciliation.results).toEqual([
      { request_count: 1, total_cost_usd_micros: 123_456 },
    ]);
    expect(result).toMatchObject({
      historyBeforeRetentionIndeterminate: true,
      repaired: 0,
      scanned: 0,
    });
    expect(await countUsageEvents(database)).toBe(0);
    expect(afterReconciliation.results).toEqual(beforeReconciliation.results);
  });

  test("does not repair a recent completion whose model call predates retention", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      completedAt: RECENT_MS,
      createdAt: BEFORE_RETENTION_MS,
      id: MODEL_CALL_IDS.oldCreatedRecentCompletion,
      nativeCallId: "old-created-recent-completion",
    });

    const result = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(result).toMatchObject({
      indeterminate: 1,
      indeterminateByReason: { predates_safe_repair_window: 1 },
      repaired: 0,
      scanned: 1,
    });
    expect(await countUsageEvents(database)).toBe(0);
  });

  test("does not duplicate a ledger event written under a historical driver identity", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.historicalDriver,
      nativeCallId: "driver-drift",
    });
    await insertUsageEvent(database, {
      id: "01J00000000000000000000204",
      sourceEventId: `${HISTORICAL_DRIVER_INSTANCE_ID}:driver-drift`,
    });

    const result = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(result).toMatchObject({
      indeterminate: 1,
      indeterminateByReason: { ambiguous_existing_ledger_event: 1 },
      repaired: 0,
      scanned: 1,
    });
    expect(await countUsageEvents(database)).toBe(1);
  });

  test("does not normalize invalid historical usage values into a new ledger event", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.invalidValues,
      inputTokens: -1,
      nativeCallId: "invalid-values",
    });

    const result = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(result).toMatchObject({
      indeterminate: 1,
      indeterminateByReason: { invalid_usage_values: 1 },
      repaired: 0,
      scanned: 1,
    });
    expect(await countUsageEvents(database)).toBe(0);
  });

  test("reports malformed channel session metadata instead of failing or inferring purpose", async () => {
    const database = await createReconciliationDatabase();
    await database
      .prepare("UPDATE session SET metadata_json = '{invalid', type = 'api_channel'")
      .run();
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.auditInvalidMetadata,
      nativeCallId: "invalid-channel-metadata",
    });

    const result = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(result).toMatchObject({
      indeterminate: 1,
      indeterminateByReason: { invalid_session_metadata: 1 },
      repaired: 0,
    });
    expect(await countUsageEvents(database)).toBe(0);
  });

  test("preserves a concurrent runtime ledger write instead of replacing it", async () => {
    const database = await createReconciliationDatabase();
    const sourceEventId = `${DRIVER_INSTANCE_ID}:race-call`;
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.race,
      nativeCallId: "race-call",
    });

    const result = await reconcileCostLedgerPage(
      createConcurrentRuntimeWriteDatabase(database, { sourceEventId }),
      {
        mode: "repair",
        now: new Date(NOW_MS),
      },
    );
    const row = await database
      .prepare("SELECT created_at, source_event_id, total_cost_usd_micros FROM usage_event")
      .first<UsageEventProjection>();

    expect(result).toMatchObject({ present: 1, repairable: 1, repaired: 0 });
    expect(row).toEqual({
      created_at: RECENT_MS,
      source_event_id: sourceEventId,
      total_cost_usd_micros: 999_999,
    });
  });

  test("rolls back an interrupted repair batch and converges on retry", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.batchFirst,
      nativeCallId: "batch-first",
    });
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.batchSecond,
      nativeCallId: "batch-second",
    });

    await expect(
      reconcileCostLedgerPage(createInterruptedBatchDatabase(database), {
        mode: "repair",
        now: new Date(NOW_MS),
      }),
    ).rejects.toThrow("injected reconciliation batch interruption");
    expect(await countUsageEvents(database)).toBe(0);

    const retry = await reconcileCostLedgerPage(database, {
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(retry).toMatchObject({ repairable: 2, repaired: 2 });
    expect(await countUsageEvents(database)).toBe(2);
  });

  test("resumes bounded repair pages with a stable cursor", async () => {
    const database = await createReconciliationDatabase();
    for (const [id, nativeCallId] of [
      [MODEL_CALL_IDS.pageFirst, "page-first"],
      [MODEL_CALL_IDS.pageSecond, "page-second"],
      [MODEL_CALL_IDS.pageThird, "page-third"],
    ] as const) {
      await insertModelCall(database, { id, nativeCallId });
    }

    const first = await reconcileCostLedgerPage(database, {
      limit: 1,
      mode: "repair",
      now: new Date(NOW_MS),
    });
    const second = await reconcileCostLedgerPage(database, {
      cursor: first.nextCursor,
      limit: 1,
      mode: "repair",
      now: new Date(NOW_MS),
    });
    const third = await reconcileCostLedgerPage(database, {
      cursor: second.nextCursor,
      limit: 1,
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(first).toMatchObject({ hasMore: true, repaired: 1, scanned: 1 });
    expect(first.nextCursor).toBe(MODEL_CALL_IDS.pageThird);
    expect(second).toMatchObject({ hasMore: true, repaired: 1, scanned: 1 });
    expect(second.nextCursor).toBe(MODEL_CALL_IDS.pageSecond);
    expect(third).toMatchObject({ hasMore: false, nextCursor: null, repaired: 1, scanned: 1 });
    expect(await countUsageEvents(database)).toBe(3);
  });

  test("continues past a corrupt model-call ID without losing the next page", async () => {
    const database = await createReconciliationDatabase();
    await insertModelCall(database, {
      id: "not-a-platform-id",
      nativeCallId: "invalid-model-call-id",
    });
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.validAfterInvalidId,
      nativeCallId: "valid-after-invalid-id",
    });

    const first = await reconcileCostLedgerPage(database, {
      limit: 1,
      mode: "repair",
      now: new Date(NOW_MS),
    });
    const second = await reconcileCostLedgerPage(database, {
      cursor: first.nextCursor,
      limit: 1,
      mode: "repair",
      now: new Date(NOW_MS),
    });

    expect(first).toMatchObject({
      hasMore: true,
      indeterminateByReason: { invalid_platform_identity: 1 },
      nextCursor: "not-a-platform-id",
      repaired: 0,
    });
    expect(second).toMatchObject({ hasMore: false, repaired: 1, scanned: 1 });
    expect(await countUsageEvents(database)).toBe(1);
  });

  test("runs repair through the durable API command ledger and local Queue boundary", async () => {
    const database = await createReconciliationDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.command,
      nativeCallId: "command-repair",
    });

    await enqueueCostLedgerReconciliationCommand(bindings, {
      cursor: null,
      mode: "repair",
      scheduledTime: NOW_MS,
    });
    const queued = queue.sent[0]?.body;

    if (queued === undefined) {
      throw new Error("Expected reconciliation API command to be queued.");
    }

    const recorded = createRecordedQueueMessage<ApiCommandMessage>({ body: queued });
    await processApiCommandMessage(bindings, recorded.message, () => NOW_MS);

    const command = await database
      .app()
      .select({ kind: apiCommandsTable.kind, status: apiCommandsTable.status })
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.id, queued.commandId))
      .get();

    expect(command).toEqual({ kind: "cost_ledger_reconciliation", status: "succeeded" });
    expect(recorded.recorded).toEqual([{ type: "ack" }]);
    expect(await countUsageEvents(database)).toBe(1);
  });

  test("does not resurrect rolled detail when a durable command is delayed", async () => {
    const database = await createReconciliationDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    await insertModelCall(database, {
      id: MODEL_CALL_IDS.command,
      nativeCallId: "delayed-command",
    });
    await enqueueCostLedgerReconciliationCommand(bindings, {
      cursor: null,
      mode: "repair",
      scheduledTime: NOW_MS,
    });
    const queued = queue.sent[0]?.body;

    if (queued === undefined) {
      throw new Error("Expected delayed reconciliation API command to be queued.");
    }

    const recorded = createRecordedQueueMessage<ApiCommandMessage>({ body: queued });
    const processedAfterRetentionMs = Date.parse("2026-06-18T12:00:00.000Z");
    await processApiCommandMessage(bindings, recorded.message, () => processedAfterRetentionMs);

    expect(recorded.recorded).toEqual([{ type: "ack" }]);
    expect(await countUsageEvents(database)).toBe(0);
  });

  test("fails closed on invalid operator and command modes", () => {
    expect(parseCostLedgerReconciliationActivationMode(undefined)).toBeNull();
    expect(parseCostLedgerReconciliationActivationMode(" audit ")).toBe("audit");
    expect(() => parseCostLedgerReconciliationActivationMode("write")).toThrow(
      "MOSOO_COST_LEDGER_RECONCILIATION_MODE",
    );
    expect(() =>
      parseApiCommandPayload(
        "cost_ledger_reconciliation",
        JSON.stringify({ cursor: null, mode: "write", scheduledTime: NOW_MS }),
      ),
    ).toThrow("mode must be 'audit' or 'repair'");
    expect(
      parseApiCommandPayload(
        "cost_ledger_reconciliation",
        JSON.stringify({ cursor: "opaque-database-key", mode: "audit", scheduledTime: NOW_MS }),
      ),
    ).toMatchObject({ cursor: "opaque-database-key" });
    expect(() =>
      parseApiCommandPayload(
        "cost_ledger_reconciliation",
        JSON.stringify({ cursor: "", mode: "audit", scheduledTime: NOW_MS }),
      ),
    ).toThrow("cursor must not be empty");
  });
});
