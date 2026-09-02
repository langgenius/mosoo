import type { AgentKind } from "@mosoo/contracts/agent";
import type { SessionStatus } from "@mosoo/contracts/session";
import { DurableRunError } from "@mosoo/contracts/session-run";
import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { createPlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  PlatformId,
  RuntimeEventId,
  RuntimeOperationId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import {
  createSessionRunTerminalSourceId,
  createRuntimeEventSemanticHash,
  readRuntimeEventPayload,
  readRuntimeEventString,
  readRuntimeRunPayload,
  stringifyRuntimeEventSemanticValue,
} from "@mosoo/runtime-events";
import type { RuntimeRunView } from "@mosoo/runtime-events";

import { getD1ChangeCount } from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { createSessionRuntimeEventProjection } from "../../../sessions/domain/session-runtime-event-projection";
import { readTerminalEventSemanticAuthority } from "../../../sessions/domain/session-terminal-event-authority";
import type { SessionRuntimeEventInput } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { decideSessionRunTransition } from "../../domain/session-run-lifecycle.machine";
import {
  prepareAssistantMessageProjection,
  prepareToolCarrierProjection,
} from "./assistant-message-projection";
import type { PreparedAssistantMessageProjection } from "./assistant-message-projection";
import { prepareRuntimeArtifactPromotion } from "./runtime-artifact-attempt.repository";

interface CompletionStateRow {
  archived_at: number | null;
  cleanup_operation_kind: "archive" | "delete" | null;
  completed_at: number | null;
  created_at: number;
  error_code: string | null;
  error_details_json: string | null;
  error_message: string | null;
  error_retryable: number | null;
  driver_last_heartbeat_at: number | null;
  driver_connection_id: string | null;
  driver_generation: number | null;
  driver_status: string | null;
  driver_status_operation_id: string | null;
  driver_updated_at: number | null;
  last_run_id: SessionRunId | null;
  message_seq_cursor: number;
  tool_carrier_anchor_json: string | null;
  permission_request_count: number;
  run_status: SessionRunStatus;
  run_status_operation_id: string | null;
  run_status_seq: number;
  run_status_source: string;
  run_trace_id: string;
  run_updated_at: number;
  run_created_by_account_id: PlatformId;
  run_driver_instance_id: DriverInstanceId | null;
  runtime_event_seq_cursor: number;
  session_kind: AgentKind;
  session_status: SessionStatus;
  session_status_operation_id: string | null;
  session_status_seq: number;
  session_updated_at: number;
  started_at: number | null;
  final_message_artifact_json: string | null;
  unfinalized_model_call_count: number;
}

interface PersistedAssistantMessageRow {
  content_text: string;
  created_at: number;
  created_by_account_id: string;
  id: string;
  plan_json: string | null;
  projection_format: "event_stream_v3" | "materialized";
  segments_json: string | null;
  seq: number;
  session_id: string;
  session_run_id: string;
}

interface PreparedTerminalAssistantMessage {
  createdAt: number;
  firstEventSeq: number;
  message: PreparedAssistantMessageProjection;
}

interface GuardedAssistantMessage {
  contentText: string;
  createdAt: number;
  createdByAccountId: string;
  id: string;
  planJson: string | null;
  projectionFormat: "event_stream_v3" | "materialized";
  segmentsJson: string | null;
  seq: number;
  sessionId: SessionId;
}

interface TranscriptAnchor {
  occurredAt: number;
  seq: number;
}

interface PersistedTerminalEventRow {
  artifact_attempt_id: string | null;
  artifact_manifest_json: string | null;
  artifact_manifest_sha256: string | null;
  created_at: number;
  ended_at: number | null;
  event_type: string;
  family: string;
  id: RuntimeEventId;
  occurred_at: number;
  process_status: string;
  process_type: string;
  run_id: string | null;
  semantic_hash: string | null;
  terminal_event_json: string | null;
  seq: number;
  session_id: string;
  source: string;
  source_event_id: string;
  stream_id: string | null;
  tool_call_id: string | null;
  tool_input_json: string | null;
  tool_name: string | null;
  tokens: number | null;
  trace_id: string | null;
  visibility: string;
}

interface PersistedTerminalAuthorityRow extends PersistedTerminalEventRow {
  agent_id: string;
  content_text: string;
  mcp_command_id: string | null;
  tool_input_delta_json: string | null;
  tool_output_delta_text: string | null;
  tool_output_text: string | null;
  tool_parent_message_id: string | null;
  tool_result_message_id: string | null;
  tool_status: string | null;
}

interface CompletionSnapshot {
  assistantMessages: PersistedAssistantMessageRow[];
  state: CompletionStateRow | null;
  terminalEvents: PersistedTerminalEventRow[];
}

export type CompletedRunCommitResult =
  | {
      kind: "applied" | "duplicate";
      persistedSourceEventIds: readonly string[];
      runDurationMs: number | null;
    }
  | {
      currentStatus: SessionRunStatus;
      kind: "stale";
      persistedSourceEventIds: readonly [];
      runDurationMs: null;
    };

export type AdoptTerminalRunProjectionResult =
  | CompletedRunCommitResult
  | {
      kind: "missing";
      persistedSourceEventIds: readonly [];
      runDurationMs: null;
    };

export type DriverTerminalRunStatus = "cancelled" | "completed" | "failed";
export type HostTerminalRunStatus = DriverTerminalRunStatus | "expired";
export type TerminalRunProjectionSource =
  | "api"
  | "driver"
  | "maintenance"
  | "runtime_operation"
  | "system"
  | "viewer";

export interface ExpectedTerminalSessionObservation {
  lastRunId: SessionRunId | null;
  status: SessionStatus;
  statusSeq: number;
  updatedAt: number;
}

export interface ExpectedTerminalDriverObservation {
  connectionId?: string | null;
  driverInstanceId: DriverInstanceId | null;
  generation?: number;
  lastHeartbeatAt?: number | null;
  status?: string | null;
  updatedAt?: number | null;
}

interface AtomicTerminalDriverReleaseObservation {
  readonly connectionId: string | null;
  readonly driverInstanceId: DriverInstanceId;
  readonly generation: number;
}

function readAtomicTerminalDriverReleaseObservation(
  observation: ExpectedTerminalDriverObservation | undefined,
): AtomicTerminalDriverReleaseObservation | null {
  if (
    observation?.driverInstanceId === null ||
    observation?.driverInstanceId === undefined ||
    observation.connectionId === undefined ||
    observation.generation === undefined
  ) {
    return null;
  }

  return {
    connectionId: observation.connectionId,
    driverInstanceId: observation.driverInstanceId,
    generation: observation.generation,
  };
}

function expectedDriverObservationMatchesState(
  state: CompletionStateRow,
  observation: ExpectedTerminalDriverObservation,
): boolean {
  return (
    state.run_driver_instance_id === observation.driverInstanceId &&
    (observation.connectionId === undefined ||
      state.driver_connection_id === observation.connectionId) &&
    (observation.generation === undefined || state.driver_generation === observation.generation) &&
    (observation.status === undefined || state.driver_status === observation.status) &&
    (observation.updatedAt === undefined || state.driver_updated_at === observation.updatedAt) &&
    (observation.lastHeartbeatAt === undefined ||
      state.driver_last_heartbeat_at === observation.lastHeartbeatAt)
  );
}

function terminalEventKind(
  status: HostTerminalRunStatus,
): "run.cancelled" | "run.completed" | "run.failed" {
  return status === "expired" ? "run.cancelled" : `run.${status}`;
}

function terminalLifecycleEvent(status: HostTerminalRunStatus) {
  switch (status) {
    case "cancelled":
      return "run.cancel";
    case "completed":
      return "run.complete";
    case "failed":
      return "run.fail";
    case "expired":
      return "run.expire";
  }
}

function readTerminalRunOperationId(input: {
  expectedSessionOperationId?: RuntimeOperationId | null;
  source: TerminalRunProjectionSource;
}): RuntimeOperationId | null {
  if (input.source !== "runtime_operation") {
    return null;
  }
  if (input.expectedSessionOperationId === undefined || input.expectedSessionOperationId === null) {
    throw new Error("A runtime-operation terminal transition requires its operation identity.");
  }
  return input.expectedSessionOperationId;
}

interface PreparedTerminalEvent {
  artifactAttemptId: string | null;
  artifactManifestJson: string | null;
  artifactManifestSha256: string | null;
  contentText: string;
  createdAt: number;
  endedAt: number;
  eventType: string;
  explicitRunView: RuntimeRunView | null;
  family: string;
  id: RuntimeEventId;
  occurredAt: number;
  processStatus: string;
  processType: string;
  semanticHash: string;
  terminalEventJson: string;
  sessionStatus: Extract<SessionStatus, "IDLE" | "TERMINATED">;
  source: string;
  sourceEventId: string;
  streamId: string | null;
  toolCallId: string | null;
  toolInputJson: string | null;
  toolName: string | null;
  tokens: number | null;
  traceId: string | null;
  visibility: string;
}

async function readTerminalAuthorityReceipt(
  database: D1Database,
  runId: SessionRunId,
): Promise<PersistedTerminalAuthorityRow | null> {
  const { results } = await database
    .prepare(
      `SELECT agent_id, artifact_attempt_id, artifact_manifest_json,
              artifact_manifest_sha256, content_text, created_at, ended_at, event_type,
              family, id, mcp_command_id, occurred_at, process_status, process_type, run_id,
              semantic_hash, terminal_event_json, seq, session_id, source, source_event_id,
              stream_id, tool_call_id,
              tool_input_delta_json, tool_input_json, tool_name, tool_output_delta_text,
              tool_output_text, tool_parent_message_id, tool_result_message_id, tool_status,
              tokens, trace_id, visibility
       FROM session_event
       WHERE run_id = ?
         AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')
       ORDER BY seq`,
    )
    .bind(runId)
    .all<PersistedTerminalAuthorityRow>();

  if (results.length > 1) {
    throw new Error(`Session run ${runId} has conflicting durable terminal events.`);
  }

  return results[0] ?? null;
}

const PERSISTED_TERMINAL_EVENT_KEYS = [
  "artifact_attempt_id",
  "artifact_manifest_json",
  "artifact_manifest_sha256",
  "created_at",
  "ended_at",
  "event_type",
  "family",
  "id",
  "occurred_at",
  "process_status",
  "process_type",
  "run_id",
  "semantic_hash",
  "terminal_event_json",
  "seq",
  "session_id",
  "source",
  "source_event_id",
  "stream_id",
  "tool_call_id",
  "tool_input_json",
  "tool_name",
  "tokens",
  "trace_id",
  "visibility",
] as const satisfies readonly (keyof PersistedTerminalEventRow)[];

const PERSISTED_TERMINAL_AUTHORITY_KEYS = [
  ...PERSISTED_TERMINAL_EVENT_KEYS,
  "agent_id",
  "content_text",
  "mcp_command_id",
  "tool_input_delta_json",
  "tool_output_delta_text",
  "tool_output_text",
  "tool_parent_message_id",
  "tool_result_message_id",
  "tool_status",
] as const satisfies readonly (keyof PersistedTerminalAuthorityRow)[];

function hasSameTerminalAuthority(
  left: PersistedTerminalAuthorityRow,
  right: PersistedTerminalAuthorityRow,
): boolean {
  return PERSISTED_TERMINAL_AUTHORITY_KEYS.every((key) => left[key] === right[key]);
}

function assertSnapshotTerminalAuthority(
  snapshot: CompletionSnapshot,
  expected: PersistedTerminalAuthorityRow,
  runId: SessionRunId,
): void {
  const [actual] = snapshot.terminalEvents;
  if (
    snapshot.terminalEvents.length !== 1 ||
    actual === undefined ||
    PERSISTED_TERMINAL_EVENT_KEYS.some((key) => actual[key] !== expected[key])
  ) {
    throw new Error(`Session run ${runId} terminal authority changed during adoption.`);
  }
}

async function assertDurableTerminalAuthority(
  database: D1Database,
  expected: PersistedTerminalAuthorityRow,
  runId: SessionRunId,
): Promise<void> {
  const actual = await readTerminalAuthorityReceipt(database, runId);
  if (actual === null || !hasSameTerminalAuthority(actual, expected)) {
    throw new Error(`Session run ${runId} terminal authority changed during adoption.`);
  }
}

async function readCompletionSnapshot(
  database: D1Database,
  input: {
    finalMessageId: string | null;
    runId: SessionRunId;
    sessionId: SessionId;
    sourceEventId: string;
  },
): Promise<CompletionSnapshot> {
  const [state, assistantMessages, terminalEvents] = await Promise.all([
    database
      .prepare(
        `SELECT
           s.archived_at,
           s.cleanup_operation_kind,
           r.completed_at,
           r.created_at,
           r.created_by_account_id AS run_created_by_account_id,
           r.error_code,
           r.error_details_json,
           r.error_message,
           r.error_retryable,
           driver.connection_id AS driver_connection_id,
           driver.generation AS driver_generation,
           driver.last_heartbeat_at AS driver_last_heartbeat_at,
           driver.status AS driver_status,
           driver.status_operation_id AS driver_status_operation_id,
           driver.updated_at AS driver_updated_at,
           s.last_run_id,
           s.message_seq_cursor,
           (
             SELECT json_object('occurredAt', output.occurred_at, 'seq', output.seq)
             FROM session_event AS output
             WHERE output.session_id = s.id
               AND output.run_id = r.id
               AND output.event_type = 'tool.call.updated'
               AND output.visibility = 'all_consumers'
               AND output.tool_call_id IS NOT NULL
               AND output.seq < COALESCE(
                 (
                   SELECT terminal.seq
                   FROM session_event AS terminal
                   WHERE terminal.session_id = s.id
                     AND terminal.run_id = r.id
                     AND terminal.event_type IN ('run.cancelled', 'run.completed', 'run.failed')
                   ORDER BY terminal.seq
                   LIMIT 1
                 ),
                 s.runtime_event_seq_cursor + 1
               )
               AND (
                 (
                   output.tool_parent_message_id IS NOT NULL
                   AND (? IS NULL OR output.tool_parent_message_id <> ?)
                 )
                 OR (
                   (
                     output.tool_output_delta_text IS NOT NULL
                     OR output.tool_output_text IS NOT NULL
                   )
                   AND NOT EXISTS (
                     SELECT 1
                     FROM session_event AS identity
                     WHERE identity.session_id = output.session_id
                       AND identity.run_id = output.run_id
                       AND identity.event_type = 'tool.call.updated'
                       AND identity.visibility = 'all_consumers'
                       AND identity.tool_call_id = output.tool_call_id
                       AND identity.tool_parent_message_id IS NOT NULL
                       AND identity.seq <= output.seq
                   )
                 )
               )
             ORDER BY output.seq
             LIMIT 1
           ) AS tool_carrier_anchor_json,
           (
             SELECT COUNT(*)
             FROM session_permission_request AS permission
             WHERE permission.session_id = r.session_id AND permission.run_id = r.id
           ) AS permission_request_count,
           r.status AS run_status,
           r.status_operation_id AS run_status_operation_id,
           r.status_seq AS run_status_seq,
           r.status_source AS run_status_source,
           r.trace_id AS run_trace_id,
           r.updated_at AS run_updated_at,
           r.driver_instance_id AS run_driver_instance_id,
           (
             SELECT COUNT(*)
             FROM session_model_call AS model_call
             WHERE model_call.session_id = r.session_id
               AND model_call.session_run_id = r.id
               AND (
                 model_call.completed_at IS NULL
                 OR model_call.status <> CASE
                   WHEN r.status = 'completed' THEN 'completed'
                   ELSE 'failed'
                 END
               )
           ) AS unfinalized_model_call_count,
           s.runtime_event_seq_cursor,
           s.kind AS session_kind,
           s.status AS session_status,
           s.status_operation_id AS session_status_operation_id,
           s.status_seq AS session_status_seq,
           s.updated_at AS session_updated_at,
           r.started_at,
           (
             SELECT json_object('occurredAt', message.occurred_at, 'seq', message.seq)
             FROM session_event AS message
             WHERE ? IS NOT NULL
               AND message.session_id = s.id
               AND message.run_id = r.id
               AND message.stream_id = ?
               AND message.process_type = 'agent.message.delta'
               AND message.visibility = 'all_consumers'
               AND message.event_type = 'message.added'
               AND message.seq < COALESCE(
                 (
                   SELECT terminal.seq
                   FROM session_event AS terminal
                   WHERE terminal.session_id = s.id
                     AND terminal.run_id = r.id
                     AND terminal.event_type IN ('run.cancelled', 'run.completed', 'run.failed')
                   ORDER BY terminal.seq
                   LIMIT 1
                 ),
                 s.runtime_event_seq_cursor + 1
               )
             ORDER BY message.seq DESC
             LIMIT 1
           ) AS final_message_artifact_json
         FROM session_run AS r
         INNER JOIN session AS s ON s.id = r.session_id
         LEFT JOIN driver_instance AS driver ON driver.id = r.driver_instance_id
         WHERE r.id = ? AND r.session_id = ?
         LIMIT 1`,
      )
      .bind(
        input.finalMessageId,
        input.finalMessageId,
        input.finalMessageId,
        input.finalMessageId,
        input.runId,
        input.sessionId,
      )
      .first<CompletionStateRow>(),
    database
      .prepare(
        `SELECT content_text, created_at, created_by_account_id, id, plan_json, projection_format,
                segments_json, seq, session_id, session_run_id
         FROM session_message
         WHERE session_run_id = ? AND role = 'assistant'
         ORDER BY seq`,
      )
      .bind(input.runId)
      .all<PersistedAssistantMessageRow>(),
    database
      .prepare(
        `SELECT artifact_attempt_id, artifact_manifest_json, artifact_manifest_sha256,
                created_at, ended_at, event_type, family, id, occurred_at,
                process_status, process_type, run_id, semantic_hash, terminal_event_json, seq,
                session_id, source, source_event_id, stream_id, tool_call_id, tool_input_json,
                tool_name, tokens, trace_id, visibility
         FROM session_event
         WHERE session_id = ?
           AND (
             source_event_id = ?
             OR (run_id = ? AND event_type IN ('run.cancelled', 'run.completed', 'run.failed'))
           )
         ORDER BY seq`,
      )
      .bind(input.sessionId, input.sourceEventId, input.runId)
      .all<PersistedTerminalEventRow>(),
  ]);

  return {
    assistantMessages: assistantMessages.results,
    state,
    terminalEvents: terminalEvents.results,
  };
}

function parseTranscriptAnchor(value: string | null, label: string): TranscriptAnchor | null {
  if (value === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("occurredAt" in parsed) ||
    typeof parsed.occurredAt !== "number" ||
    !("seq" in parsed) ||
    typeof parsed.seq !== "number"
  ) {
    throw new Error(`Canonical ${label} transcript anchor is invalid.`);
  }
  return { occurredAt: parsed.occurredAt, seq: parsed.seq };
}

function prepareTerminalAssistantMessages(
  snapshot: CompletionSnapshot,
  input: {
    finalMessage: PreparedAssistantMessageProjection | null;
    runId: SessionRunId;
    sessionId: SessionId;
  },
): PreparedTerminalAssistantMessage[] {
  const { state } = snapshot;
  if (state === null) {
    return [];
  }
  const finalArtifact = parseTranscriptAnchor(state.final_message_artifact_json, "final message");
  const toolArtifact = parseTranscriptAnchor(state.tool_carrier_anchor_json, "tool carrier");

  if (input.finalMessage !== null && finalArtifact === null) {
    throw new Error(
      `Canonical final assistant ${input.finalMessage.id} has no pre-terminal message stream.`,
    );
  }

  const final =
    input.finalMessage === null || finalArtifact === null
      ? null
      : {
          createdAt: finalArtifact.occurredAt,
          firstEventSeq: finalArtifact.seq,
          message: input.finalMessage,
        };
  const carrier =
    toolArtifact === null
      ? null
      : {
          createdAt: toolArtifact.occurredAt,
          firstEventSeq: toolArtifact.seq,
          message: prepareToolCarrierProjection({
            createdByAccountId: state.run_created_by_account_id,
            sessionId: input.sessionId,
            sessionRunId: input.runId,
          }),
        };

  if (final !== null && carrier !== null && final.message.id === carrier.message.id) {
    return [
      final.firstEventSeq <= carrier.firstEventSeq
        ? final
        : {
            ...final,
            createdAt: carrier.createdAt,
            firstEventSeq: carrier.firstEventSeq,
          },
    ];
  }

  return [final, carrier]
    .filter((message): message is PreparedTerminalAssistantMessage => message !== null)
    .toSorted((left, right) => left.firstEventSeq - right.firstEventSeq);
}

function isCanonicalAssistantMessage(
  row: PersistedAssistantMessageRow,
  expected: PreparedTerminalAssistantMessage,
): boolean {
  return (
    row.content_text === expected.message.contentText &&
    row.created_at === expected.createdAt &&
    row.created_by_account_id === expected.message.createdByAccountId &&
    row.id === expected.message.id &&
    row.plan_json === expected.message.planJson &&
    row.projection_format === expected.message.projectionFormat &&
    row.segments_json === expected.message.segmentsJson &&
    row.session_id === expected.message.sessionId &&
    row.session_run_id === expected.message.sessionRunId
  );
}

function assertCanonicalAssistantMessages(
  rows: readonly PersistedAssistantMessageRow[],
  expected: readonly PreparedTerminalAssistantMessage[],
  runId: SessionRunId,
): void {
  if (
    rows.length === expected.length &&
    rows.every((row, index) => {
      const message = expected[index];
      return message !== undefined && isCanonicalAssistantMessage(row, message);
    })
  ) {
    return;
  }

  throw new Error(
    `Canonical assistant messages conflict with the persisted projection for run ${runId}.`,
  );
}

function assertRepairableAssistantMessages(
  rows: readonly PersistedAssistantMessageRow[],
  expected: readonly PreparedTerminalAssistantMessage[],
  runId: SessionRunId,
): void {
  if (
    rows.length <= expected.length &&
    rows.every((row, index) => {
      const message = expected[index];
      return message !== undefined && isCanonicalAssistantMessage(row, message);
    })
  ) {
    return;
  }

  throw new Error(`Canonical assistant messages are not safely repairable for run ${runId}.`);
}

function assertCanonicalTerminalRunError(
  state: CompletionStateRow,
  expected: RunError | null,
  runId: SessionRunId,
): void {
  const expectedDetails =
    expected === null ? null : stringifyRuntimeEventSemanticValue(expected.details);
  const persistedDetails =
    state.error_details_json === null
      ? null
      : stringifyRuntimeEventSemanticValue(JSON.parse(state.error_details_json));

  if (
    state.error_code !== (expected?.code ?? null) ||
    persistedDetails !== expectedDetails ||
    state.error_message !== (expected?.message ?? null) ||
    state.error_retryable !== (expected === null ? null : Number(expected.retryable))
  ) {
    throw new Error(`Canonical terminal error conflicts with the persisted run ${runId}.`);
  }
}

function assertCanonicalTerminalEvent(
  rows: readonly PersistedTerminalEventRow[],
  expected: {
    eventType: ReturnType<typeof terminalEventKind>;
    runId: SessionRunId;
    sourceEventId: string;
    semanticHash: string;
  },
): PersistedTerminalEventRow {
  const [row] = rows;

  if (
    rows.length !== 1 ||
    row === undefined ||
    row.event_type !== expected.eventType ||
    row.run_id !== expected.runId ||
    row.semantic_hash !== expected.semanticHash ||
    row.source_event_id !== expected.sourceEventId
  ) {
    throw new Error(
      `Canonical ${expected.eventType} receipt conflicts with the persisted projection for run ${expected.runId}.`,
    );
  }

  return row;
}

function readRunDurationMs(state: CompletionStateRow): number | null {
  if (state.completed_at === null) {
    return null;
  }

  return Math.max(0, state.completed_at - (state.started_at ?? state.created_at));
}

function projectedSessionOperationId(
  state: CompletionStateRow,
  sessionStatus: PreparedTerminalEvent["sessionStatus"],
): string | null {
  return sessionStatus === "IDLE" ? state.session_status_operation_id : null;
}

function isLegacyTerminalProjection(snapshot: CompletionSnapshot): boolean {
  return snapshot.terminalEvents.length === 1 && snapshot.terminalEvents[0]?.semantic_hash === null;
}

function assertLegacyAssistantMessages(
  rows: readonly PersistedAssistantMessageRow[],
  expected: readonly PreparedTerminalAssistantMessage[],
  runId: SessionRunId,
  sessionId: SessionId,
): void {
  const materialized = rows.filter((row) => row.projection_format === "materialized");
  const carriers = rows.filter((row) => row.projection_format === "event_stream_v3");
  const expectedCarrier = expected.find(({ message }) => String(message.id) === String(runId));
  if (
    materialized.length > 1 ||
    carriers.length > 1 ||
    materialized.length + carriers.length !== rows.length ||
    rows.some((row) => row.session_id !== sessionId || row.session_run_id !== runId) ||
    carriers.some(
      (row) =>
        expectedCarrier === undefined ||
        row.id !== runId ||
        !isCanonicalAssistantMessage(row, expectedCarrier),
    )
  ) {
    throw new Error(`Legacy terminal assistant messages conflict with run ${runId}.`);
  }
}

function staleTerminalResult(state: CompletionStateRow): CompletedRunCommitResult {
  return {
    currentStatus: state.run_status,
    kind: "stale",
    persistedSourceEventIds: [],
    runDurationMs: null,
  };
}

function hasSafelyRepairableStaleSessionProjection(
  state: CompletionStateRow,
  input: { runId: SessionRunId },
): boolean {
  return (
    state.archived_at === null &&
    state.cleanup_operation_kind === null &&
    state.last_run_id === input.runId &&
    state.session_status === "RUNNING" &&
    state.session_status_operation_id === null &&
    state.session_updated_at <= state.run_updated_at
  );
}

function explicitRunViewMatchesFreshState(
  state: CompletionStateRow,
  input: {
    createdAt: number;
    error: RunError | null;
    explicitRunView: RuntimeRunView | null;
    runId: SessionRunId;
    targetStatus: HostTerminalRunStatus;
  },
): boolean {
  const run = input.explicitRunView;
  if (run === null) {
    return true;
  }

  return (
    run.completedAt === toIsoString(state.completed_at ?? input.createdAt) &&
    run.id === input.runId &&
    run.startedAt === toIsoString(state.started_at ?? input.createdAt) &&
    run.status === input.targetStatus &&
    run.traceId === state.run_trace_id &&
    stringifyRuntimeEventSemanticValue(run.error) ===
      stringifyRuntimeEventSemanticValue(input.error)
  );
}

function classifyTerminalSnapshot(
  snapshot: CompletionSnapshot,
  input: {
    assistantMessage: PreparedAssistantMessageProjection | null;
    assistantMessages: readonly PreparedTerminalAssistantMessage[];
    createdAt: number;
    error: RunError | null;
    explicitRunView: RuntimeRunView | null;
    expectedDriverObservation?: ExpectedTerminalDriverObservation;
    expectedRunStatus?: SessionRunStatus;
    expectedSessionObservation?: ExpectedTerminalSessionObservation;
    expectedSessionOperationId?: RuntimeOperationId | null;
    eventId: RuntimeEventId;
    runId: SessionRunId;
    runStatusOperationId: RuntimeOperationId | null;
    semanticHash: string;
    sessionId: SessionId;
    sessionStatus: PreparedTerminalEvent["sessionStatus"];
    sourceEventId: string;
    source: TerminalRunProjectionSource;
    targetStatus: HostTerminalRunStatus;
  },
): CompletedRunCommitResult | null {
  const { state } = snapshot;

  if (state === null) {
    throw new Error(`Session run ${input.runId} was not found for atomic completion.`);
  }
  const terminalDriverRelease = readAtomicTerminalDriverReleaseObservation(
    input.expectedDriverObservation,
  );
  if (state.run_status === input.targetStatus) {
    if (
      input.expectedDriverObservation !== undefined &&
      !expectedDriverObservationMatchesState(state, input.expectedDriverObservation)
    ) {
      return staleTerminalResult(state);
    }
    if (
      terminalDriverRelease !== null &&
      state.driver_status_operation_id !== null &&
      state.driver_status_operation_id !== input.runId &&
      state.driver_status !== "stopping"
    ) {
      return staleTerminalResult(state);
    }
    if (isLegacyTerminalProjection(snapshot)) {
      if (input.assistantMessage !== null) {
        throw new Error(
          "A legacy materialized terminal run cannot adopt an event-stream reference.",
        );
      }
      assertLegacyAssistantMessages(
        snapshot.assistantMessages,
        input.assistantMessages,
        input.runId,
        input.sessionId,
      );
      assertCanonicalTerminalRunError(state, input.error, input.runId);
      const [legacyEvent] = snapshot.terminalEvents;
      if (
        legacyEvent === undefined ||
        legacyEvent.event_type !== terminalEventKind(input.targetStatus) ||
        legacyEvent.run_id !== input.runId ||
        legacyEvent.source_event_id !==
          createSessionRunTerminalSourceId(input.runId, terminalEventKind(input.targetStatus))
      ) {
        throw new Error(`Legacy terminal projection conflicts with run ${input.runId}.`);
      }
      const cursorCovered =
        legacyEvent.seq <= state.runtime_event_seq_cursor &&
        snapshot.assistantMessages.every((message) => message.seq <= state.message_seq_cursor);
      if (
        cursorCovered &&
        state.permission_request_count === 0 &&
        state.unfinalized_model_call_count === 0
      ) {
        return {
          kind: "duplicate",
          persistedSourceEventIds: [],
          runDurationMs: readRunDurationMs(state),
        };
      }
      if (
        state.archived_at !== null ||
        state.last_run_id !== input.runId ||
        state.session_status_operation_id !== null ||
        (state.session_status !== "IDLE" && state.session_status !== "TERMINATED")
      ) {
        throw new Error(
          `Legacy terminal projection for run ${input.runId} is not safely repairable.`,
        );
      }
      return null;
    }
    if (
      state.run_status_operation_id !== input.runStatusOperationId ||
      state.run_status_source !== input.source
    ) {
      return staleTerminalResult(state);
    }
    if (!explicitRunViewMatchesFreshState(state, input)) {
      return staleTerminalResult(state);
    }
    assertCanonicalTerminalRunError(state, input.error, input.runId);
    assertRepairableAssistantMessages(
      snapshot.assistantMessages,
      input.assistantMessages,
      input.runId,
    );

    if (snapshot.terminalEvents.length === 0) {
      if (
        state.archived_at !== null ||
        state.last_run_id !== input.runId ||
        (state.session_status !== "RUNNING" && state.session_status !== input.sessionStatus) ||
        state.session_status_operation_id !== null ||
        state.session_updated_at > state.run_updated_at
      ) {
        throw new Error(
          `Missing terminal projection for run ${input.runId} is not safely repairable.`,
        );
      }
      return null;
    }

    const hasMissingAssistantMessages =
      snapshot.assistantMessages.length < input.assistantMessages.length;
    if (!hasMissingAssistantMessages) {
      assertCanonicalAssistantMessages(
        snapshot.assistantMessages,
        input.assistantMessages,
        input.runId,
      );
    }
    const terminalEvent = assertCanonicalTerminalEvent(snapshot.terminalEvents, {
      ...input,
      eventType: terminalEventKind(input.targetStatus),
      semanticHash: input.semanticHash,
    });
    if (terminalEvent.seq > state.runtime_event_seq_cursor) {
      throw new Error(
        `Canonical terminal event is ahead of the Session cursor for run ${input.runId}.`,
      );
    }
    if (
      hasMissingAssistantMessages ||
      snapshot.assistantMessages.some((message) => message.seq > state.message_seq_cursor) ||
      state.permission_request_count !== 0
    ) {
      return null;
    }

    if (state.unfinalized_model_call_count > 0) {
      return null;
    }

    if (hasSafelyRepairableStaleSessionProjection(state, input)) {
      return null;
    }

    return {
      kind: terminalEvent.id === input.eventId ? "applied" : "duplicate",
      persistedSourceEventIds: terminalEvent.id === input.eventId ? [input.sourceEventId] : [],
      runDurationMs: readRunDurationMs(state),
    };
  }

  if (["cancelled", "completed", "expired", "failed"].includes(state.run_status)) {
    return staleTerminalResult(state);
  }

  if (input.expectedRunStatus !== undefined && state.run_status !== input.expectedRunStatus) {
    return staleTerminalResult(state);
  }
  if (
    input.expectedSessionObservation !== undefined &&
    (state.last_run_id !== input.expectedSessionObservation.lastRunId ||
      state.session_status !== input.expectedSessionObservation.status ||
      state.session_status_seq !== input.expectedSessionObservation.statusSeq ||
      state.session_updated_at !== input.expectedSessionObservation.updatedAt)
  ) {
    return staleTerminalResult(state);
  }
  if (
    input.expectedDriverObservation !== undefined &&
    (!expectedDriverObservationMatchesState(state, input.expectedDriverObservation) ||
      (terminalDriverRelease !== null &&
        state.driver_status_operation_id !== null &&
        state.driver_status !== "stopping"))
  ) {
    return staleTerminalResult(state);
  }

  if (
    input.expectedSessionOperationId !== undefined &&
    state.session_status_operation_id !== input.expectedSessionOperationId
  ) {
    return staleTerminalResult(state);
  }
  if (!explicitRunViewMatchesFreshState(state, input)) {
    return staleTerminalResult(state);
  }

  return null;
}

async function prepareTerminalEvent(
  record: SessionRuntimeEventInput,
  input: {
    assistantMessage: PreparedAssistantMessageProjection | null;
    error: RunError | null;
    runId: SessionRunId;
    sessionId: SessionId;
    targetStatus: HostTerminalRunStatus;
    timestampMs?: number;
  },
): Promise<PreparedTerminalEvent> {
  const expectedKind = terminalEventKind(input.targetStatus);
  const expectedSourceEventId = createSessionRunTerminalSourceId(input.runId, expectedKind);

  if (
    record.event.kind !== expectedKind ||
    record.event.runId !== input.runId ||
    record.event.sessionId !== input.sessionId ||
    record.sourceEventId !== expectedSourceEventId ||
    record.event.sourceEventId !== expectedSourceEventId
  ) {
    throw new Error(
      `Atomic run terminal projection requires one exact canonical ${expectedKind} identity.`,
    );
  }

  const eventPayload = readRuntimeEventPayload(record.event);
  const runtimeRunPayload = readRuntimeRunPayload(record.event);
  const runPayload = runtimeRunPayload.run;
  if (
    runPayload === null ||
    runPayload.id !== input.runId ||
    runPayload.status !== input.targetStatus
  ) {
    throw new Error(`Atomic ${expectedKind} payload does not match its terminal run identity.`);
  }
  if (runtimeRunPayload.lifecycle !== "IDLE" && runtimeRunPayload.lifecycle !== "TERMINATED") {
    throw new Error(`Atomic ${expectedKind} projection requires a terminal Session lifecycle.`);
  }
  if (input.targetStatus === "failed") {
    if (input.error === null || runPayload.error === null) {
      throw new Error("Atomic run.failed projection requires one exact RunError.");
    }
    if (
      runPayload.error.code !== input.error.code ||
      stringifyRuntimeEventSemanticValue(runPayload.error.details) !==
        stringifyRuntimeEventSemanticValue(input.error.details) ||
      runPayload.error.message !== input.error.message ||
      runPayload.error.retryable !== input.error.retryable
    ) {
      throw new Error("Atomic run.failed payload conflicts with its persisted RunError.");
    }
  } else if (input.targetStatus === "completed") {
    if (input.error !== null || runPayload.error !== null) {
      throw new Error(`Atomic ${expectedKind} projection cannot persist a RunError.`);
    }
  } else if ((input.error === null) !== (runPayload.error === null)) {
    throw new Error(`Atomic ${expectedKind} RunError must be present together.`);
  } else if (
    input.error !== null &&
    runPayload.error !== null &&
    (runPayload.error.code !== input.error.code ||
      stringifyRuntimeEventSemanticValue(runPayload.error.details) !==
        stringifyRuntimeEventSemanticValue(input.error.details) ||
      runPayload.error.message !== input.error.message ||
      runPayload.error.retryable !== input.error.retryable)
  ) {
    throw new Error(`Atomic ${expectedKind} projection cannot persist a RunError.`);
  }

  const finalMessageId = readRuntimeEventString(eventPayload, "finalMessageId");
  if (
    input.targetStatus === "completed" &&
    (finalMessageId === null) !== (input.assistantMessage === null)
  ) {
    throw new Error("run.completed final message identity and reference must be present together.");
  }
  if (input.assistantMessage !== null) {
    if (
      input.targetStatus !== "completed" ||
      input.assistantMessage.sessionId !== input.sessionId ||
      input.assistantMessage.sessionRunId !== input.runId ||
      input.assistantMessage.id !== finalMessageId
    ) {
      throw new Error("Atomic final assistant reference conflicts with run.completed.");
    }
  }

  const timestampMs = input.timestampMs ?? currentTimestampMs();
  const occurredAt = record.occurredAt ?? timestampMs;
  const parsedEndedAt = Date.parse(record.event.occurredAt);
  const projection = createSessionRuntimeEventProjection(record.event);
  const artifactAttemptId = record.artifactAttemptId ?? null;
  const artifactManifestJson = record.artifactManifestJson ?? null;
  const artifactManifestSha256 = record.artifactManifestSha256 ?? null;
  if (
    (artifactAttemptId === null) !== (artifactManifestJson === null) ||
    (artifactAttemptId === null) !== (artifactManifestSha256 === null) ||
    (artifactAttemptId !== null && expectedKind !== "run.completed")
  ) {
    throw new Error("Atomic terminal artifact projection is incomplete or out of scope.");
  }

  if (
    projection.eventType !== expectedKind ||
    projection.runId !== input.runId ||
    projection.visibility !== "all_consumers"
  ) {
    throw new Error("Atomic run terminal event projection is not public and run-scoped.");
  }

  return {
    artifactAttemptId,
    artifactManifestJson,
    artifactManifestSha256,
    contentText: projection.contentText,
    createdAt: timestampMs,
    endedAt:
      Number.isFinite(parsedEndedAt) && parsedEndedAt >= occurredAt ? parsedEndedAt : occurredAt,
    eventType: projection.eventType,
    explicitRunView: Object.hasOwn(eventPayload, "run") ? runPayload : null,
    family: projection.family,
    id: createPlatformId<RuntimeEventId>(),
    occurredAt,
    processStatus: projection.processStatus,
    processType: projection.processType,
    semanticHash: await createRuntimeEventSemanticHash(record.event),
    terminalEventJson: stringifyRuntimeEventSemanticValue(record.event),
    sessionStatus: runtimeRunPayload.lifecycle,
    source: projection.source,
    sourceEventId: expectedSourceEventId,
    streamId: projection.streamId,
    toolCallId: projection.toolCallId,
    toolInputJson: projection.toolInputJson,
    toolName: projection.toolName,
    tokens: projection.tokens,
    traceId: projection.traceId,
    visibility: projection.visibility,
  };
}

function prepareTerminalEventInsert(
  database: D1Database,
  input: {
    assistantMessageCount: number;
    expectedDriverObservation?: ExpectedTerminalDriverObservation;
    event: PreparedTerminalEvent;
    runId: SessionRunId;
    sessionId: SessionId;
    state: CompletionStateRow;
  },
): D1PreparedStatement {
  const { event, state } = input;

  return database
    .prepare(
      `/* completed-run:event */
       INSERT INTO session_event (
         agent_id, artifact_attempt_id, artifact_manifest_json, artifact_manifest_sha256,
         content_text, created_at, ended_at, event_type, family, id,
         occurred_at, process_status, process_type, run_id, semantic_hash, terminal_event_json,
         seq, session_id, source_event_id, source, stream_id, tool_call_id, tool_input_json,
         tool_name, tokens, trace_id, visibility
       )
       SELECT
         s.agent_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, r.id, ?, ?,
         s.runtime_event_seq_cursor + 1, s.id, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM session AS s
       INNER JOIN session_run AS r ON r.session_id = s.id
       WHERE s.id = ?
         AND r.id = ?
         AND r.status = ?
         AND r.status_seq = ?
         AND r.status_operation_id IS ?
         AND r.status_source = ?
         AND (? = 0 OR r.driver_instance_id IS ?)
         AND (
           ? = 0 OR (
             SELECT driver.connection_id FROM driver_instance AS driver
             WHERE driver.id = r.driver_instance_id
           ) IS ?
         )
         AND (
           ? = 0 OR (
             SELECT driver.generation FROM driver_instance AS driver
             WHERE driver.id = r.driver_instance_id
           ) IS ?
         )
         AND (
           ? = 0 OR (
             SELECT driver.status FROM driver_instance AS driver
             WHERE driver.id = r.driver_instance_id
           ) IS ?
         )
         AND (
           ? = 0 OR (
             SELECT driver.updated_at FROM driver_instance AS driver
             WHERE driver.id = r.driver_instance_id
           ) IS ?
         )
         AND (
           ? = 0 OR (
             SELECT driver.last_heartbeat_at FROM driver_instance AS driver
             WHERE driver.id = r.driver_instance_id
           ) IS ?
         )
         AND s.archived_at IS ?
         AND s.cleanup_operation_kind IS ?
         AND s.last_run_id IS ?
         AND s.status = ?
         AND s.status_operation_id IS ?
         AND s.status_seq = ?
         AND s.updated_at = ?
         AND s.message_seq_cursor = ?
         AND s.runtime_event_seq_cursor = ?
         AND (
           SELECT COUNT(*)
           FROM session_message AS m
           WHERE m.session_run_id = r.id AND m.role = 'assistant'
         ) = ?
         AND NOT EXISTS (
           SELECT 1
           FROM session_event AS existing
           WHERE existing.session_id = s.id
             AND (
               existing.source_event_id = ?
               OR (
                 existing.run_id = r.id
                 AND existing.event_type IN ('run.cancelled', 'run.completed', 'run.failed')
               )
             )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM driver_command AS command
           WHERE command.kind = 'mcp.execute'
             AND command.status = 'accepted'
             AND json_extract(command.payload_json, '$.runId') = r.id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM external_tool_effect AS effect
           INNER JOIN driver_command AS command ON command.id = effect.command_id
           WHERE effect.session_run_id = r.id
             AND effect.status IN ('claimed', 'succeeded', 'unknown')
             AND command.status IN ('queued', 'delivered', 'accepted')
         )`,
    )
    .bind(
      event.artifactAttemptId,
      event.artifactManifestJson,
      event.artifactManifestSha256,
      event.contentText,
      event.createdAt,
      event.endedAt,
      event.eventType,
      event.family,
      event.id,
      event.occurredAt,
      event.processStatus,
      event.processType,
      event.semanticHash,
      event.terminalEventJson,
      event.sourceEventId,
      event.source,
      event.streamId,
      event.toolCallId,
      event.toolInputJson,
      event.toolName,
      event.tokens,
      event.traceId,
      event.visibility,
      input.sessionId,
      input.runId,
      state.run_status,
      state.run_status_seq,
      state.run_status_operation_id,
      state.run_status_source,
      Number(input.expectedDriverObservation !== undefined),
      input.expectedDriverObservation?.driverInstanceId ?? null,
      Number(input.expectedDriverObservation?.connectionId !== undefined),
      input.expectedDriverObservation?.connectionId ?? null,
      Number(input.expectedDriverObservation?.generation !== undefined),
      input.expectedDriverObservation?.generation ?? null,
      Number(input.expectedDriverObservation?.status !== undefined),
      input.expectedDriverObservation?.status ?? null,
      Number(input.expectedDriverObservation?.updatedAt !== undefined),
      input.expectedDriverObservation?.updatedAt ?? null,
      Number(input.expectedDriverObservation?.lastHeartbeatAt !== undefined),
      input.expectedDriverObservation?.lastHeartbeatAt ?? null,
      state.archived_at,
      state.cleanup_operation_kind,
      state.last_run_id,
      state.session_status,
      state.session_status_operation_id,
      state.session_status_seq,
      state.session_updated_at,
      state.message_seq_cursor,
      state.runtime_event_seq_cursor,
      input.assistantMessageCount,
      event.sourceEventId,
    );
}

function prepareTerminalEventAdoptionFence(
  database: D1Database,
  row: PersistedTerminalAuthorityRow,
): D1PreparedStatement {
  return database
    .prepare(
      `/* completed-run:adopt-event */
       INSERT INTO session_event (id)
       SELECT ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM session_event
         WHERE id = ?
           AND agent_id = ?
           AND artifact_attempt_id IS ?
           AND artifact_manifest_json IS ?
           AND artifact_manifest_sha256 IS ?
           AND content_text = ?
           AND created_at = ?
           AND ended_at IS ?
           AND event_type = ?
           AND family = ?
           AND mcp_command_id IS ?
           AND occurred_at = ?
           AND process_status = ?
           AND process_type = ?
           AND run_id IS ?
           AND semantic_hash IS ?
           AND terminal_event_json IS ?
           AND seq = ?
           AND session_id = ?
           AND source = ?
           AND source_event_id = ?
           AND stream_id IS ?
           AND tool_call_id IS ?
           AND tool_input_delta_json IS ?
           AND tool_input_json IS ?
           AND tool_name IS ?
           AND tool_output_delta_text IS ?
           AND tool_output_text IS ?
           AND tool_parent_message_id IS ?
           AND tool_result_message_id IS ?
           AND tool_status IS ?
           AND tokens IS ?
           AND trace_id IS ?
           AND visibility = ?
       )`,
    )
    .bind(
      row.id,
      row.id,
      row.agent_id,
      row.artifact_attempt_id,
      row.artifact_manifest_json,
      row.artifact_manifest_sha256,
      row.content_text,
      row.created_at,
      row.ended_at,
      row.event_type,
      row.family,
      row.mcp_command_id,
      row.occurred_at,
      row.process_status,
      row.process_type,
      row.run_id,
      row.semantic_hash,
      row.terminal_event_json,
      row.seq,
      row.session_id,
      row.source,
      row.source_event_id,
      row.stream_id,
      row.tool_call_id,
      row.tool_input_delta_json,
      row.tool_input_json,
      row.tool_name,
      row.tool_output_delta_text,
      row.tool_output_text,
      row.tool_parent_message_id,
      row.tool_result_message_id,
      row.tool_status,
      row.tokens,
      row.trace_id,
      row.visibility,
    );
}

function prepareAssistantMessageInsert(
  database: D1Database,
  input: {
    eventId: RuntimeEventId;
    message: PreparedTerminalAssistantMessage;
    seqOffset: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `/* completed-run:message */
       INSERT INTO session_message (
         content_text, created_at, created_by_account_id, id, plan_json, role,
         projection_format, segments_json, seq, session_id, session_run_id
       )
       SELECT ?, ?, ?, ?, ?, 'assistant', ?, ?, s.message_seq_cursor + ?, s.id, ?
       FROM session AS s
       INNER JOIN session_event AS terminal
         ON terminal.session_id = s.id AND terminal.id = ?
       WHERE s.id = ?
         AND terminal.event_type IN ('run.cancelled', 'run.completed', 'run.failed')`,
    )
    .bind(
      input.message.message.contentText,
      input.message.createdAt,
      input.message.message.createdByAccountId,
      input.message.message.id,
      input.message.message.planJson,
      input.message.message.projectionFormat,
      input.message.message.segmentsJson,
      input.seqOffset,
      input.message.message.sessionRunId,
      input.eventId,
      input.message.message.sessionId,
    );
}

function prepareRunTerminalUpdate(
  database: D1Database,
  input: {
    error: RunError | null;
    eventId: RuntimeEventId;
    runId: SessionRunId;
    sessionId: SessionId;
    source: TerminalRunProjectionSource;
    statusOperationId: RuntimeOperationId | null;
    state: CompletionStateRow;
    targetStatus: HostTerminalRunStatus;
    timestampMs: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `/* completed-run:run */
       UPDATE session_run
       SET completed_at = ?,
           error_code = ?,
           error_details_json = ?,
           error_message = ?,
           error_retryable = ?,
           started_at = COALESCE(started_at, ?),
           status = ?,
           status_changed_at = ?,
           status_event = ?,
           status_operation_id = ?,
           status_seq = status_seq + 1,
           status_source = ?,
           updated_at = ?
       WHERE id = ?
         AND session_id = ?
         AND status = ?
         AND status_seq = ?
         AND EXISTS (
           SELECT 1
           FROM session_event AS terminal
           WHERE terminal.id = ?
             AND terminal.session_id = ?
             AND terminal.run_id = ?
             AND terminal.event_type = ?
         )`,
    )
    .bind(
      input.timestampMs,
      input.error?.code ?? null,
      input.error === null ? null : stringifyRuntimeEventSemanticValue(input.error.details),
      input.error?.message ?? null,
      input.error === null ? null : Number(input.error.retryable),
      input.timestampMs,
      input.targetStatus,
      input.timestampMs,
      terminalLifecycleEvent(input.targetStatus),
      input.statusOperationId,
      input.source,
      input.timestampMs,
      input.runId,
      input.sessionId,
      input.state.run_status,
      input.state.run_status_seq,
      input.eventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
    );
}

function prepareSessionModelCallsTerminalUpdate(
  database: D1Database,
  input: {
    eventId: RuntimeEventId;
    runId: SessionRunId;
    semanticHash: string | null;
    sessionId: SessionId;
    targetStatus: HostTerminalRunStatus;
    timestampMs: number;
  },
): D1PreparedStatement {
  const status = input.targetStatus === "completed" ? "completed" : "failed";

  return database
    .prepare(
      `/* completed-run:model-calls */
       UPDATE session_model_call
          SET completed_at = COALESCE(completed_at, ?),
              status = ?,
              updated_at = MAX(updated_at, ?)
        WHERE session_id = ?
          AND session_run_id = ?
          AND EXISTS (
            SELECT 1
              FROM session_event AS terminal
             WHERE terminal.id = ?
               AND terminal.session_id = ?
               AND terminal.run_id = ?
               AND terminal.event_type = ?
               AND terminal.semantic_hash IS ?
          )`,
    )
    .bind(
      input.timestampMs,
      status,
      input.timestampMs,
      input.sessionId,
      input.runId,
      input.eventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
      input.semanticHash,
    );
}

function prepareSessionTerminalUpdate(
  database: D1Database,
  input: {
    assistantMessageCount: number;
    eventId: RuntimeEventId;
    lastMessageAt: number;
    runId: SessionRunId;
    sessionId: SessionId;
    sessionOperationId: string | null;
    sessionStatus: PreparedTerminalEvent["sessionStatus"];
    state: CompletionStateRow;
    targetStatus: HostTerminalRunStatus;
    timestampMs: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `/* completed-run:session */
       UPDATE session
       SET last_message_at = CASE WHEN ? > 0 THEN ? ELSE last_message_at END,
           message_seq_cursor = message_seq_cursor + ?,
           runtime_event_seq_cursor = runtime_event_seq_cursor + 1,
           status = ?,
           status_operation_id = ?,
           status_seq = status_seq + 1,
           updated_at = MAX(updated_at, ?),
           workspace_checkpoint_required = CASE
             WHEN ? = 'completed' AND kind = 'cattle' THEN 1
             ELSE workspace_checkpoint_required
           END
       WHERE id = ?
         AND archived_at IS ?
         AND cleanup_operation_kind IS ?
         AND last_run_id = ?
         AND status = ?
         AND status_operation_id IS ?
         AND status_seq = ?
         AND updated_at = ?
         AND message_seq_cursor = ?
         AND runtime_event_seq_cursor = ?
         AND EXISTS (
           SELECT 1
           FROM session_event AS terminal
           WHERE terminal.id = ?
             AND terminal.session_id = ?
             AND terminal.run_id = ?
             AND terminal.event_type = ?
         )
         AND EXISTS (
           SELECT 1
           FROM session_run AS completed_run
           WHERE completed_run.id = ?
             AND completed_run.session_id = ?
             AND completed_run.status = ?
             AND completed_run.status_seq = ?
         )`,
    )
    .bind(
      input.assistantMessageCount,
      input.lastMessageAt,
      input.assistantMessageCount,
      input.sessionStatus,
      input.sessionOperationId,
      input.timestampMs,
      input.targetStatus,
      input.sessionId,
      input.state.archived_at,
      input.state.cleanup_operation_kind,
      input.runId,
      input.state.session_status,
      input.state.session_status_operation_id,
      input.state.session_status_seq,
      input.state.session_updated_at,
      input.state.message_seq_cursor,
      input.state.runtime_event_seq_cursor,
      input.eventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
      input.runId,
      input.sessionId,
      input.targetStatus,
      input.state.run_status_seq + 1,
    );
}

function prepareSessionTerminalRepair(
  database: D1Database,
  input: {
    eventId: RuntimeEventId;
    lastMessageAt: number;
    messageCursorIncrement: number;
    runId: SessionRunId;
    runtimeEventCursorIncrement: 0 | 1;
    sessionId: SessionId;
    sessionOperationId: string | null;
    sessionStatus: PreparedTerminalEvent["sessionStatus"];
    state: CompletionStateRow;
    targetStatus: HostTerminalRunStatus;
    timestampMs: number;
  },
): D1PreparedStatement {
  const touchLastMessage = Number(input.messageCursorIncrement > 0);

  return database
    .prepare(
      `/* completed-run:session-repair */
       UPDATE session
       SET last_message_at = CASE WHEN ? = 1 THEN ? ELSE last_message_at END,
           message_seq_cursor = message_seq_cursor + ?,
           runtime_event_seq_cursor = runtime_event_seq_cursor + ?,
           status = CASE WHEN last_run_id = ? THEN ? ELSE status END,
           status_operation_id = CASE
             WHEN last_run_id = ? THEN ?
             ELSE status_operation_id
           END,
           status_seq = status_seq + CASE
             WHEN last_run_id = ? AND (status <> ? OR status_operation_id IS NOT ?)
               THEN 1
             ELSE 0
           END,
           updated_at = MAX(updated_at, ?),
           workspace_checkpoint_required = CASE
             WHEN ? = 'completed' AND kind = 'cattle' THEN 1
             ELSE workspace_checkpoint_required
           END
       WHERE id = ?
         AND archived_at IS ?
         AND cleanup_operation_kind IS ?
         AND last_run_id IS ?
         AND status = ?
         AND status_operation_id IS ?
         AND status_seq = ?
         AND updated_at = ?
         AND message_seq_cursor = ?
         AND runtime_event_seq_cursor = ?
         AND EXISTS (
           SELECT 1
           FROM session_event AS terminal
           WHERE terminal.id = ?
             AND terminal.session_id = ?
             AND terminal.run_id = ?
             AND terminal.event_type = ?
         )
         AND EXISTS (
           SELECT 1
           FROM session_run AS terminal_run
           WHERE terminal_run.id = ?
             AND terminal_run.session_id = ?
             AND terminal_run.status = ?
             AND terminal_run.status_seq = ?
         )`,
    )
    .bind(
      touchLastMessage,
      input.lastMessageAt,
      input.messageCursorIncrement,
      input.runtimeEventCursorIncrement,
      input.runId,
      input.sessionStatus,
      input.runId,
      input.sessionOperationId,
      input.runId,
      input.sessionStatus,
      input.sessionOperationId,
      input.timestampMs,
      input.targetStatus,
      input.sessionId,
      input.state.archived_at,
      input.state.cleanup_operation_kind,
      input.state.last_run_id,
      input.state.session_status,
      input.state.session_status_operation_id,
      input.state.session_status_seq,
      input.state.session_updated_at,
      input.state.message_seq_cursor,
      input.state.runtime_event_seq_cursor,
      input.eventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
      input.runId,
      input.sessionId,
      input.targetStatus,
      input.state.run_status_seq,
    );
}

function preparePermissionRequestDelete(
  database: D1Database,
  input: {
    eventId: RuntimeEventId;
    runId: SessionRunId;
    sessionId: SessionId;
    targetStatus: HostTerminalRunStatus;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `/* completed-run:permissions */
       DELETE FROM session_permission_request
       WHERE session_id = ?
         AND run_id = ?
         AND EXISTS (
           SELECT 1
           FROM session_event AS terminal
           INNER JOIN session_run AS completed_run
             ON completed_run.id = terminal.run_id
           WHERE terminal.id = ?
             AND terminal.session_id = ?
             AND terminal.run_id = ?
             AND terminal.event_type = ?
             AND completed_run.status = ?
         )`,
    )
    .bind(
      input.sessionId,
      input.runId,
      input.eventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
      input.targetStatus,
    );
}

function prepareTerminalDriverReleaseClaim(
  database: D1Database,
  input: {
    eventId: RuntimeEventId;
    observation: AtomicTerminalDriverReleaseObservation;
    runId: SessionRunId;
    sessionId: SessionId;
    targetStatus: HostTerminalRunStatus;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `/* completed-run:driver-release-claim */
       UPDATE driver_instance
       SET status_operation_id = ?
       WHERE id = ?
         AND generation = ?
         AND connection_id IS ?
         AND status IN ('provisioning', 'connecting', 'ready', 'stopped', 'failed')
         AND status_operation_id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM session_run AS active_successor
           WHERE active_successor.driver_instance_id = driver_instance.id
             AND active_successor.id <> ?
             AND active_successor.status IN ('queued', 'booting', 'running', 'waiting_input')
         )
         AND EXISTS (
           SELECT 1
           FROM session_event AS terminal
           INNER JOIN session_run AS terminal_run
             ON terminal_run.id = terminal.run_id
            AND terminal_run.session_id = terminal.session_id
           WHERE terminal.id = ?
             AND terminal.session_id = ?
             AND terminal.run_id = ?
             AND terminal.event_type = ?
             AND terminal_run.driver_instance_id = driver_instance.id
             AND terminal_run.status = ?
         )`,
    )
    .bind(
      input.runId,
      input.observation.driverInstanceId,
      input.observation.generation,
      input.observation.connectionId,
      input.runId,
      input.eventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
      input.targetStatus,
    );
}

async function claimTerminalDriverForAdoption(
  database: D1Database,
  input: {
    fence: PersistedTerminalAuthorityRow;
    observation: AtomicTerminalDriverReleaseObservation;
    result: Extract<CompletedRunCommitResult, { kind: "applied" | "duplicate" }>;
    runId: SessionRunId;
    sessionId: SessionId;
    state: CompletionStateRow;
    targetStatus: HostTerminalRunStatus;
  },
): Promise<CompletedRunCommitResult> {
  const results = await database.batch([
    prepareTerminalEventAdoptionFence(database, input.fence),
    prepareTerminalDriverReleaseClaim(database, {
      eventId: input.fence.id,
      observation: input.observation,
      runId: input.runId,
      sessionId: input.sessionId,
      targetStatus: input.targetStatus,
    }),
  ]);

  return getD1ChangeCount(results[1]) === 1 ? input.result : staleTerminalResult(input.state);
}

function prepareTerminalCommitGuard(
  database: D1Database,
  input: {
    assistantMessages: readonly GuardedAssistantMessage[];
    driverRelease: AtomicTerminalDriverReleaseObservation | null;
    event: PreparedTerminalEvent;
    error: RunError | null;
    messageCursorIncrement: number;
    repairingExistingTerminal: boolean;
    runId: SessionRunId;
    runtimeEventCursorIncrement: 0 | 1;
    sessionId: SessionId;
    source: string;
    state: CompletionStateRow;
    statusOperationId: string | null;
    targetStatus: HostTerminalRunStatus;
    terminalEventId: RuntimeEventId;
    terminalSemanticHash: string | null;
    terminalSourceEventId: string;
  },
): D1PreparedStatement {
  const sameCurrentRun = input.state.last_run_id === input.runId;
  const repairedLifecycle =
    input.repairingExistingTerminal &&
    sameCurrentRun &&
    (input.state.session_status !== input.event.sessionStatus ||
      input.state.session_status_operation_id !==
        projectedSessionOperationId(input.state, input.event.sessionStatus));
  const expectedSessionStatus = sameCurrentRun
    ? input.event.sessionStatus
    : input.state.session_status;
  const expectedSessionOperationId = sameCurrentRun
    ? projectedSessionOperationId(input.state, input.event.sessionStatus)
    : input.state.session_status_operation_id;
  const expectedSessionStatusSeq =
    input.state.session_status_seq +
    (input.repairingExistingTerminal ? Number(repairedLifecycle) : 1);
  const expectedRunStatusSeq =
    input.state.run_status_seq + Number(!input.repairingExistingTerminal);
  const assistantMessagesJson = JSON.stringify(input.assistantMessages);
  const expectedErrorDetailsJson = input.repairingExistingTerminal
    ? input.state.error_details_json
    : input.error === null
      ? null
      : stringifyRuntimeEventSemanticValue(input.error.details);

  return database
    .prepare(
      `/* completed-run:guard */
       INSERT INTO session_event (id)
       SELECT ?
       WHERE NOT EXISTS (
         SELECT 1
         FROM session_event AS terminal
         INNER JOIN session_run AS terminal_run
           ON terminal_run.id = terminal.run_id AND terminal_run.session_id = terminal.session_id
         INNER JOIN session AS terminal_session ON terminal_session.id = terminal.session_id
         WHERE terminal.id = ?
           AND terminal.session_id = ?
           AND terminal.run_id = ?
           AND terminal.event_type = ?
           AND terminal.source_event_id = ?
           AND terminal.semantic_hash IS ?
           AND terminal_run.status = ?
           AND terminal_run.status_seq = ?
           AND terminal_run.status_operation_id IS ?
           AND terminal_run.status_source = ?
           AND terminal_run.error_code IS ?
           AND terminal_run.error_details_json IS ?
           AND terminal_run.error_message IS ?
           AND terminal_run.error_retryable IS ?
           AND terminal_session.archived_at IS ?
           AND terminal_session.cleanup_operation_kind IS ?
           AND terminal_session.last_run_id IS ?
           AND terminal_session.status = ?
           AND terminal_session.status_operation_id IS ?
           AND terminal_session.status_seq = ?
           AND terminal_session.message_seq_cursor = ?
           AND terminal_session.runtime_event_seq_cursor = ?
           AND (
             ? = 0 OR EXISTS (
               SELECT 1
               FROM driver_instance AS terminal_driver
               WHERE terminal_driver.id = ?
                 AND terminal_driver.generation = ?
                 AND terminal_driver.connection_id IS ?
                 AND terminal_driver.status_operation_id = ?
                 AND terminal_run.driver_instance_id = terminal_driver.id
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM session_permission_request AS permission
             WHERE permission.session_id = ? AND permission.run_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM session_model_call AS model_call
             WHERE model_call.session_id = ?
               AND model_call.session_run_id = ?
               AND (
                 model_call.completed_at IS NULL
                 OR model_call.status <> ?
               )
           )
           AND ? = (
             SELECT COUNT(*)
             FROM session_message AS message
             WHERE message.session_run_id = ? AND message.role = 'assistant'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM session_message AS message
             WHERE message.session_run_id = ?
               AND message.role = 'assistant'
               AND NOT EXISTS (
                 SELECT 1
                 FROM json_each(?) AS expected
                 WHERE message.id = json_extract(expected.value, '$.id')
                   AND message.session_id = json_extract(expected.value, '$.sessionId')
                   AND message.content_text = json_extract(expected.value, '$.contentText')
                   AND message.created_at = json_extract(expected.value, '$.createdAt')
                   AND message.plan_json IS json_extract(expected.value, '$.planJson')
                   AND message.projection_format = json_extract(
                     expected.value,
                     '$.projectionFormat'
                   )
                   AND message.segments_json IS json_extract(expected.value, '$.segmentsJson')
                   AND message.created_by_account_id = json_extract(
                     expected.value,
                     '$.createdByAccountId'
                   )
                   AND message.seq = json_extract(expected.value, '$.seq')
               )
           )
       )`,
    )
    .bind(
      input.event.id,
      input.terminalEventId,
      input.sessionId,
      input.runId,
      terminalEventKind(input.targetStatus),
      input.terminalSourceEventId,
      input.terminalSemanticHash,
      input.targetStatus,
      expectedRunStatusSeq,
      input.statusOperationId,
      input.source,
      input.error?.code ?? null,
      expectedErrorDetailsJson,
      input.error?.message ?? null,
      input.error === null ? null : Number(input.error.retryable),
      input.state.archived_at,
      input.state.cleanup_operation_kind,
      input.state.last_run_id,
      expectedSessionStatus,
      expectedSessionOperationId,
      expectedSessionStatusSeq,
      input.state.message_seq_cursor + input.messageCursorIncrement,
      input.state.runtime_event_seq_cursor + input.runtimeEventCursorIncrement,
      Number(input.driverRelease !== null),
      input.driverRelease?.driverInstanceId ?? "",
      input.driverRelease?.generation ?? -1,
      input.driverRelease === null ? "" : input.driverRelease.connectionId,
      input.runId,
      input.sessionId,
      input.runId,
      input.sessionId,
      input.runId,
      input.targetStatus === "completed" ? "completed" : "failed",
      input.assistantMessages.length,
      input.runId,
      input.runId,
      assistantMessagesJson,
    );
}

async function classifyAfterBatch(
  database: D1Database,
  input: {
    assistantMessage: PreparedAssistantMessageProjection | null;
    error: RunError | null;
    event: PreparedTerminalEvent;
    expectedDriverObservation?: ExpectedTerminalDriverObservation;
    expectedRunStatus?: SessionRunStatus;
    expectedSessionObservation?: ExpectedTerminalSessionObservation;
    expectedSessionOperationId?: RuntimeOperationId | null;
    runId: SessionRunId;
    runStatusOperationId: RuntimeOperationId | null;
    sessionId: SessionId;
    source: TerminalRunProjectionSource;
    targetStatus: HostTerminalRunStatus;
    terminalEventFence?: PersistedTerminalAuthorityRow;
  },
): Promise<CompletedRunCommitResult | null> {
  const snapshot = await readCompletionSnapshot(database, {
    finalMessageId: input.assistantMessage?.id ?? null,
    runId: input.runId,
    sessionId: input.sessionId,
    sourceEventId: input.event.sourceEventId,
  });
  if (input.terminalEventFence !== undefined) {
    assertSnapshotTerminalAuthority(snapshot, input.terminalEventFence, input.runId);
    await assertDurableTerminalAuthority(database, input.terminalEventFence, input.runId);
  }
  const assistantMessages = prepareTerminalAssistantMessages(snapshot, {
    finalMessage: input.assistantMessage,
    runId: input.runId,
    sessionId: input.sessionId,
  });

  return classifyTerminalSnapshot(snapshot, {
    assistantMessage: input.assistantMessage,
    assistantMessages,
    createdAt: input.event.createdAt,
    error: input.error,
    explicitRunView: input.event.explicitRunView,
    ...(input.expectedDriverObservation === undefined
      ? {}
      : { expectedDriverObservation: input.expectedDriverObservation }),
    ...(input.expectedRunStatus === undefined
      ? {}
      : { expectedRunStatus: input.expectedRunStatus }),
    ...(input.expectedSessionObservation === undefined
      ? {}
      : { expectedSessionObservation: input.expectedSessionObservation }),
    ...(input.expectedSessionOperationId === undefined
      ? {}
      : { expectedSessionOperationId: input.expectedSessionOperationId }),
    eventId: input.event.id,
    runId: input.runId,
    runStatusOperationId: input.runStatusOperationId,
    semanticHash: input.event.semanticHash,
    sessionId: input.sessionId,
    sessionStatus: input.event.sessionStatus,
    sourceEventId: input.event.sourceEventId,
    source: input.source,
    targetStatus: input.targetStatus,
  });
}

function readPersistedTerminalStatus(
  status: SessionRunStatus,
  runId: SessionRunId,
): HostTerminalRunStatus {
  switch (status) {
    case "cancelled":
    case "completed":
    case "expired":
    case "failed":
      return status;
    case "booting":
    case "queued":
    case "running":
    case "waiting_input":
      throw new Error(`Session run ${runId} has a terminal receipt without a terminal status.`);
  }
}

function readPersistedTerminalSource(
  source: string,
  runId: SessionRunId,
): TerminalRunProjectionSource {
  switch (source) {
    case "api":
    case "driver":
    case "maintenance":
    case "runtime_operation":
    case "system":
    case "viewer":
      return source;
    default:
      throw new Error(`Session run ${runId} has an invalid terminal status source.`);
  }
}

function readPersistedTerminalError(
  state: CompletionStateRow,
  runId: SessionRunId,
): RunError | null {
  if (
    state.error_code === null &&
    state.error_details_json === null &&
    state.error_message === null &&
    state.error_retryable === null
  ) {
    return null;
  }
  if (
    state.error_code === null ||
    state.error_details_json === null ||
    state.error_message === null ||
    (state.error_retryable !== 0 && state.error_retryable !== 1)
  ) {
    throw new Error(`Session run ${runId} has an invalid durable terminal error.`);
  }

  try {
    return parseSchemaValue(DurableRunError, {
      code: state.error_code,
      details: JSON.parse(state.error_details_json),
      message: state.error_message,
      retryable: state.error_retryable === 1,
    });
  } catch {
    throw new Error(`Session run ${runId} has an invalid durable terminal error.`);
  }
}

function assertAdoptableTerminalReceipt(
  row: PersistedTerminalAuthorityRow,
  input: {
    runId: SessionRunId;
    sessionId: SessionId;
    targetStatus: HostTerminalRunStatus;
  },
): void {
  const eventType = terminalEventKind(input.targetStatus);
  const hasArtifact = row.artifact_attempt_id !== null;
  if (
    row.session_id !== input.sessionId ||
    row.run_id !== input.runId ||
    row.event_type !== eventType ||
    row.source_event_id !== createSessionRunTerminalSourceId(input.runId, eventType) ||
    row.visibility !== "all_consumers" ||
    row.mcp_command_id !== null ||
    row.tool_call_id !== null ||
    row.tool_input_delta_json !== null ||
    row.tool_input_json !== null ||
    row.tool_name !== null ||
    row.tool_output_delta_text !== null ||
    row.tool_output_text !== null ||
    row.tool_parent_message_id !== null ||
    row.tool_result_message_id !== null ||
    row.tool_status !== null ||
    (row.semantic_hash !== null && !/^[0-9a-f]{64}$/.test(row.semantic_hash)) ||
    (row.semantic_hash === null) !== (row.terminal_event_json === null) ||
    (eventType !== "run.completed" && row.stream_id !== null) ||
    hasArtifact !== (row.artifact_manifest_json !== null) ||
    hasArtifact !== (row.artifact_manifest_sha256 !== null) ||
    (hasArtifact && eventType !== "run.completed")
  ) {
    throw new Error(`Session run ${input.runId} has an invalid canonical terminal receipt.`);
  }
}

function assertPreparedTerminalEventMatchesAuthority(
  event: PreparedTerminalEvent,
  row: PersistedTerminalAuthorityRow,
  runId: SessionRunId,
): void {
  if (
    event.artifactAttemptId !== row.artifact_attempt_id ||
    event.artifactManifestJson !== row.artifact_manifest_json ||
    event.artifactManifestSha256 !== row.artifact_manifest_sha256 ||
    event.contentText !== row.content_text ||
    event.createdAt !== row.created_at ||
    event.endedAt !== row.ended_at ||
    event.eventType !== row.event_type ||
    event.family !== row.family ||
    event.occurredAt !== row.occurred_at ||
    event.processStatus !== row.process_status ||
    event.processType !== row.process_type ||
    event.semanticHash !== row.semantic_hash ||
    event.source !== row.source ||
    event.sourceEventId !== row.source_event_id ||
    event.streamId !== row.stream_id ||
    event.terminalEventJson !== row.terminal_event_json ||
    event.toolCallId !== row.tool_call_id ||
    event.toolInputJson !== row.tool_input_json ||
    event.toolName !== row.tool_name ||
    event.tokens !== row.tokens ||
    event.traceId !== row.trace_id ||
    event.visibility !== row.visibility
  ) {
    throw new Error(`Session run ${runId} terminal semantic authority conflicts with its receipt.`);
  }
}

function prepareAdoptedTerminalEvent(
  row: PersistedTerminalAuthorityRow,
  state: CompletionStateRow,
): PreparedTerminalEvent {
  return {
    artifactAttemptId: row.artifact_attempt_id,
    artifactManifestJson: row.artifact_manifest_json,
    artifactManifestSha256: row.artifact_manifest_sha256,
    contentText: row.content_text,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? row.occurred_at,
    eventType: row.event_type,
    explicitRunView: null,
    family: row.family,
    id: createPlatformId<RuntimeEventId>(),
    occurredAt: row.occurred_at,
    processStatus: row.process_status,
    processType: row.process_type,
    semanticHash: row.semantic_hash ?? "",
    sessionStatus: state.session_status === "TERMINATED" ? "TERMINATED" : "IDLE",
    source: row.source,
    sourceEventId: row.source_event_id,
    streamId: row.stream_id,
    terminalEventJson: row.terminal_event_json ?? "",
    toolCallId: row.tool_call_id,
    toolInputJson: row.tool_input_json,
    toolName: row.tool_name,
    tokens: row.tokens,
    traceId: row.trace_id,
    visibility: row.visibility,
  };
}

export async function adoptTerminalRunProjection(
  database: D1Database,
  input: {
    expectedDriverObservation?: AtomicTerminalDriverReleaseObservation;
    expectedTargetStatus?: DriverTerminalRunStatus;
    runId: SessionRunId;
    sessionId: SessionId;
  },
): Promise<AdoptTerminalRunProjectionResult> {
  const authority = await readTerminalAuthorityReceipt(database, input.runId);
  if (authority === null) {
    return { kind: "missing", persistedSourceEventIds: [], runDurationMs: null };
  }
  if (authority.session_id !== input.sessionId) {
    throw new Error(`Session run ${input.runId} terminal receipt belongs to another session.`);
  }
  const semanticAuthority =
    authority.semantic_hash === null
      ? null
      : await readTerminalEventSemanticAuthority({
          eventJson: authority.terminal_event_json,
          eventType: authority.event_type,
          runId: input.runId,
          semanticHash: authority.semantic_hash,
          sessionId: input.sessionId,
          sourceEventId: authority.source_event_id,
          streamId: authority.stream_id,
        });
  const persistedEvent = semanticAuthority?.event ?? null;
  const persistedFinalMessageId = semanticAuthority?.finalMessageId ?? null;

  const snapshot = await readCompletionSnapshot(database, {
    finalMessageId: persistedFinalMessageId,
    runId: input.runId,
    sessionId: input.sessionId,
    sourceEventId: authority.source_event_id,
  });
  const { state } = snapshot;
  if (state === null) {
    throw new Error(`Session run ${input.runId} was not found for terminal adoption.`);
  }
  assertSnapshotTerminalAuthority(snapshot, authority, input.runId);

  const targetStatus = readPersistedTerminalStatus(state.run_status, input.runId);
  const error = readPersistedTerminalError(state, input.runId);
  assertAdoptableTerminalReceipt(authority, {
    runId: input.runId,
    sessionId: input.sessionId,
    targetStatus,
  });
  if (
    input.expectedTargetStatus !== undefined &&
    terminalEventKind(input.expectedTargetStatus) !== terminalEventKind(targetStatus)
  ) {
    return staleTerminalResult(state);
  }

  const source = readPersistedTerminalSource(state.run_status_source, input.runId);
  const expectedDriverObservation =
    input.expectedDriverObservation === undefined
      ? undefined
      : {
          connectionId: input.expectedDriverObservation.connectionId,
          driverInstanceId: input.expectedDriverObservation.driverInstanceId,
          generation: input.expectedDriverObservation.generation,
        };
  const assistantMessage =
    persistedEvent === null || persistedFinalMessageId === null
      ? null
      : prepareAssistantMessageProjection({
          createdByAccountId: state.run_created_by_account_id,
          messageId: persistedFinalMessageId,
          sessionId: input.sessionId,
          sessionRunId: input.runId,
        });
  const event =
    persistedEvent === null
      ? prepareAdoptedTerminalEvent(authority, state)
      : await prepareTerminalEvent(
          {
            artifactAttemptId: authority.artifact_attempt_id,
            artifactManifestJson: authority.artifact_manifest_json,
            artifactManifestSha256: authority.artifact_manifest_sha256,
            event: persistedEvent,
            occurredAt: authority.occurred_at,
            sourceEventId: authority.source_event_id,
          },
          {
            assistantMessage,
            error,
            runId: input.runId,
            sessionId: input.sessionId,
            targetStatus,
            timestampMs: authority.created_at,
          },
        );
  if (persistedEvent !== null) {
    assertPreparedTerminalEventMatchesAuthority(event, authority, input.runId);
  }

  return commitPreparedTerminalRunProjection(database, {
    assistantMessage,
    error,
    event,
    ...(expectedDriverObservation === undefined ? {} : { expectedDriverObservation }),
    runId: input.runId,
    runStatusOperationId: state.run_status_operation_id as RuntimeOperationId | null,
    sessionId: input.sessionId,
    source,
    targetStatus,
    terminalEventFence: authority,
  });
}

export async function commitTerminalRunProjection(
  database: D1Database,
  input: {
    assistantMessage: PreparedAssistantMessageProjection | null;
    error: RunError | null;
    expectedDriverObservation?: ExpectedTerminalDriverObservation;
    expectedRunStatus?: SessionRunStatus;
    expectedSessionObservation?: ExpectedTerminalSessionObservation;
    expectedSessionOperationId?: RuntimeOperationId | null;
    runId: SessionRunId;
    sessionId: SessionId;
    source: TerminalRunProjectionSource;
    targetStatus: HostTerminalRunStatus;
    terminalEvent: SessionRuntimeEventInput;
    timestampMs?: number;
  },
): Promise<CompletedRunCommitResult> {
  if (input.targetStatus !== "completed" && input.assistantMessage !== null) {
    throw new Error("Only a completed run can project a final assistant message.");
  }

  const runStatusOperationId = readTerminalRunOperationId(input);
  const event = await prepareTerminalEvent(input.terminalEvent, input);

  return commitPreparedTerminalRunProjection(database, {
    ...input,
    event,
    runStatusOperationId,
  });
}

async function commitPreparedTerminalRunProjection(
  database: D1Database,
  input: {
    assistantMessage: PreparedAssistantMessageProjection | null;
    error: RunError | null;
    event: PreparedTerminalEvent;
    expectedDriverObservation?: ExpectedTerminalDriverObservation;
    expectedRunStatus?: SessionRunStatus;
    expectedSessionObservation?: ExpectedTerminalSessionObservation;
    expectedSessionOperationId?: RuntimeOperationId | null;
    runId: SessionRunId;
    runStatusOperationId: RuntimeOperationId | null;
    sessionId: SessionId;
    source: TerminalRunProjectionSource;
    targetStatus: HostTerminalRunStatus;
    terminalEventFence?: PersistedTerminalAuthorityRow;
  },
): Promise<CompletedRunCommitResult> {
  const { event, runStatusOperationId } = input;
  const snapshot = await readCompletionSnapshot(database, {
    finalMessageId: input.assistantMessage?.id ?? null,
    runId: input.runId,
    sessionId: input.sessionId,
    sourceEventId: event.sourceEventId,
  });
  if (input.terminalEventFence !== undefined) {
    assertSnapshotTerminalAuthority(snapshot, input.terminalEventFence, input.runId);
    await assertDurableTerminalAuthority(database, input.terminalEventFence, input.runId);
  }
  const assistantMessages = prepareTerminalAssistantMessages(snapshot, {
    finalMessage: input.assistantMessage,
    runId: input.runId,
    sessionId: input.sessionId,
  });
  const terminal = classifyTerminalSnapshot(snapshot, {
    assistantMessage: input.assistantMessage,
    assistantMessages,
    createdAt: event.createdAt,
    error: input.error,
    explicitRunView: event.explicitRunView,
    ...(input.expectedDriverObservation === undefined
      ? {}
      : { expectedDriverObservation: input.expectedDriverObservation }),
    ...(input.expectedRunStatus === undefined
      ? {}
      : { expectedRunStatus: input.expectedRunStatus }),
    ...(input.expectedSessionObservation === undefined
      ? {}
      : { expectedSessionObservation: input.expectedSessionObservation }),
    ...(input.expectedSessionOperationId === undefined
      ? {}
      : { expectedSessionOperationId: input.expectedSessionOperationId }),
    eventId: event.id,
    runId: input.runId,
    runStatusOperationId,
    semanticHash: event.semanticHash,
    sessionId: input.sessionId,
    sessionStatus: event.sessionStatus,
    sourceEventId: event.sourceEventId,
    source: input.source,
    targetStatus: input.targetStatus,
  });
  const { state } = snapshot;

  if (terminal !== null) {
    const driverRelease = readAtomicTerminalDriverReleaseObservation(
      input.expectedDriverObservation,
    );
    if (
      (terminal.kind === "applied" || terminal.kind === "duplicate") &&
      input.terminalEventFence !== undefined &&
      state !== null &&
      driverRelease !== null &&
      state.driver_status_operation_id === null
    ) {
      return claimTerminalDriverForAdoption(database, {
        fence: input.terminalEventFence,
        observation: driverRelease,
        result: terminal,
        runId: input.runId,
        sessionId: input.sessionId,
        state,
        targetStatus: input.targetStatus,
      });
    }
    return terminal;
  }

  if (state === null) {
    throw new Error(`Session run ${input.runId} was not found for atomic completion.`);
  }

  const repairingExistingTerminal = state.run_status === input.targetStatus;
  const observedDriverRelease = readAtomicTerminalDriverReleaseObservation(
    input.expectedDriverObservation,
  );
  const driverRelease =
    observedDriverRelease !== null && state.driver_status_operation_id === null
      ? observedDriverRelease
      : null;

  if (!repairingExistingTerminal) {
    const decision = decideSessionRunTransition({
      currentStatus: state.run_status,
      targetStatus: input.targetStatus,
    });

    if (decision.kind !== "accepted") {
      throw new Error(`Driver terminal run projection was rejected: ${decision.kind}.`);
    }
  }

  if (
    state.session_status === "TERMINATED" &&
    (!repairingExistingTerminal || event.sessionStatus !== "TERMINATED")
  ) {
    throw new Error("Session is not writable for an atomic terminal run projection.");
  }

  if (
    (!repairingExistingTerminal && snapshot.terminalEvents.length > 0) ||
    (!repairingExistingTerminal && snapshot.assistantMessages.length > 0)
  ) {
    throw new Error("Atomic terminal run projection found a partial canonical projection.");
  }

  if (!repairingExistingTerminal && state.last_run_id !== input.runId) {
    throw new Error("Active terminal run is no longer the Session's current run.");
  }

  const persistedTerminalEvent = repairingExistingTerminal
    ? (snapshot.terminalEvents[0] ?? null)
    : null;
  const terminalEventId = persistedTerminalEvent?.id ?? event.id;
  const terminalSemanticHash =
    persistedTerminalEvent === null ? event.semanticHash : persistedTerminalEvent.semantic_hash;
  const terminalSourceEventId = persistedTerminalEvent?.source_event_id ?? event.sourceEventId;
  const repairingLegacyTerminal = persistedTerminalEvent?.semantic_hash === null;
  const guardedRunSource = repairingLegacyTerminal ? state.run_status_source : input.source;
  const guardedRunStatusOperationId = repairingLegacyTerminal
    ? state.run_status_operation_id
    : runStatusOperationId;
  const sessionOperationId = projectedSessionOperationId(state, event.sessionStatus);
  const runtimeEventCursorIncrement = (() => {
    if (persistedTerminalEvent === null) {
      return 1;
    }
    if (persistedTerminalEvent.seq <= state.runtime_event_seq_cursor) {
      return 0;
    }
    if (persistedTerminalEvent.seq === state.runtime_event_seq_cursor + 1) {
      return 1;
    }
    throw new Error("Canonical terminal event is separated from the Session cursor by a gap.");
  })() satisfies 0 | 1;
  const assistantMessageInserts: {
    message: PreparedTerminalAssistantMessage;
    seqOffset: number;
  }[] = [];
  const guardedAssistantMessages: GuardedAssistantMessage[] = [];
  let messageCursorIncrement = 0;

  if (repairingLegacyTerminal) {
    for (const persisted of snapshot.assistantMessages) {
      if (persisted.seq > state.message_seq_cursor) {
        messageCursorIncrement += 1;
        if (persisted.seq !== state.message_seq_cursor + messageCursorIncrement) {
          throw new Error(
            "Legacy assistant message is separated from the Session cursor by a gap.",
          );
        }
      }
      guardedAssistantMessages.push({
        contentText: persisted.content_text,
        createdAt: persisted.created_at,
        createdByAccountId: persisted.created_by_account_id,
        id: persisted.id,
        planJson: persisted.plan_json,
        projectionFormat: persisted.projection_format,
        segmentsJson: persisted.segments_json,
        seq: persisted.seq,
        sessionId: input.sessionId,
      });
    }
  } else {
    assertRepairableAssistantMessages(snapshot.assistantMessages, assistantMessages, input.runId);
    for (const [index, message] of assistantMessages.entries()) {
      const persisted = snapshot.assistantMessages[index];
      let seq: number;
      if (persisted === undefined) {
        messageCursorIncrement += 1;
        seq = state.message_seq_cursor + messageCursorIncrement;
        assistantMessageInserts.push({
          message,
          seqOffset: messageCursorIncrement,
        });
      } else {
        seq = persisted.seq;
        if (seq > state.message_seq_cursor) {
          messageCursorIncrement += 1;
          if (seq !== state.message_seq_cursor + messageCursorIncrement) {
            throw new Error(
              "Canonical assistant messages are separated from the Session cursor by a gap.",
            );
          }
        }
      }
      guardedAssistantMessages.push({
        contentText: message.message.contentText,
        createdAt: message.createdAt,
        createdByAccountId: message.message.createdByAccountId,
        id: message.message.id,
        planJson: message.message.planJson,
        projectionFormat: message.message.projectionFormat,
        segmentsJson: message.message.segmentsJson,
        seq,
        sessionId: message.message.sessionId,
      });
    }
  }
  const lastMessageAt = guardedAssistantMessages.at(-1)?.createdAt ?? event.createdAt;

  const statements = [
    input.terminalEventFence === undefined
      ? prepareTerminalEventInsert(database, {
          assistantMessageCount: snapshot.assistantMessages.length,
          event,
          ...(input.expectedDriverObservation === undefined
            ? {}
            : { expectedDriverObservation: input.expectedDriverObservation }),
          runId: input.runId,
          sessionId: input.sessionId,
          state,
        })
      : prepareTerminalEventAdoptionFence(database, input.terminalEventFence),
    ...(!repairingExistingTerminal &&
    event.artifactAttemptId !== null &&
    event.artifactManifestJson !== null &&
    event.artifactManifestSha256 !== null
      ? prepareRuntimeArtifactPromotion(database, {
          attemptId: event.artifactAttemptId,
          eventId: event.id,
          manifestJson: event.artifactManifestJson,
          manifestSha256: event.artifactManifestSha256,
          timestampMs: event.createdAt,
        })
      : []),
    ...assistantMessageInserts.map(({ message, seqOffset }) =>
      prepareAssistantMessageInsert(database, {
        eventId: terminalEventId,
        message,
        seqOffset,
      }),
    ),
    ...(repairingExistingTerminal
      ? [
          prepareSessionTerminalRepair(database, {
            eventId: terminalEventId,
            lastMessageAt,
            messageCursorIncrement,
            runId: input.runId,
            runtimeEventCursorIncrement,
            sessionId: input.sessionId,
            sessionOperationId,
            sessionStatus: event.sessionStatus,
            state,
            targetStatus: input.targetStatus,
            timestampMs: event.createdAt,
          }),
        ]
      : [
          prepareRunTerminalUpdate(database, {
            error: input.error,
            eventId: event.id,
            runId: input.runId,
            sessionId: input.sessionId,
            source: input.source,
            state,
            statusOperationId: runStatusOperationId,
            targetStatus: input.targetStatus,
            timestampMs: event.createdAt,
          }),
          prepareSessionTerminalUpdate(database, {
            assistantMessageCount: assistantMessages.length,
            eventId: event.id,
            lastMessageAt,
            runId: input.runId,
            sessionId: input.sessionId,
            sessionOperationId,
            sessionStatus: event.sessionStatus,
            state,
            targetStatus: input.targetStatus,
            timestampMs: event.createdAt,
          }),
        ]),
    prepareSessionModelCallsTerminalUpdate(database, {
      eventId: terminalEventId,
      runId: input.runId,
      semanticHash: terminalSemanticHash,
      sessionId: input.sessionId,
      targetStatus: input.targetStatus,
      timestampMs: event.createdAt,
    }),
    ...(driverRelease === null
      ? []
      : [
          prepareTerminalDriverReleaseClaim(database, {
            eventId: terminalEventId,
            observation: driverRelease,
            runId: input.runId,
            sessionId: input.sessionId,
            targetStatus: input.targetStatus,
          }),
        ]),
    preparePermissionRequestDelete(database, {
      eventId: terminalEventId,
      runId: input.runId,
      sessionId: input.sessionId,
      targetStatus: input.targetStatus,
    }),
    prepareTerminalCommitGuard(database, {
      assistantMessages: guardedAssistantMessages,
      driverRelease,
      event,
      error: input.error,
      messageCursorIncrement,
      repairingExistingTerminal,
      runId: input.runId,
      source: guardedRunSource,
      statusOperationId: guardedRunStatusOperationId,
      runtimeEventCursorIncrement,
      sessionId: input.sessionId,
      state,
      targetStatus: input.targetStatus,
      terminalEventId,
      terminalSemanticHash,
      terminalSourceEventId,
    }),
  ];

  try {
    const results = await database.batch(statements);

    if (input.terminalEventFence === undefined && getD1ChangeCount(results[0]) === 0) {
      const raced = await classifyAfterBatch(database, {
        ...input,
        event,
        runStatusOperationId,
      });

      if (raced !== null) {
        return raced;
      }

      throw new Error("Atomic terminal run projection lost a concurrent session mutation.");
    }
  } catch (error) {
    try {
      const committed = await classifyAfterBatch(database, {
        ...input,
        event,
        runStatusOperationId,
      });

      if (committed !== null) {
        return committed;
      }
    } catch {
      // Preserve the batch failure when its commit outcome cannot be proven.
    }

    throw error;
  }

  const committed = await classifyAfterBatch(database, {
    ...input,
    event,
    runStatusOperationId,
  });

  if (committed === null) {
    throw new Error("Atomic terminal run projection did not commit its canonical projection.");
  }

  return committed;
}
