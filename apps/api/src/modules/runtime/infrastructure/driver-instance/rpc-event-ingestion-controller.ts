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
import { parseRuntimeEventEnvelope } from "@mosoo/runtime-events";

import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import { publishSessionViewerEventsSafely } from "../../../sessions/application/session-event-write.service";
import { finalizeSessionModelCallUsage } from "../../../sessions/infrastructure/session-model-call.repository";
import {
  canonicalRuntimeEventJson,
  getSessionRuntimeEventSourceReceipts,
} from "../../../sessions/infrastructure/session-runtime-event-store.repository";
import { isTerminalSessionRunStatus } from "../../domain/session-run-lifecycle.machine";
import { getSessionRunSummary } from "../session-runs/session-run-read.repository";
import { EVENT_BATCH_MAX_SIZE, LOG_BATCH_MAX_SIZE } from "./connections";
import { DriverEventTerminalGate } from "./driver-event-terminal-gate";
import { publishDriverLogBatch } from "./driver-log-batch-publisher";
import {
  assertRuntimeEventMatchesDriverEnvelope,
  assertRuntimeEventMatchesDriverLink,
} from "./event-link-assertion";
import { persistProjectedRuntimeDriverEvents } from "./event-persistence";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import type { RuntimeSessionLink } from "./event-types";
import { projectRuntimeDriverEvents, resolveDriverEventPersistenceSourceId } from "./events";
import type { DriverInstanceRpcOperationContext } from "./rpc";
import type { DriverInstanceRpcControllerDependencies } from "./rpc-controller-dependencies";
import { terminalConflict } from "./terminal-conflict";
import { releaseTerminalDriverInstanceSessionRun } from "./terminal-run-release";

function parseDriverRuntimeEvent(envelope: DriverEventEnvelope, link: RuntimeSessionLink) {
  try {
    return parseRuntimeEventEnvelope(envelope.event);
  } catch (error) {
    if (!["run.completed", "run.failed", "run.cancelled"].includes(envelope.event.kind))
      throw error;
    throw terminalConflict({
      currentStatus: link.sessionRunStatus,
      runId: link.sessionRunId,
      sourceEventId: envelope.eventId,
      reason: "Terminal event violates the runtime event contract.",
    });
  }
}

function canonicalDriverEventJson(envelope: DriverEventEnvelope, link: RuntimeSessionLink): string {
  return canonicalRuntimeEventJson(parseDriverRuntimeEvent(envelope, link));
}

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
      for (const envelope of input.events) {
        const event = parseDriverRuntimeEvent(envelope, link);
        assertRuntimeEventMatchesDriverLink(event, { driverInstanceId, link });
        assertRuntimeEventMatchesDriverEnvelope(event, { eventId: envelope.eventId });
      }
      const receipts = await this.#readPersistedEventReceipts(link, input.events);
      context.assertActiveConnection();
      if (
        link.sessionRunId !== null &&
        input.events.some(
          (envelope) =>
            receipts.has(envelope.eventId) &&
            ["run.completed", "run.failed", "run.cancelled"].includes(envelope.event.kind),
        )
      ) {
        await finalizeSessionModelCallUsage(env.DB, link.sessionRunId);
        await releaseTerminalDriverInstanceSessionRun(env, {
          driverInstanceId,
          sessionRunId: link.sessionRunId,
        });
      }
      const events: DriverEventEnvelope[] = [];
      const submitted = new Map<string, string>();
      for (const envelope of input.events) {
        const sourceId = resolveDriverEventPersistenceSourceId(envelope);
        const canonical = canonicalDriverEventJson(envelope, link);
        const previous = submitted.get(sourceId);
        if (previous !== undefined && previous !== canonical) {
          throw terminalConflict({
            currentStatus: link.sessionRunStatus,
            runId: link.sessionRunId,
            sourceEventId: sourceId,
            reason: "Source event identity changed within the batch.",
          });
        }
        if (previous === undefined && !receipts.has(envelope.eventId)) {
          events.push(envelope);
        }
        submitted.set(sourceId, canonical);
      }

      if (events.length === 0) {
        return { accepted: input.events.map((event) => receipts.get(event.eventId)!) };
      }

      if (
        events.filter((envelope) =>
          ["run.completed", "run.failed", "run.cancelled"].includes(envelope.event.kind),
        ).length > 1
      ) {
        throw terminalConflict({
          currentStatus: link.sessionRunStatus,
          runId: link.sessionRunId,
          reason: "A batch cannot commit multiple terminal events.",
        });
      }
      const terminal = events.find((envelope) =>
        ["run.completed", "run.failed", "run.cancelled"].includes(envelope.event.kind),
      );
      if (terminal !== undefined && link.sessionRunId !== null) {
        const run = await getSessionRunSummary(env.DB, link.sessionRunId);
        if (run !== null && isTerminalSessionRunStatus(run.status)) {
          const committed = await this.#readPersistedEventReceipts(link, [terminal]);
          if (!committed.has(terminal.eventId)) {
            throw terminalConflict({
              currentStatus: run.status,
              runId: run.id,
              sourceEventId: terminal.eventId,
              reason: "A different terminal event already completed this Run.",
            });
          }
          events.splice(events.indexOf(terminal), 1);
          await releaseTerminalDriverInstanceSessionRun(env, {
            driverInstanceId,
            sessionRunId: run.id,
          });
        }
      }
      // Persist resets in source order before projecting later cursor observations.
      const segments: DriverEventEnvelope[][] = [];
      let pendingSegment: DriverEventEnvelope[] = [];
      for (const event of events) {
        if (event.event.kind === "runtime.session.reset") {
          if (pendingSegment.length > 0) segments.push(pendingSegment);
          segments.push([event]);
          pendingSegment = [];
        } else {
          pendingSegment.push(event);
        }
      }
      if (pendingSegment.length > 0) segments.push(pendingSegment);
      for (const segment of segments) {
        const projection = await (async () => {
          try {
            return await projectRuntimeDriverEvents(env, {
              assertCurrentConnection: () => context.assertActiveConnection(),
              currentLiveState: state.liveState,
              driverInstanceId,
              events: segment,
              link,
            });
          } catch (error) {
            logError("runtime.driver.events.projection_failed", {
              ...createErrorLogContext(error),
              driverInstanceId,
              ...summarizeDriverEvents(segment),
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
              ...summarizeDriverEvents(segment),
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
      }

      const durableReceipts = await this.#readPersistedEventReceipts(link, input.events);
      const accepted: DriverEventReceipt[] = [];
      for (const envelope of input.events) {
        const receipt = durableReceipts.get(envelope.eventId);
        if (receipt === undefined) {
          throw terminalConflict({
            currentStatus: link.sessionRunStatus,
            runId: link.sessionRunId,
            sourceEventId: envelope.eventId,
            reason: "Runtime event did not commit a durable receipt.",
          });
        }
        accepted.push(receipt);
      }
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
    // The terminal RPC checks only after pending canonical events have committed.
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
        if (receipt.canonicalEventJson !== canonicalDriverEventJson(event, link)) {
          throw terminalConflict({
            currentStatus: link.sessionRunStatus,
            runId: link.sessionRunId,
            sourceEventId: event.eventId,
            reason: "Source event identity already belongs to a different runtime event.",
          });
        }
        receipts.set(event.eventId, {
          eventId: event.eventId,
          seq: receipt.seq,
          type: event.event.kind,
        });
      }
    }

    return receipts;
  }
}
