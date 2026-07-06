export function isDriverClosedBeforeReadyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("closed before ready");
}

// A driver can die before ready for transient reasons (boot crash, container
// rollout window). The budget counts attempts — never wall-clock — so recovery
// behaves the same regardless of how slow production DO round-trips are.
export async function withPreReadyRetry<T>(input: {
  attempt: () => Promise<T>;
  onRetry: (error: Error, retriesRemaining: number) => Promise<void>;
  retryLimit: number;
}): Promise<T> {
  let retriesRemaining = input.retryLimit;

  while (true) {
    try {
      return await input.attempt();
    } catch (error) {
      if (!isDriverClosedBeforeReadyError(error) || retriesRemaining === 0) {
        throw error;
      }

      retriesRemaining -= 1;
      await input.onRetry(error as Error, retriesRemaining);
    }
  }
}
