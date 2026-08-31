import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";
import { destroyDriverInstanceDurableObject } from "../driver-instance/client";
import { stopDriverSession } from "../driver-session-stop.service";
import { closeSandboxConversationSession } from "../sandbox-session.service";
import { deleteActiveSandboxConversationSession } from "../sandbox-session/sandbox-conversation-session-delete";
import { createLeaseOwnershipRenewal } from "./lease-ownership-renewal";
import type { RuntimeProvisioningLease } from "./runtime-provisioning-lease-store";
import {
  claimRuntimeProvisioningSubjectRetirement,
  claimRuntimeProvisioningDriverCleanup,
  readRuntimeProvisioningCleanupTargets,
  releaseAbortedRuntimeProvisioningLease,
  renewRuntimeProvisioningLeaseOwnership,
} from "./runtime-provisioning-lease-store";
import { runRuntimeSubjectOperation } from "./runtime-subject-operations.service";
import { getRuntimeSubject } from "./runtime-subject-store";

const PROVISIONING_CLEANUP_HEARTBEAT_MS = 60_000;

export async function retireRuntimeProvisioningIncarnation(
  bindings: ApiBindings,
  lease: RuntimeProvisioningLease,
  source: "api" | "maintenance",
): Promise<"released" | "stale" | "waiting"> {
  if (lease.sandboxIncarnation === null) {
    return "stale";
  }

  const retirement = await claimRuntimeProvisioningSubjectRetirement(bindings.DB, {
    lease,
    source,
  });
  if (retirement.kind === "stale") {
    return "stale";
  }
  if (retirement.kind === "waiting" || retirement.kind === "repairing") {
    return "waiting";
  }
  if (retirement.kind === "destroying") {
    const subject = await getRuntimeSubject(bindings.DB, lease.sandboxId);
    if (subject === null) {
      throw new Error("Runtime provisioning retirement lost its subject.");
    }
    await runRuntimeSubjectOperation(bindings, {
      kind: subject.kind,
      lease: retirement.lease,
      reason: "runtime.provisioning_ambiguous",
      runtimeSubjectId: lease.sandboxId,
    });
  }

  return (await releaseAbortedRuntimeProvisioningLease(bindings.DB, lease)) ? "released" : "stale";
}

export async function cleanupRuntimeProvisioningResources(
  bindings: ApiBindings,
  lease: RuntimeProvisioningLease,
  source: "api" | "maintenance",
): Promise<void> {
  const requireOwnership = createLeaseOwnershipRenewal(
    () => renewRuntimeProvisioningLeaseOwnership(bindings.DB, lease),
    "Runtime provisioning cleanup lost its lease ownership.",
  );
  const heartbeat = setInterval(() => {
    void requireOwnership().catch(() => undefined);
  }, PROVISIONING_CLEANUP_HEARTBEAT_MS);

  try {
    await requireOwnership();
    const targets = await readRuntimeProvisioningCleanupTargets(bindings.DB, lease);
    if (targets === null) {
      throw new Error("Runtime provisioning cleanup lost its lease ownership.");
    }

    const failures: unknown[] = [];
    const liveDrivers = targets.driverInstances.filter((driver) =>
      LIVE_DRIVER_INSTANCE_STATUSES.some((status) => status === driver.status),
    );
    const driverClaims = await Promise.allSettled(
      liveDrivers.map(async (driver) => ({
        claimed: await claimRuntimeProvisioningDriverCleanup(bindings.DB, {
          driverGeneration: driver.generation,
          driverInstanceId: driver.id,
          lease,
          source,
        }),
        driver,
      })),
    );
    failures.push(
      ...driverClaims.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
    const claimedDrivers = driverClaims.flatMap((result) =>
      result.status === "fulfilled" && result.value.claimed ? [result.value.driver] : [],
    );
    await requireOwnership();
    const stopResults = await Promise.allSettled(
      claimedDrivers.map((driver) =>
        stopDriverSession(bindings, {
          driverInstanceId: driver.id,
          expectedDriverGeneration: driver.generation,
          reason: "runtime.provisioning_stale",
        }),
      ),
    );
    failures.push(
      ...stopResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );

    await requireOwnership();
    if (targets.conversationSessionId !== null) {
      if (lease.sandboxIncarnation === null) {
        throw new Error("Runtime provisioning cleanup target has no sandbox incarnation.");
      }
      try {
        await deleteActiveSandboxConversationSession(bindings, {
          sandboxId: lease.sandboxId,
          sandboxIncarnation: lease.sandboxIncarnation,
          sandboxSessionId: targets.conversationSessionId,
        });
        await closeSandboxConversationSession(bindings, {
          expectedProvisioningOperationId: lease.operationId,
          expectedSandboxSessionId: targets.conversationSessionId,
          sandboxId: lease.sandboxId,
          sessionId: lease.sessionId,
        });
      } catch (error) {
        failures.push(error);
      }
    }

    await requireOwnership();
    const liveDriverIds = new Set(liveDrivers.map((driver) => driver.id));
    const destructionTargets = [
      ...targets.driverInstances.filter((driver) => !liveDriverIds.has(driver.id)),
      ...claimedDrivers,
    ];
    const destroyResults = await Promise.allSettled(
      destructionTargets.map((driver) =>
        destroyDriverInstanceDurableObject(
          bindings,
          driver.id,
          driver.generation,
          "runtime.provisioning_stale",
        ),
      ),
    );
    failures.push(
      ...destroyResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );

    await requireOwnership();
    if (failures[0] !== undefined) {
      throw failures[0];
    }
  } finally {
    clearInterval(heartbeat);
  }
}
