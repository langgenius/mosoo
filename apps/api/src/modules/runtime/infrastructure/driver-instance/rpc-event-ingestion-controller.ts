import { createMcpExecuteFailedEventIdentity } from "@mosoo/agent-driver/events";
import type {
  DriverEventBatchOutput,
  DriverEventReceipt,
  DriverLogBatchInput,
  DriverLogBatchOutput,
} from "@mosoo/agent-driver/orpc";
import { McpExecuteCommandResult } from "@mosoo/contracts/runtime-command";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";
import {
  createRuntimeEventSemanticHash,
  isRuntimeEventRecord,
  readRuntimeEventToolCallUpdate,
} from "@mosoo/runtime-events";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import { loadSessionViewerState } from "../../../sessions/application/session-live-state.service";
import type {
  SessionDeliveryEvent,
  SessionLiveState,
} from "../../../sessions/application/session-live-state.service";
import { getSessionRuntimeEventSourceReceipts } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import type { SessionRuntimeEventSourceReceipt } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import { getExternalToolEffectForCommand } from "../session-runs/external-tool-effect-store.repository";
import { getRuntimeCommandRecord } from "../session-runs/runtime-command-store.repository";
import { EVENT_BATCH_MAX_SIZE, LOG_BATCH_MAX_SIZE } from "./connections";
import { canonicalizeDriverEventEnvelope } from "./driver-event-canonicalization";
import { DriverEventTerminalGate } from "./driver-event-terminal-gate";
import { publishDriverLogBatch } from "./driver-log-batch-publisher";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import type { CanonicalDriverEventEnvelope, HostDriverEventBatchInput } from "./event-types";
import {
  getRuntimeSessionLink,
  persistProjectedRuntimeDriverEventPrerequisites,
  persistProjectedRuntimeDriverEvents,
  preflightProjectedRuntimeDriverEvents,
  projectRuntimeDriverEvents,
} from "./events";
import type { RuntimeSessionLink } from "./events";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import { stageRuntimeArtifactEvents } from "./runtime-artifact-staging";
import { assertActiveRuntimeSessionRun } from "./session-link.repository";

interface HashedDriverEvent {
  readonly envelope: CanonicalDriverEventEnvelope;
  readonly persistenceSourceId: string;
  readonly semanticHash: string;
}

interface PreparedDriverEventBatch {
  readonly uniqueOuterEvents: readonly HashedDriverEvent[];
  readonly uniquePersistenceEvents: readonly HashedDriverEvent[];
}

function toRuntimeArtifactEvent(event: HashedDriverEvent) {
  return {
    event: event.envelope.event,
    semanticHash: event.semanticHash,
    sourceEventId: event.persistenceSourceId,
  };
}

function summarizeDriverEvents(events: readonly CanonicalDriverEventEnvelope[]) {
  return {
    eventCount: events.length,
    eventKinds: events.map((event) => event.event.kind).slice(0, 24),
    sourceEventIds: events.map((event) => event.eventId).slice(0, 24),
  };
}

function resolveEventSessionRunId(
  events: readonly { readonly event: { readonly runId?: unknown } }[],
): SessionRunId | undefined {
  let eventRunId: string | undefined;

  for (const envelope of events) {
    const candidateRunId = envelope.event.runId;

    if (candidateRunId === undefined) {
      continue;
    }
    if (typeof candidateRunId !== "string") {
      throw new TypeError("Driver event run id must be a string.");
    }

    if (eventRunId !== undefined && eventRunId !== candidateRunId) {
      throw new Error("Event batch cannot contain events from multiple runs.");
    }

    eventRunId = candidateRunId;
  }

  return eventRunId === undefined
    ? undefined
    : parsePlatformId<SessionRunId>(eventRunId, "driver event run id");
}

