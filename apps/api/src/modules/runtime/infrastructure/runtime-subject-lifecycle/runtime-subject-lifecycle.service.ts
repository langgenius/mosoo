import type {
  AccountId,
  AgentId,
  ProjectId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
} from "@mosoo/id";
import { createPlatformId } from "@mosoo/id";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../../platform/analytics/product-analytics";
import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { SandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import type { SandboxHandle } from "../sandbox-handles";
import { RuntimeSubjectCapacityExceededError } from "./runtime-subject-errors";
import { listRuntimeSubjectDriverIds } from "./runtime-subject-maintenance-store";
import {
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
  startRuntimeSubjectContainer,
} from "./runtime-subject-platform";
import {
  assertSessionRuntimeSubjectBinding,
  claimRuntimeSubjectActivation,
  getRuntimeSubjectActivationRecord,
  markRuntimeSubjectActivationDestroying,
  markRuntimeSubjectActivationFailed,
  markRuntimeSubjectActive,
  preemptRuntimeSubjectActivationClaim,
  readRuntimeSubjectCapacityShortfall,
} from "./runtime-subject-record-store";
import type { RuntimeSubjectActivationRecord } from "./runtime-subject-store.types";

const RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS = 10 * 60_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS = 8_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS = 250;
const INTERACTIVE_ACTIVATION_CLAIM_OWNER_PREFIX = "interactive-activation-";
const PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX = "prewarm-activation-";
const MAINTENANCE_CLAIM_OWNER_PREFIX = "scheduled-";

export type RuntimeSubjectActivationPurpose = "interactive" | "prewarm";

export interface ActivateRuntimeSubjectInput {
  readonly agentId: AgentId | null;
  readonly executionOwnerUserId: AccountId;
  readonly networkConstraints: SandboxNetworkConstraints;
  readonly purpose?: RuntimeSubjectActivationPurpose;
  readonly runtimeSubjectId: SandboxId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly timing: RuntimeTimingRecorder;
}

interface ActivationClaim {
  readonly activation: ActivateRuntimeSubjectInput;
  readonly claimExpiresAt: number;
  readonly claimOwner: string;
  readonly purpose: RuntimeSubjectActivationPurpose;
}

function hasActiveRuntimeSubjectClaim(
  record: RuntimeSubjectActivationRecord,
  now: number,
): boolean {
  return (
    record.claimOwner !== null && record.claimExpiresAt !== null && record.claimExpiresAt > now
  );
}

function createRuntimeSubjectActivationClaimOwner(
  purpose: RuntimeSubjectActivationPurpose,
): string {
  const prefix =
    purpose === "prewarm"
      ? PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX
      : INTERACTIVE_ACTIVATION_CLAIM_OWNER_PREFIX;

  return `${prefix}${crypto.randomUUID()}`;
}

function canPreemptRuntimeSubjectClaim(
  purpose: RuntimeSubjectActivationPurpose,
  record: RuntimeSubjectActivationRecord,
  mode: "all_low_priority" | "prewarm_only",
): boolean {
  if (
    purpose !== "interactive" ||
    record.claimOwner === null ||
    record.claimExpiresAt === null ||
    (record.status !== "active" && record.status !== "cold")
  ) {
    return false;
  }

  if (record.claimOwner.startsWith(PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX)) {
    return true;
  }

  // An unstarted maintenance claim has not left `active` yet.
  return (
    mode === "all_low_priority" &&
    record.status === "active" &&
    record.claimOwner.startsWith(MAINTENANCE_CLAIM_OWNER_PREFIX)
  );
}

async function readActivationRecord(
  bindings: ApiBindings,
  runtimeSubjectId: SandboxId,
): Promise<RuntimeSubjectActivationRecord> {
  const record = await getRuntimeSubjectActivationRecord(bindings.DB, runtimeSubjectId);

  if (!record) {
    throw new Error("Runtime subject activation has no lifecycle record.");
  }

  return record;
}

async function preemptRuntimeSubjectClaim(
  bindings: ApiBindings,
  claim: ActivationClaim,
  record: RuntimeSubjectActivationRecord,
): Promise<boolean> {
  if (record.claimOwner === null || record.claimExpiresAt === null) {
    return false;
  }

  return preemptRuntimeSubjectActivationClaim(bindings.DB, {
    claimExpiresAt: claim.claimExpiresAt,
    claimOwner: claim.claimOwner,
    expectedClaimExpiresAt: record.claimExpiresAt,
    expectedClaimOwner: record.claimOwner,
    expectedStatus: record.status,
    now: currentTimestampMs(),
    runtimeSubjectId: claim.activation.runtimeSubjectId,
  });
}

function assertRuntimeSubjectNotInOperation(record: RuntimeSubjectActivationRecord): void {
  if (record.status === "backing_up" || record.status === "destroying") {
    throw new Error("Runtime subject is busy with lifecycle maintenance.");
  }
}

async function admitActivation(
  bindings: ApiBindings,
  claim: ActivationClaim,
): Promise<RuntimeSubjectActivationRecord> {
  const { activation } = claim;
  let record = await readActivationRecord(bindings, activation.runtimeSubjectId);

  assertSessionRuntimeSubjectBinding(record, activation);
  assertRuntimeSubjectNotInOperation(record);

  if (canPreemptRuntimeSubjectClaim(claim.purpose, record, "prewarm_only")) {
    if (await preemptRuntimeSubjectClaim(bindings, claim, record)) {
      return record;
    }

    record = await readActivationRecord(bindings, activation.runtimeSubjectId);
  }

  // A concurrent activation can hold the claim through `cold` for tens of
  // seconds (Apple Silicon cold-start stalls inside container startup). Wait
  // briefly for the in-flight activation to finish before failing this one.
  const waitDeadline = currentTimestampMs() + RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS;
  while (
    hasActiveRuntimeSubjectClaim(record, currentTimestampMs()) &&
    currentTimestampMs() < waitDeadline
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS),
    );
    record = await readActivationRecord(bindings, activation.runtimeSubjectId);
    assertRuntimeSubjectNotInOperation(record);
  }

  if (hasActiveRuntimeSubjectClaim(record, currentTimestampMs())) {
    if (
      canPreemptRuntimeSubjectClaim(claim.purpose, record, "all_low_priority") &&
      (await preemptRuntimeSubjectClaim(bindings, claim, record))
    ) {
      return record;
    }

    throw new Error("Runtime subject is claimed by lifecycle maintenance.");
  }

  const claimed = await claimRuntimeSubjectActivation(bindings.DB, {
    claimExpiresAt: claim.claimExpiresAt,
    claimOwner: claim.claimOwner,
    executionOwnerUserId: activation.executionOwnerUserId,
    expectedStatus: record.status,
    now: currentTimestampMs(),
    runtimeSubjectId: activation.runtimeSubjectId,
  });

  if (!claimed) {
    // Only a cold activation consumes deployment and account capacity.
    const shortfall =
      record.status === "cold"
        ? await readRuntimeSubjectCapacityShortfall(bindings.DB, {
            executionOwnerUserId: activation.executionOwnerUserId,
            now: currentTimestampMs(),
          })
        : null;

    if (shortfall !== null) {
      throw new RuntimeSubjectCapacityExceededError(shortfall);
    }

    throw new Error("Runtime subject is busy with lifecycle maintenance.");
  }

  return record;
}

