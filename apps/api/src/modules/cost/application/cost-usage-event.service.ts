import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import type { SessionRunTrigger } from "@mosoo/contracts/session-run";
import { usageEventRollupReceiptsTable, usageEventsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
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
import { and, eq, exists, gte, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { calculateUsageCost } from "../domain/cost-pricing";
import { normalizeUsageTokens } from "../domain/usage-contract";
import type {
  AgentPublicationStateAtRun,
  RunPurpose,
  UsageContract,
} from "../domain/usage-contract";
export interface RuntimeUsageRunContext {
  actorUserId: AccountId;
  agentId: AgentId;
  agentOwnerUserId: AccountId;
  agentRevisionId: AgentDeploymentVersionId | null;
  agentStatus: "draft" | "published";
  createdAtMs: number;
  model: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  provider: string;
  runtimeId: string | null;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  trigger: SessionRunTrigger;
}

export interface RecordRuntimeUsageEventInput {
  callKey: string;
  driverInstanceId: DriverInstanceId;
  nativeCallId: string | null;
  run: RuntimeUsageRunContext;
  sourceEventSeq?: number;
  usage: SessionUsageSummary;
}

function selectedValue<Value>(value: Value, alias: string) {
  return sql<Value>`${value}`.as(alias);
}

function normalizeSourceEventSeq(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Runtime usage source event seq must be a non-negative safe integer.");
  }

  return value;
}

function toTokenCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value);
}

function isProvidedTokenCount(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUsageContract(value: string | null | undefined): value is UsageContract {
  return (
    value === "anthropic_bucketed" ||
    value === "openai_runtime_total_with_cached_breakdown" ||
    value === "openai_total_with_cached_breakdown"
  );
}

function requireUsageContract(usage: SessionUsageSummary): UsageContract {
  if (isUsageContract(usage.usageContract)) {
    return usage.usageContract;
  }

  throw new Error("Usage contract must be declared by the runtime driver.");
}

function resolvePublicationState(input: RuntimeUsageRunContext): AgentPublicationStateAtRun {
  if (isTruthy(input.agentRevisionId)) {
    return "published";
  }

  return input.agentStatus === "published" ? "draft_of_published" : "unpublished";
}

function resolveRunPurpose(input: RuntimeUsageRunContext): RunPurpose {
  if (input.trigger === "system") {
    return "scheduled";
  }

  if (isTruthy(input.agentRevisionId)) {
    return "production";
  }

  return input.agentStatus === "published" ? "preview" : "debug";
}

function toProvidedUsdCost(usage: SessionUsageSummary): number | null {
  if (usage.costCurrency !== "USD") {
    return null;
  }

  if (
    typeof usage.costAmount !== "number" ||
    !Number.isFinite(usage.costAmount) ||
    usage.costAmount < 0
  ) {
    return null;
  }

  return usage.costAmount;
}

function toUsdMicros(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value * 1_000_000);
}

export function hasRecordableRuntimeUsage(usage: SessionUsageSummary): boolean {
  return (
    toTokenCount(usage.inputTokens) > 0 ||
    toTokenCount(usage.outputTokens) > 0 ||
    toTokenCount(usage.cachedReadTokens) > 0 ||
    toTokenCount(usage.cachedWriteTokens) > 0 ||
    toProvidedUsdCost(usage) !== null
  );
}

function hasRuntimeUsageMutation(input: RecordRuntimeUsageEventInput): boolean {
  return (
    hasRecordableRuntimeUsage(input.usage) ||
    (input.sourceEventSeq !== undefined &&
      (isProvidedTokenCount(input.usage.inputTokens) ||
        isProvidedTokenCount(input.usage.outputTokens) ||
        isProvidedTokenCount(input.usage.cachedReadTokens) ||
        isProvidedTokenCount(input.usage.cachedWriteTokens)))
  );
}

const RUNTIME_USAGE_SOURCE = "runtime_driver";