function resolveDriverEventPersistenceSourceId(event: CanonicalDriverEventEnvelope): string {
  if (
    (event.event.kind === "run.cancelled" ||
      event.event.kind === "run.completed" ||
      event.event.kind === "run.failed") &&
    event.event.runId !== undefined
  ) {
    return createSessionRunTerminalSourceId(
      parsePlatformId<SessionRunId>(event.event.runId, "driver terminal event run id"),
      event.event.kind,
    );
  }

  return event.eventId;
}

const PRE_HELLO_LOG_BATCH_LIMIT = 16;

export class DriverInstanceRpcEventIngestionController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;
  readonly #eventTerminalGate = new DriverEventTerminalGate();
  #droppedPreHelloLogBatches = 0;
  readonly #pendingPreHelloLogBatches: DriverLogBatchInput[] = [];

  public constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  public async handlePushEvents(
    input: HostDriverEventBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverEventBatchOutput> {
    const { state } = this.#dependencies;

    if (!state.hello) {
      throw new Error("Driver hello is required before pushEvents.");
    }

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }
    const driverInstanceId = state.requireDriverInstanceId();

    if (input.events.length > EVENT_BATCH_MAX_SIZE) {
      throw new Error(`Event batch exceeds max size ${EVENT_BATCH_MAX_SIZE}.`);
    }
    context.assertActiveConnection();

    return this.#eventTerminalGate.run(async () => {
      context.assertActiveConnection();
      const { env, viewCache, viewerEventDelivery } = this.#dependencies;
      const cachedLink = state.runtimeSessionLink;
      const eventSessionRunId = resolveEventSessionRunId(input.events);
      const shouldRefreshLink =
        input.events.some(
          (envelope) =>
            envelope.event.kind === "run.started" || envelope.event.kind === "agent.tasks.replaced",
        ) ||
        runtimeSessionLinkNeedsRefresh(cachedLink) ||
        (eventSessionRunId !== undefined && cachedLink?.sessionRunId !== eventSessionRunId);
      const link = await this.#getRuntimeSessionLink({
        refresh: shouldRefreshLink,
        ...(eventSessionRunId === undefined ? {} : { sessionRunId: eventSessionRunId }),
      });
      context.assertActiveConnection();
      const canonicalInputEvents = input.events.map((event) =>
        canonicalizeDriverEventEnvelope(event, { traceId: link.traceId }),
      );
      const preparedEvents = await prepareDriverEventBatch(canonicalInputEvents);
      assertDriverEventBatchTerminalOrder(
        preparedEvents.uniquePersistenceEvents.map((event) => event.envelope),
      );
      const provenMcpCommandIds = await proveMcpDriverEvents(env.DB, {
        driverGeneration: state.requireDriverGeneration(),
        driverInstanceId,
        events: preparedEvents.uniquePersistenceEvents,
      });
      const durableReceiptsBySource = await this.#readPersistedEventReceipts(
        link,
        preparedEvents.uniquePersistenceEvents,
      );
      const durableReceipts = projectDriverEventReceipts(
        preparedEvents.uniqueOuterEvents,
        durableReceiptsBySource,
      );
      context.assertActiveConnection();
      const pendingEvents = preparedEvents.uniquePersistenceEvents.filter(
        (event) => !durableReceiptsBySource.has(event.persistenceSourceId),
      );
      const events = pendingEvents.map((event) => event.envelope);
      const containsTerminalEvent = preparedEvents.uniquePersistenceEvents.some(
        ({ envelope: { event } }) =>
          event.kind === "run.cancelled" ||
          event.kind === "run.completed" ||
          event.kind === "run.failed",
      );
      let requiresDurableStateSync = durableReceipts.length > 0 || containsTerminalEvent;
      let requiresDriverStateReload = requiresDurableStateSync && !containsTerminalEvent;
      if (events.length === 0) {
        const replayState = await this.#readDurableStateForSync(link, requiresDriverStateReload);
        context.assertActiveConnection();
        if (replayState !== null) {
          viewCache.update(replayState);
        } else if (containsTerminalEvent) {
          // Terminal state is sealed in D1. Do not rebuild an unbounded final
          // transcript in this hibernatable Driver DO merely to discard it.
          viewCache.reset();
        }
        if (requiresDurableStateSync) {
          viewerEventDelivery.requestStateSync(link.sessionId);
        }
        return { accepted: durableReceipts };
      }

      const assertActiveRun = async (): Promise<void> => {
        if (eventSessionRunId === undefined || link.sessionId === null) {
          return;
        }

        await assertActiveRuntimeSessionRun(env.DB, {
          driverInstanceId,
          sessionId: link.sessionId,
          sessionRunId: eventSessionRunId,
        });
      };

      await assertActiveRun();
      const projection = await (async () => {
        try {
          return await projectRuntimeDriverEvents(env, {
            assertCurrentConnection: () => context.assertActiveConnection(),
            currentLiveState: viewCache.currentState,
            driverInstanceId,
            events,
            projectLiveState: !containsTerminalEvent,
            link,
            provenMcpCommandIds,
          });
        } catch (error) {
          logError("runtime.driver.events.projection_failed", {
            ...createErrorLogContext(error),
            driverInstanceId,
            ...summarizeDriverEvents(events),
          });
          throw error;
        }
      })();
      await persistProjectedRuntimeDriverEventPrerequisites(env.DB, {
        driverConnectionId: context.connectionId,
        driverGeneration: state.requireDriverGeneration(),
        driverInstanceId,
        projection,
      });
      await preflightProjectedRuntimeDriverEvents(env.DB, projection);
      context.assertActiveConnection();
      const artifactProjections = await stageRuntimeArtifactEvents(env, {
        driverFence: {
          connectionId: context.connectionId,
          driverInstanceId,
          generation: state.requireDriverGeneration(),
          sessionRunId: link.sessionRunId,
        },
        events: pendingEvents.map(toRuntimeArtifactEvent),
        link,
      });
      if (artifactProjections.size > 0) {
        requiresDurableStateSync = true;
        requiresDriverStateReload = !containsTerminalEvent;
      }
      context.assertActiveConnection();
      // An accepted source identity must already be durable. Buffering stream
      // fragments only in this hibernatable DO would acknowledge text that a
      // fresh instance cannot reconstruct, so persist every canonical event.
      const persistenceRuntimeEvents = projection.runtimeEvents.map((record) => {
        const artifact =
          record.sourceEventId === null ? undefined : artifactProjections.get(record.sourceEventId);
        return artifact === undefined
          ? record
          : {
              ...record,
              artifactAttemptId: artifact.attemptId,
              artifactManifestJson: artifact.manifestJson,
              artifactManifestSha256: artifact.manifestSha256,
            };
      });

      const commit = await (async () => {
        try {
          return await persistProjectedRuntimeDriverEvents(env, {
            driverConnectionId: context.connectionId,
            driverGeneration: state.requireDriverGeneration(),
            driverInstanceId,
            projection: {
              ...projection,
              runtimeEvents: persistenceRuntimeEvents,
            },
          });
        } catch (error) {
          logError("runtime.driver.events.persistence_failed", {
            ...createErrorLogContext(error),
            driverInstanceId,
            ...summarizeDriverEvents(events),
            persistenceEventKinds: persistenceRuntimeEvents
              .map((event) => event.event.kind)
              .slice(0, 24),
            persistenceEventSourceIds: persistenceRuntimeEvents
              .map((event) => event.sourceEventId)
              .slice(0, 24),
          });
          throw error;
        }
      })();
      context.assertActiveConnection();

      const committedReceiptsBySource = await this.#readPersistedEventReceipts(
        link,
        preparedEvents.uniquePersistenceEvents,
      );
      if (committedReceiptsBySource.size !== preparedEvents.uniquePersistenceEvents.length) {
        throw new Error("Driver event commit did not produce every durable source receipt.");
      }
      const persistedRuntimeEventSeqs = commit.persistedSourceEventIds.flatMap(
        (sourceEventId): number[] => {
          const seq = committedReceiptsBySource.get(sourceEventId)?.seq;
          return seq === undefined ? [] : [seq];
        },
      );
      const deliveryRuntimeEventSeqCursor =
        persistedRuntimeEventSeqs.length === 0 ? null : Math.max(...persistedRuntimeEventSeqs);
      const previousDeliveryRuntimeEventSeqCursor =
        deliveryRuntimeEventSeqCursor === null ||
        persistedRuntimeEventSeqs.length === 0 ||
        deliveryRuntimeEventSeqCursor - Math.min(...persistedRuntimeEventSeqs) + 1 !==
          persistedRuntimeEventSeqs.length
          ? null
          : Math.min(...persistedRuntimeEventSeqs) - 1;

      const replayState = await this.#readDurableStateForSync(link, requiresDriverStateReload);
      context.assertActiveConnection();
      if (containsTerminalEvent) {
        viewCache.reset();
      } else {
        const committedLiveState = replayState ?? commit.liveState;
        if (committedLiveState !== null) {
          viewCache.update(committedLiveState);
        }
      }

      if (!requiresDurableStateSync) {
        viewerEventDelivery.enqueue(
          projection.link.sessionId,
          filterDurablyCommittedDeliveryEvents({
            persistenceEvents: persistenceRuntimeEvents,
            persistedSourceEventIds: commit.persistedSourceEventIds,
            sessionDeliveryEvents: projection.sessionDeliveryEvents,
          }),
          deliveryRuntimeEventSeqCursor,
          previousDeliveryRuntimeEventSeqCursor,
        );
      } else {
        viewerEventDelivery.requestStateSync(link.sessionId);
      }

      const accepted = projectDriverEventReceipts(
        preparedEvents.uniqueOuterEvents,
        committedReceiptsBySource,
      );

      return { accepted };
    });
  }

  public async handlePushLogs(
    input: DriverLogBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverLogBatchOutput> {
    const { env, state } = this.#dependencies;

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }

    if (input.logs.length > LOG_BATCH_MAX_SIZE) {
      throw new Error(`Log batch exceeds max size ${LOG_BATCH_MAX_SIZE}.`);
    }
    context.assertActiveConnection();

    if (!state.hello) {
      // Drivers can flush their first batches while the hello round-trip is
      // still in flight (production DO latency routinely exceeds the flush
      // interval). Rejecting here used to kill boots; hold a bounded window
      // instead and publish it once hello commits.
      if (this.#pendingPreHelloLogBatches.length >= PRE_HELLO_LOG_BATCH_LIMIT) {
        this.#pendingPreHelloLogBatches.shift();
        this.#droppedPreHelloLogBatches += 1;
      }

      this.#pendingPreHelloLogBatches.push(input);

      return { ok: true };
    }

    await publishDriverLogBatch(env, state, input);

    return { ok: true };
  }

  public async publishPendingPreHelloLogs(): Promise<void> {
    const { env, state } = this.#dependencies;
    const pending = this.#pendingPreHelloLogBatches.splice(0);
    const dropped = this.#droppedPreHelloLogBatches;
    this.#droppedPreHelloLogBatches = 0;

    if (dropped > 0) {
      logError("runtime.driver.log.pre_hello_overflow", {
        driverInstanceId: state.requireDriverInstanceId(),
        droppedBatches: dropped,
      });
    }

    for (const batch of pending) {
      try {
        await publishDriverLogBatch(env, state, batch);
      } catch (error) {
        logError("runtime.driver.log.pre_hello_publish_failed", {
          ...createErrorLogContext(error),
          batchSize: batch.logs.length,
          driverInstanceId: state.requireDriverInstanceId(),
        });
      }
    }
  }

  public async runAfterPendingEvents<T>(operation: () => Promise<T>): Promise<T> {
    // Terminal RPCs share the event gate so a fallback completion cannot
    // snapshot progress state while the final assistant batch is still in flight.
    return this.#eventTerminalGate.run(operation);
  }

  async #getRuntimeSessionLink(
    options: { refresh?: boolean; sessionRunId?: SessionRunId } = {},
  ): Promise<RuntimeSessionLink> {
    const { env, state } = this.#dependencies;

    if (options.refresh !== true && state.runtimeSessionLink !== null) {
      return state.runtimeSessionLink;
    }

    const link = await getRuntimeSessionLink(
      env.DB,
      state.requireDriverInstanceId(),
      options.sessionRunId === undefined ? {} : { sessionRunId: options.sessionRunId },
    );
    state.setRuntimeSessionLink(link);
    return link;
  }

  async #readPersistedEventReceipts(
    link: RuntimeSessionLink,
    events: readonly HashedDriverEvent[],
  ): Promise<Map<string, SessionRuntimeEventSourceReceipt>> {
    if (link.sessionId === null) {
      return new Map<string, SessionRuntimeEventSourceReceipt>();
    }

    const sourceEventIds = events.map((event) => event.persistenceSourceId);

    if (sourceEventIds.length === 0) {
      return new Map<string, SessionRuntimeEventSourceReceipt>();
    }

    const receiptsByEventId = await getSessionRuntimeEventSourceReceipts(
      this.#dependencies.env.DB,
      {
        sessionId: link.sessionId,
        sourceEventIds,
      },
    );
    for (const event of events) {
      const receipt = receiptsByEventId.get(event.persistenceSourceId);

      if (receipt === undefined) {
        continue;
      }

      if (
        receipt.semanticHash === null ||
        receipt.semanticHash !== event.semanticHash ||
        receipt.type !== event.envelope.event.kind
      ) {
        throw new Error(
          `Driver event source ${event.persistenceSourceId} conflicts with its durable receipt.`,
        );
      }
    }

    return receiptsByEventId;
  }

  async #readDurableStateForSync(
    link: RuntimeSessionLink,
    required: boolean,
  ): Promise<SessionLiveState | null> {
    if (link.sessionId === null || !required) {
      return null;
    }
    const viewerId = link.callerId ?? link.creatorId;
    if (viewerId === null) {
      throw new Error("Durable Driver event replay is missing its Session viewer identity.");
    }

    return loadSessionViewerState(this.#dependencies.env.DB, {
      sessionId: link.sessionId,
      viewerId,
    });
  }
}

