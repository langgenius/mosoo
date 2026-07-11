import { parsePlatformId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";
import type { DriverEventEnvelope } from "agent-driver/events";
import type {
  DriverEventBatchInput,
  DriverEventBatchOutput,
  DriverEventReceipt,
  DriverLogBatchInput,
  DriverLogBatchOutput,
} from "agent-driver/orpc";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import type { SessionDeliveryEvent } from "../../../sessions/application/session-live-state.service";
import { getSessionRuntimeEventSourceReceipts } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { EVENT_BATCH_MAX_SIZE, LOG_BATCH_MAX_SIZE } from "./connections";
import { DriverEventTerminalGate } from "./driver-event-terminal-gate";
import { publishDriverLogBatch } from "./driver-log-batch-publisher";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import {
  getRuntimeSessionLink,
  persistProjectedRuntimeDriverEvents,
  appRuntimeDriverEvents,
} from "./events";
import type { RuntimeSessionLink } from "./events";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import { filterDurablyAcceptedRuntimeStreamReplays } from "./runtime-event-replay-filter";

function summarizeDriverEvents(events: readonly DriverEventEnvelope[]) {
  return {
    eventCount: events.length,
    eventKinds: events.map((event) => event.event.kind).slice(0, 24),
    sourceEventIds: events.map((event) => event.eventId).slice(0, 24),
  };
}

function resolveEventSessionRunId(
  events: readonly DriverEventEnvelope[],
): SessionRunId | undefined {
  let eventRunId: string | undefined;

  for (const envelope of events) {
    const candidateRunId = envelope.event.runId;

    if (candidateRunId === undefined) {
      continue;
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
    input: DriverEventBatchInput,
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
        input.events.some((envelope) => envelope.event.kind === "run.started") ||
        runtimeSessionLinkNeedsRefresh(cachedLink) ||
        (eventSessionRunId !== undefined && cachedLink?.sessionRunId !== eventSessionRunId);
      const link = await this.#getRuntimeSessionLink({
        refresh: shouldRefreshLink,
        ...(eventSessionRunId === undefined ? {} : { sessionRunId: eventSessionRunId }),
      });
      context.assertActiveConnection();
      const replayedReceipts = state.readProcessedDriverEventReceipts(input.events);
      const candidateEvents = state.filterUnprocessedDriverEvents(input.events);
      const durableReceipts = await this.#readPersistedEventReceipts(link, candidateEvents);
      context.assertActiveConnection();
      const durableEventIds = new Set(
        durableReceipts.flatMap((receipt) =>
          receipt.eventId === undefined ? [] : [receipt.eventId],
        ),
      );
      const events = filterDurablyAcceptedRuntimeStreamReplays(candidateEvents, durableEventIds);
      const replayedAccepted = [...replayedReceipts, ...durableReceipts];

      if (events.length === 0) {
        state.rememberProcessedDriverEventReceipts(replayedAccepted);
        return { accepted: replayedAccepted };
      }

      const projection = await (async () => {
        try {
          return await appRuntimeDriverEvents(env, {
            assertCurrentConnection: () => context.assertActiveConnection(),
            currentLiveState: viewCache.currentState,
            driverInstanceId,
            events,
            link,
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
      // An accepted source identity must already be durable. Buffering stream
      // fragments only in this hibernatable DO would acknowledge text that a
      // fresh instance cannot reconstruct, so persist every canonical event.
      const persistenceRuntimeEvents = projection.runtimeEvents;

      const commit = await (async () => {
        try {
          return await persistProjectedRuntimeDriverEvents(env, {
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

      if (commit.liveState) {
        viewCache.update(commit.liveState);
      }

      viewerEventDelivery.enqueue(
        projection.link.sessionId,
        filterDurablyCommittedDeliveryEvents({
          persistenceEvents: persistenceRuntimeEvents,
          persistedSourceEventIds: commit.persistedSourceEventIds,
          sessionDeliveryEvents: projection.sessionDeliveryEvents,
        }),
      );

      const accepted = [...replayedAccepted, ...state.createDriverEventReceipts(events)];

      state.rememberProcessedDriverEventReceipts(accepted);

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
    events: readonly DriverEventEnvelope[],
  ): Promise<DriverEventReceipt[]> {
    if (link.sessionId === null) {
      return [];
    }

    const sourceEventIds = events
      .map((event) => event.eventId)
      .filter((eventId) => eventId.length > 0);

    if (sourceEventIds.length === 0) {
      return [];
    }

    const receiptsByEventId = await getSessionRuntimeEventSourceReceipts(
      this.#dependencies.env.DB,
      {
        sessionId: link.sessionId,
        sourceEventIds,
      },
    );
    const receipts: DriverEventReceipt[] = [];
    const seenEventIds = new Set<string>();

    for (const event of events) {
      if (event.eventId.length === 0 || seenEventIds.has(event.eventId)) {
        continue;
      }

      seenEventIds.add(event.eventId);

      const receipt = receiptsByEventId.get(event.eventId);

      if (receipt === undefined) {
        continue;
      }

      receipts.push(receipt);
    }

    return receipts;
  }
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
