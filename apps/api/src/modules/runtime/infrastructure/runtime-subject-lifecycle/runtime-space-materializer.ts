import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import { isRuntimeSandboxLocalBucketEnabled } from "../runtime-sandbox-bucket-mount";
import type { SandboxHandle } from "../sandbox-handles";
import {
  hydrateSandboxSpaceTreesFromCanonical,
  syncSandboxSpaceTreesToCanonical,
} from "../sandbox-space-file-sync.service";
import { ensureRuntimeSpaceMounts } from "./runtime-space-mounts";

interface RuntimeSpaceMaterializationInput {
  readonly bindings: ApiBindings;
  readonly executionOwnerUserId: string;
  readonly isCold: boolean;
  readonly mountedSpaceIds: Set<string>;
  readonly onSpaceMountFailed?: (alias: SpaceAliasBinding, error: unknown) => Promise<void>;
  readonly onSpaceMountSucceeded?: (alias: SpaceAliasBinding) => Promise<void>;
  readonly spaceAliases: SpaceAliasBinding[];
  readonly subject: SandboxHandle;
  readonly timing?: RuntimeTimingRecorder;
}

function measureOptional<T>(
  timing: RuntimeTimingRecorder | undefined,
  name: string,
  task: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, task) : task();
}

export async function materializeRuntimeSpaces(
  input: RuntimeSpaceMaterializationInput,
): Promise<void> {
  const useLocalBucket = isRuntimeSandboxLocalBucketEnabled(input.bindings);

  await measureOptional(input.timing, "runtimeSubject.ensureSpaceMounts", () =>
    ensureRuntimeSpaceMounts({
      bindings: input.bindings,
      isCold: input.isCold,
      localBucket: useLocalBucket,
      mountedSpaceIds: input.mountedSpaceIds,
      ...(input.onSpaceMountFailed ? { onMountFailed: input.onSpaceMountFailed } : {}),
      ...(input.onSpaceMountSucceeded ? { onMountSucceeded: input.onSpaceMountSucceeded } : {}),
      spaceAliases: input.spaceAliases,
      subject: input.subject,
    }),
  );

  if (!useLocalBucket || input.spaceAliases.length === 0) {
    return;
  }

  await measureOptional(input.timing, "runtimeSubject.syncSpacesToCanonical", () =>
    syncSandboxSpaceTreesToCanonical({
      bindings: input.bindings,
      executionOwnerUserId: input.executionOwnerUserId,
      sandbox: input.subject,
      spaceAliases: input.spaceAliases,
    }),
  );
  await measureOptional(input.timing, "runtimeSubject.hydrateSpacesFromCanonical", () =>
    hydrateSandboxSpaceTreesFromCanonical({
      bindings: input.bindings,
      sandbox: input.subject,
      spaceAliases: input.spaceAliases,
    }),
  );
}
