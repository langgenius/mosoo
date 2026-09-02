import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import { runBestEffortRuntimeCleanup } from "../runtime-cleanup";
import type { RuntimeProcessHandle } from "../sandbox-handles";

export async function startProvisionProcessWithOwnershipFence(input: {
  assertOwned: () => Promise<void>;
  context: Record<string, unknown>;
  message: string;
  startProcess: () => Promise<RuntimeProcessHandle>;
}): Promise<RuntimeProcessHandle> {
  await input.assertOwned();
  const process = await input.startProcess();
  try {
    await input.assertOwned();
    return process;
  } catch (error) {
    await stopProvisionProcess({
      context: input.context,
      message: input.message,
      process,
    });
    disposeRpcResource(process);
    throw error;
  }
}

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