function resolveUsageEventIdentity(input: RecordRuntimeUsageEventInput): {
  source: string;
  sourceEventId: string;
} {
  const sourceEventId = isTruthy(input.nativeCallId)
    ? `${input.driverInstanceId}:${input.nativeCallId}`
    : `${input.driverInstanceId}:${input.run.sessionRunId}:${input.callKey}`;

  return { source: RUNTIME_USAGE_SOURCE, sourceEventId };
}

async function isUsageEventAlreadyRolledUp(
  database: AppDatabase,
  identity: { source: string; sourceEventId: string },
): Promise<boolean> {
  const existing = await database
    .select({ source: usageEventRollupReceiptsTable.source })
    .from(usageEventRollupReceiptsTable)
    .where(
      and(
        eq(usageEventRollupReceiptsTable.source, identity.source),
        eq(usageEventRollupReceiptsTable.sourceEventId, identity.sourceEventId),
      ),
    )
    .limit(1);

  return existing.length > 0;
}

export async function hasRuntimeUsageEventRollupReceipt(
  database: D1Database,
  input: RecordRuntimeUsageEventInput,
): Promise<boolean> {
  return isUsageEventAlreadyRolledUp(getAppDatabase(database), resolveUsageEventIdentity(input));
}

export function createRuntimeUsageEventUnrolledPredicate(
  database: AppDatabase,
  input: RecordRuntimeUsageEventInput,
) {
  const identity = resolveUsageEventIdentity(input);

  return notExists(
    database
      .select({ source: usageEventRollupReceiptsTable.source })
      .from(usageEventRollupReceiptsTable)
      .where(
        and(
          eq(usageEventRollupReceiptsTable.source, identity.source),
          eq(usageEventRollupReceiptsTable.sourceEventId, identity.sourceEventId),
        ),
      ),
  );
}

export function createRuntimeUsageEventConvergencePredicate(
  database: AppDatabase,
  input: RecordRuntimeUsageEventInput,
) {
  const identity = resolveUsageEventIdentity(input);
  const identityPredicate = and(
    eq(usageEventsTable.source, identity.source),
    eq(usageEventsTable.sourceEventId, identity.sourceEventId),
  );
  const converged = exists(
    database
      .select({ source: usageEventsTable.source })
      .from(usageEventsTable)
      .where(
        and(
          identityPredicate,
          eq(usageEventsTable.sessionId, input.run.sessionId),
          eq(usageEventsTable.sessionRunId, input.run.sessionRunId),
          eq(usageEventsTable.model, input.run.model),
          eq(usageEventsTable.provider, input.run.provider),
          eq(usageEventsTable.usageContract, requireUsageContract(input.usage)),
          gte(usageEventsTable.sourceEventSeq, normalizeSourceEventSeq(input.sourceEventSeq)),
        ),
      ),
  );

  return hasRecordableRuntimeUsage(input.usage)
    ? converged
    : or(
        notExists(
          database
            .select({ source: usageEventsTable.source })
            .from(usageEventsTable)
            .where(identityPredicate),
        ),
        converged,
      );
}

