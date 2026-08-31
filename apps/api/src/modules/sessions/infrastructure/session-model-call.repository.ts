import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import {
  agentsTable,
  projectsTable,
  sessionEventsTable,
  sessionModelCallsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  OrganizationId,
  ProjectId,
  RuntimeEventId,
  SessionId,
  SessionModelCallId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, exists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import {
  createRuntimeUsageEventConvergencePredicate,
  createRuntimeUsageEventUnrolledPredicate,
  createRuntimeUsageEventUpsert,
  hasRuntimeUsageEventRollupReceipt,
} from "../../cost/application/cost-usage-event.service";
import type { SessionUsageSummary } from "./session-live-state.types";
interface SessionModelCallRunRow {
  agent_id: AgentId;
  agent_owner_user_id: AccountId;
  agent_revision_id: AgentDeploymentVersionId | null;
  agent_status: "draft" | "published";
  actor_user_id: AccountId;
  completed_at: number | null;
  created_at: number;
  model: string | null;
  project_organization_id: OrganizationId;
  project_id: ProjectId;
  provider: string | null;
  runtime_id: string | null;
  session_id: SessionId;
  session_model: string;
  session_provider: string;
  session_runtime_id: string;
  started_at: number | null;
  status: SessionRunStatus;
  trigger: "resume" | "retry" | "system" | "user_prompt";
}

export type SessionModelCallStatus = "completed" | "failed" | "started";

export interface UpsertSessionModelCallUsageInput {
  createdAtMs: number;
  driverInstanceId: DriverInstanceId;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  sourceEventSeq: number;
  traceId: string;
  usage: SessionUsageSummary | null;
}

export interface DurableSessionModelCallUsageProjectionInput extends UpsertSessionModelCallUsageInput {
  eventId: RuntimeEventId;
  semanticHash: string;
}

type SessionModelCallInsert = typeof sessionModelCallsTable.$inferInsert;

interface StoredSessionModelCall {
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  costCurrency: string | null;
  driverInstanceId: string | null;
  inputTokens: number | null;
  metadataJson: string | null;
  model: string;
  nativeCallId: string | null;
  outputTokens: number | null;
  provider: string;
  sessionId: string;
  sessionRunId: string;
  sourceEventSeq: number;
  startedAt: number | null;
  totalCostUsdMicros: number | null;
  traceId: string;
}

function selectedValue<Value>(value: Value, alias: string) {
  return sql<Value>`${value}`.as(alias);
}

function toTokenCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function toUsdMicros(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value * 1_000_000);
}

function buildUsageMetadata(usage: SessionUsageSummary): string {
  return JSON.stringify({
    cachedReadTokens: usage.cachedReadTokens ?? null,
    cachedWriteTokens: usage.cachedWriteTokens ?? null,
    callId: usage.callId ?? null,
    costAmount: usage.costAmount ?? null,
    costCurrency: usage.costCurrency ?? null,
    inputTokens: usage.inputTokens ?? null,
    model: usage.model ?? null,
    outputTokens: usage.outputTokens ?? null,
    provider: usage.provider ?? null,
    size: usage.size ?? null,
    source: usage.source,
    thoughtTokens: usage.thoughtTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    usageContract: usage.usageContract ?? null,
    used: usage.used ?? null,
  });
}

