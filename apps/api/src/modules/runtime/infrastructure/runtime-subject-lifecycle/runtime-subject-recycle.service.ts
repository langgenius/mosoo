import type { AgentKind } from "@mosoo/contracts/agent";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import type { RuntimeSubjectOperationStatus } from "../../domain/runtime-subject-lifecycle.machine";
import { createSandboxCheckpoints } from "../sandbox-backup.service";
import { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";
import { getRuntimeSubjectOperationErrorCode } from "./runtime-subject-errors";
import { destroyRuntimeSubjectContainer } from "./runtime-subject-platform";
import {
  advanceRuntimeSubjectOperationStatus,
  claimInactiveRuntimeSubject,
  closeRuntimeSubjectSessionsForRecycle,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
  markRuntimeSubjectOperationRepairNeeded,
} from "./runtime-subject-store";

const RECYCLE_CLAIM_TTL_MS = 10 * 60_000;

function getRuntimeSubjectRecycleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Runtime subject recycle failed.";
}

async function runRuntimeSubjectRecycleOperation(
  bindings: ApiBindings,
  input: {
    readonly kind: AgentKind;
    readonly operationId: RuntimeOperationId;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly startStatus: RuntimeSubjectOperationStatus;
  },
): Promise<void> {
  let destroyStarted = input.startStatus === "destroying";

  try {
    const policy = getRuntimeKindPolicy(input.kind);

    if (input.startStatus === "backing_up") {
      await stopRuntimeSubjectDrivers(bindings, {
        operationId: input.operationId,
        reason: input.reason,
        runtimeSubjectId: input.runtimeSubjectId,
      });
      await createSandboxCheckpoints(bindings, {
        operationId: input.operationId,
        rules: policy.checkpoint.createOnHibernate,
        sandboxId: input.runtimeSubjectId,
      });
      destroyStarted = await advanceRuntimeSubjectOperationStatus(bindings.DB, {
        expectedStatus: "backing_up",
        operationId: input.operationId,
        runtimeSubjectId: input.runtimeSubjectId,
        source: "maintenance",
        status: "destroying",
      });
      if (!destroyStarted) {
        throw new Error("Runtime subject changed before recycle destroy.");
      }
    }

    await destroyRuntimeSubjectContainer(bindings, input.runtimeSubjectId);
    await closeRuntimeSubjectSessionsForRecycle(bindings.DB, input.runtimeSubjectId);
    const completed = await markRuntimeSubjectCold(bindings.DB, {
      clearBackups: false,
      expectedStatus: "destroying",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
      source: "maintenance",
    });
    if (!completed) {
      throw new Error("Runtime subject changed before recycle completion.");
    }
  } catch (error) {
    await markRuntimeSubjectOperationRepairNeeded(bindings.DB, {
      errorCode: getRuntimeSubjectOperationErrorCode(error),
      errorMessage: getRuntimeSubjectRecycleErrorMessage(error),
      expectedStatus: destroyStarted ? "destroying" : "backing_up",
      operationId: input.operationId,
      runtimeSubjectId: input.runtimeSubjectId,
      source: "maintenance",
    });
    throw error;
  }
}

export async function recycleRuntimeSubject(
  bindings: ApiBindings,
  input: {
    readonly claimOwner: string;
    readonly kind: AgentKind;
    readonly now: number;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const operationId = createPlatformId<RuntimeOperationId>();
  const started = await markRuntimeSubjectOperationStarted(bindings.DB, {
    claimOwner: input.claimOwner,
    now: input.now,
    operationId,
    runtimeSubjectId: input.runtimeSubjectId,
    source: "maintenance",
    status: "backing_up",
  });

  if (!started) {
    return false;
  }

  await runRuntimeSubjectRecycleOperation(bindings, {
    kind: input.kind,
    operationId,
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
    startStatus: "backing_up",
  });

  return true;
}

export async function resumeRuntimeSubjectRecycleOperation(
  bindings: ApiBindings,
  input: {
    readonly kind: AgentKind;
    readonly operationId: RuntimeOperationId;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly status: RuntimeSubjectOperationStatus;
  },
): Promise<boolean> {
  await runRuntimeSubjectRecycleOperation(bindings, {
    kind: input.kind,
    operationId: input.operationId,
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
    startStatus: input.status,
  });

  return true;
}

export async function recycleInactiveRuntimeSubjectNow(
  bindings: ApiBindings,
  input: {
    readonly kind: AgentKind;
    readonly now?: number;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  const now = input.now ?? Date.now();
  const claimOwner = `immediate-${crypto.randomUUID()}`;
  const claimed = await claimInactiveRuntimeSubject(bindings.DB, {
    claimExpiresAt: now + RECYCLE_CLAIM_TTL_MS,
    claimOwner,
    now,
    runtimeSubjectId: input.runtimeSubjectId,
  });

  if (!claimed) {
    return false;
  }

  return recycleRuntimeSubject(bindings, {
    claimOwner,
    kind: input.kind,
    now,
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
  });
}
