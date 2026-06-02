export interface Clock {
  nowMs(): number;
}

export interface Stopwatch {
  readonly startedAtMs: number;
  elapsedAt(timestampMs: number): number;
  elapsedMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
};

export function currentTimestampMs(): number {
  return systemClock.nowMs();
}

export function toDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    throw new Error("Duration must be a finite millisecond value.");
  }

  return Math.max(0, Math.round(durationMs));
}

export function createStopwatch(clock: Clock = systemClock): Stopwatch {
  const startedAtMs = clock.nowMs();

  return {
    startedAtMs,
    elapsedAt(timestampMs) {
      return toDurationMs(timestampMs - startedAtMs);
    },
    elapsedMs() {
      return toDurationMs(clock.nowMs() - startedAtMs);
    },
  };
}

export function toIsoString(timestampMs: number | string): string {
  const normalizedTimestampMs = Number(timestampMs);

  if (!Number.isFinite(normalizedTimestampMs)) {
    throw new Error("Timestamp must be a finite millisecond value.");
  }

  return new Date(normalizedTimestampMs).toISOString();
}