function projectDriverEventReceipts(
  events: readonly HashedDriverEvent[],
  receiptsBySource: ReadonlyMap<string, SessionRuntimeEventSourceReceipt>,
): DriverEventReceipt[] {
  return events.flatMap((event) => {
    const receipt = receiptsBySource.get(event.persistenceSourceId);

    return receipt === undefined
      ? []
      : [
          {
            eventId: event.envelope.eventId,
            seq: receipt.seq,
            type: event.envelope.event.kind,
          },
        ];
  });
}

async function prepareDriverEventBatch(
  events: readonly CanonicalDriverEventEnvelope[],
): Promise<PreparedDriverEventBatch> {
  const hashedEvents = await Promise.all(
    events.map(async (envelope) => ({
      envelope,
      persistenceSourceId: resolveDriverEventPersistenceSourceId(envelope),
      semanticHash: await createRuntimeEventSemanticHash(envelope.event),
    })),
  );
  const outerIdentities = new Map<string, HashedDriverEvent>();
  const persistenceIdentities = new Map<string, HashedDriverEvent>();

  for (const event of hashedEvents) {
    const outer = outerIdentities.get(event.envelope.eventId);

    if (outer !== undefined) {
      assertMatchingDriverEventIdentity(outer, event, "outer");
    } else {
      outerIdentities.set(event.envelope.eventId, event);
    }

    const persisted = persistenceIdentities.get(event.persistenceSourceId);

    if (persisted !== undefined) {
      assertMatchingDriverEventIdentity(persisted, event, "durable");
    } else {
      persistenceIdentities.set(event.persistenceSourceId, event);
    }
  }

  return {
    uniqueOuterEvents: [...outerIdentities.values()],
    uniquePersistenceEvents: [...persistenceIdentities.values()],
  };
}

