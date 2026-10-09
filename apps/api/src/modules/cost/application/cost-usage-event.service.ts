import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import type { SessionRunTrigger } from "@mosoo/contracts/session-run";
import { usageEventsTable } from "@mosoo/db";
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
import { sql } from "drizzle-orm";

import type { AppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { calculateUsageCost } from "../domain/cost-pricing";
import { normalizeUsageTokens, toTokenCount, toUsdMicros } from "../domain/usage-contract";
import type {
  AgentPublicationStateAtRun,
  RunPurpose,
  UsageContract,
} from "../domain/usage-contract";
export interface RuntimeUsageRunContext {
  actorUserId: AccountId;
  agentId: AgentId | null;
  agentOwnerUserId: AccountId;
  agentRevisionId: AgentDeploymentVersionId | null;
  agentStatus: "draft" | "published" | null;
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
  usage: SessionUsageSummary;
}

function requireUsageContract(usage: SessionUsageSummary): UsageContract {
  if (usage.usageContract === undefined) {
    throw new Error("Usage contract must be declared by the runtime driver.");
  }

  return usage.usageContract;
}

function resolvePublicationState(input: RuntimeUsageRunContext): AgentPublicationStateAtRun {
  if (input.agentId === null) return "not_applicable";
  if (isTruthy(input.agentRevisionId)) {
    return "published";
  }

  return input.agentStatus === null
    ? "archived"
    : input.agentStatus === "published"
      ? "draft_of_published"
      : "unpublished";
}

function resolveRunPurpose(input: RuntimeUsageRunContext): RunPurpose {
  if (input.agentId === null) return "production";

  if (isTruthy(input.agentRevisionId)) {
    return "production";
  }

  return input.agentStatus === "published" ? "preview" : "debug";
}

function toProvidedUsdCost(usage: SessionUsageSummary): number | null {
  return usage.costCurrency === "USD" &&
    typeof usage.costAmount === "number" &&
    usage.costAmount >= 0
    ? usage.costAmount
    : null;
}

function hasRecordableRuntimeUsage(usage: SessionUsageSummary): boolean {
  return (
    [usage.inputTokens, usage.outputTokens, usage.cachedReadTokens, usage.cachedWriteTokens].some(
      (value) => (toTokenCount(value) ?? 0) > 0,
    ) || toProvidedUsdCost(usage) !== null
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

function createRuntimeUsageEventInsert(database: AppDatabase, input: RecordRuntimeUsageEventInput) {
  if (!hasRecordableRuntimeUsage(input.usage)) {
    return null;
  }

  const provider = input.run.provider;
  const model = input.run.model;
  const usageContract = requireUsageContract(input.usage);
  const tokens = normalizeUsageTokens({
    cacheCreationTokens: toTokenCount(input.usage.cachedWriteTokens) ?? 0,
    cacheReadTokens: toTokenCount(input.usage.cachedReadTokens) ?? 0,
    inputTokens: toTokenCount(input.usage.inputTokens) ?? 0,
    outputTokens: toTokenCount(input.usage.outputTokens) ?? 0,
    usageContract,
  });
  const cost = calculateUsageCost({
    cacheCreationTokens: tokens.cacheCreationTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    inputTokens: tokens.inputTokens,
    model,
    outputTokens: tokens.outputTokens,
    pricedAtMs: input.run.createdAtMs,
    providedCostUsd: toProvidedUsdCost(input.usage),
    provider,
  });
  const { source, sourceEventId } = resolveUsageEventIdentity(input);

  return database.insert(usageEventsTable).values({
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
    totalCostUsdMicros: toUsdMicros(cost.totalCostUsd) ?? 0,
    usageContract,
  });
}

export function createRuntimeUsageEventUpsert(
  database: AppDatabase,
  input: RecordRuntimeUsageEventInput,
) {
  const query = createRuntimeUsageEventInsert(database, input);

  if (query === null) {
    return null;
  }

  return query.onConflictDoUpdate({
    set: {
      cacheCreationTokens: sql`excluded.cache_creation_tokens`,
      cacheReadTokens: sql`excluded.cache_read_tokens`,
      inputTokens: sql`excluded.input_tokens`,
      model: sql`excluded.model`,
      outputTokens: sql`excluded.output_tokens`,
      priceSnapshotJson: sql`excluded.price_snapshot_json`,
      pricingStatus: sql`excluded.pricing_status`,
      provider: sql`excluded.provider`,
      totalCostUsdMicros: sql`excluded.total_cost_usd_micros`,
      usageContract: sql`excluded.usage_contract`,
    },
    target: [usageEventsTable.source, usageEventsTable.sourceEventId],
  });
}
