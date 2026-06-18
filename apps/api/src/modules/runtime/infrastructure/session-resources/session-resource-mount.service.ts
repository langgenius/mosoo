import { getSessionResourceRootPath } from "agent-driver/paths";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import {
  createRuntimeSandboxBucketMountOptions,
  isRuntimeSandboxLocalBucketEnabled,
  resolveRuntimeSandboxBucketMountTarget,
} from "../runtime-sandbox-bucket-mount";
import { toRuntimeBucketMountConflictError } from "../runtime-sandbox-mount-errors";
import { RuntimeBucketMountConflictError } from "../runtime-subject-lifecycle/runtime-subject-errors";
import type { SandboxHandle } from "../sandbox-handles";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function getSessionResourceMountPath(sessionId: string): string {
  return getSessionResourceRootPath(sessionId);
}

function getSessionResourceBucketPrefix(sessionId: string): string {
  return `/session/${sessionId}/attachment/`;
}

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
  const mountPath = getSessionResourceMountPath(input.sessionId);
  const bucket = resolveRuntimeSandboxBucketMountTarget(input.bindings);
  const prefix = getSessionResourceBucketPrefix(input.sessionId);
  const localBucket = isRuntimeSandboxLocalBucketEnabled(input.bindings);

  if (
    await sandboxBucketMountIsReady({
      localBucket,
      mountPath,
      sandbox: input.sandbox,
    })
  ) {
    return;
  }

  await input.sandbox.mkdir(mountPath, { recursive: true });

  try {
    await input.sandbox.mountBucket(
      bucket,
      mountPath,
      createRuntimeSandboxBucketMountOptions(input.bindings, {
        prefix,
        readOnly: true,
      }),
    );
  } catch (cause) {
    const error =
      toRuntimeBucketMountConflictError(cause, {
        mountPath,
      }) ?? cause;

    if (
      error instanceof RuntimeBucketMountConflictError &&
      (localBucket ||
        (await sandboxBucketMountIsReady({
          localBucket,
          mountPath,
          sandbox: input.sandbox,
        })))
    ) {
      return;
    }

    if (
      !localBucket &&
      error instanceof RuntimeBucketMountConflictError &&
      error.bucket === bucket &&
      error.prefix === prefix
    ) {
      return;
    }

    throw error;
  }
}