export async function activateRuntimeSubject(
  bindings: ApiBindings,
  input: ActivateRuntimeSubjectInput,
): Promise<SandboxHandle> {
  const purpose = input.purpose ?? "interactive";
  const claimOwner = createRuntimeSubjectActivationClaimOwner(purpose);
  const record = await input.timing.measure("runtimeSubject.admitLifecycle", () =>
    admitActivation(bindings, {
      activation: input,
      claimExpiresAt: currentTimestampMs() + RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS,
      claimOwner,
      purpose,
    }),
  );
  const subject = await getRuntimeSubjectKeepAliveHandle(bindings, input.runtimeSubjectId);
  const isCold = record.status === "cold";

  try {
    // Push the Session egress policy before any container-starting RPC: the
    // internet switch only takes effect at container start, and a limited
    // policy must fail closed here rather than let the container come up
    // unrestricted.
    await input.timing.measure("runtimeSubject.configureNetwork", () =>
      subject.configureNetworkConstraints(input.networkConstraints),
    );
    await input.timing.measure("runtimeSubject.prepareFilesystem", async () => {
      const allowStartupRecovery =
        isCold &&
        (await listRuntimeSubjectDriverIds(bindings.DB, input.runtimeSubjectId)).length === 0;
      await startRuntimeSubjectContainer(subject, {
        allowStartupRecovery,
        runtimeSubjectId: input.runtimeSubjectId,
      });
    });

    const activated = await input.timing.measure("runtimeSubject.markActive", () =>
      markRuntimeSubjectActive(bindings.DB, {
        claimOwner,
        runtimeSubjectId: input.runtimeSubjectId,
      }),
    );

    if (!activated) {
      throw new Error("Runtime subject activation claim expired before completion.");
    }

    if (isCold) {
      await captureServerProductEvent(bindings, {
        distinctId: input.executionOwnerUserId,
        event: SERVER_PRODUCT_ANALYTICS_EVENTS.sandboxCreated,
        properties: {
          activation_purpose: purpose,
          agent_id: input.agentId ?? undefined,
          execution_owner_id: input.executionOwnerUserId,
          sandbox_id: input.runtimeSubjectId,
          session_id: input.sessionId,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime subject activation failed.";
    const operationId = createPlatformId<RuntimeOperationId>();
    let destroyingRecorded = false;

    try {
      destroyingRecorded = await markRuntimeSubjectActivationDestroying(bindings.DB, {
        claimOwner,
        message,
        operationId,
        runtimeSubjectId: input.runtimeSubjectId,
      });
    } catch (recordError) {
      logWarn("runtime.subject.activation_failure.destroy_record_failed", {
        ...createErrorLogContext(recordError),
        runtimeSubjectId: input.runtimeSubjectId,
      });
    }

    // Only confirmed teardown may advertise cold; failure leaves destroying +
    // operationId for the maintenance repair loop. Neither path masks the
    // activation error.
    let destroyed = false;

    if (destroyingRecorded) {
      try {
        await destroyRuntimeSubjectContainer(bindings, input.runtimeSubjectId);
        destroyed = true;
      } catch (destroyError) {
        logWarn("runtime.subject.activation_failure.destroy_failed", {
          ...createErrorLogContext(destroyError),
          runtimeSubjectId: input.runtimeSubjectId,
        });
      }
    }

    if (destroyingRecorded && destroyed) {
      try {
        await markRuntimeSubjectActivationFailed(bindings.DB, {
          message,
          operationId,
          runtimeSubjectId: input.runtimeSubjectId,
        });
      } catch (finalizeError) {
        logWarn("runtime.subject.activation_failure.destroy_finalize_failed", {
          ...createErrorLogContext(finalizeError),
          runtimeSubjectId: input.runtimeSubjectId,
        });
      }
    }

    throw new Error(message, { cause: error });
  }

  return subject;
}
