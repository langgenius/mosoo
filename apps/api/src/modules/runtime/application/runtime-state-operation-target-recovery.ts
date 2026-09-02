import type { RuntimeOperationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { RuntimeOperationEvent } from "./runtime-state-operation-events";
import {
  commitRuntimeOperationReadySnapshots,
  writeRuntimeOperationInterruptedSnapshots,
} from "./runtime-state-operation-target-events";
import { listRuntimeOperationTargets } from "./runtime-state-operation-target-store";
import type { RuntimeSessionTargetTransition } from "./runtime-state-operation-target-store";

export async function restoreRuntimeOperationFailedTargets(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly readyEvent: RuntimeOperationEvent;
    readonly targets: readonly RuntimeSessionTargetTransition[];
    readonly terminalTimestampMs: number;
  },
): Promise<void> {
  const phaseTargets = input.targets.map((target) => target.current);
  const ownedTargets = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: phaseTargets,
  });

  await writeRuntimeOperationInterruptedSnapshots(bindings, {
    operationId: input.operationId,
    targets: ownedTargets,
    timestampMs: input.terminalTimestampMs,
  });

  const readyTargets = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: phaseTargets,
  });
  await commitRuntimeOperationReadySnapshots(bindings, {
    event: input.readyEvent,
    operationId: input.operationId,
    targets: readyTargets,
  });

  const unreleased = await listRuntimeOperationTargets(bindings.DB, {
    operationId: input.operationId,
    targets: phaseTargets,
  });
  if (unreleased.length > 0) {
    throw new Error("Runtime operation ready projection did not release every owned Session.");
  }
}
