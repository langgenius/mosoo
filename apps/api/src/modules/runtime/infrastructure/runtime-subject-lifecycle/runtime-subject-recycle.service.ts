import type { AgentKind } from "@mosoo/contracts/agent";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { runRuntimeSubjectOperation } from "./runtime-subject-operations.service";
import {
  claimInactiveRuntimeSubject,
  markRuntimeSubjectOperationStarted,
  releaseInactiveRuntimeSubjectClaim,
} from "./runtime-subject-store";
import type { RuntimeSubjectOperationLease } from "./runtime-subject-store";

const RECYCLE_CLAIM_TTL_MS = 10 * 60_000;

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
  const lease = await markRuntimeSubjectOperationStarted(bindings.DB, {
    claimExpiresAt: input.now + RECYCLE_CLAIM_TTL_MS,
    claimOwner: input.claimOwner,
    now: input.now,
    operationId,
    operationKind: "hibernate",
    runtimeSubjectId: input.runtimeSubjectId,
    source: "maintenance",
  });

  if (lease === null) {
    await releaseInactiveRuntimeSubjectClaim(bindings.DB, {
      claimOwner: input.claimOwner,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    return false;
  }

  await runRuntimeSubjectOperation(bindings, {
    kind: input.kind,
    lease,
    reason: input.reason,
    runtimeSubjectId: input.runtimeSubjectId,
  });
  return true;
}

export async function resumeRuntimeSubjectRecycleOperation(
  bindings: ApiBindings,
  input: {
    readonly kind: AgentKind;
    readonly lease: RuntimeSubjectOperationLease;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<boolean> {
  await runRuntimeSubjectOperation(bindings, input);
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

  return claimed
    ? recycleRuntimeSubject(bindings, {
        claimOwner,
        kind: input.kind,
        now,
        reason: input.reason,
        runtimeSubjectId: input.runtimeSubjectId,
      })
    : false;
}
