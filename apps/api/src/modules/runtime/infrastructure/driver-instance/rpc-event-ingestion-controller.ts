import { compactAgUiSessionEvents } from "@mosoo/ag-ui-session";
import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import type {
  DriverEventBatchInput,
  DriverEventReceipt,
  DriverLogBatchInput,
  DriverLogBatchOutput,
} from "@mosoo/agent-driver/orpc";
import { parsePlatformId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import { publishSessionViewerEventsSafely } from "../../../sessions/application/session-event-write.service";
import { getSessionRuntimeEventSourceReceipts } from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { EVENT_BATCH_MAX_SIZE, LOG_BATCH_MAX_SIZE } from "./connections";
import { DriverEventTerminalGate } from "./driver-event-terminal-gate";
import { publishDriverLogBatch } from "./driver-log-batch-publisher";
import { persistProjectedRuntimeDriverEvents } from "./event-persistence";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import type { RuntimeSessionLink } from "./event-types";
import { projectRuntimeDriverEvents, resolveDriverEventPersistenceSourceId } from "./events";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";

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

export class DriverInstanceRpcEventIngestionController {
  readonly #dependencies: DriverInstanceRpcControllerDependencies;
  readonly #eventTerminalGate = new DriverEventTerminalGate();

  public constructor(dependencies: DriverInstanceRpcControllerDependencies) {
    this.#dependencies = dependencies;
  }

  public async handlePushEvents(
    input: DriverEventBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ accepted: DriverEventReceipt[] }> {
    const { state } = this.#dependencies;

    if (!state.hello) {
      throw new Error("Driver hello is required before pushEvents.");
    }

    if (input.events.length > EVENT_BATCH_MAX_SIZE) {
      throw new Error(`Event batch exceeds max size ${EVENT_BATCH_MAX_SIZE}.`);
    }
    context.assertActiveConnection();

    return this.#eventTerminalGate.run(async () => {
      context.assertActiveConnection();
      const { env } = this.#dependencies;
      const driverInstanceId = state.requireDriverInstanceId();
      const cachedLink = state.runtimeSessionLink;
      const eventSessionRunId = resolveEventSessionRunId(input.events);
      const link = await state.getRuntimeSessionLink(env.DB, {
        refresh:
          input.events.some((envelope) => envelope.event.kind === "run.started") ||
          runtimeSessionLinkNeedsRefresh(cachedLink) ||
          (eventSessionRunId !== undefined && cachedLink?.sessionRunId !== eventSessionRunId),
        ...(eventSessionRunId === undefined ? {} : { sessionRunId: eventSessionRunId }),
      });
      context.assertActiveConnection();
      const receipts = await this.#readPersistedEventReceipts(link, input.events);
      context.assertActiveConnection();
      // Receipts must be a prefix of the submitted batch in submission order;
      // durable events keep their persisted receipt, new ones get the next seq.
      const accepted: DriverEventReceipt[] = [];
      const events: DriverEventEnvelope[] = [];

      for (const envelope of input.events) {
        let receipt = receipts.get(envelope.eventId);

        if (receipt === undefined) {
          state.driverEventReceiptSeq += 1;
          receipt = {
            eventId: envelope.eventId,
            seq: state.driverEventReceiptSeq,
            type: envelope.event.kind,
          };
          receipts.set(envelope.eventId, receipt);
          events.push(envelope);
        }

        accepted.push(receipt);
      }

      if (events.length === 0) {
        return { accepted };
      }

      const projection = await (async () => {
        try {
          return await projectRuntimeDriverEvents(env, {
            assertCurrentConnection: () => context.assertActiveConnection(),
            currentLiveState: state.liveState,
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
      const commit = await (async () => {
        try {
          return await persistProjectedRuntimeDriverEvents(env, {
            driverInstanceId,
            projection,
          });
        } catch (error) {
          logError("runtime.driver.events.persistence_failed", {
            ...createErrorLogContext(error),
            driverInstanceId,
            ...summarizeDriverEvents(events),
          });
          throw error;
        }
      })();
      context.assertActiveConnection();

      if (commit.liveState !== null) {
        state.liveState = commit.liveState;
      }

      const persistedSourceEventIds = new Set(commit.persistedSourceEventIds);
      await publishSessionViewerEventsSafely(
        env,
        projection.link.sessionId,
        compactAgUiSessionEvents(
          projection.sessionDeliveryEvents.flatMap((record) =>
            persistedSourceEventIds.has(record.sourceEventId) ? [record.event] : [],
          ),
        ),
      );

      return { accepted };
    });
  }

  public async handlePushLogs(
    input: DriverLogBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverLogBatchOutput> {
    const { env, state } = this.#dependencies;

    if (input.logs.length > LOG_BATCH_MAX_SIZE) {
      throw new Error(`Log batch exceeds max size ${LOG_BATCH_MAX_SIZE}.`);
    }
    context.assertActiveConnection();

    await publishDriverLogBatch(env, state, input);

    return { ok: true };
  }

  public async runAfterPendingEvents<T>(operation: () => Promise<T>): Promise<T> {
    // Terminal RPCs share the event gate so a fallback completion cannot
    // snapshot progress state while the final assistant batch is still in flight.
    return this.#eventTerminalGate.run(operation);
  }

  async #readPersistedEventReceipts(
    link: RuntimeSessionLink,
    events: readonly DriverEventEnvelope[],
  ): Promise<Map<string, DriverEventReceipt>> {
    const receipts = new Map<string, DriverEventReceipt>();

    if (link.sessionId === null) {
      return receipts;
    }

    const persistedReceipts = await getSessionRuntimeEventSourceReceipts(
      this.#dependencies.env.DB,
      {
        sessionId: link.sessionId,
        sourceEventIds: events.map(resolveDriverEventPersistenceSourceId),
      },
    );

    for (const event of events) {
      const receipt = persistedReceipts.get(resolveDriverEventPersistenceSourceId(event));

      if (receipt !== undefined) {
        receipts.set(event.eventId, { ...receipt, eventId: event.eventId });
      }
    }

    return receipts;
  }
}
