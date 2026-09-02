import {
  SANDBOX_WORKSPACE_ROOT,
  getSessionResourceBackingPath,
  getSessionResourceRootPath,
} from "@mosoo/agent-driver/paths";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { quoteShellArg } from "../../../../shared/shell";
import {
  createRuntimeSandboxBucketMountOptions,
  isRuntimeSandboxLocalBucketEnabled,
  resolveRuntimeSandboxBucketMountTarget,
} from "../runtime-sandbox-bucket-mount";
import { toRuntimeBucketMountConflictError } from "../runtime-sandbox-mount-errors";
import { RuntimeBucketMountConflictError } from "../runtime-subject-lifecycle/runtime-subject-errors";
import type { SandboxHandle } from "../sandbox-handles";

function getSessionResourceMountPath(sessionId: string): string {
  return getSessionResourceBackingPath(sessionId);
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

async function ensureSessionResourceAlias(input: {
  readonly mountPath: string;
  readonly publicPath: string;
  readonly sandbox: SandboxHandle;
}): Promise<void> {
  const workspacePrefix = `${SANDBOX_WORKSPACE_ROOT}/`;
  const publicParent = input.publicPath.slice(0, input.publicPath.lastIndexOf("/"));
  if (!publicParent.startsWith(workspacePrefix) || !input.mountPath.startsWith(workspacePrefix)) {
    throw new Error("Session resource paths must be inside the workspace root.");
  }
  const parentDepth = publicParent.slice(workspacePrefix.length).split("/").length;
  const target = `${"../".repeat(parentDepth)}${input.mountPath.slice(workspacePrefix.length)}`;
  const command = [
    "set -eu",
    `link=${quoteShellArg(input.publicPath)}`,
    `target=${quoteShellArg(target)}`,
    'if [ -L "$link" ]; then [ "$(readlink "$link")" = "$target" ];',
    'elif [ -e "$link" ]; then exit 42;',
    'else ln -s "$target" "$link" 2>/dev/null || { [ -L "$link" ] && [ "$(readlink "$link")" = "$target" ]; }; fi',
  ].join("; ");
  const result = await input.sandbox.exec(`sh -lc ${quoteShellArg(command)}`);
  if (!result.success || result.exitCode !== 0) {
    throw new Error("Session resource alias conflicts with its reserved workspace path.");
  }
}

export async function ensureSessionResourcesMounted(input: {
  bindings: ApiBindings;
  sandbox: SandboxHandle;
  sessionId: string;
}): Promise<void> {
  const mountPath = getSessionResourceMountPath(input.sessionId);
  const publicPath = getSessionResourceRootPath(input.sessionId);
  const bucket = resolveRuntimeSandboxBucketMountTarget(input.bindings);
  const prefix = getSessionResourceBucketPrefix(input.sessionId);
  const localBucket = isRuntimeSandboxLocalBucketEnabled(input.bindings);

  const ready = await sandboxBucketMountIsReady({
    localBucket,
    mountPath,
    sandbox: input.sandbox,
  });

  if (!ready) {
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

      const sameMount =
        error instanceof RuntimeBucketMountConflictError &&
        (localBucket ||
          (await sandboxBucketMountIsReady({
            localBucket,
            mountPath,
            sandbox: input.sandbox,
          })) ||
          (error.bucket === bucket && error.prefix === prefix));

      if (!sameMount) {
        throw error;
      }
    }
  }

  await ensureSessionResourceAlias({ mountPath, publicPath, sandbox: input.sandbox });
}