async function getSessionModelCallRunRow(
  database: D1Database,
  sessionRunId: SessionRunId,
): Promise<SessionModelCallRunRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        actor_user_id: sessionRunsTable.createdByAccountId,
        agent_id: sessionRunsTable.agentId,
        agent_owner_user_id: agentsTable.ownerId,
        agent_revision_id: sessionRunsTable.deploymentVersionId,
        agent_status: sql<"draft" | "published">`${agentsTable.status}`,
        completed_at: sessionRunsTable.completedAt,
        created_at: sessionRunsTable.createdAt,
        model: sql`${sessionRunsTable.model}`.mapWith(sessionRunsTable.model).as("model"),
        project_organization_id: projectsTable.organizationId,
        project_id: sessionsTable.projectId,
        provider: sql`${sessionRunsTable.provider}`
          .mapWith(sessionRunsTable.provider)
          .as("provider"),
        runtime_id: sql`${sessionRunsTable.runtimeId}`
          .mapWith(sessionRunsTable.runtimeId)
          .as("runtime_id"),
        session_id: sessionsTable.id,
        session_model: sql`${sessionsTable.model}`.mapWith(sessionsTable.model).as("session_model"),
        session_provider: sql`${sessionsTable.provider}`
          .mapWith(sessionsTable.provider)
          .as("session_provider"),
        session_runtime_id: sql`${sessionsTable.runtimeId}`
          .mapWith(sessionsTable.runtimeId)
          .as("session_runtime_id"),
        started_at: sessionRunsTable.startedAt,
        status: sessionRunsTable.status,
        trigger: sessionRunsTable.trigger,
      })
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .innerJoin(
        agentsTable,
        and(
          eq(agentsTable.id, sessionRunsTable.agentId),
          eq(agentsTable.projectId, sessionsTable.projectId),
        ),
      )
      .innerJoin(projectsTable, eq(projectsTable.id, sessionsTable.projectId))
      .where(eq(sessionRunsTable.id, sessionRunId))
      .limit(1)
      .get()) ?? null
  );
}

function toSessionModelCallStatus(status: SessionRunStatus): SessionModelCallStatus {
  if (status === "completed") {
    return "completed";
  }

  if (status === "failed" || status === "cancelled" || status === "expired") {
    return "failed";
  }

  return "started";
}

function createSessionModelCallInsertSelect(
  database: ReturnType<typeof getAppDatabase>,
  values: SessionModelCallInsert,
  writeFence: SQL,
) {
  return database
    .select({
      cacheCreationTokens: selectedValue(values.cacheCreationTokens, "cache_creation_tokens"),
      cacheReadTokens: selectedValue(values.cacheReadTokens, "cache_read_tokens"),
      callKey: selectedValue(values.callKey, "call_key"),
      completedAt: selectedValue(values.completedAt, "completed_at"),
      costCurrency: selectedValue(values.costCurrency, "cost_currency"),
      createdAt: selectedValue(values.createdAt, "created_at"),
      driverInstanceId: selectedValue(values.driverInstanceId, "driver_instance_id"),
      errorCode: selectedValue(values.errorCode, "error_code"),
      errorMessage: selectedValue(values.errorMessage, "error_message"),
      id: selectedValue(values.id, "id"),
      inputTokens: selectedValue(values.inputTokens, "input_tokens"),
      metadataJson: selectedValue(values.metadataJson, "metadata_json"),
      model: selectedValue(values.model, "model"),
      nativeCallId: selectedValue(values.nativeCallId, "native_call_id"),
      outputTokens: selectedValue(values.outputTokens, "output_tokens"),
      provider: selectedValue(values.provider, "provider"),
      sourceEventSeq: selectedValue(values.sourceEventSeq, "source_event_seq"),
      sessionId: selectedValue(values.sessionId, "session_id"),
      sessionRunId: selectedValue(values.sessionRunId, "session_run_id"),
      startedAt: selectedValue(values.startedAt, "started_at"),
      status: selectedValue(values.status, "status"),
      totalCostUsdMicros: selectedValue(values.totalCostUsdMicros, "total_cost_usd_micros"),
      traceId: selectedValue(values.traceId, "trace_id"),
      updatedAt: selectedValue(values.updatedAt, "updated_at"),
    })
    .from(sql`(SELECT 1)`)
    .where(writeFence);
}

