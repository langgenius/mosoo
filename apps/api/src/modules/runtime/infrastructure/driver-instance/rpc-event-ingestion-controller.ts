import { createPromiseDeferred } from "@mosoo/effects";
import type { DriverEventEnvelope } from "agent-driver/events";
import type {
  DriverEventBatchInput,
  DriverEventBatchOutput,
  DriverEventReceipt,
  DriverLogBatchInput,
  DriverLogBatchOutput,
} from "agent-driver/orpc";

import type { SessionDeliveryEvent } from "../../../sessions/application/session-live-state.service";
import { getSessionRuntimeEventSourceReceipts } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { EVENT_BATCH_MAX_SIZE, LOG_BATCH_MAX_SIZE } from "./connections";
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
import { RuntimeEventPersistenceCompactor } from "./runtime-event-persistence-compactor";
import { filterDurablyAcceptedRuntimeStreamReplays } from "./runtime-event-replay-filter";

export class DriverInstanceRpcEventIngestionController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;
  #driverEventGate: Promise<unknown> = Promise.resolve();
  readonly #runtimeEventPersistenceCompactor = new RuntimeEventPersistenceCompactor();

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

    return this.#withDriverEventGate(async () => {
      context.assertActiveConnection();
      const { env, fileWatch, viewCache, viewerEventDelivery } = this.#dependencies;
      const cachedLink = state.runtimeSessionLink;
      const shouldRefreshLink =
        input.events.some((envelope) => envelope.event.kind === "run.started") ||
        runtimeSessionLinkNeedsRefresh(cachedLink);
      const link = await this.#getRuntimeSessionLink({ refresh: shouldRefreshLink });
      context.assertActiveConnection();
      fileWatch.ensureStarted(link);
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

      const projection = await appRuntimeDriverEvents(env.DB, {
        assertCurrentConnection: () => context.assertActiveConnection(),
        currentLiveState: viewCache.currentState,
        driverInstanceId,
        events,
        link,
      });
      const persistenceRuntimeEvents = this.#runtimeEventPersistenceCompactor.compact(
        projection.runtimeEvents,
      );

      const commit = await persistProjectedRuntimeDriverEvents(env, {
        driverInstanceId,
        projection: {
          ...projection,
          runtimeEvents: persistenceRuntimeEvents,
        },
      });
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

    if (!state.hello) {
      throw new Error("Driver hello is required before pushLogs.");
    }

    if (input.driverInstanceId !== state.requireDriverInstanceId()) {
      throw new Error("Driver instance id mismatch.");
    }

    if (input.logs.length > LOG_BATCH_MAX_SIZE) {
      throw new Error(`Log batch exceeds max size ${LOG_BATCH_MAX_SIZE}.`);
    }
    context.assertActiveConnection();

    await publishDriverLogBatch(env, state, input);

    return { ok: true };
  }

  async #getRuntimeSessionLink(options: { refresh?: boolean } = {}): Promise<RuntimeSessionLink> {
    const { env, state } = this.#dependencies;

    if (options.refresh !== true && state.runtimeSessionLink !== null) {
      return state.runtimeSessionLink;
    }

    const link = await getRuntimeSessionLink(env.DB, state.requireDriverInstanceId());
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

  async #withDriverEventGate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#driverEventGate;
    const nextGate = createPromiseDeferred<null>();
    this.#driverEventGate = nextGate.promise;
    await previous;

    try {
      return await operation();
    } finally {
      nextGate.resolve(null);
    }
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
