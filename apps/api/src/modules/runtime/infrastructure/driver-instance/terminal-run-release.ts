import { createMcpExecuteFailedEventIdentity } from "@mosoo/agent-driver/events";
import type { RunError, SessionRunSummary } from "@mosoo/contracts/session-run";
import {
  driverInstancesTable,
  sessionEventsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  RuntimeEventId,
  RuntimeOperationId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { createRuntimeEvent, createRuntimeEventSemanticHash } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import { and, eq, exists, inArray, isNull, ne, notExists, sql } from "drizzle-orm";

import { logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { createSessionRuntimeEventProjection } from "../../../sessions/domain/session-runtime-event-projection";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { classifyReclaim, decideReclaimRecovery } from "../../domain/session-run-reclaim-recovery";
import { isTerminalSessionRunStatus } from "../../domain/session-run-status";
import { recordRuntimeRunLeaseReleasedOutcome } from "../runtime-subject-lifecycle/runtime-run-lease-store";
import { createSandboxCheckpoints } from "../sandbox-backup.service";
import { markClaimedExternalToolEffectsUnknownForDriver } from "../session-runs/external-tool-effect-store.repository";
import {
  listAcceptedInputStartCommandRepairsForTerminalDriver,
  listAcceptedMcpCommandRepairsForTerminalDriver,
  listTerminalDriversWithPendingRuntimeCommands,
  repairAcceptedRuntimeCommandsForTerminalDriver,
  updateRuntimeCommandRecord,
} from "../session-runs/runtime-command-store.repository";
import type {
  AcceptedInputStartCommandRepair,
  AcceptedMcpCommandRepair,
} from "../session-runs/runtime-command-store.repository";
import { isCattleTerminalCheckpointReadyForNextRun } from "../session-runs/session-run-admission.repository";
import { getSessionRunSummary } from "../session-runs/session-run-store.repository";
import { commitTerminalRunProjection } from "./completed-run-commit.repository";
import { createCanonicalDriverRunFailedEvent } from "./driver-event-canonicalization";
import type { RuntimeSessionLink } from "./event-types";
import { getDriverInstanceLifecycleIdentity } from "./lifecycle";
import { getRuntimeSessionLink } from "./session-link.repository";
import {
  closeTerminalRuntimeConversationIfNeeded,
  recycleTerminalRuntimeLeaseIfNeeded,
} from "./terminal-runtime-lease";

export interface TerminalDriverInstanceSessionRunReleaseResult {
  readonly link: RuntimeSessionLink | null;
  readonly released: boolean;
}

async function claimTerminalRunRelease(
  database: D1Database,
  input: {
    readonly expectedDriverConnectionId?: string | null;
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly sessionRunId: SessionRunId;
  },
): Promise<{
  operationId: RuntimeOperationId;
  phase: "cleanup_required" | "release_committed";
} | null> {
  const operationId = parsePlatformId<RuntimeOperationId>(
    input.sessionRunId,
    "terminal Run release operation ID",
  );
  const db = getAppDatabase(database);
  const exactTerminalRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.id, input.sessionRunId),
        eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        inArray(sessionRunsTable.status, ["cancelled", "completed", "expired", "failed"]),
      ),
    );
  const activeSuccessorRun = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(
      and(
        eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
        ne(sessionRunsTable.id, input.sessionRunId),
        inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
      ),
    );
  const claimed = await db
    .update(driverInstancesTable)
    .set({ statusOperationId: operationId })
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        input.expectedDriverConnectionId === undefined
          ? undefined
          : input.expectedDriverConnectionId === null
            ? isNull(driverInstancesTable.connectionId)
            : eq(driverInstancesTable.connectionId, input.expectedDriverConnectionId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        inArray(driverInstancesTable.status, [
          "provisioning",
          "connecting",
          "ready",
          "stopped",
          "failed",
        ]),
        isNull(driverInstancesTable.statusOperationId),
        exists(exactTerminalRun),
        notExists(activeSuccessorRun),
      ),
    )
    .returning({ id: driverInstancesTable.id })
    .get();

  if (claimed !== undefined) {
    return { operationId, phase: "cleanup_required" };
  }

  const adopted = await db
    .select({ status: driverInstancesTable.status })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        input.expectedDriverConnectionId === undefined
          ? undefined
          : input.expectedDriverConnectionId === null
            ? isNull(driverInstancesTable.connectionId)
            : eq(driverInstancesTable.connectionId, input.expectedDriverConnectionId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        inArray(driverInstancesTable.status, [
          "provisioning",
          "connecting",
          "ready",
          "stopping",
          "stopped",
          "failed",
        ]),
        eq(driverInstancesTable.statusOperationId, operationId),
        exists(exactTerminalRun),
        notExists(activeSuccessorRun),
      ),
    )
    .limit(1)
    .get();

  return adopted === undefined
    ? null
    : {
        operationId,
        phase: adopted.status === "stopping" ? "release_committed" : "cleanup_required",
      };
}