function createSessionModelCallUsageUpsert(
  database: ReturnType<typeof getAppDatabase>,
  values: SessionModelCallInsert,
  writeFence: SQL,
) {
  return database
    .insert(sessionModelCallsTable)
    .select(createSessionModelCallInsertSelect(database, values, writeFence))
    .onConflictDoUpdate({
      set: {
        cacheCreationTokens: sql`COALESCE(excluded.cache_creation_tokens, ${sessionModelCallsTable.cacheCreationTokens})`,
        cacheReadTokens: sql`COALESCE(excluded.cache_read_tokens, ${sessionModelCallsTable.cacheReadTokens})`,
        completedAt: sql`COALESCE(excluded.completed_at, ${sessionModelCallsTable.completedAt})`,
        costCurrency: sql`COALESCE(excluded.cost_currency, ${sessionModelCallsTable.costCurrency})`,
        driverInstanceId: sql`excluded.driver_instance_id`,
        inputTokens: sql`COALESCE(excluded.input_tokens, ${sessionModelCallsTable.inputTokens})`,
        metadataJson: sql`excluded.metadata_json`,
        model: sql`excluded.model`,
        outputTokens: sql`COALESCE(excluded.output_tokens, ${sessionModelCallsTable.outputTokens})`,
        provider: sql`excluded.provider`,
        sourceEventSeq: sql`excluded.source_event_seq`,
        startedAt: sql`COALESCE(${sessionModelCallsTable.startedAt}, excluded.started_at)`,
        status: sql`excluded.status`,
        totalCostUsdMicros: sql`COALESCE(excluded.total_cost_usd_micros, ${sessionModelCallsTable.totalCostUsdMicros})`,
        traceId: sql`excluded.trace_id`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${sessionModelCallsTable.sourceEventSeq} < excluded.source_event_seq AND ${writeFence}`,
      target: [sessionModelCallsTable.sessionRunId, sessionModelCallsTable.callKey],
    });
}

function createSessionModelCallUsageConvergenceGuard(
  database: ReturnType<typeof getAppDatabase>,
  modelCallValues: SessionModelCallInsert,
  usageEventInput: Parameters<typeof createRuntimeUsageEventUpsert>[1],
) {
  return database.insert(sessionModelCallsTable).select(
    createSessionModelCallInsertSelect(
      database,
      modelCallValues,
      sql`${createRuntimeUsageEventUnrolledPredicate(database, usageEventInput)}
        AND NOT (${createRuntimeUsageEventConvergencePredicate(database, usageEventInput)})`,
    ),
  );
}

async function getStoredSessionModelCall(
  database: D1Database,
  input: { callKey: string; sessionRunId: SessionRunId },
): Promise<StoredSessionModelCall | null> {
  return (
    (await getAppDatabase(database)
      .select({
        cacheCreationTokens: sessionModelCallsTable.cacheCreationTokens,
        cacheReadTokens: sessionModelCallsTable.cacheReadTokens,
        costCurrency: sessionModelCallsTable.costCurrency,
        driverInstanceId: sessionModelCallsTable.driverInstanceId,
        inputTokens: sessionModelCallsTable.inputTokens,
        metadataJson: sessionModelCallsTable.metadataJson,
        model: sessionModelCallsTable.model,
        nativeCallId: sessionModelCallsTable.nativeCallId,
        outputTokens: sessionModelCallsTable.outputTokens,
        provider: sessionModelCallsTable.provider,
        sessionId: sessionModelCallsTable.sessionId,
        sessionRunId: sessionModelCallsTable.sessionRunId,
        sourceEventSeq: sessionModelCallsTable.sourceEventSeq,
        startedAt: sessionModelCallsTable.startedAt,
        totalCostUsdMicros: sessionModelCallsTable.totalCostUsdMicros,
        traceId: sessionModelCallsTable.traceId,
      })
      .from(sessionModelCallsTable)
      .where(
        and(
          eq(sessionModelCallsTable.sessionRunId, input.sessionRunId),
          eq(sessionModelCallsTable.callKey, input.callKey),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

function assertSessionModelCallConverged(
  stored: StoredSessionModelCall | null,
  expected: SessionModelCallInsert,
): void {
  const sourceEventSeq = expected.sourceEventSeq ?? 0;

  if (stored === null || stored.sourceEventSeq < sourceEventSeq) {
    throw new Error("Session model call CAS did not persist the durable event.");
  }

  if (stored.sourceEventSeq > sourceEventSeq) {
    return;
  }

  const requiredValuesMatch =
    stored.driverInstanceId === (expected.driverInstanceId ?? null) &&
    stored.metadataJson === (expected.metadataJson ?? null) &&
    stored.model === expected.model &&
    stored.nativeCallId === (expected.nativeCallId ?? null) &&
    stored.provider === expected.provider &&
    stored.sessionId === expected.sessionId &&
    stored.sessionRunId === expected.sessionRunId &&
    stored.startedAt === (expected.startedAt ?? null) &&
    stored.traceId === expected.traceId;
  const optionalValuesMatch =
    (expected.cacheCreationTokens == null ||
      stored.cacheCreationTokens === expected.cacheCreationTokens) &&
    (expected.cacheReadTokens == null || stored.cacheReadTokens === expected.cacheReadTokens) &&
    (expected.costCurrency == null || stored.costCurrency === expected.costCurrency) &&
    (expected.inputTokens == null || stored.inputTokens === expected.inputTokens) &&
    (expected.outputTokens == null || stored.outputTokens === expected.outputTokens) &&
    (expected.totalCostUsdMicros == null ||
      stored.totalCostUsdMicros === expected.totalCostUsdMicros);

  if (!requiredValuesMatch || !optionalValuesMatch) {
    throw new Error("Session model call event seq was replayed with conflicting content.");
  }
}

async function prepareSessionModelCallUsageValues(
  database: D1Database,
  input: UpsertSessionModelCallUsageInput,
): Promise<{
  modelCallValues: SessionModelCallInsert;
  usageEventInput: Parameters<typeof createRuntimeUsageEventUpsert>[1];
} | null> {
  if (!input.usage) {
    return null;
  }

  if (!Number.isSafeInteger(input.sourceEventSeq) || input.sourceEventSeq < 0) {
    throw new Error("Session model call source event seq must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0) {
    throw new Error("Session model call createdAtMs must be a non-negative safe integer.");
  }

  const usage = input.usage;
  const run = await getSessionModelCallRunRow(database, input.sessionRunId);

  if (!run) {
    throw new Error("Session run not found for model call usage.");
  }

  if (run.session_id !== input.sessionId) {
    throw new Error("Session model call usage does not belong to the durable Session Run.");
  }

  const timestampMs = currentTimestampMs();
  const status = toSessionModelCallStatus(run.status);
  const completedAt = status === "started" ? null : run.completed_at;

  if (status !== "started" && completedAt === null) {
    throw new Error("Terminal Session Run is missing completed_at for model call usage.");
  }

  const nativeCallId = normalizeUsageCallId(usage.callId);
  const callKey = isTruthy(nativeCallId) ? `model_call:${nativeCallId}` : "run_usage";
  const provider = run.provider ?? run.session_provider;
  const model = run.model ?? run.session_model;
  const usageEventInput = {
    callKey,
    driverInstanceId: input.driverInstanceId,
    nativeCallId,
    run: {
      actorUserId: run.actor_user_id,
      agentId: run.agent_id,
      agentOwnerUserId: run.agent_owner_user_id,
      agentRevisionId: run.agent_revision_id,
      agentStatus: run.agent_status,
      createdAtMs: input.createdAtMs,
      model,
      organizationId: run.project_organization_id,
      projectId: run.project_id,
      provider,
      runtimeId: run.runtime_id ?? run.session_runtime_id,
      sessionId: run.session_id,
      sessionRunId: input.sessionRunId,
      trigger: run.trigger,
    },
    sourceEventSeq: input.sourceEventSeq,
    usage,
  } satisfies Parameters<typeof createRuntimeUsageEventUpsert>[1];
  const modelCallValues = {
    cacheCreationTokens: toTokenCount(usage.cachedWriteTokens),
    cacheReadTokens: toTokenCount(usage.cachedReadTokens),
    callKey,
    completedAt,
    costCurrency: usage.costCurrency ?? null,
    createdAt: input.createdAtMs,
    driverInstanceId: input.driverInstanceId,
    errorCode: null,
    errorMessage: null,
    id: createPlatformId<SessionModelCallId>(),
    inputTokens: toTokenCount(usage.inputTokens),
    metadataJson: buildUsageMetadata(usage),
    model,
    nativeCallId,
    outputTokens: toTokenCount(usage.outputTokens),
    provider,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
    sourceEventSeq: input.sourceEventSeq,
    startedAt: run.started_at ?? run.created_at,
    status,
    totalCostUsdMicros: toUsdMicros(usage.costAmount),
    traceId: input.traceId,
    updatedAt: timestampMs,
  } satisfies SessionModelCallInsert;

  return { modelCallValues, usageEventInput };
}

export async function prepareDurableSessionModelCallUsageProjection(
  database: D1Database,
  input: DurableSessionModelCallUsageProjectionInput,
): Promise<D1PreparedStatement[]> {
  const prepared = await prepareSessionModelCallUsageValues(database, input);

  if (prepared === null) {
    return [];
  }

  const { modelCallValues, usageEventInput } = prepared;
  const appDatabase = getAppDatabase(database);
  const receiptFence = exists(
    appDatabase
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.id, input.eventId),
          eq(sessionEventsTable.sessionId, input.sessionId),
          eq(sessionEventsTable.eventType, "usage.updated"),
          eq(sessionEventsTable.runId, input.sessionRunId),
          eq(sessionEventsTable.semanticHash, input.semanticHash),
          eq(sessionEventsTable.seq, input.sourceEventSeq),
        ),
      ),
  );
  const writeFence = sql`${createRuntimeUsageEventUnrolledPredicate(
    appDatabase,
    usageEventInput,
  )} AND ${receiptFence}`;
  const modelCallQuery = createSessionModelCallUsageUpsert(
    appDatabase,
    modelCallValues,
    writeFence,
  ).toSQL();
  const statements = [database.prepare(modelCallQuery.sql).bind(...modelCallQuery.params)];
  const usageEventUpsert = createRuntimeUsageEventUpsert(
    appDatabase,
    usageEventInput,
    receiptFence,
  );

  if (usageEventUpsert !== null) {
    const usageEventQuery = usageEventUpsert.toSQL();
    statements.push(database.prepare(usageEventQuery.sql).bind(...usageEventQuery.params));
  }

  const usageEventConvergenceQuery =
    usageEventUpsert === null
      ? null
      : appDatabase
          .select({ converged: sql<number>`1` })
          .from(sql`(SELECT 1)`)
          .where(createRuntimeUsageEventConvergencePredicate(appDatabase, usageEventInput))
          .toSQL();
  const usageEventFailureSql =
    usageEventConvergenceQuery === null ? "" : ` OR NOT EXISTS (${usageEventConvergenceQuery.sql})`;

  const sourceEventSeq = modelCallValues.sourceEventSeq ?? 0;
  statements.push(
    database
      .prepare(
        `INSERT INTO session_event (id)
         SELECT ?
          WHERE EXISTS (
            SELECT 1
              FROM session_event AS receipt
             WHERE receipt.id = ?
               AND receipt.session_id = ?
               AND receipt.event_type = 'usage.updated'
               AND receipt.run_id = ?
               AND receipt.semantic_hash = ?
               AND receipt.seq = ?
          )
            AND (
              NOT EXISTS (
                SELECT 1
                  FROM session_model_call AS stored
                 WHERE stored.session_run_id = ?
                   AND stored.call_key = ?
                   AND (
                     stored.source_event_seq > ?
                     OR (
                       stored.source_event_seq = ?
                       AND stored.driver_instance_id IS ?
                       AND stored.metadata_json IS ?
                       AND stored.model = ?
                       AND stored.native_call_id IS ?
                       AND stored.provider = ?
                       AND stored.session_id = ?
                       AND stored.started_at IS ?
                       AND stored.trace_id = ?
                       AND (? IS NULL OR stored.cache_creation_tokens = ?)
                       AND (? IS NULL OR stored.cache_read_tokens = ?)
                       AND (? IS NULL OR stored.cost_currency = ?)
                       AND (? IS NULL OR stored.input_tokens = ?)
                       AND (? IS NULL OR stored.output_tokens = ?)
                       AND (? IS NULL OR stored.total_cost_usd_micros = ?)
                     )
                   )
              )${usageEventFailureSql}
            )`,
      )
      .bind(
        input.eventId,
        input.eventId,
        input.sessionId,
        input.sessionRunId,
        input.semanticHash,
        input.sourceEventSeq,
        input.sessionRunId,
        modelCallValues.callKey,
        sourceEventSeq,
        sourceEventSeq,
        modelCallValues.driverInstanceId ?? null,
        modelCallValues.metadataJson ?? null,
        modelCallValues.model,
        modelCallValues.nativeCallId ?? null,
        modelCallValues.provider,
        modelCallValues.sessionId,
        modelCallValues.startedAt ?? null,
        modelCallValues.traceId,
        modelCallValues.cacheCreationTokens ?? null,
        modelCallValues.cacheCreationTokens ?? null,
        modelCallValues.cacheReadTokens ?? null,
        modelCallValues.cacheReadTokens ?? null,
        modelCallValues.costCurrency ?? null,
        modelCallValues.costCurrency ?? null,
        modelCallValues.inputTokens ?? null,
        modelCallValues.inputTokens ?? null,
        modelCallValues.outputTokens ?? null,
        modelCallValues.outputTokens ?? null,
        modelCallValues.totalCostUsdMicros ?? null,
        modelCallValues.totalCostUsdMicros ?? null,
        ...(usageEventConvergenceQuery?.params ?? []),
      ),
  );

  return statements;
}

export async function upsertSessionModelCallUsage(
  database: D1Database,
  input: UpsertSessionModelCallUsageInput,
): Promise<void> {
  const prepared = await prepareSessionModelCallUsageValues(database, input);

  if (prepared === null) {
    return;
  }
  const { modelCallValues, usageEventInput } = prepared;
  const callKey = modelCallValues.callKey;

  if (await hasRuntimeUsageEventRollupReceipt(database, usageEventInput)) {
    const stored = await getStoredSessionModelCall(database, {
      callKey,
      sessionRunId: input.sessionRunId,
    });

    if (stored !== null && stored.sourceEventSeq >= input.sourceEventSeq) {
      assertSessionModelCallConverged(stored, modelCallValues);
      return;
    }

    throw new Error(
      "Session model call usage was already rolled up and cannot be replaced safely.",
    );
  }

  await runAppDatabaseBatch(database, (appDatabase) => {
    const writeFence = createRuntimeUsageEventUnrolledPredicate(appDatabase, usageEventInput);
    const modelCallUpsert = createSessionModelCallUsageUpsert(
      appDatabase,
      modelCallValues,
      writeFence,
    );
    const usageEventUpsert = createRuntimeUsageEventUpsert(appDatabase, usageEventInput);

    return usageEventUpsert === null
      ? [modelCallUpsert]
      : [
          modelCallUpsert,
          usageEventUpsert,
          createSessionModelCallUsageConvergenceGuard(
            appDatabase,
            modelCallValues,
            usageEventInput,
          ),
        ];
  });

  assertSessionModelCallConverged(
    await getStoredSessionModelCall(database, { callKey, sessionRunId: input.sessionRunId }),
    modelCallValues,
  );
}

function normalizeUsageCallId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
