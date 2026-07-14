import type { SessionType } from "@mosoo/contracts/session";
import {
  agentsTable,
  appsTable,
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
  AppId,
  SessionId,
  SessionModelCallId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { createRuntimeUsageEventUpsert } from "../../cost/application/cost-usage-event.service";
import type { SessionUsageSummary } from "./session-live-state.types";
interface SessionModelCallRunRow {
  agent_id: AgentId;
  agent_owner_user_id: AccountId;
  agent_revision_id: AgentDeploymentVersionId | null;
  agent_status: "draft" | "published";
  actor_user_id: AccountId;
  completed_at: number | null;
  model: string | null;
  app_organization_id: OrganizationId;
  app_id: AppId;
  provider: string | null;
  runtime_id: string | null;
  session_id: SessionId;
  session_model: string;
  session_provider: string;
  session_runtime_id: string;
  session_type: SessionType;
  started_at: number | null;
  trigger: "resume" | "retry" | "system" | "user_prompt";
  trigger_provider: string | null;
}

export type SessionModelCallStatus = "completed" | "failed" | "started";

export interface UpsertSessionModelCallUsageInput {
  driverInstanceId: DriverInstanceId;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  status: SessionModelCallStatus;
  traceId: string;
  usage: SessionUsageSummary | null;
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
    cachedWriteTokens: usage.cachedWriteTokens ?? null,
    callId: usage.callId ?? null,
    model: usage.model ?? null,
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
        model: sql`${sessionRunsTable.model}`.mapWith(sessionRunsTable.model).as("model"),
        app_organization_id: appsTable.organizationId,
        app_id: sessionsTable.appId,
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
        session_type: sql<SessionType>`${sessionsTable.type}`,
        started_at: sessionRunsTable.startedAt,
        trigger: sessionRunsTable.trigger,
        trigger_provider: sql<
          string | null
        >`json_extract(${sessionsTable.metadataJson}, '$.triggered_by.provider')`,
      })
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .innerJoin(
        agentsTable,
        and(
          eq(agentsTable.id, sessionRunsTable.agentId),
          eq(agentsTable.appId, sessionsTable.appId),
        ),
      )
      .innerJoin(appsTable, eq(appsTable.id, sessionsTable.appId))
      .where(eq(sessionRunsTable.id, sessionRunId))
      .limit(1)
      .get()) ?? null
  );
}

export async function upsertSessionModelCallUsage(
  database: D1Database,
  input: UpsertSessionModelCallUsageInput,
): Promise<void> {
  if (!input.usage) {
    return;
  }
  const usage = input.usage;

  const run = await getSessionModelCallRunRow(database, input.sessionRunId);

  if (!run) {
    throw new Error("Session run not found for model call usage.");
  }

  const timestampMs = currentTimestampMs();
  const completedAt =
    input.status === "completed" || input.status === "failed"
      ? (run.completed_at ?? timestampMs)
      : null;
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
      createdAtMs: completedAt ?? timestampMs,
      model,
      organizationId: run.app_organization_id,
      appId: run.app_id,
      provider,
      runtimeId: run.runtime_id ?? run.session_runtime_id,
      sessionId: run.session_id,
      sessionType: run.session_type,
      sessionRunId: input.sessionRunId,
      trigger: run.trigger,
      triggerProvider: run.trigger_provider,
    },
    usage,
  } satisfies Parameters<typeof createRuntimeUsageEventUpsert>[1];

  await runAppDatabaseBatch(database, (appDatabase) => {
    const modelCallUpsert = appDatabase
      .insert(sessionModelCallsTable)
      .values({
        cacheCreationTokens: toTokenCount(usage.cachedWriteTokens),
        cacheReadTokens: toTokenCount(usage.cachedReadTokens),
        callKey,
        completedAt,
        costCurrency: usage.costCurrency ?? null,
        createdAt: timestampMs,
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
        startedAt: run.started_at ?? timestampMs,
        status: input.status,
        totalCostUsdMicros: toUsdMicros(usage.costAmount),
        traceId: input.traceId,
        updatedAt: timestampMs,
      })
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
          startedAt: sql`COALESCE(${sessionModelCallsTable.startedAt}, excluded.started_at)`,
          status: sql`CASE
            WHEN ${sessionModelCallsTable.status} IN ('completed', 'failed')
              AND excluded.status = 'started'
              THEN ${sessionModelCallsTable.status}
            ELSE excluded.status
          END`,
          totalCostUsdMicros: sql`COALESCE(excluded.total_cost_usd_micros, ${sessionModelCallsTable.totalCostUsdMicros})`,
          traceId: sql`excluded.trace_id`,
          updatedAt: sql`excluded.updated_at`,
        },
        target: [sessionModelCallsTable.sessionRunId, sessionModelCallsTable.callKey],
      });
    const usageEventUpsert = createRuntimeUsageEventUpsert(appDatabase, usageEventInput);

    return usageEventUpsert === null ? [modelCallUpsert] : [modelCallUpsert, usageEventUpsert];
  });
}

function normalizeUsageCallId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}