async function checkpointTerminalRuntimeSessionIfNeeded(
  bindings: ApiBindings,
  link: RuntimeSessionLink,
  input: { readonly driverGeneration: number; readonly driverInstanceId: DriverInstanceId },
): Promise<void> {
  if (
    link.sandboxId === null ||
    link.sandboxKind === null ||
    link.sessionId === null ||
    link.sessionRunId === null ||
    link.sessionRunStatus !== "completed"
  ) {
    return;
  }

  const lifecycle = await getAppDatabase(bindings.DB)
    .select({
      cleanupOperationKind: sessionsTable.cleanupOperationKind,
      operationId: sessionsTable.statusOperationId,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, link.sessionId))
    .limit(1)
    .get();
  if (lifecycle?.cleanupOperationKind === "delete" && lifecycle.operationId !== null) {
    return;
  }
  if (
    link.sandboxKind === "cattle" &&
    (await isCattleTerminalCheckpointReadyForNextRun(bindings.DB, link.sessionId))
  ) {
    return;
  }

  const rules = getRuntimeKindPolicy(link.sandboxKind).checkpoint.createOnTerminal;

  if (rules.length === 0) {
    return;
  }

  const driver = await getAppDatabase(bindings.DB)
    .select({ sandboxIncarnation: driverInstancesTable.sandboxIncarnation })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        eq(driverInstancesTable.sandboxId, link.sandboxId),
      ),
    )
    .limit(1)
    .get();
  if (driver === undefined) {
    throw new Error("Terminal sandbox checkpoint lost its exact Driver incarnation.");
  }

  await createSandboxCheckpoints(bindings, {
    requiredSessionId: link.sessionId,
    rules,
    sandboxId: link.sandboxId,
    terminalAuthority: {
      driverGeneration: input.driverGeneration,
      driverInstanceId: input.driverInstanceId,
      incarnation: driver.sandboxIncarnation,
      sessionId: link.sessionId,
      sessionRunId: link.sessionRunId,
    },
  });
}

