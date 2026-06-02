import type { SessionId, SessionRunId } from "@mosoo/id";
import type { RuntimeTimingPayload, RuntimeTimingPhase } from "@mosoo/runtime-events";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { createStopwatch, systemClock, toDurationMs } from "../../../../time";
import type { Clock } from "../../../../time";
import {
  appendSessionRuntimeEvents,
  createSessionRuntimeEvent,
} from "../../../sessions/application/session-event-write.service";

export type RuntimeTimingPath = RuntimeTimingPayload["path"];
export type RuntimeTimingStage = RuntimeTimingPayload["stage"];

export type RuntimeTimingSnapshot = RuntimeTimingPayload & {
  readonly runId: SessionRunId | null;
  readonly sessionId: SessionId;
};

export interface RuntimeTimingRecorder {
  addPhase(name: string, durationMs: number): void;
  measure<T>(name: string, task: () => Promise<T>): Promise<T>;
  snapshot(input?: { path?: RuntimeTimingPath }): RuntimeTimingSnapshot;
}

export function createRuntimeTimingRecorder(input: {
  clock?: Clock;
  path?: RuntimeTimingPath;
  runId: SessionRunId | null;
  sessionId: SessionId;
  source: RuntimeTimingPayload["source"];
  stage: RuntimeTimingStage;
  traceId: string | null;
}): RuntimeTimingRecorder {
  const clock = input.clock ?? systemClock;
  const stopwatch = createStopwatch(clock);
  const phases: RuntimeTimingPhase[] = [];
  const defaultPath = input.path ?? "unknown";

  return {
    addPhase(name, durationMs) {
      phases.push({
        durationMs: toDurationMs(durationMs),
        name,
      });
    },
    async measure(name, task) {
      const phase = createStopwatch(clock);

      try {
        return await task();
      } finally {
        this.addPhase(name, phase.elapsedMs());
      }
    },
    snapshot(options) {
      const completedAtMs = clock.nowMs();

      return {
        completedAtMs,
        path: options?.path ?? defaultPath,
        phases: [...phases],
        runId: input.runId,
        sessionId: input.sessionId,
        source: input.source,
        stage: input.stage,
        startedAtMs: stopwatch.startedAtMs,
        totalMs: stopwatch.elapsedAt(completedAtMs),
        traceId: input.traceId,
      };
    },
  };
}

export async function appendSessionRuntimeTimingEvent(input: {
  bindings: ApiBindings;
  timing: RuntimeTimingSnapshot;
}): Promise<void> {
  await appendSessionRuntimeEvents({
    bindings: input.bindings,
    events: [
      createSessionRuntimeEvent({
        kind: "runtime.timing.recorded",
        occurredAtMs: input.timing.completedAtMs,
        payload: input.timing,
        runId: input.timing.runId,
        sessionId: input.timing.sessionId,
        traceId: input.timing.traceId,
      }),
    ],
    sessionId: input.timing.sessionId,
  });
}

export async function appendSessionRuntimeTimingEventBestEffort(input: {
  bindings: ApiBindings;
  timing: RuntimeTimingSnapshot;
}): Promise<void> {
  try {
    await appendSessionRuntimeTimingEvent(input);
  } catch (error) {
    logWarn("session.runtime_timing.append_failed", {
      ...createErrorLogContext(error),
      runId: input.timing.runId,
      sessionId: input.timing.sessionId,
      stage: input.timing.stage,
    });
  }
}
