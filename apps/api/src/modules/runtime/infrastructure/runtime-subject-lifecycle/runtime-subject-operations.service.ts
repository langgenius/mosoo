import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxOperationKind } from "@mosoo/contracts/sandbox";
import type { RuntimeOperationId, SandboxId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { RuntimeSubjectOperationInput } from "../../application/execution-plane/execution-plane-adapter";
import {
  appendOneRuntimeDiagnosticEventPerSession,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import { appendRuntimeSubjectTerminatedEvents } from "../../application/runtime-state-operation-target-events";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { createSandboxCheckpoints } from "../sandbox-backup.service";
import { createLeaseOwnershipRenewal } from "./lease-ownership-renewal";
import { runtimeSubjectActivationRetirementIsDrained } from "./runtime-provisioning-lease-store";
import { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";
import {
  getRuntimeSubjectErrorCode,
  getRuntimeSubjectOperationErrorCode,
  RuntimeSubjectCheckpointFailedError,
  RuntimeSubjectPhysicalStateLostError,
} from "./runtime-subject-errors";
import { createRuntimeSubjectLifecycleService } from "./runtime-subject-lifecycle.service";
import {
  clearRuntimeSubjectAgentState,
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
  inspectRuntimeSubjectIncarnation,
} from "./runtime-subject-platform";
import {
  advanceRuntimeSubjectOperationStatus,
  getRuntimeSubject,
  listRuntimeSubjectSessionStateTargets,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationRepairNeeded,
  markRuntimeSubjectOperationStarted,
  renewRuntimeSubjectOperationLease,
} from "./runtime-subject-store";
import type { RuntimeSubjectOperationLease } from "./runtime-subject-store";

export { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";

const RUNTIME_SUBJECT_OPERATION_LEASE_TTL_MS = 10 * 60_000;
const RUNTIME_SUBJECT_OPERATION_HEARTBEAT_MS = 60_000;

type DestructiveRuntimeSubjectOperationKind = Exclude<SandboxOperationKind, "activate">;

function operationWorkerOwner(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getRuntimeOperationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Runtime state operation failed.";
}

async function appendCheckpointFailureDiagnostics(
  bindings: ApiBindings,
  input: {
    readonly error: unknown;
    readonly runtimeSubjectId: SandboxId;
    readonly targets: RuntimeSubjectOperationInput["targets"];
  },
): Promise<void> {
  const errorCode = getRuntimeSubjectErrorCode(input.error);

  if (errorCode !== "runtime.subject_checkpoint_failed") {
    return;
  }

  await appendOneRuntimeDiagnosticEventPerSession(bindings, {
    events: input.targets.flatMap((target) =>
      target.agentId === null
        ? []
        : [
            {
              eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxCheckpointFailed.name,
              sessionId: target.sessionId,
              value: {
                ...toRuntimeDiagnosticBaseValue({
                  agentId: target.agentId,
                  sessionId: target.sessionId,
                }),
                backupId:
                  input.error instanceof RuntimeSubjectCheckpointFailedError
                    ? input.error.backupId
                    : null,
                dir:
                  input.error instanceof RuntimeSubjectCheckpointFailedError
                    ? input.error.dir
                    : null,
                errorCode,
                reason: toRuntimeDiagnosticReason(
                  input.error,
                  "Runtime subject checkpoint failed.",
                ),
                sandboxId: input.runtimeSubjectId,
              },
            },
          ],
    ),
  });
}

function checkpointRules(kind: AgentKind, operationKind: DestructiveRuntimeSubjectOperationKind) {
  const checkpoint = getRuntimeKindPolicy(kind).checkpoint;

  switch (operationKind) {
    case "hibernate":
      return checkpoint.createOnHibernate;
    case "recreate":
      return checkpoint.createOnRecreate;
    case "reset":
      return checkpoint.createOnReset;
  }
}

function clearsBackups(kind: AgentKind, operationKind: SandboxOperationKind): boolean {
  if (operationKind === "reset") {
    return true;
  }
  return operationKind === "recreate"
    ? getRuntimeKindPolicy(kind).checkpoint.createOnRecreate.length === 0
    : false;
}

type RuntimeSubjectPhysicalState = "gone" | "healthy" | "unknown";

async function inspectOperationRuntimeSubjectPhysicalState(
  bindings: ApiBindings,
  input: {
    readonly lease: RuntimeSubjectOperationLease;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<RuntimeSubjectPhysicalState> {
  const record = await getRuntimeSubject(bindings.DB, input.runtimeSubjectId);
  if (
    record === null ||
    record.incarnation !== input.lease.incarnation ||
    record.networkConstraintsHash === null
  ) {
    return "unknown";
  }

  const subject = await getRuntimeSubjectKeepAliveHandle(
    bindings,
    input.runtimeSubjectId,
    input.lease.incarnation,
  );
  try {
    const result = await inspectRuntimeSubjectIncarnation(
      subject,
      input.lease.incarnation,
      record.networkConstraintsHash,
    );
    switch (result.kind) {
      case "healthy":
        return "healthy";
      case "missing":
      case "retired":
        return "gone";
      case "stale":
      case "unknown":
        return "unknown";
    }
  } finally {
    disposeRpcResource(subject);
  }
}

export async function runRuntimeSubjectOperation(
  bindings: ApiBindings,
  input: {
    readonly kind: AgentKind;
    readonly lease: RuntimeSubjectOperationLease;
    readonly reason: string;
    readonly runtimeSubjectId: SandboxId;
    readonly targets?: RuntimeSubjectOperationInput["targets"];
  },
): Promise<void> {
  let lease = input.lease;
  let physicalStateLost = false;
  const renew = createLeaseOwnershipRenewal(
    () =>
      renewRuntimeSubjectOperationLease(bindings.DB, {
        claimExpiresAt: Date.now() + RUNTIME_SUBJECT_OPERATION_LEASE_TTL_MS,
        lease,
        runtimeSubjectId: input.runtimeSubjectId,
      }),
    "Runtime subject operation lost lifecycle ownership.",
  );
  const heartbeat = setInterval(() => {
    void renew().catch(() => undefined);
  }, RUNTIME_SUBJECT_OPERATION_HEARTBEAT_MS);

  try {
    await renew();

    if (lease.status === "restoring") {
      const advanced = await advanceRuntimeSubjectOperationStatus(bindings.DB, {
        expectedStatus: "restoring",
        lease,
        runtimeSubjectId: input.runtimeSubjectId,
        source: "maintenance",
        status: "destroying",
      });
      if (!advanced) {
        throw new Error("Runtime subject activation repair lost lifecycle ownership.");
      }
      lease = { ...lease, status: "destroying" };
    }

    if (
      lease.kind === "activate" &&
      !(await runtimeSubjectActivationRetirementIsDrained(bindings.DB, {
        lease,
        runtimeSubjectId: input.runtimeSubjectId,
      }))
    ) {
      throw new Error("Runtime subject incarnation is still draining active Runs.");
    }

    if (lease.status === "backing_up") {
      if (lease.kind === "activate") {
        throw new Error("Activation repair cannot enter the backup phase.");
      }

      const before = await inspectOperationRuntimeSubjectPhysicalState(bindings, {
        lease,
        runtimeSubjectId: input.runtimeSubjectId,
      });
      if (before === "unknown") {
        throw new Error("Runtime subject physical state is unknown before checkpoint.");
      }
      physicalStateLost = before === "gone";

      if (!physicalStateLost) {
        try {
          await renew();
          await stopRuntimeSubjectDrivers(bindings, {
            operationId: lease.operationId,
            reason: input.reason,
            runtimeSubjectId: input.runtimeSubjectId,
            sandboxIncarnation: lease.incarnation,
            ...(input.targets === undefined ? {} : { targets: input.targets }),
          });
          await renew();

          if (lease.kind === "reset") {
            const stateTargets = await listRuntimeSubjectSessionStateTargets(bindings.DB, {
              runtimeSubjectId: input.runtimeSubjectId,
            });
            await clearRuntimeSubjectAgentState(bindings, {
              incarnation: lease.incarnation,
              rules: getRuntimeKindPolicy(input.kind).checkpoint.clearOnReset,
              runtimeSubjectId: input.runtimeSubjectId,
              stateTargets,
            });
            await renew();
          }

          await createSandboxCheckpoints(bindings, {
            operationLease: lease,
            rules: checkpointRules(input.kind, lease.kind),
            sandboxId: input.runtimeSubjectId,
          });
          await renew();
        } catch (error) {
          let after: RuntimeSubjectPhysicalState = "unknown";
          try {
            after = await inspectOperationRuntimeSubjectPhysicalState(bindings, {
              lease,
              runtimeSubjectId: input.runtimeSubjectId,
            });
          } catch {
            // Preserve the original failure unless the exact incarnation is
            // durably known to be gone.
          }
          physicalStateLost = after === "gone";
          if (!physicalStateLost) {
            throw error;
          }
        }
      }

      const advanced = await advanceRuntimeSubjectOperationStatus(bindings.DB, {
        expectedStatus: "backing_up",
        lease,
        runtimeSubjectId: input.runtimeSubjectId,
        source: "maintenance",
        status: "destroying",
      });
      if (!advanced) {
        throw new Error("Runtime subject changed before destroy.");
      }
      lease = { ...lease, status: "destroying" };
    }

    if (lease.kind === "activate") {
      await renew();
      await stopRuntimeSubjectDrivers(bindings, {
        operationId: lease.operationId,
        reason: input.reason,
        runtimeSubjectId: input.runtimeSubjectId,
        sandboxIncarnation: lease.incarnation,
      });
      await renew();
    }

    await renew();
    await destroyRuntimeSubjectContainer(bindings, input.runtimeSubjectId, lease.incarnation);
    await renew();

    if (input.targets !== undefined) {
      await appendRuntimeSubjectTerminatedEvents(bindings, {
        reason: input.reason,
        runtimeSubjectId: input.runtimeSubjectId,
        targets: input.targets,
      });
    }
    const completed = await markRuntimeSubjectCold(bindings.DB, {
      clearBackups: !physicalStateLost && clearsBackups(input.kind, lease.kind),
      clearNativeResumeRefs: !physicalStateLost && lease.kind === "reset",
      ...(physicalStateLost
        ? {
            errorCode: "runtime.subject_operation_failed" as const,
            errorMessage:
              "Runtime subject physical incarnation was lost before its checkpoint completed.",
          }
        : {}),
      expectedStatus: "destroying",
      lease,
      runtimeSubjectId: input.runtimeSubjectId,
      source: "maintenance",
    });
    if (!completed) {
      throw new Error("Runtime subject changed before operation completion.");
    }
    if (physicalStateLost) {
      throw new RuntimeSubjectPhysicalStateLostError(input.runtimeSubjectId);
    }
  } catch (error) {
    if (!(error instanceof RuntimeSubjectPhysicalStateLostError)) {
      await markRuntimeSubjectOperationRepairNeeded(bindings.DB, {
        errorCode: getRuntimeSubjectOperationErrorCode(error),
        errorMessage: getRuntimeOperationErrorMessage(error),
        expectedStatus: lease.status,
        lease,
        runtimeSubjectId: input.runtimeSubjectId,
        source: "maintenance",
      });
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function startRuntimeSubjectOperation(
  bindings: ApiBindings,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly operationKind: DestructiveRuntimeSubjectOperationKind;
    readonly runtimeSubjectId: SandboxId;
  },
): Promise<RuntimeSubjectOperationLease> {
  const now = Date.now();
  const lease = await markRuntimeSubjectOperationStarted(bindings.DB, {
    claimExpiresAt: now + RUNTIME_SUBJECT_OPERATION_LEASE_TTL_MS,
    claimOwner: operationWorkerOwner("runtime-operation"),
    now,
    operationId: input.operationId,
    operationKind: input.operationKind,
    runtimeSubjectId: input.runtimeSubjectId,
    source: "runtime",
  });
  if (lease === null) {
    throw new Error("Runtime subject is busy with lifecycle maintenance.");
  }
  return lease;
}

async function executeRequestedRuntimeSubjectOperation(
  bindings: ApiBindings,
  input: RuntimeSubjectOperationInput & {
    readonly operationKind: "recreate" | "reset";
  },
): Promise<void> {
  const subject = await getRuntimeSubject(bindings.DB, input.runtimeSubjectId);
  if (subject === null) {
    return;
  }
  if (
    input.operationKind === "reset" &&
    !getRuntimeKindPolicy(subject.kind).operations.resetSubjectState
  ) {
    throw new Error("This runtime kind does not have resettable subject state.");
  }

  if (subject.status === "cold") {
    if (input.operationKind === "recreate") {
      return;
    }
    if (subject.agentId === null || subject.projectId === null || subject.ownerAccountId === null) {
      throw new Error("Cold runtime subject has no complete activation identity.");
    }

    const activated = await createRuntimeSubjectLifecycleService(bindings).activate({
      agentId: subject.agentId,
      projectId: subject.projectId,
      executionOwnerUserId: subject.ownerAccountId,
      kind: subject.kind,
      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: subject.id,
      subjectId: subject.subjectId,
      subjectKind: subject.subjectKind,
    });
    disposeRpcResource(activated.subject);
  } else if (subject.status !== "active") {
    throw new Error("Runtime subject is busy with lifecycle maintenance.");
  }

  const lease = await startRuntimeSubjectOperation(bindings, input);
  try {
    await runRuntimeSubjectOperation(bindings, {
      kind: subject.kind,
      lease,
      reason: input.reason,
      runtimeSubjectId: input.runtimeSubjectId,
      targets: input.targets,
    });
  } catch (error) {
    await appendCheckpointFailureDiagnostics(bindings, {
      error,
      runtimeSubjectId: input.runtimeSubjectId,
      targets: input.targets,
    });
    throw error;
  }
}

export function recreateRuntimeSubjectPreservingState(
  bindings: ApiBindings,
  input: RuntimeSubjectOperationInput,
): Promise<void> {
  return executeRequestedRuntimeSubjectOperation(bindings, {
    ...input,
    operationKind: "recreate",
  });
}

export function resetRuntimeSubjectAgentState(
  bindings: ApiBindings,
  input: RuntimeSubjectOperationInput,
): Promise<void> {
  return executeRequestedRuntimeSubjectOperation(bindings, {
    ...input,
    operationKind: "reset",
  });
}