async function failFinalizedDriverRun(
  bindings: ApiBindings,
  input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly runId: SessionRunId;
    readonly runError: RunError;
    readonly runtimeId: string;
    readonly sessionId: SessionId;
  },
): Promise<SessionRunSummary | null> {
  const current = await getSessionRunSummary(bindings.DB, input.runId);

  if (current === null) {
    throw new Error("Finalized Driver Session Run was not found.");
  }

  if (current.status !== "failed" && isTerminalSessionRunStatus(current.status)) {
    return null;
  }

  const timestampMs = currentTimestampMs();
  const timestamp = toIsoString(timestampMs);
  const runError = current.status === "failed" ? (current.error ?? input.runError) : input.runError;
  const failedRun: SessionRunSummary = {
    ...current,
    completedAt: current.completedAt ?? timestamp,
    error: runError,
    startedAt: current.startedAt ?? timestamp,
    status: "failed",
    updatedAt: current.status === "failed" ? current.updatedAt : timestamp,
  };
  const event = createCanonicalDriverRunFailedEvent({
    driverInstanceId: input.driverInstanceId,
    error: runError,
    id: createPlatformId<RuntimeEventId>(),
    occurredAt: timestamp,
    runId: input.runId,
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    traceId: failedRun.traceId,
  });
  const outcome = await commitTerminalRunProjection(bindings.DB, {
    assistantMessage: null,
    error: runError,
    runId: input.runId,
    sessionId: input.sessionId,
    source: "maintenance",
    targetStatus: "failed",
    terminalEvent: {
      event,
      occurredAt: timestampMs,
      sourceEventId: event.sourceEventId ?? null,
    },
    timestampMs,
  });

  if (outcome.kind === "stale") {
    return null;
  }

  return getSessionRunSummary(bindings.DB, input.runId);
}

export async function releaseTerminalDriverInstanceSessionRun(
  bindings: ApiBindings,
  input: {
    expectedDriverConnectionId?: string | null;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    sessionRunId: SessionRunId;
  },
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  const database = bindings.DB;
  const claim = await claimTerminalRunRelease(database, input);
  if (claim === null) {
    throw new Error("Terminal Session Run release lost its exact Driver ownership.");
  }
  const link = await getRuntimeSessionLink(database, input.driverInstanceId, {
    sessionRunId: input.sessionRunId,
  });

  if (
    link.sessionRunId !== input.sessionRunId ||
    link.sessionRunStatus === null ||
    !isTerminalSessionRunStatus(link.sessionRunStatus)
  ) {
    throw new Error("Terminal Session Run no longer belongs to this Driver instance.");
  }

  await repairTerminalDriverInputCommands(bindings, input);

  if (claim.phase === "release_committed") {
    return { link, released: true };
  }

  await checkpointTerminalRuntimeSessionIfNeeded(bindings, link, input);
  await closeTerminalRuntimeConversationIfNeeded(bindings, link);
  await recycleTerminalRuntimeLeaseIfNeeded(bindings, link);

  const outcome = await recordRuntimeRunLeaseReleasedOutcome(database, {
    driverInstanceId: input.driverInstanceId,
    expectedDriverGeneration: input.driverGeneration,
    expectedDriverOperationId: claim.operationId,
    expectedSessionRunId: input.sessionRunId,
    retainDriverOperationUntilTerminal: true,
  });

  if (outcome.status !== "applied") {
    const reason = "reason" in outcome ? outcome.reason : outcome.status;
    throw new Error(`Terminal Session Run lease release failed: ${reason}.`);
  }

  return { link, released: true };
}

function runHasReclaimError(run: SessionRunSummary, runError: RunError): boolean {
  return (
    run.error?.code === runError.code &&
    run.error.details["driverInstanceId"] === runError.details["driverInstanceId"]
  );
}

type McpTerminalStatus = "cancelled" | "completed" | "failed";
type CompletedMcpCommandRepair = Extract<
  AcceptedMcpCommandRepair["terminal"],
  { status: "completed" }
>;
type ReconciledMcpTerminal =
  | { result: CompletedMcpCommandRepair["result"]; status: "completed" }
  | { error: RunError; status: "failed" }
  | { status: "cancelled" };
interface PersistedMcpTerminalEvent extends Record<string, unknown> {
  contentText: string;
  semanticHash: string | null;
  sourceEventId: string;
  toolOutputText: string | null;
  toolStatus: McpTerminalStatus;
}

function mcpTerminalSourceEventId(
  commandId: string,
  status: Exclude<McpTerminalStatus, "failed">,
): string {
  return `mcp.execute.${status}:${commandId}`;
}

