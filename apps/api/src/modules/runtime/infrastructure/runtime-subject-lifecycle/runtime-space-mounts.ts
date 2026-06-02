import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { SandboxHandle } from "../sandbox-handles";
import {
  ensureRuntimeSpaceAnchor,
  getRuntimeSpaceBucketPrefix,
  hasRuntimeSubjectGlobalMount,
  mountRuntimeSpaceAlias,
  prepareRuntimeSpaceMountPath,
  resolveRuntimeSpaceBucketMountTarget,
  RuntimeSpaceMountConflictError,
} from "./runtime-space-mount-platform";

interface RuntimeSpaceMountInput {
  bindings: ApiBindings;
  bucketMountTarget: string;
  isCold: boolean;
  localBucket: boolean;
  mountedSpaceIds: Set<string>;
  onMountFailed?: (alias: SpaceAliasBinding, error: unknown) => Promise<void>;
  onMountSucceeded?: (alias: SpaceAliasBinding) => Promise<void>;
  spaceAliases: SpaceAliasBinding[];
  subject: SandboxHandle;
}

async function isRuntimeSpaceMountReady(
  input: RuntimeSpaceMountInput,
  alias: SpaceAliasBinding,
): Promise<boolean> {
  if (!input.isCold && input.mountedSpaceIds.has(alias.spaceId)) {
    return true;
  }

  if (input.localBucket || input.isCold) {
    return false;
  }

  return hasRuntimeSubjectGlobalMount(input.subject, alias.globalMountPath, {
    localBucket: input.localBucket,
  });
}

async function recoverRuntimeSpaceAliasMount(
  input: RuntimeSpaceMountInput,
  alias: SpaceAliasBinding,
): Promise<boolean> {
  if (input.localBucket) {
    return false;
  }

  return hasRuntimeSubjectGlobalMount(input.subject, alias.globalMountPath, {
    localBucket: input.localBucket,
  });
}

export async function ensureRuntimeSpaceMounts(
  input: Omit<RuntimeSpaceMountInput, "bucketMountTarget">,
): Promise<void> {
  const mountInput: RuntimeSpaceMountInput = {
    ...input,
    bucketMountTarget: resolveRuntimeSpaceBucketMountTarget(input.bindings),
  };

  const results = await Promise.allSettled(
    input.spaceAliases.map((alias) => ensureRuntimeSpaceMount(mountInput, alias)),
  );
  const failure = results.find((result) => result.status === "rejected");

  if (failure?.status === "rejected") {
    throw failure.reason;
  }
}

async function ensureRuntimeSpaceMount(
  input: RuntimeSpaceMountInput,
  alias: SpaceAliasBinding,
): Promise<void> {
  const mountReady = await isRuntimeSpaceMountReady(input, alias);

  if (mountReady) {
    await ensureRuntimeSpaceAnchor(input.subject, alias.globalMountPath);
    input.mountedSpaceIds.add(alias.spaceId);
    await input.onMountSucceeded?.(alias);
    return;
  }

  await prepareRuntimeSpaceMountPath(input.subject, alias.globalMountPath);
  try {
    await mountRuntimeSpaceAlias(input, alias);
  } catch (error) {
    if (input.localBucket && error instanceof RuntimeSpaceMountConflictError) {
      await ensureRuntimeSpaceAnchor(input.subject, alias.globalMountPath);
      input.mountedSpaceIds.add(alias.spaceId);
      await input.onMountSucceeded?.(alias);
      return;
    }

    if (
      error instanceof RuntimeSpaceMountConflictError &&
      error.bucket === input.bucketMountTarget &&
      error.prefix === getRuntimeSpaceBucketPrefix(alias.spaceId)
    ) {
      input.mountedSpaceIds.add(alias.spaceId);
      await input.onMountSucceeded?.(alias);
      return;
    }

    const recovered = await recoverRuntimeSpaceAliasMount(input, alias);

    if (!recovered) {
      await input.onMountFailed?.(alias, error);
      throw error;
    }
  }

  await ensureRuntimeSpaceAnchor(input.subject, alias.globalMountPath);
  input.mountedSpaceIds.add(alias.spaceId);
  await input.onMountSucceeded?.(alias);
}