function assertMatchingDriverEventIdentity(
  expected: HashedDriverEvent,
  actual: HashedDriverEvent,
  identityKind: "durable" | "outer",
): void {
  if (
    expected.persistenceSourceId !== actual.persistenceSourceId ||
    expected.semanticHash !== actual.semanticHash
  ) {
    throw new Error(`Driver event batch contains a conflicting ${identityKind} source identity.`);
  }
}

export function assertDriverEventBatchTerminalOrder(
  events: readonly CanonicalDriverEventEnvelope[],
): void {
  const terminalIndexes = events.flatMap((event, index) =>
    event.event.kind === "run.cancelled" ||
    event.event.kind === "run.completed" ||
    event.event.kind === "run.failed"
      ? [index]
      : [],
  );

  if (terminalIndexes.length > 1) {
    throw new Error("Driver event batch cannot contain multiple run terminal events.");
  }

  if (terminalIndexes[0] !== undefined && terminalIndexes[0] !== events.length - 1) {
    throw new Error("Driver event batch run terminal event must be last.");
  }
}

function readMcpDriverEventIdentity(event: CanonicalDriverEventEnvelope): {
  commandId: DriverCommandId;
  sourceEventId: string;
  status: "cancelled" | "completed" | "failed" | "running";
} | null {
  const sourceEventId = event.event.sourceEventId ?? event.eventId;
  const reservedSource = sourceEventId.startsWith("mcp.execute.");
  const mcpPayload =
    event.event.kind === "tool.call.updated" &&
    readRuntimeEventToolCallUpdate(event.event).kind === "mcp";

  if (!reservedSource && !mcpPayload) {
    return null;
  }
  if (!reservedSource || !mcpPayload) {
    throw new Error("MCP tool events require their reserved command source identity.");
  }

  const commandId = parsePlatformId<DriverCommandId>(
    event.event.correlationId,
    "MCP event command correlation ID",
  );

  for (const status of ["running", "completed", "failed", "cancelled"] as const) {
    const prefix = `mcp.execute.${status}:`;

    if (!sourceEventId.startsWith(prefix)) {
      continue;
    }

    if (event.event.sourceEventId !== sourceEventId || event.eventId !== sourceEventId) {
      throw new Error("MCP event transport identity does not match its command.");
    }

    if (
      status !== "failed" &&
      commandId !==
        parsePlatformId<DriverCommandId>(
          sourceEventId.slice(prefix.length),
          "MCP event source command ID",
        )
    ) {
      throw new Error("MCP event transport identity does not match its command.");
    }

    return { commandId, sourceEventId, status };
  }

  throw new Error("MCP event source identity has an unsupported terminal status.");
}