function createMcpTerminalEvent(
  driverInstanceId: DriverInstanceId,
  repair: AcceptedMcpCommandRepair,
  terminal: ReconciledMcpTerminal,
  traceId: string,
): RuntimeEventEnvelope {
  const identity =
    terminal.status === "failed"
      ? createMcpExecuteFailedEventIdentity({
          commandId: repair.commandId,
          rawInput: repair.command.argumentsJson,
          rawOutput: terminal.error.message,
          title: repair.command.toolName,
          toolCallId: repair.command.toolCallId,
        })
      : ({
          payload: {
            kind: "mcp",
            rawInput: repair.command.argumentsJson,
            ...(terminal.status === "completed" ? { rawOutput: terminal.result.outputText } : {}),
            status: terminal.status,
            title: repair.command.toolName,
            toolCallId: repair.command.toolCallId,
          },
          sourceEventId: mcpTerminalSourceEventId(repair.commandId, terminal.status),
        } as const);

  return createRuntimeEvent({
    correlationId: repair.commandId,
    driverInstanceId,
    id: createPlatformId<RuntimeEventId>(),
    kind: "tool.call.updated",
    occurredAt: new Date().toISOString(),
    payload: identity.payload,
    runId: parsePlatformId<SessionRunId>(repair.command.runId, "MCP command Session Run ID"),
    runtimeId: repair.runtimeId,
    sessionId: repair.sessionId,
    sourceEventId: identity.sourceEventId,
    traceId,
  });
}

async function readExistingMcpTerminalEvent(input: {
  bindings: ApiBindings;
  repair: AcceptedMcpCommandRepair;
}): Promise<PersistedMcpTerminalEvent | null> {
  const rows = await getAppDatabase(input.bindings.DB)
    .select({
      contentText: sessionEventsTable.contentText,
      eventType: sessionEventsTable.eventType,
      family: sessionEventsTable.family,
      mcpCommandId: sessionEventsTable.mcpCommandId,
      processStatus: sessionEventsTable.processStatus,
      processType: sessionEventsTable.processType,
      runId: sessionEventsTable.runId,
      semanticHash: sessionEventsTable.semanticHash,
      source: sessionEventsTable.source,
      sourceEventId: sessionEventsTable.sourceEventId,
      streamId: sessionEventsTable.streamId,
      toolCallId: sessionEventsTable.toolCallId,
      toolInputDeltaJson: sessionEventsTable.toolInputDeltaJson,
      toolInputJson: sessionEventsTable.toolInputJson,
      toolName: sessionEventsTable.toolName,
      toolOutputDeltaText: sessionEventsTable.toolOutputDeltaText,
      toolOutputText: sessionEventsTable.toolOutputText,
      toolParentMessageId: sessionEventsTable.toolParentMessageId,
      toolResultMessageId: sessionEventsTable.toolResultMessageId,
      toolStatus: sessionEventsTable.toolStatus,
      tokens: sessionEventsTable.tokens,
      traceId: sessionEventsTable.traceId,
      visibility: sessionEventsTable.visibility,
    })
    .from(sessionEventsTable)
    .where(
      and(
        eq(sessionEventsTable.sessionId, input.repair.sessionId),
        eq(sessionEventsTable.mcpCommandId, input.repair.commandId),
        eq(sessionEventsTable.eventType, "tool.call.updated"),
        inArray(sessionEventsTable.toolStatus, ["completed", "cancelled", "failed"]),
      ),
    )
    .all();

  if (rows.length > 1) {
    throw new Error("MCP command has conflicting durable terminal events.");
  }

  return (rows[0] as PersistedMcpTerminalEvent | undefined) ?? null;
}

