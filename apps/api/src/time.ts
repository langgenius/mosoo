export interface Stopwatch {
  readonly startedAtMs: number;
  elapsedAt(timestampMs: number): number;
  elapsedMs(): number;
}

export const systemClock = {
  nowMs: (): number => Date.now(),
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

export function createStopwatch(): Stopwatch {
  const startedAtMs = currentTimestampMs();

  return {
    startedAtMs,
    elapsedAt(timestampMs) {
      return toDurationMs(timestampMs - startedAtMs);
    },
    elapsedMs() {
      return toDurationMs(currentTimestampMs() - startedAtMs);
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
