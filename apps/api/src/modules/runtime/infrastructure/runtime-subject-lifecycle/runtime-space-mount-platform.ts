import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import { withDisposedRpcResult } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { SANDBOX_SPACE_ANCHOR_FILE_NAME } from "../../domain/sandbox-layout";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import {
  createRuntimeSandboxBucketMountOptions,
  resolveRuntimeSandboxBucketMountTarget,
} from "../runtime-sandbox-bucket-mount";
import { toRuntimeSpaceMountConflictError } from "../runtime-sandbox-mount-errors";
import type { SandboxHandle } from "../sandbox-handles";
export { RuntimeSpaceMountConflictError } from "./runtime-subject-errors";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function hasRuntimeSubjectGlobalMount(
  subject: SandboxHandle,
  mountPath: string,
  options: {
    readonly localBucket: boolean;
  },
): Promise<boolean> {
  const probeCommand = options.localBucket
    ? `test -e ${quoteShellArg(mountPath)}`
    : `test -d ${quoteShellArg(mountPath)} && mountpoint -q ${quoteShellArg(mountPath)}`;

  return withDisposedRpcResult(
    withRuntimeProvisionTimeout(
      subject.exec(`sh -lc ${quoteShellArg(probeCommand)}`),
      `Runtime subject mount probe for ${mountPath}`,
    ),
    (probe) => probe.success && probe.exitCode === 0,
  );
}

function getRuntimeSpaceAnchorPath(mountPath: string): string {
  return `${mountPath}/${SANDBOX_SPACE_ANCHOR_FILE_NAME}`;
}

export async function ensureRuntimeSpaceAnchor(
  subject: SandboxHandle,
  mountPath: string,
): Promise<void> {
  const command = [
    `mkdir -p ${quoteShellArg(mountPath)}`,
    `if [ -n "$(find ${quoteShellArg(mountPath)} -mindepth 1 -maxdepth 1 ! -name ${quoteShellArg(SANDBOX_SPACE_ANCHOR_FILE_NAME)} -print -quit)" ]; then exit 0; fi`,
    `if [ -e ${quoteShellArg(getRuntimeSpaceAnchorPath(mountPath))} ]; then exit 0; fi`,
    `: > ${quoteShellArg(getRuntimeSpaceAnchorPath(mountPath))}`,
  ].join(" && ");

  await withDisposedRpcResult(
    withRuntimeProvisionTimeout(
      subject.exec(`sh -lc ${quoteShellArg(command)}`),
      `Runtime space anchor for ${mountPath}`,
    ),
    (result) => {
      if (!result.success || result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() ||
            result.stdout.trim() ||
            `Failed to materialize runtime space at ${mountPath}.`,
        );
      }
    },
  );
}

export function resolveRuntimeSpaceBucketMountTarget(bindings: ApiBindings): string {
  return resolveRuntimeSandboxBucketMountTarget(bindings);
}

export function getRuntimeSpaceBucketPrefix(spaceId: string): string {
  return `/space/${spaceId}/`;
}

export async function prepareRuntimeSpaceMountPath(
  subject: SandboxHandle,
  mountPath: string,
): Promise<void> {
  await subject.mkdir(mountPath, { recursive: true });
}

export async function mountRuntimeSpaceAlias(
  input: {
    readonly bindings: ApiBindings;
    readonly bucketMountTarget: string;
    readonly subject: SandboxHandle;
  },
  alias: SpaceAliasBinding,
): Promise<void> {
  try {
    await withRuntimeProvisionTimeout(
      input.subject.mountBucket(
        input.bucketMountTarget,
        alias.globalMountPath,
        createRuntimeSandboxBucketMountOptions(input.bindings, {
          prefix: getRuntimeSpaceBucketPrefix(alias.spaceId),
        }),
      ),
      `Runtime space bucket mount for ${alias.spaceId} at ${alias.globalMountPath}`,
    );
  } catch (error) {
    throw (
      toRuntimeSpaceMountConflictError(error, {
        mountPath: alias.globalMountPath,
      }) ?? error
    );
  }
}