function adoptExistingMcpTerminal(input: {
  rawOutput: string | null;
  repair: AcceptedMcpCommandRepair;
  status: McpTerminalStatus;
}): ReconciledMcpTerminal {
  if (input.status === "completed") {
    if (input.repair.effectStatus !== "succeeded" || input.repair.terminal.status !== "completed") {
      throw new Error("MCP completion event conflicts with its durable external effect.");
    }

    return { result: input.repair.terminal.result, status: "completed" };
  }

  if (input.status === "cancelled") {
    if (input.repair.effectStatus !== "intent") {
      throw new Error("MCP cancellation event conflicts with its durable external effect.");
    }

    return { status: "cancelled" };
  }

  if (input.repair.effectStatus === "succeeded" || input.repair.terminal.status !== "failed") {
    throw new Error("MCP failure event conflicts with its durable external effect.");
  }

  if (input.rawOutput === null) {
    throw new Error("MCP failure event is missing its durable raw output.");
  }

  return {
    error: { ...input.repair.terminal.error, message: input.rawOutput },
    status: "failed",
  };
}

async function assertMcpTerminalEventProjection(
  row: Record<string, unknown>,
  event: RuntimeEventEnvelope,
  commandId: AcceptedMcpCommandRepair["commandId"],
): Promise<void> {
  const expected = createSessionRuntimeEventProjection(event, {
    provenMcpCommandId: commandId,
  });

  if (row["sourceEventId"] !== event.sourceEventId) {
    throw new Error("MCP terminal event source identity conflicts with its command.");
  }

  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) {
      throw new Error(`MCP terminal event projection ${key} conflicts with its command.`);
    }
  }

  if (row["semanticHash"] !== (await createRuntimeEventSemanticHash(event))) {
    throw new Error("MCP terminal event semantic hash conflicts with its command.");
  }
}

async function reconcileAcceptedMcpCommand(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    repair: AcceptedMcpCommandRepair;
  },
): Promise<void> {
  const runId = parsePlatformId<SessionRunId>(
    input.repair.command.runId,
    "MCP command Session Run ID",
  );
  const link = await getRuntimeSessionLink(bindings.DB, input.driverInstanceId, {
    sessionRunId: runId,
  });

  if (
    link.sessionId !== input.repair.sessionId ||
    link.sessionRunId !== runId ||
    link.runtimeId !== input.repair.runtimeId ||
    link.traceId === null
  ) {
    throw new Error("MCP command repair lost its authoritative Session Run identity.");
  }

  const traceId = link.traceId;
  const existing = await readExistingMcpTerminalEvent({ bindings, repair: input.repair });
  const proposedTerminal =
    existing === null
      ? input.repair.terminal.status === "completed"
        ? ({ result: input.repair.terminal.result, status: "completed" } as const)
        : ({ error: input.repair.terminal.error, status: "failed" } as const)
      : adoptExistingMcpTerminal({
          rawOutput: existing.toolOutputText,
          repair: input.repair,
          status: existing.toolStatus,
        });

  if (existing === null) {
    try {
      await appendSessionRuntimeEvents({
        bindings,
        events: [
          createMcpTerminalEvent(input.driverInstanceId, input.repair, proposedTerminal, traceId),
        ],
        provenMcpCommandId: input.repair.commandId,
        sessionId: input.repair.sessionId,
      });
    } catch (error) {
      // The terminal tool partial-unique index chooses exactly one concurrent
      // Driver/repair winner. Only suppress the insert error when that winner
      // can now be read and validated below.
      if ((await readExistingMcpTerminalEvent({ bindings, repair: input.repair })) === null) {
        throw error;
      }
    }
  }

  const persisted =
    existing ?? (await readExistingMcpTerminalEvent({ bindings, repair: input.repair }));

  if (persisted === null) {
    throw new Error("MCP terminal event was not durably persisted.");
  }

  const terminal = adoptExistingMcpTerminal({
    rawOutput: persisted.toolOutputText,
    repair: input.repair,
    status: persisted.toolStatus,
  });
  const event = createMcpTerminalEvent(input.driverInstanceId, input.repair, terminal, traceId);
  await assertMcpTerminalEventProjection(persisted, event, input.repair.commandId);
  const outcome = await updateRuntimeCommandRecord(bindings.DB, {
    commandId: input.repair.commandId,
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
    ...(terminal.status === "completed"
      ? { result: terminal.result }
      : terminal.status === "failed"
        ? { error: terminal.error }
        : {}),
    status: terminal.status,
  });

  if (outcome.kind === "rejected") {
    throw new Error(`MCP command terminal repair was rejected: ${outcome.reason}.`);
  }
}

