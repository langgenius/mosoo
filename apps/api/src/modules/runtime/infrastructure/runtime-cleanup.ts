import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";

export async function runBestEffortRuntimeCleanup(input: {
  readonly context: Record<string, unknown>;
  readonly message: string;
  readonly task: () => Promise<void>;
}): Promise<void> {
  try {
    await input.task();
  } catch (error) {
    logWarn(input.message, {
      ...input.context,
      ...createErrorLogContext(error),
    });
  }
}
