import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";
import type { RuntimeTimingPayload, RuntimeTimingPhase } from "@mosoo/runtime-events";

type DriverRuntimeTimingPath = RuntimeTimingPayload["path"];
type DriverRuntimeTimingStage = RuntimeTimingPayload["stage"];

interface CreateDriverRuntimeTimingEventInput {
  readonly completedAtMs?: number;
  readonly native?: DriverEventInput["native"] | undefined;
  readonly path: DriverRuntimeTimingPath;
  readonly phases: readonly RuntimeTimingPhase[];
  readonly runId: SessionRunId | null;
  readonly sessionId: string;
  readonly sourceEventId?: string | undefined;
  readonly stage: DriverRuntimeTimingStage;
  readonly startedAtMs: number;
  readonly traceId?: string | null;
}

export function toDriverDurationMs(
  startedAtMs: number,
  completedAtMs: number = Date.now(),
): number {
  const durationMs = completedAtMs - startedAtMs;

  if (!Number.isFinite(durationMs)) {
    throw new Error("Driver runtime timing duration must be finite.");
  }

  return Math.max(0, Math.round(durationMs));
}

export function createDriverRuntimeTimingPhase(
  name: string,
  durationMs: number,
): RuntimeTimingPhase {
  if (!Number.isFinite(durationMs)) {
    throw new Error("Driver runtime timing phase duration must be finite.");
  }

  return {
    durationMs: Math.max(0, Math.round(durationMs)),
    name,
  };
}

export function createDriverRuntimeTimingEvent(
  input: CreateDriverRuntimeTimingEventInput,
): DriverEventInput {
  const completedAtMs = input.completedAtMs ?? Date.now();

  return {
    kind: "runtime.timing.recorded",
    ...(input.native === undefined ? {} : { native: input.native }),
    occurredAt: new Date(completedAtMs).toISOString(),
    payload: {
      completedAtMs,
      path: input.path,
      phases: input.phases.map((phase) =>
        createDriverRuntimeTimingPhase(phase.name, phase.durationMs),
      ),
      runId: input.runId,
      sessionId: input.sessionId,
      source: "driver",
      stage: input.stage,
      startedAtMs: input.startedAtMs,
      totalMs: toDriverDurationMs(input.startedAtMs, completedAtMs),
      traceId: input.traceId ?? null,
    },
    ...(input.sourceEventId === undefined ? {} : { sourceEventId: input.sourceEventId }),
    visibility: "owner_debug",
  };
}