async function assertInputTerminalEventPersisted(
  bindings: ApiBindings,
  repair: AcceptedInputStartCommandRepair,
): Promise<void> {
  const eventType =
    repair.terminal.status === "completed"
      ? "run.completed"
      : repair.terminal.status === "cancelled"
        ? "run.cancelled"
        : "run.failed";
  const row =
    (await getAppDatabase(bindings.DB)
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.sessionId, repair.sessionId),
          eq(
            sessionEventsTable.runId,
            parsePlatformId<SessionRunId>(repair.command.runId, "input command Session Run ID"),
          ),
          eq(sessionEventsTable.eventType, eventType),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("Input command terminal Session Run event is not durably persisted.");
  }
}

async function reconcileAcceptedInputStartCommand(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    repair: AcceptedInputStartCommandRepair;
  },
): Promise<void> {
  await assertInputTerminalEventPersisted(bindings, input.repair);
  const outcome = await updateRuntimeCommandRecord(bindings.DB, {
    commandId: input.repair.commandId,
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
    ...(input.repair.terminal.status === "completed"
      ? { result: input.repair.terminal.result }
      : input.repair.terminal.status === "failed"
        ? { error: input.repair.terminal.error }
        : {}),
    status: input.repair.terminal.status,
  });

  if (outcome.kind === "rejected") {
    throw new Error(`Input command terminal repair was rejected: ${outcome.reason}.`);
  }
}

async function repairTerminalDriverMcpCommands(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
  },
): Promise<void> {
  await markClaimedExternalToolEffectsUnknownForDriver(bindings.DB, input);
  const mcpRepairs = await listAcceptedMcpCommandRepairsForTerminalDriver(bindings.DB, input);

  for (const repair of mcpRepairs) {
    await reconcileAcceptedMcpCommand(bindings, { ...input, repair });
  }
}

async function repairTerminalDriverInputCommands(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
  },
): Promise<void> {
  const inputRepairs = await listAcceptedInputStartCommandRepairsForTerminalDriver(
    bindings.DB,
    input,
  );

  for (const repair of inputRepairs) {
    await reconcileAcceptedInputStartCommand(bindings, { ...input, repair });
  }
}

export async function repairFinalizedTerminalDriverRunState(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    sessionRunId: SessionRunId | null;
    status: "failed" | "stopped";
  },
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  const commandRepairInput = {
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
  };

  // Close any durable tool UI state before the enclosing run is made terminal.
  await repairTerminalDriverMcpCommands(bindings, commandRepairInput);

  if (input.sessionRunId === null) {
    await repairTerminalDriverInputCommands(bindings, commandRepairInput);
    await repairAcceptedRuntimeCommandsForTerminalDriver(bindings.DB, commandRepairInput);
    return { link: null, released: false };
  }

  const link = await getRuntimeSessionLink(bindings.DB, input.driverInstanceId, {
    sessionRunId: input.sessionRunId,
  });

  if (link.sessionRunId !== input.sessionRunId || link.sessionRunStatus === null) {
    throw new Error("Finalized Driver Session Run ownership was lost.");
  }

  const wasActive = !isTerminalSessionRunStatus(link.sessionRunStatus);

  if (wasActive || link.sessionRunStatus === "failed") {
    const runError = classifyReclaim({
      driverInstanceId: input.driverInstanceId,
      driverTerminalStatus: input.status,
      reclaimReason: "socket_closed",
    });
    const run =
      link.sessionId === null || link.runtimeId === null
        ? null
        : await failFinalizedDriverRun(bindings, {
            driverInstanceId: input.driverInstanceId,
            runError,
            runId: link.sessionRunId,
            runtimeId: link.runtimeId,
            sessionId: link.sessionId,
          });

    if (link.sessionId !== null && run !== null && runHasReclaimError(run, runError)) {
      // Decide recovery for the reclaimed run. v1 records the decision so it is
      // observable and unit-testable; executing the auto-requeue (a fresh
      // `resume` run + re-dispatch) is a follow-up because this DO finalize
      // context lacks the viewer + requestUrl that enqueueSessionRunDispatchCommand
      // needs to rebuild the sandbox's action-token callback URLs.
      if (wasActive) {
        const recovery = decideReclaimRecovery({
          driverTerminalStatus: input.status,
          priorTrigger: run.trigger,
          reclaimReason: "socket_closed",
          runStatus: link.sessionRunStatus,
        });
        logInfo("runtime.reclaim.recovery.decided", {
          action: recovery.kind,
          driverInstanceId: input.driverInstanceId,
          priorTrigger: run.trigger,
          runId: run.id,
          sessionId: link.sessionId,
        });
      }
    }
  }

  // input.start is derived from the authoritative terminal run and its durable
  // event, so it must be repaired after the run transition above.
  await repairTerminalDriverInputCommands(bindings, commandRepairInput);
  await repairAcceptedRuntimeCommandsForTerminalDriver(bindings.DB, commandRepairInput);

  return releaseTerminalDriverInstanceSessionRun(bindings, {
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
    sessionRunId: link.sessionRunId,
  });
}