async function proveMcpDriverEvents(
  database: D1Database,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    events: readonly HashedDriverEvent[];
  },
): Promise<ReadonlyMap<string, DriverCommandId>> {
  const proven = new Map<string, DriverCommandId>();

  for (const { envelope } of input.events) {
    const identity = readMcpDriverEventIdentity(envelope);

    if (identity === null) {
      continue;
    }

    if (envelope.event.kind !== "tool.call.updated") {
      throw new Error("MCP command source identity requires a tool.call.updated event.");
    }

    const record = await getRuntimeCommandRecord(
      database,
      input.driverInstanceId,
      input.driverGeneration,
      identity.commandId,
    );

    if (record === null || record.kind !== "mcp.execute") {
      throw new Error("MCP event does not have an immutable command in this Driver generation.");
    }

    if (
      record.status !== "accepted" &&
      (identity.status === "running" || record.status !== identity.status)
    ) {
      throw new Error("MCP event conflicts with the command's durable lifecycle status.");
    }

    const command = record.payload;
    const toolCall = readRuntimeEventToolCallUpdate(envelope.event);
    const effect = await getExternalToolEffectForCommand(database, {
      commandId: identity.commandId,
      driverGeneration: input.driverGeneration,
      driverInstanceId: input.driverInstanceId,
    });

    if (
      effect === null ||
      envelope.event.driverInstanceId !== input.driverInstanceId ||
      envelope.event.runId !== command.runId ||
      toolCall.content !== null ||
      toolCall.kind !== "mcp" ||
      toolCall.messageId !== null ||
      toolCall.parentMessageId !== null ||
      toolCall.rawInput !== command.argumentsJson ||
      toolCall.rawInputDelta !== null ||
      toolCall.rawOutputDelta !== null ||
      toolCall.status !== identity.status ||
      toolCall.title !== command.toolName ||
      toolCall.toolCallId !== command.toolCallId
    ) {
      throw new Error("MCP event does not match its immutable command intent.");
    }

    if (identity.status === "completed") {
      if (effect.status !== "succeeded" || effect.resultJson === null) {
        throw new Error("MCP completion event has no succeeded durable external effect.");
      }

      const result = parseSchemaValue(McpExecuteCommandResult, JSON.parse(effect.resultJson));

      if (
        result.requestId !== command.requestId ||
        result.serverId !== command.serverId ||
        result.toolName !== command.toolName ||
        toolCall.rawOutput !== result.outputText ||
        (record.status === "completed" &&
          (record.result === null ||
            record.result.outputText !== result.outputText ||
            record.result.requestId !== result.requestId ||
            record.result.serverId !== result.serverId ||
            record.result.toolName !== result.toolName ||
            (record.result.isError ?? false) !== (result.isError ?? false)))
      ) {
        throw new Error("MCP completion event conflicts with its durable external effect result.");
      }
    } else if (identity.status === "failed") {
      if (
        (effect.status !== "intent" && effect.status !== "unknown") ||
        toolCall.rawOutput === null ||
        toolCall.rawOutput.length === 0 ||
        (record.status === "failed" && record.error?.message !== toolCall.rawOutput)
      ) {
        throw new Error("MCP failure event conflicts with its durable external effect state.");
      }

      const failedEvent = createMcpExecuteFailedEventIdentity({
        commandId: identity.commandId,
        rawInput: command.argumentsJson,
        rawOutput: toolCall.rawOutput,
        title: command.toolName,
        toolCallId: command.toolCallId,
      });
      const payload = envelope.event.payload;

      if (
        identity.sourceEventId !== failedEvent.sourceEventId ||
        !isRuntimeEventRecord(payload) ||
        Object.keys(payload).length !== Object.keys(failedEvent.payload).length ||
        Object.entries(failedEvent.payload).some(([key, value]) => payload[key] !== value)
      ) {
        throw new Error("MCP failure event does not have its canonical content identity.");
      }
    } else if (toolCall.rawOutput !== null || effect.status !== "intent") {
      throw new Error("Unsettled MCP event contains an impossible external effect output.");
    }

    if (identity.status !== "running") {
      proven.set(envelope.eventId, identity.commandId);
    }
  }

  return proven;
}

function filterDurablyCommittedDeliveryEvents(input: {
  persistenceEvents: readonly { readonly sourceEventId: string | null }[];
  persistedSourceEventIds: readonly string[];
  sessionDeliveryEvents: readonly {
    readonly event: SessionDeliveryEvent;
    readonly sourceEventId: string | null;
  }[];
}): SessionDeliveryEvent[] {
  const persistedSourceEventIds = new Set(input.persistedSourceEventIds);
  const persistenceSourceEventIds = new Set(
    input.persistenceEvents.flatMap((event) =>
      event.sourceEventId === null ? [] : [event.sourceEventId],
    ),
  );

  return input.sessionDeliveryEvents.flatMap((record) => {
    if (record.sourceEventId === null || !persistenceSourceEventIds.has(record.sourceEventId)) {
      return [record.event];
    }

    return persistedSourceEventIds.has(record.sourceEventId) ? [record.event] : [];
  });
}
