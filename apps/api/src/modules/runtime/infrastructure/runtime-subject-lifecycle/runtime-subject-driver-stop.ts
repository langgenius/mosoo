import type { DriverInstanceId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { StopRuntimeSubjectDriversInput } from "../../application/execution-plane/execution-plane-adapter";
import { listLiveDriverInstanceIdsForSandboxSessions } from "../driver-instance/live-driver-instance.repository";
import { stopDriverSession } from "../driver-session.service";
import { listRuntimeSubjectDriverIds } from "./runtime-subject-store";

async function listRuntimeSubjectOperationDriverIds(
  bindings: ApiBindings,
  input: StopRuntimeSubjectDriversInput,
): Promise<DriverInstanceId[]> {
  if (input.targets !== undefined) {
    return listLiveDriverInstanceIdsForSandboxSessions(
      bindings.DB,
      input.targets.map((target) => target.sessionId),
    );
  }

  return listRuntimeSubjectDriverIds(bindings.DB, input.runtimeSubjectId);
}

export async function stopRuntimeSubjectDrivers(
  bindings: ApiBindings,
  input: StopRuntimeSubjectDriversInput,
): Promise<void> {
  const driverIds = await listRuntimeSubjectOperationDriverIds(bindings, input);

  await Promise.all(
    driverIds.map((driverInstanceId) =>
      stopDriverSession(bindings, {
        driverInstanceId,
        ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
        ...(input.preserveSessionLifecycle !== undefined
          ? { preserveSessionLifecycle: input.preserveSessionLifecycle }
          : {}),
        reason: input.reason,
        ...(input.terminalRun ? { terminalRun: input.terminalRun } : {}),
      }),
    ),
  );
}
