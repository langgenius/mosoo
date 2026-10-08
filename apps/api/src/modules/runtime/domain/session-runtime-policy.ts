// The idle sweep and post-close release each use this existing grace period.
export const SESSION_RUNTIME_IDLE_GRACE_MS = 5 * 60_000;

// One turn holds its Sandbox for at most this long. A heartbeating driver never
// looks stale, so without this bound a stuck turn would keep its container
// running indefinitely; maintenance cancels the turn instead.
export const SESSION_RUN_TIME_LIMIT_MS = 2 * 60 * 60_000;

export function getRuntimeSubjectInactiveDeadline(now: number): number {
  return now + SESSION_RUNTIME_IDLE_GRACE_MS;
}