function prepareRuntimeUsageEventValues(input: RecordRuntimeUsageEventInput) {
  const rawInputTokens = toTokenCount(input.usage.inputTokens);
  const rawOutputTokens = toTokenCount(input.usage.outputTokens);
  const rawCacheReadTokens = toTokenCount(input.usage.cachedReadTokens);
  const rawCacheCreationTokens = toTokenCount(input.usage.cachedWriteTokens);
  const providedCostUsd = toProvidedUsdCost(input.usage);

  if (!hasRuntimeUsageMutation(input)) {
    return null;
  }

  const provider = input.run.provider;
  const model = input.run.model;
  const usageContract = requireUsageContract(input.usage);
  const tokens = normalizeUsageTokens({
    cacheCreationTokens: rawCacheCreationTokens,
    cacheReadTokens: rawCacheReadTokens,
    inputTokens: rawInputTokens,
    outputTokens: rawOutputTokens,
    usageContract,
  });
  const cost = calculateUsageCost({
    cacheCreationTokens: tokens.cacheCreationTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    inputTokens: tokens.inputTokens,
    model,
    outputTokens: tokens.outputTokens,
    pricedAtMs: input.run.createdAtMs,
    providedCostUsd,
    provider,
  });
  const { source, sourceEventId } = resolveUsageEventIdentity(input);
  const values = {
    actorUserId: input.run.actorUserId,
    agentId: input.run.agentId,
    agentOwnerUserId: input.run.agentOwnerUserId,
    agentPublicationStateAtRun: resolvePublicationState(input.run),
    agentRevisionId: input.run.agentRevisionId,
    cacheCreationTokens: tokens.cacheCreationTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    createdAt: input.run.createdAtMs,
    id: createPlatformId(),
    inputTokens: tokens.inputTokens,
    model,
    organizationId: input.run.organizationId,
    projectId: input.run.projectId,
    outputTokens: tokens.outputTokens,
    priceSnapshotJson: cost.priceSnapshotJson,
    pricingStatus: cost.pricingStatus,
    provider,
    runPurpose: resolveRunPurpose(input.run),
    runtimeId: input.run.runtimeId,
    sessionId: input.run.sessionId,
    sessionRunId: input.run.sessionRunId,
    source,
    sourceEventId,
    sourceEventSeq: normalizeSourceEventSeq(input.sourceEventSeq),
    totalCostUsdMicros: toUsdMicros(cost.totalCostUsd),
    usageContract,
  } satisfies typeof usageEventsTable.$inferInsert;

  return { providedCostUsd, values };
}

function createRuntimeUsageEventInsert(
  database: AppDatabase,
  input: RecordRuntimeUsageEventInput,
  writeFence?: SQL,
) {
  const prepared = prepareRuntimeUsageEventValues(input);

  if (prepared === null) {
    return null;
  }

  const { values } = prepared;
  const identity = resolveUsageEventIdentity(input);
  const mayCreate = hasRecordableRuntimeUsage(input.usage)
    ? undefined
    : exists(
        database
          .select({ source: usageEventsTable.source })
          .from(usageEventsTable)
          .where(
            and(
              eq(usageEventsTable.source, identity.source),
              eq(usageEventsTable.sourceEventId, identity.sourceEventId),
            ),
          ),
      );

  return {
    prepared,
    query: database.insert(usageEventsTable).select(
      database
        .select({
          actorUserId: selectedValue(values.actorUserId, "actor_user_id"),
          agentId: selectedValue(values.agentId, "agent_id"),
          agentOwnerUserId: selectedValue(values.agentOwnerUserId, "agent_owner_user_id"),
          agentPublicationStateAtRun: selectedValue(
            values.agentPublicationStateAtRun,
            "agent_publication_state_at_run",
          ),
          agentRevisionId: selectedValue(values.agentRevisionId, "agent_revision_id"),
          cacheCreationTokens: selectedValue(values.cacheCreationTokens, "cache_creation_tokens"),
          cacheReadTokens: selectedValue(values.cacheReadTokens, "cache_read_tokens"),
          createdAt: selectedValue(values.createdAt, "created_at"),
          id: selectedValue(values.id, "id"),
          inputTokens: selectedValue(values.inputTokens, "input_tokens"),
          model: selectedValue(values.model, "model"),
          organizationId: selectedValue(values.organizationId, "organization_id"),
          projectId: selectedValue(values.projectId, "project_id"),
          outputTokens: selectedValue(values.outputTokens, "output_tokens"),
          priceSnapshotJson: selectedValue(values.priceSnapshotJson, "price_snapshot_json"),
          pricingStatus: selectedValue(values.pricingStatus, "pricing_status"),
          provider: selectedValue(values.provider, "provider"),
          runPurpose: selectedValue(values.runPurpose, "run_purpose"),
          runtimeId: selectedValue(values.runtimeId, "runtime_id"),
          sessionId: selectedValue(values.sessionId, "session_id"),
          sessionRunId: selectedValue(values.sessionRunId, "session_run_id"),
          source: selectedValue(values.source, "source"),
          sourceEventId: selectedValue(values.sourceEventId, "source_event_id"),
          sourceEventSeq: selectedValue(values.sourceEventSeq, "source_event_seq"),
          totalCostUsdMicros: selectedValue(values.totalCostUsdMicros, "total_cost_usd_micros"),
          usageContract: selectedValue(values.usageContract, "usage_contract"),
        })
        .from(sql`(SELECT 1)`)
        .where(
          and(createRuntimeUsageEventUnrolledPredicate(database, input), writeFence, mayCreate),
        ),
    ),
  };
}