export async function repairTerminalDriverRuntimeCommandsGlobally(
  bindings: ApiBindings,
): Promise<void> {
  const failures: unknown[] = [];
  const claimedReleases = await getAppDatabase(bindings.DB)
    .select({
      driverGeneration: driverInstancesTable.generation,
      driverInstanceId: driverInstancesTable.id,
      sessionRunId: sessionRunsTable.id,
    })
    .from(driverInstancesTable)
    .innerJoin(
      sessionRunsTable,
      and(
        eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
        sql`${sessionRunsTable.id} = ${driverInstancesTable.statusOperationId}`,
      ),
    )
    .where(
      and(
        inArray(driverInstancesTable.status, ["ready", "stopped", "failed"]),
        inArray(sessionRunsTable.status, ["cancelled", "completed", "expired", "failed"]),
      ),
    )
    .all();

  for (const release of claimedReleases) {
    try {
      await releaseTerminalDriverInstanceSessionRun(bindings, release);
    } catch (error) {
      failures.push(error);
    }
  }

  const drivers = await listTerminalDriversWithPendingRuntimeCommands(bindings.DB);

  for (const driver of drivers) {
    try {
      const identity = await getDriverInstanceLifecycleIdentity(bindings, driver.id);

      if (
        identity === null ||
        identity.generation !== driver.generation ||
        (identity.status !== "failed" && identity.status !== "stopped")
      ) {
        continue;
      }

      let link = await getRuntimeSessionLink(bindings.DB, driver.id);

      if (link.sessionRunId === null) {
        link = await getRuntimeSessionLink(bindings.DB, driver.id, {
          latestTerminalRun: true,
        });
      }
      await repairFinalizedTerminalDriverRunState(bindings, {
        driverGeneration: driver.generation,
        driverInstanceId: driver.id,
        sessionRunId: link.sessionRunId,
        status: identity.status,
      });
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures[0] !== undefined) {
    throw failures[0];
  }
}

export async function releaseLinkedTerminalDriverInstanceSessionRun(
  bindings: ApiBindings,
  driverInstanceId: DriverInstanceId,
  driverGeneration: number,
): Promise<TerminalDriverInstanceSessionRunReleaseResult> {
  const link = await getRuntimeSessionLink(bindings.DB, driverInstanceId, {
    latestTerminalRun: true,
  });

  if (link.sessionRunId === null) {
    return { link, released: false };
  }

  return releaseTerminalDriverInstanceSessionRun(bindings, {
    driverGeneration,
    driverInstanceId,
    sessionRunId: link.sessionRunId,
  });
}
