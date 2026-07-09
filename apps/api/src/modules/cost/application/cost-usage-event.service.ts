import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import type { SessionType } from "@mosoo/contracts/session";
import type { SessionRunTrigger } from "@mosoo/contracts/session-run";
import { usageEventsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
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
import { sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
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
  appId: AppId;
  provider: string;
  runtimeId: string | null;
  sessionId: SessionId;
  sessionType: SessionType;
  sessionRunId: SessionRunId;
  trigger: SessionRunTrigger;
  triggerProvider: string | null;
}

export interface RecordRuntimeUsageEventInput {
  callKey: string;
  driverInstanceId: DriverInstanceId;
  nativeCallId: string | null;
  run: RuntimeUsageRunContext;
  usage: SessionUsageSummary;
}

function toTokenCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value);
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
  if (input.sessionType === "api_channel" && isTruthy(input.triggerProvider)) {
    return "channel";
  }

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

export async function recordRuntimeUsageEvent(
  database: D1Database,
  input: RecordRuntimeUsageEventInput,
): Promise<void> {
  const rawInputTokens = toTokenCount(input.usage.inputTokens);
  const rawOutputTokens = toTokenCount(input.usage.outputTokens);
  const rawCacheReadTokens = toTokenCount(input.usage.cachedReadTokens);
  const rawCacheCreationTokens = toTokenCount(input.usage.cachedWriteTokens);

  if (
    rawInputTokens === 0 &&
    rawOutputTokens === 0 &&
    rawCacheReadTokens === 0 &&
    rawCacheCreationTokens === 0
  ) {
    return;
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
    providedCostUsd: toProvidedUsdCost(input.usage),
    provider,
  });
  const source = "runtime_driver";
  const sourceEventId = isTruthy(input.nativeCallId)
    ? `${input.driverInstanceId}:${input.nativeCallId}`
    : `${input.driverInstanceId}:${input.run.sessionRunId}:${input.callKey}`;

  await getAppDatabase(database)
    .insert(usageEventsTable)
    .values({
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
      appId: input.run.appId,
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
      totalCostUsdMicros: toUsdMicros(cost.totalCostUsd),
      usageContract,
    })
    .onConflictDoUpdate({
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
    })
    .run();
}
