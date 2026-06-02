import { runBestEffortRuntimeCleanup } from "../runtime-cleanup";
import type { RuntimeProcessHandle } from "../sandbox-handles";

export async function stopProvisionProcess(input: {
  context: Record<string, unknown>;
  message: string;
  process: RuntimeProcessHandle | null;
}): Promise<void> {
  const process = input.process;

  if (process === null) {
    return;
  }

  await runBestEffortRuntimeCleanup({
    context: input.context,
    message: input.message,
    task: async () => {
      const status = await process.getStatus();

      if (status === "running") {
        await process.kill();
      }
    },
  });
}
