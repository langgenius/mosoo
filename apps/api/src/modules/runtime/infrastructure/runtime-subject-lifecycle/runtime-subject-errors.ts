export class RuntimeSubjectCheckpointFailedError extends Error {
  constructor(input: { readonly cause: unknown; readonly runtimeSubjectId: string }) {
    super(`Runtime subject ${input.runtimeSubjectId} checkpoint failed.`, {
      cause: input.cause,
    });
    this.name = "RuntimeSubjectCheckpointFailedError";
  }
}

export type RuntimeSubjectCapacityScope = "account" | "platform";

export interface RuntimeSubjectCapacityShortfall {
  readonly limit: number;
  readonly scope: RuntimeSubjectCapacityScope;
}

// A full deployment or account quota is a normal, retryable condition; callers
// surface it as such instead of the generic lifecycle-busy failure.
export class RuntimeSubjectCapacityExceededError extends Error {
  readonly limit: number;
  readonly scope: RuntimeSubjectCapacityScope;

  constructor(shortfall: RuntimeSubjectCapacityShortfall) {
    super(
      shortfall.scope === "platform"
        ? "mosoo is at capacity right now. Try again in a few minutes."
        : `You already have ${shortfall.limit} active sessions. Try again in a few minutes, after one of them finishes.`,
    );
    this.name = "RuntimeSubjectCapacityExceededError";
    this.limit = shortfall.limit;
    this.scope = shortfall.scope;
  }
}

export function findRuntimeSubjectCapacityError(
  error: unknown,
): RuntimeSubjectCapacityExceededError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof RuntimeSubjectCapacityExceededError) {
      return current;
    }

    seen.add(current);
    current = current.cause;
  }

  return null;
}
