import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";
import type { DriverInstanceId, RuntimeOperationId, SandboxId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { listLiveDriverInstanceIdsForSandboxSessions } from "../driver-instance/live-driver-instance.repository";
import { stopDriverSession } from "../driver-session-stop.service";
import { listRuntimeSubjectDriverIds } from "./runtime-subject-maintenance-store";

export interface StopRuntimeSubjectDriversInput {
  operationId?: RuntimeOperationId;
  runtimeSubjectId: SandboxId;
  preserveSessionLifecycle?: boolean;
  reason: string;
  targets?: readonly { readonly sessionId: SessionId }[];
  terminalRun?: {
    error?: RunError | null;
    status: Extract<SessionRunStatus, "cancelled" | "failed">;
  };
}

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