export function createRuntimeUsageEventUpsert(
  database: AppDatabase,
  input: RecordRuntimeUsageEventInput,
  writeFence?: SQL,
) {
  const insert = createRuntimeUsageEventInsert(database, input, writeFence);

  if (insert === null) {
    return null;
  }

  const { prepared, query } = insert;

  const sourceEventSeqFence =
    input.sourceEventSeq === undefined
      ? eq(usageEventsTable.sourceEventSeq, 0)
      : sql`${usageEventsTable.sourceEventSeq} < excluded.source_event_seq`;
  const cacheCreationTokensProvided = isProvidedTokenCount(input.usage.cachedWriteTokens);
  const cacheReadTokensProvided = isProvidedTokenCount(input.usage.cachedReadTokens);
  const inputTokensProvided = isProvidedTokenCount(input.usage.inputTokens);
  const outputTokensProvided = isProvidedTokenCount(input.usage.outputTokens);
  const mergedCacheCreationTokens = cacheCreationTokensProvided
    ? sql`excluded.cache_creation_tokens`
    : sql`${usageEventsTable.cacheCreationTokens}`;
  const mergedCacheReadTokens = cacheReadTokensProvided
    ? sql`excluded.cache_read_tokens`
    : sql`${usageEventsTable.cacheReadTokens}`;
  const mergedInputTokens =
    input.usage.usageContract !== "anthropic_bucketed"
      ? inputTokensProvided
        ? sql`excluded.input_tokens`
        : sql`${usageEventsTable.inputTokens}`
      : inputTokensProvided
        ? cacheReadTokensProvided
          ? sql`excluded.input_tokens`
          : sql`excluded.input_tokens + ${usageEventsTable.cacheReadTokens}`
        : cacheReadTokensProvided
          ? sql`${usageEventsTable.inputTokens} - ${usageEventsTable.cacheReadTokens} + excluded.cache_read_tokens`
          : sql`${usageEventsTable.inputTokens}`;
  const mergedOutputTokens = outputTokensProvided
    ? sql`excluded.output_tokens`
    : sql`${usageEventsTable.outputTokens}`;
  const mergedHasTokens = sql`(
    ${mergedCacheCreationTokens} > 0 OR
    ${mergedCacheReadTokens} > 0 OR
    ${mergedInputTokens} > 0 OR
    ${mergedOutputTokens} > 0
  )`;
  const preserveRuntimeReportedCost = sql`(
    ${prepared.providedCostUsd === null} AND
    NOT ${mergedHasTokens} AND
    json_extract(${usageEventsTable.priceSnapshotJson}, '$.source') = 'runtime_reported_usd'
  )`;
  const billableInputTokens = sql`MAX(0, ${mergedInputTokens} - ${mergedCacheReadTokens})`;
  const pricingRateSnapshot = sql`CASE
    WHEN ${inputTokensProvided} OR
      json_extract(${usageEventsTable.priceSnapshotJson}, '$.source') IS NOT 'mosoo_seed_2026_07_10'
      THEN excluded.price_snapshot_json
    ELSE ${usageEventsTable.priceSnapshotJson}
  END`;
  const priceSnapshotJson = sql`CASE
    WHEN excluded.pricing_status <> 'priced' THEN NULL
    WHEN ${preserveRuntimeReportedCost} THEN ${usageEventsTable.priceSnapshotJson}
    WHEN ${mergedHasTokens} THEN
      json_set(${pricingRateSnapshot}, '$.billableInputTokens', ${billableInputTokens})
    ELSE excluded.price_snapshot_json
  END`;
  const totalCostUsdMicros = sql`CASE
    WHEN excluded.pricing_status = 'priced' AND ${preserveRuntimeReportedCost}
      THEN ${usageEventsTable.totalCostUsdMicros}
    WHEN excluded.pricing_status = 'priced' AND ${mergedHasTokens} THEN
      CAST(ROUND(
        ${billableInputTokens} * json_extract(${pricingRateSnapshot}, '$.inputUsdPerMillion') +
        ${mergedOutputTokens} * json_extract(${pricingRateSnapshot}, '$.outputUsdPerMillion') +
        ${mergedCacheReadTokens} * json_extract(${pricingRateSnapshot}, '$.cacheReadUsdPerMillion') +
        ${mergedCacheCreationTokens} * json_extract(${pricingRateSnapshot}, '$.cacheWriteUsdPerMillion')
      ) AS INTEGER)
    WHEN excluded.pricing_status = 'unknown' AND ${prepared.providedCostUsd === null}
      THEN ${usageEventsTable.totalCostUsdMicros}
    ELSE excluded.total_cost_usd_micros
  END`;
  const identityFence = sql`
    ${usageEventsTable.sessionId} IS excluded.session_id AND
    ${usageEventsTable.sessionRunId} IS excluded.session_run_id AND
    ${usageEventsTable.model} = excluded.model AND
    ${usageEventsTable.provider} = excluded.provider AND
    ${usageEventsTable.usageContract} = excluded.usage_contract
  `;
  const updateFence = sql`${sourceEventSeqFence} AND ${identityFence}`;

  return query.onConflictDoUpdate({
    set: {
      cacheCreationTokens: mergedCacheCreationTokens,
      cacheReadTokens: mergedCacheReadTokens,
      inputTokens: mergedInputTokens,
      model: sql`excluded.model`,
      outputTokens: mergedOutputTokens,
      priceSnapshotJson,
      pricingStatus: sql`excluded.pricing_status`,
      provider: sql`excluded.provider`,
      sourceEventSeq: sql`excluded.source_event_seq`,
      totalCostUsdMicros,
      usageContract: sql`excluded.usage_contract`,
    },
    setWhere: writeFence === undefined ? updateFence : sql`${updateFence} AND ${writeFence}`,
    target: [usageEventsTable.source, usageEventsTable.sourceEventId],
  });
}

