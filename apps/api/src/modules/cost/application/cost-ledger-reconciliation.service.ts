import type { SessionUsageSummary } from "@mosoo/ag-ui-session";
import { SESSION_TYPES } from "@mosoo/contracts/session";
import type { SessionType } from "@mosoo/contracts/session";
import { SESSION_RUN_TRIGGERS } from "@mosoo/contracts/session-run";
import type { SessionRunTrigger } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
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

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import { getD1ChangeCount, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import type { AppDatabase } from "../../../platform/db/drizzle";
import type { UsageContract } from "../domain/usage-contract";
import { getUsageDetailRetentionCutoffMs } from "./cost-rollup.service";
import {
  createRuntimeUsageEventInsertIfMissing,
  hasRecordableRuntimeUsage,
} from "./cost-usage-event.service";
import type { RecordRuntimeUsageEventInput } from "./cost-usage-event.service";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type CostLedgerReconciliationMode = "audit" | "repair";
export type CostLedgerReconciliationCursor = string;

export type CostLedgerIndeterminateReason =
  | "ambiguous_existing_ledger_event"
  | "invalid_platform_identity"
  | "invalid_run_trigger"
  | "invalid_session_metadata"
  | "invalid_session_type"
  | "invalid_usage_timestamp"
  | "invalid_usage_metadata"
  | "invalid_usage_values"
  | "missing_driver_identity"
  | "missing_published_revision"
  | "missing_run_context"
  | "predates_safe_repair_window";

export interface CostLedgerReconciliationInput {
  cursor?: CostLedgerReconciliationCursor | null;
  limit?: number;
  mode?: CostLedgerReconciliationMode;
  now?: Date;
}

export interface CostLedgerReconciliationResult {
  failed: number;
  hasMore: boolean;
  historyBeforeRetentionIndeterminate: boolean;
  indeterminate: number;
  indeterminateByReason: Partial<Record<CostLedgerIndeterminateReason, number>>;
  mode: CostLedgerReconciliationMode;
  nextCursor: CostLedgerReconciliationCursor | null;
  present: number;
  repairable: number;
  repaired: number;
  scanned: number;
  skipped: number;
}

interface CostLedgerCandidateRow {
  actor_user_id: string | null;
  agent_id: string | null;
  agent_owner_user_id: string | null;
  agent_revision_id: string | null;
  app_id: string | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  call_key: string;
  completed_at: number | null;
  cost_currency: string | null;
  created_at: number;
  driver_instance_id: string | null;
  input_tokens: number | null;
  metadata_json: string | null;
  model: string;
  model_call_id: string;
  native_call_id: string | null;
  organization_id: string | null;
  output_tokens: number | null;
  potential_usage_event_id: string | null;
  provider: string;
  run_runtime_id: string | null;
  run_trigger: string | null;
  resolved_revision_id: string | null;
  session_id: string;
  resolved_run_id: string | null;
  session_run_id: string;
  session_runtime_id: string | null;
  session_metadata_valid: number | null;
  session_type: string | null;
  total_cost_usd_micros: number | null;
  trigger_provider: string | null;
  usage_event_id: string | null;
}

interface RepairableCostLedgerCandidate {
  input: RecordRuntimeUsageEventInput;
}

type ClassifiedCostLedgerCandidate =
  | { kind: "indeterminate"; reason: CostLedgerIndeterminateReason }
  | { kind: "present" }
  | { kind: "repairable"; value: RepairableCostLedgerCandidate }
  | { kind: "skipped" };

const LIST_USAGE_CANDIDATES_SQL = `
  WITH model_call_candidates AS (
    SELECT
      session_model_call.id AS model_call_id,
      session_model_call.cache_creation_tokens,
      session_model_call.cache_read_tokens,
      session_model_call.call_key,
      session_model_call.completed_at,
      session_model_call.cost_currency,
      session_model_call.created_at,
      session_model_call.driver_instance_id,
      session_model_call.input_tokens,
      session_model_call.metadata_json,
      session_model_call.model,
      session_model_call.native_call_id,
      session_model_call.output_tokens,
      session_model_call.provider,
      session_model_call.session_id,
      session_model_call.session_run_id,
      session_model_call.total_cost_usd_micros,
      session_run.id AS resolved_run_id,
      session_run.agent_id,
      session_run.created_by_account_id AS actor_user_id,
      session_run.deployment_version_id AS agent_revision_id,
      session_run.runtime_id AS run_runtime_id,
      session_run.trigger AS run_trigger,
      agent_deployment_version.id AS resolved_revision_id,
      json_valid(session.metadata_json) AS session_metadata_valid,
      session.type AS session_type,
      session.runtime_id AS session_runtime_id,
      CASE
        WHEN json_valid(session.metadata_json)
          THEN json_extract(session.metadata_json, '$.triggered_by.provider')
        ELSE NULL
      END AS trigger_provider,
      agent.owner_account_id AS agent_owner_user_id,
      app.id AS app_id,
      app.organization_id,
      CASE
        WHEN session_model_call.driver_instance_id IS NULL THEN NULL
        WHEN session_model_call.native_call_id IS NOT NULL
          AND trim(session_model_call.native_call_id) <> ''
          THEN session_model_call.driver_instance_id || ':' || trim(session_model_call.native_call_id)
        ELSE session_model_call.driver_instance_id || ':' || session_model_call.session_run_id || ':' || session_model_call.call_key
      END AS expected_source_event_id,
      CASE
        WHEN session_model_call.native_call_id IS NOT NULL
          AND trim(session_model_call.native_call_id) <> ''
          THEN trim(session_model_call.native_call_id)
        ELSE session_model_call.session_run_id || ':' || session_model_call.call_key
      END AS expected_source_event_suffix
    FROM session_model_call
    LEFT JOIN session_run
      ON session_run.id = session_model_call.session_run_id
    LEFT JOIN session
      ON session.id = session_model_call.session_id
      AND session.id = session_run.session_id
    LEFT JOIN agent
      ON agent.id = session_run.agent_id
      AND agent.app_id = session.app_id
    LEFT JOIN agent_deployment_version
      ON agent_deployment_version.id = session_run.deployment_version_id
      AND agent_deployment_version.agent_id = session_run.agent_id
    LEFT JOIN app
      ON app.id = session.app_id
    WHERE session_model_call.id < ?
      AND COALESCE(session_model_call.completed_at, session_model_call.created_at) >= ?
  )
  SELECT
    model_call_candidates.*,
    usage_event.id AS usage_event_id,
    (
      SELECT historical_usage_event.id
      FROM usage_event AS historical_usage_event
      WHERE historical_usage_event.source = 'runtime_driver'
        AND historical_usage_event.session_run_id = model_call_candidates.session_run_id
        AND instr(historical_usage_event.source_event_id, ':') > 0
        AND substr(
          historical_usage_event.source_event_id,
          instr(historical_usage_event.source_event_id, ':') + 1
        ) = model_call_candidates.expected_source_event_suffix
        AND (
          model_call_candidates.expected_source_event_id IS NULL
          OR historical_usage_event.source_event_id <> model_call_candidates.expected_source_event_id
        )
      LIMIT 1
    ) AS potential_usage_event_id
  FROM model_call_candidates
  LEFT JOIN usage_event
    ON usage_event.source = 'runtime_driver'
    AND usage_event.source_event_id = model_call_candidates.expected_source_event_id
  ORDER BY model_call_candidates.model_call_id DESC
  LIMIT ?
`;

const HAS_HISTORY_BEFORE_RETENTION_SQL = `
  SELECT 1 AS found
  FROM session_model_call
  WHERE COALESCE(completed_at, created_at) < ?
    AND (
      COALESCE(input_tokens, 0) > 0
      OR COALESCE(output_tokens, 0) > 0
      OR COALESCE(cache_read_tokens, 0) > 0
      OR COALESCE(cache_creation_tokens, 0) > 0
      OR (
        cost_currency = 'USD'
        AND total_cost_usd_micros IS NOT NULL
        AND total_cost_usd_micros >= 0
      )
    )
  LIMIT 1
`;

function requirePageSize(value: number | undefined): number {
  const pageSize = value ?? DEFAULT_PAGE_SIZE;

  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error(`Cost ledger reconciliation limit must be between 1 and ${MAX_PAGE_SIZE}.`);
  }

  return pageSize;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readUsageSource(value: unknown): SessionUsageSummary["source"] | null {
  return value === "prompt_response" || value === "session_update" ? value : null;
}

function readUsageContract(value: unknown): UsageContract | null {
  if (
    value === "anthropic_bucketed" ||
    value === "openai_runtime_total_with_cached_breakdown" ||
    value === "openai_total_with_cached_breakdown"
  ) {
    return value;
  }

  return null;
}

function restoreStoredUsage(row: CostLedgerCandidateRow): SessionUsageSummary | null {
  if (row.metadata_json === null) {
    return null;
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(row.metadata_json) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(metadata)) {
    return null;
  }

  const source = readUsageSource(metadata["source"]);
  const usageContract = readUsageContract(metadata["usageContract"]);

  if (source === null || usageContract === null) {
    return null;
  }

  return {
    cachedReadTokens: row.cache_read_tokens,
    cachedWriteTokens: row.cache_creation_tokens,
    callId: row.native_call_id,
    costAmount: row.total_cost_usd_micros === null ? null : row.total_cost_usd_micros / 1_000_000,
    costCurrency: row.cost_currency,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    source,
    usageContract,
  };
}

function isSessionType(value: string | null): value is SessionType {
  return value !== null && SESSION_TYPES.some((candidate) => candidate === value);
}

function isSessionRunTrigger(value: string | null): value is SessionRunTrigger {
  return value !== null && SESSION_RUN_TRIGGERS.some((candidate) => candidate === value);
}

function normalizeNativeCallId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function hasStoredRecordableUsage(row: CostLedgerCandidateRow): boolean {
  return (
    (row.input_tokens ?? 0) > 0 ||
    (row.output_tokens ?? 0) > 0 ||
    (row.cache_read_tokens ?? 0) > 0 ||
    (row.cache_creation_tokens ?? 0) > 0 ||
    (row.cost_currency === "USD" &&
      row.total_cost_usd_micros !== null &&
      row.total_cost_usd_micros >= 0)
  );
}

function hasValidStoredUsageValues(row: CostLedgerCandidateRow): boolean {
  return [
    row.input_tokens,
    row.output_tokens,
    row.cache_read_tokens,
    row.cache_creation_tokens,
    row.total_cost_usd_micros,
  ].every((value) => value === null || (Number.isSafeInteger(value) && value >= 0));
}

function classifyCandidate(
  row: CostLedgerCandidateRow,
  cutoffMs: number,
  nowMs: number,
): ClassifiedCostLedgerCandidate {
  if (row.usage_event_id !== null) {
    return { kind: "present" };
  }

  if (row.potential_usage_event_id !== null) {
    return { kind: "indeterminate", reason: "ambiguous_existing_ledger_event" };
  }

  if (!hasValidStoredUsageValues(row)) {
    return { kind: "indeterminate", reason: "invalid_usage_values" };
  }

  if (!hasStoredRecordableUsage(row)) {
    return { kind: "skipped" };
  }

  if (row.driver_instance_id === null) {
    return { kind: "indeterminate", reason: "missing_driver_identity" };
  }

  const usageTimestamp = row.completed_at ?? row.created_at;

  if (
    !Number.isSafeInteger(row.created_at) ||
    row.created_at < 0 ||
    row.created_at > nowMs ||
    !Number.isSafeInteger(usageTimestamp) ||
    usageTimestamp < 0 ||
    usageTimestamp > nowMs
  ) {
    return { kind: "indeterminate", reason: "invalid_usage_timestamp" };
  }

  if (row.created_at < cutoffMs) {
    return { kind: "indeterminate", reason: "predates_safe_repair_window" };
  }

  const usage = restoreStoredUsage(row);

  if (usage === null) {
    return { kind: "indeterminate", reason: "invalid_usage_metadata" };
  }

  if (!hasRecordableRuntimeUsage(usage)) {
    return { kind: "skipped" };
  }

  if (
    row.resolved_run_id === null ||
    row.actor_user_id === null ||
    row.agent_id === null ||
    row.agent_owner_user_id === null ||
    row.app_id === null ||
    row.organization_id === null ||
    (row.run_runtime_id === null && row.session_runtime_id === null)
  ) {
    return { kind: "indeterminate", reason: "missing_run_context" };
  }

  if (row.agent_revision_id === null || row.resolved_revision_id === null) {
    return { kind: "indeterminate", reason: "missing_published_revision" };
  }

  if (!isSessionType(row.session_type)) {
    return { kind: "indeterminate", reason: "invalid_session_type" };
  }

  if (row.session_type === "api_channel" && row.session_metadata_valid !== 1) {
    return { kind: "indeterminate", reason: "invalid_session_metadata" };
  }

  if (!isSessionRunTrigger(row.run_trigger)) {
    return { kind: "indeterminate", reason: "invalid_run_trigger" };
  }

  try {
    parsePlatformId<SessionModelCallId>(row.model_call_id, "model call ID");
    const sessionRunId = parsePlatformId<SessionRunId>(row.session_run_id, "session run ID");
    const input: RecordRuntimeUsageEventInput = {
      callKey: row.call_key,
      driverInstanceId: parsePlatformId<DriverInstanceId>(
        row.driver_instance_id,
        "driver instance ID",
      ),
      nativeCallId: normalizeNativeCallId(row.native_call_id),
      run: {
        actorUserId: parsePlatformId<AccountId>(row.actor_user_id, "actor user ID"),
        agentId: parsePlatformId<AgentId>(row.agent_id, "agent ID"),
        agentOwnerUserId: parsePlatformId<AccountId>(
          row.agent_owner_user_id,
          "agent owner user ID",
        ),
        agentRevisionId: parsePlatformId<AgentDeploymentVersionId>(
          row.agent_revision_id,
          "agent revision ID",
        ),
        agentStatus: "published",
        createdAtMs: row.completed_at ?? row.created_at,
        model: row.model,
        organizationId: parsePlatformId<OrganizationId>(row.organization_id, "organization ID"),
        appId: parsePlatformId<AppId>(row.app_id, "app ID"),
        provider: row.provider,
        runtimeId: row.run_runtime_id ?? row.session_runtime_id,
        sessionId: parsePlatformId<SessionId>(row.session_id, "session ID"),
        sessionType: row.session_type,
        sessionRunId,
        trigger: row.run_trigger,
        triggerProvider: row.trigger_provider,
      },
      usage,
    };

    return { kind: "repairable", value: { input } };
  } catch {
    return { kind: "indeterminate", reason: "invalid_platform_identity" };
  }
}

async function listUsageCandidates(
  database: D1Database,
  input: {
    cursor: CostLedgerReconciliationCursor | null;
    cutoffMs: number;
    limit: number;
  },
): Promise<CostLedgerCandidateRow[]> {
  const result = await database
    .prepare(LIST_USAGE_CANDIDATES_SQL)
    .bind(input.cursor ?? "~", input.cutoffMs, input.limit)
    .all<CostLedgerCandidateRow>();

  return result.results;
}

async function hasHistoryBeforeRetention(database: D1Database, cutoffMs: number): Promise<boolean> {
  const row = await database
    .prepare(HAS_HISTORY_BEFORE_RETENTION_SQL)
    .bind(cutoffMs)
    .first<{ found: number }>();

  return row !== null;
}

function incrementIndeterminateReason(
  reasons: Partial<Record<CostLedgerIndeterminateReason, number>>,
  reason: CostLedgerIndeterminateReason,
): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

async function repairCandidates(
  database: D1Database,
  candidates: readonly RepairableCostLedgerCandidate[],
  cursor: CostLedgerReconciliationCursor | null,
): Promise<{ present: number; repaired: number }> {
  if (candidates.length === 0) {
    return { present: 0, repaired: 0 };
  }

  const firstCandidate = candidates[0];

  if (firstCandidate === undefined) {
    return { present: 0, repaired: 0 };
  }

  const remainingCandidates = candidates.slice(1);

  function createRepairQuery(appDatabase: AppDatabase, candidate: RepairableCostLedgerCandidate) {
    const query = createRuntimeUsageEventInsertIfMissing(appDatabase, candidate.input);

    if (query === null) {
      throw new Error("Repairable cost ledger candidate produced no usage event write.");
    }

    return query;
  }

  try {
    const results = await runAppDatabaseBatch(database, (db) => [
      createRepairQuery(db, firstCandidate),
      ...remainingCandidates.map((candidate) => createRepairQuery(db, candidate)),
    ]);
    let repaired = 0;

    for (const result of results as readonly unknown[]) {
      repaired += getD1ChangeCount(result);
    }

    return {
      present: candidates.length - repaired,
      repaired,
    };
  } catch (error) {
    logError("cost.ledger_reconciliation.repair_failed", {
      ...createErrorLogContext(error),
      cursor,
      failed: candidates.length,
    });
    throw error;
  }
}

export function parseCostLedgerReconciliationActivationMode(
  value: string | undefined,
): CostLedgerReconciliationMode | null {
  const normalized = value?.trim() ?? "";

  if (normalized.length === 0) {
    return null;
  }

  if (normalized === "audit" || normalized === "repair") {
    return normalized;
  }

  throw new Error("MOSOO_COST_LEDGER_RECONCILIATION_MODE must be unset, 'audit', or 'repair'.");
}

export async function reconcileCostLedgerPage(
  database: D1Database,
  input: CostLedgerReconciliationInput = {},
): Promise<CostLedgerReconciliationResult> {
  const cursor = input.cursor ?? null;
  const limit = requirePageSize(input.limit);
  const mode = input.mode ?? "audit";
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Cost ledger reconciliation time must be a valid non-negative timestamp.");
  }

  const cutoffMs = getUsageDetailRetentionCutoffMs(now);
  const rows = await listUsageCandidates(database, {
    cursor,
    cutoffMs,
    limit: limit + 1,
  });
  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const lastRow = pageRows.at(-1);
  const nextCursor = hasMore && lastRow !== undefined ? lastRow.model_call_id : null;
  const repairableCandidates: RepairableCostLedgerCandidate[] = [];
  const indeterminateByReason: Partial<Record<CostLedgerIndeterminateReason, number>> = {};
  let present = 0;
  let skipped = 0;

  for (const row of pageRows) {
    const classified = classifyCandidate(row, cutoffMs, nowMs);

    if (classified.kind === "repairable") {
      repairableCandidates.push(classified.value);
      continue;
    }

    if (classified.kind === "present") {
      present += 1;
      continue;
    }

    if (classified.kind === "skipped") {
      skipped += 1;
      continue;
    }

    incrementIndeterminateReason(indeterminateByReason, classified.reason);
  }

  const writeResult =
    mode === "repair"
      ? await repairCandidates(database, repairableCandidates, cursor)
      : { present: 0, repaired: 0 };
  const indeterminate = Object.values(indeterminateByReason).reduce(
    (total, count) => total + count,
    0,
  );

  return {
    failed: 0,
    hasMore,
    historyBeforeRetentionIndeterminate:
      cursor === null ? await hasHistoryBeforeRetention(database, cutoffMs) : false,
    indeterminate,
    indeterminateByReason,
    mode,
    nextCursor,
    present: present + writeResult.present,
    repairable: repairableCandidates.length,
    repaired: writeResult.repaired,
    scanned: pageRows.length,
    skipped,
  };
}
