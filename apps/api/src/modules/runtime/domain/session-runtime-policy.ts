// The idle sweep and post-close release each use this existing grace period.
export const SESSION_RUNTIME_IDLE_GRACE_MS = 5 * 60_000;

export function getRuntimeSubjectInactiveDeadline(now: number): number {
  return now + SESSION_RUNTIME_IDLE_GRACE_MS;
}