export function createRuntimeUsageEventInsertIfMissing(
  database: AppDatabase,
  input: RecordRuntimeUsageEventInput,
) {
  const insert = createRuntimeUsageEventInsert(database, input);

  if (insert === null) {
    return null;
  }

  return insert.query.onConflictDoNothing({
    target: [usageEventsTable.source, usageEventsTable.sourceEventId],
  });
}

function readRuntimeReportedUsd(priceSnapshotJson: string | null): number | null {
  if (priceSnapshotJson === null) {
    return null;
  }

  try {
    const snapshot = JSON.parse(priceSnapshotJson) as unknown;

    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("source" in snapshot) ||
      snapshot.source !== "runtime_reported_usd" ||
      !("reportedCostUsd" in snapshot) ||
      typeof snapshot.reportedCostUsd !== "number" ||
      !Number.isFinite(snapshot.reportedCostUsd) ||
      snapshot.reportedCostUsd < 0
    ) {
      return null;
    }

    return snapshot.reportedCostUsd;
  } catch {
    return null;
  }
}

export async function recordRuntimeUsageEvent(
  database: D1Database,
  input: RecordRuntimeUsageEventInput,
): Promise<void> {
  if (!hasRuntimeUsageMutation(input)) {
    return;
  }

  const appDatabase = getAppDatabase(database);

  if (await isUsageEventAlreadyRolledUp(appDatabase, resolveUsageEventIdentity(input))) {
    if (input.sourceEventSeq !== undefined) {
      throw new Error("Runtime usage event was already rolled up and cannot be replaced safely.");
    }

    return;
  }

  const query = createRuntimeUsageEventUpsert(appDatabase, input);

  if (query === null) {
    return;
  }

  await query.run();

  if (
    input.sourceEventSeq !== undefined &&
    (await isUsageEventAlreadyRolledUp(appDatabase, resolveUsageEventIdentity(input)))
  ) {
    throw new Error("Runtime usage event was rolled up before its durable replay was verified.");
  }

  if (input.sourceEventSeq !== undefined) {
    const identity = resolveUsageEventIdentity(input);
    const prepared = prepareRuntimeUsageEventValues(input);

    if (prepared === null) {
      return;
    }
    const { values: expected } = prepared;

    const row =
      (await appDatabase
        .select({
          cacheCreationTokens: usageEventsTable.cacheCreationTokens,
          cacheReadTokens: usageEventsTable.cacheReadTokens,
          inputTokens: usageEventsTable.inputTokens,
          model: usageEventsTable.model,
          outputTokens: usageEventsTable.outputTokens,
          priceSnapshotJson: usageEventsTable.priceSnapshotJson,
          pricingStatus: usageEventsTable.pricingStatus,
          provider: usageEventsTable.provider,
          sessionId: usageEventsTable.sessionId,
          sessionRunId: usageEventsTable.sessionRunId,
          sourceEventSeq: usageEventsTable.sourceEventSeq,
          totalCostUsdMicros: usageEventsTable.totalCostUsdMicros,
          usageContract: usageEventsTable.usageContract,
        })
        .from(usageEventsTable)
        .where(
          and(
            eq(usageEventsTable.source, identity.source),
            eq(usageEventsTable.sourceEventId, identity.sourceEventId),
          ),
        )
        .limit(1)
        .get()) ?? null;

    if (row === null) {
      if (!hasRecordableRuntimeUsage(input.usage)) {
        return;
      }
      throw new Error("Runtime usage event CAS did not persist the durable event.");
    }

    if (row.sourceEventSeq < input.sourceEventSeq) {
      throw new Error("Runtime usage event CAS did not persist the durable event.");
    }

    if (
      row.model !== expected.model ||
      row.provider !== expected.provider ||
      row.sessionId !== expected.sessionId ||
      row.sessionRunId !== expected.sessionRunId ||
      row.usageContract !== expected.usageContract
    ) {
      throw new Error("Runtime usage event identity conflicts with its durable event.");
    }

    if (row.sourceEventSeq > input.sourceEventSeq) {
      return;
    }

    const tokensUnavailable =
      row.cacheCreationTokens === 0 &&
      row.cacheReadTokens === 0 &&
      row.inputTokens === 0 &&
      row.outputTokens === 0;
    const providedCostUsd =
      prepared.providedCostUsd ??
      (tokensUnavailable ? readRuntimeReportedUsd(row.priceSnapshotJson) : null);
    const mergedCost = calculateUsageCost({
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      inputTokens: row.inputTokens,
      model: row.model,
      outputTokens: row.outputTokens,
      pricedAtMs: input.run.createdAtMs,
      providedCostUsd,
      provider: row.provider,
    });
    const costMustMatch =
      (mergedCost.pricing !== null || providedCostUsd !== null) &&
      (tokensUnavailable ||
        isProvidedTokenCount(input.usage.inputTokens) ||
        mergedCost.pricing === null);

    if (
      (isProvidedTokenCount(input.usage.cachedWriteTokens) &&
        row.cacheCreationTokens !== expected.cacheCreationTokens) ||
      (isProvidedTokenCount(input.usage.cachedReadTokens) &&
        row.cacheReadTokens !== expected.cacheReadTokens) ||
      (isProvidedTokenCount(input.usage.inputTokens) &&
        (input.usage.usageContract === "anthropic_bucketed" &&
        !isProvidedTokenCount(input.usage.cachedReadTokens)
          ? row.inputTokens - row.cacheReadTokens !== expected.inputTokens
          : row.inputTokens !== expected.inputTokens)) ||
      (isProvidedTokenCount(input.usage.outputTokens) &&
        row.outputTokens !== expected.outputTokens) ||
      (costMustMatch && row.priceSnapshotJson !== mergedCost.priceSnapshotJson) ||
      (costMustMatch && row.pricingStatus !== mergedCost.pricingStatus) ||
      (costMustMatch && row.totalCostUsdMicros !== toUsdMicros(mergedCost.totalCostUsd))
    ) {
      throw new Error("Runtime usage event seq was replayed with conflicting content.");
    }
  }
}
