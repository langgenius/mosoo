import type { SessionRunTrigger } from "@mosoo/contracts/session-run";
import {
  apiCommandsTable,
  sessionEventsTable,
  sessionMessagesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  AppId,
  PlatformId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq, exists, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import type { AppDatabase } from "../../../../platform/db/drizzle";
import type { PreparedApiCommand } from "../../../api-command/application/api-command-ledger";
import { createSessionRuntimeEventProjection } from "../../../sessions/domain/session-runtime-event-projection";
import type { BoundCapabilityRunProvenance } from "../../domain/bound-capability-run-provenance";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { createSessionStatusTransitionPatch } from "./session-lifecycle-projection.repository";

interface QueuedRunAdmissionRecord {
  agentId: AgentId;
  boundCapabilityProvenance?: BoundCapabilityRunProvenance;
  createdBy: AccountId;
  deploymentVersionId: AgentDeploymentVersionId | null;
  deploymentVersionNumber: number | null;
  id: SessionRunId;
  model: string | null;
  provider: string | null;
  runtimeId: string | null;
  sessionId: SessionId;
  timestampMs: number;
  traceId: string;
  trigger: SessionRunTrigger;
}

interface QueuedMessageAdmissionRecord {
  content: string;
  createdByAccountId: PlatformId;
  id: SessionMessageId;
  timestampMs: number;
}

export interface CommitQueuedSessionRunAdmissionInput {
  apiCommand: PreparedApiCommand;
  clientRequestId: string | null;
  events: readonly RuntimeEventEnvelope[];
  message: QueuedMessageAdmissionRecord;
  run: QueuedRunAdmissionRecord;
  runCreationGuard?: SQL;
  session: {
    agentId: AgentId;
    appId: AppId;
    id: SessionId;
  };
}

function selectedValue<T>(value: T, alias: string) {
  return sql<T>`${value}`.as(alias);
}

function admissionSessionPredicate(input: CommitQueuedSessionRunAdmissionInput) {
  return and(
    eq(sessionsTable.id, input.session.id),
    eq(sessionsTable.agentId, input.session.agentId),
    eq(sessionsTable.appId, input.session.appId),
    eq(sessionsTable.lastRunId, input.run.id),
    eq(sessionsTable.status, "RUNNING"),
  );
}

function claimableSessionPredicate(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  return and(
    eq(sessionsTable.id, input.session.id),
    eq(sessionsTable.agentId, input.session.agentId),
    eq(sessionsTable.appId, input.session.appId),
    isNull(sessionsTable.archivedAt),
    eq(sessionsTable.status, "IDLE"),
    isNull(sessionsTable.statusOperationId),
    notExists(
      db
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(
          and(
            eq(sessionRunsTable.sessionId, input.session.id),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
          ),
        ),
    ),
    input.clientRequestId === null
      ? sql`TRUE`
      : notExists(
          db
            .select({ id: sessionEventsTable.id })
            .from(sessionEventsTable)
            .where(
              and(
                eq(sessionEventsTable.sessionId, input.session.id),
                eq(sessionEventsTable.sourceEventId, input.clientRequestId),
              ),
            ),
        ),
    input.runCreationGuard ?? sql`TRUE`,
  );
}

export async function hasSessionRunAdmissionClientRequestReceipt(
  database: D1Database,
  input: { clientRequestId: string | null; sessionId: SessionId },
): Promise<boolean> {
  if (input.clientRequestId === null) {
    return false;
  }

  const receipt =
    (await getAppDatabase(database)
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, input.sessionId),
          eq(sessionEventsTable.sourceEventId, input.clientRequestId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return receipt !== null;
}

function createRunInsertQuery(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  return db.insert(sessionRunsTable).select(
    db
      .select({
        agentId: selectedValue(input.run.agentId, "agent_id"),
        boundCapabilityAgentId: selectedValue(
          input.run.boundCapabilityProvenance?.agentId ?? null,
          "bound_capability_agent_id",
        ),
        boundCapabilityAppId: selectedValue(
          input.run.boundCapabilityProvenance?.appId ?? null,
          "bound_capability_app_id",
        ),
        boundCapabilityBindingEnv: selectedValue(
          input.run.boundCapabilityProvenance?.bindingEnv ?? null,
          "bound_capability_binding_env",
        ),
        boundCapabilityBindingName: selectedValue(
          input.run.boundCapabilityProvenance?.bindingName ?? null,
          "bound_capability_binding_name",
        ),
        boundCapabilityDeploymentId: selectedValue(
          input.run.boundCapabilityProvenance?.deploymentId ?? null,
          "bound_capability_deployment_id",
        ),
        boundCapabilityDeploymentRunId: selectedValue(
          input.run.boundCapabilityProvenance?.deploymentRunId ?? null,
          "bound_capability_deployment_run_id",
        ),
        completedAt: selectedValue(null, "completed_at"),
        createdAt: selectedValue(input.run.timestampMs, "created_at"),
        createdByAccountId: selectedValue(input.run.createdBy, "created_by_account_id"),
        deploymentVersionId: selectedValue(input.run.deploymentVersionId, "deployment_version_id"),
        deploymentVersionNumber: selectedValue(
          input.run.deploymentVersionNumber,
          "deployment_version_number",
        ),
        driverInstanceId: selectedValue(null, "driver_instance_id"),
        errorCode: selectedValue(null, "error_code"),
        errorDetailsJson: selectedValue(null, "error_details_json"),
        errorMessage: selectedValue(null, "error_message"),
        id: selectedValue(input.run.id, "id"),
        model: selectedValue(input.run.model, "model"),
        provider: selectedValue(input.run.provider, "provider"),
        runtimeId: selectedValue(input.run.runtimeId, "runtime_id"),
        sessionId: sessionsTable.id,
        startedAt: selectedValue(null, "started_at"),
        status: selectedValue("queued" as const, "status"),
        statusChangedAt: selectedValue(input.run.timestampMs, "status_changed_at"),
        statusEvent: selectedValue("run.queue", "status_event"),
        statusOperationId: selectedValue(null, "status_operation_id"),
        statusSeq: selectedValue(0, "status_seq"),
        statusSource: selectedValue("api", "status_source"),
        traceId: selectedValue(input.run.traceId, "trace_id"),
        trigger: selectedValue(input.run.trigger, "trigger"),
        updatedAt: selectedValue(input.run.timestampMs, "updated_at"),
      })
      .from(sessionsTable)
      .where(claimableSessionPredicate(db, input)),
  );
}

function createMessageInsertQuery(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  return db.insert(sessionMessagesTable).select(
    db
      .select({
        contentText: selectedValue(input.message.content, "content_text"),
        createdAt: selectedValue(input.message.timestampMs, "created_at"),
        createdByAccountId: selectedValue(
          input.message.createdByAccountId,
          "created_by_account_id",
        ),
        id: selectedValue(input.message.id, "id"),
        planJson: selectedValue(null, "plan_json"),
        role: selectedValue("user" as const, "role"),
        segmentsJson: selectedValue(null, "segments_json"),
        seq: sessionsTable.messageSeqCursor,
        sessionId: sessionsTable.id,
        sessionRunId: selectedValue(input.run.id, "session_run_id"),
      })
      .from(sessionsTable)
      .where(
        and(
          admissionSessionPredicate(input),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
  );
}

function runtimeEventOccurredAt(event: RuntimeEventEnvelope, fallbackMs: number): number {
  const occurredAt = Date.parse(event.occurredAt);
  return Number.isFinite(occurredAt) ? occurredAt : fallbackMs;
}

function createEventInsertQuery(
  db: AppDatabase,
  input: CommitQueuedSessionRunAdmissionInput,
  event: RuntimeEventEnvelope,
  index: number,
) {
  const projection = createSessionRuntimeEventProjection(event);
  const timestampMs = input.run.timestampMs + index;
  const occurredAt = runtimeEventOccurredAt(event, timestampMs);
  const sourceEventId =
    event.sourceEventId ?? (index === 0 ? input.clientRequestId : null) ?? event.id;

  return db.insert(sessionEventsTable).select(
    db
      .select({
        agentId: sessionsTable.agentId,
        contentText: selectedValue(projection.contentText, "content_text"),
        createdAt: selectedValue(timestampMs, "created_at"),
        endedAt: selectedValue(Math.max(occurredAt, timestampMs), "ended_at"),
        eventType: selectedValue(projection.eventType, "event_type"),
        family: selectedValue(projection.family, "family"),
        id: selectedValue(event.id, "id"),
        occurredAt: selectedValue(occurredAt, "occurred_at"),
        processStatus: selectedValue(projection.processStatus, "process_status"),
        processType: selectedValue(projection.processType, "process_type"),
        runId: selectedValue(projection.runId, "run_id"),
        seq: sql<number>`${sessionsTable.runtimeEventSeqCursor} - ${input.events.length - index - 1}`.as(
          "seq",
        ),
        sessionId: sessionsTable.id,
        sourceEventId: selectedValue(sourceEventId, "source_event_id"),
        source: selectedValue(projection.source, "source"),
        tokens: selectedValue(projection.tokens, "tokens"),
        traceId: selectedValue(projection.traceId, "trace_id"),
        visibility: selectedValue(projection.visibility, "visibility"),
      })
      .from(sessionsTable)
      .where(
        and(
          admissionSessionPredicate(input),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
  );
}

function createApiCommandInsertQuery(db: AppDatabase, input: CommitQueuedSessionRunAdmissionInput) {
  const record = input.apiCommand.record;

  return db.insert(apiCommandsTable).select(
    db
      .select({
        attemptCount: selectedValue(record.attemptCount, "attempt_count"),
        claimExpiresAt: selectedValue(record.claimExpiresAt, "claim_expires_at"),
        claimOwner: selectedValue(record.claimOwner, "claim_owner"),
        completedAt: selectedValue(record.completedAt, "completed_at"),
        createdAt: selectedValue(record.createdAt, "created_at"),
        dedupeKey: selectedValue(record.dedupeKey, "dedupe_key"),
        id: selectedValue(record.id, "id"),
        kind: selectedValue(record.kind, "kind"),
        lastErrorCode: selectedValue(record.lastErrorCode, "last_error_code"),
        lastErrorMessage: selectedValue(record.lastErrorMessage, "last_error_message"),
        payloadJson: selectedValue(record.payloadJson, "payload_json"),
        status: selectedValue(record.status, "status"),
        updatedAt: selectedValue(record.updatedAt, "updated_at"),
      })
      .from(sessionsTable)
      .where(
        and(
          admissionSessionPredicate(input),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
  );
}

export async function commitQueuedSessionRunAdmission(
  database: D1Database,
  input: CommitQueuedSessionRunAdmissionInput,
): Promise<boolean> {
  if (input.events.length === 0) {
    throw new Error("Queued Session Run admission requires canonical runtime events.");
  }

  for (const event of input.events) {
    if (event.sessionId !== input.session.id || event.runId !== input.run.id) {
      throw new Error("Queued Session Run admission event scope does not match the Run.");
    }
  }

  const results = await runAppDatabaseBatch(database, (db) => [
    createRunInsertQuery(db, input),
    db
      .update(sessionsTable)
      .set({
        lastMessageAt: input.message.timestampMs,
        lastRunId: input.run.id,
        messageSeqCursor: sql`${sessionsTable.messageSeqCursor} + 1`,
        model: sql`COALESCE(${input.run.model}, ${sessionsTable.model})`,
        provider: sql`COALESCE(${input.run.provider}, ${sessionsTable.provider})`,
        runtimeEventSeqCursor: sql`${sessionsTable.runtimeEventSeqCursor} + ${input.events.length}`,
        ...createSessionStatusTransitionPatch({
          status: "RUNNING",
          timestampMs: input.run.timestampMs,
        }),
      })
      .where(
        and(
          eq(sessionsTable.id, input.session.id),
          eq(sessionsTable.agentId, input.session.agentId),
          eq(sessionsTable.appId, input.session.appId),
          isNull(sessionsTable.archivedAt),
          eq(sessionsTable.status, "IDLE"),
          isNull(sessionsTable.statusOperationId),
          exists(
            db
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(eq(sessionRunsTable.id, input.run.id)),
          ),
        ),
      ),
    createMessageInsertQuery(db, input),
    ...input.events.map((event, index) => createEventInsertQuery(db, input, event, index)),
    createApiCommandInsertQuery(db, input),
  ]);

  return getD1ChangeCount((results as readonly unknown[])[0]) > 0;
}
