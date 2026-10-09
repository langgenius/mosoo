import { getSessionResourceRootPath } from "@mosoo/agent-driver/paths";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { quoteShellArg } from "../../../../shared/shell";
import {
  createRuntimeSandboxBucketMountOptions,
  isRuntimeSandboxLocalBucketEnabled,
  resolveRuntimeSandboxBucketMountTarget,
} from "../runtime-sandbox-bucket-mount";
import type { SandboxHandle } from "../sandbox-handles";

async function sandboxBucketMountIsReady(input: {
  localBucket: boolean;
  mountPath: string;
  sandbox: SandboxHandle;
}): Promise<boolean> {
  const command = input.localBucket
    ? `test -e ${quoteShellArg(input.mountPath)}`
    : `test -d ${quoteShellArg(input.mountPath)} && mountpoint -q ${quoteShellArg(
        input.mountPath,
      )}`;
  const probe = await input.sandbox.exec(`sh -lc ${quoteShellArg(command)}`);

  return probe.success && probe.exitCode === 0;
}

export async function ensureSessionResourcesMounted(input: {
  bindings: ApiBindings;
  sandbox: SandboxHandle;
  sessionId: string;
}): Promise<void> {
  const mountPath = getSessionResourceRootPath(input.sessionId);
  const localBucket = isRuntimeSandboxLocalBucketEnabled(input.bindings);
  const probe = { localBucket, mountPath, sandbox: input.sandbox };

  if (await sandboxBucketMountIsReady(probe)) {
    return;
  }

  await input.sandbox.mkdir(mountPath, { recursive: true });

  try {
    await input.sandbox.mountBucket(
      resolveRuntimeSandboxBucketMountTarget(input.bindings),
      mountPath,
      createRuntimeSandboxBucketMountOptions(input.bindings, {
        prefix: `/session/${input.sessionId}/attachment/`,
        readOnly: true,
      }),
    );
  } catch (error) {
    // A concurrent Run may have mounted the same path first. Only a FUSE mount
    // has a real mountpoint to probe; the local-sync probe passes after mkdir.
    if (!localBucket && (await sandboxBucketMountIsReady(probe))) {
      return;
    }

    throw error;
  }
}
