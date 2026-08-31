import type { DriverInstanceId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { StopRuntimeSubjectDriversInput } from "../../application/execution-plane/execution-plane-adapter";
import { stopDriverSession } from "../driver-session.service";
import { listRuntimeSubjectDriverIds } from "./runtime-subject-store";

export async function stopRuntimeSubjectDrivers(
  bindings: ApiBindings,
  input: StopRuntimeSubjectDriversInput,
): Promise<void> {
  const driverIds: DriverInstanceId[] = await listRuntimeSubjectDriverIds(
    bindings.DB,
    input.runtimeSubjectId,
    input.sandboxIncarnation,
  );

  const outcomes = await Promise.allSettled(
    driverIds.map((driverInstanceId) =>
      stopDriverSession(bindings, {
        driverInstanceId,
        reason: input.reason,
      }),
    ),
  );
  const failure = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failure !== undefined) {
    throw failure.reason;
  }
}
