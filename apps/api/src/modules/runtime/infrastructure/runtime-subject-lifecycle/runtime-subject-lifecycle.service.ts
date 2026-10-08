import type {
  AccountId,
  AgentId,
  DriverInstanceId,
  ProjectId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { createPlatformId } from "@mosoo/id";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../../platform/analytics/product-analytics";
import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import { runtimeImagesEnabled } from "../../../../platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import type { RuntimeDiagnosticContext } from "../../application/runtime-diagnostic-events";
import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { SandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import type { SandboxHandle } from "../sandbox-handles";
import {
  recordRuntimeRunLeaseAcquiredOutcome,
  recordRuntimeRunLeaseReleased,
} from "./runtime-run-lease-store";
import type { RuntimeRunLeaseTransitionOutcome } from "./runtime-run-lease-store";
import { getRuntimeSubjectErrorCode } from "./runtime-subject-errors";
import {
  configureRuntimeSubjectNetwork,
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
  prepareRuntimeSubjectFilesystem,
} from "./runtime-subject-platform";
import {
  assertSessionRuntimeSubjectBinding,
  claimRuntimeSubjectActivation,
  ensureRuntimeSubjectId,
  getRuntimeSubjectActivationRecord,
  listRuntimeSubjectDriverIds,
  markRuntimeSubjectActivationDestroying,
  markRuntimeSubjectActivationFailed,
  markRuntimeSubjectActive,
  markRuntimeSubjectRestoring,
  preemptRuntimeSubjectActivationClaim,
} from "./runtime-subject-store";
import type { RuntimeSubjectActivationRecord } from "./runtime-subject-store";

const RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS = 10 * 60_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS = 8_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS = 250;
const INTERACTIVE_ACTIVATION_CLAIM_OWNER_PREFIX = "interactive-activation-";
const PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX = "prewarm-activation-";
const MAINTENANCE_CLAIM_OWNER_PREFIXES = ["scheduled-", "immediate-"] as const;

export type RuntimeSubjectActivationPurpose = "interactive" | "prewarm";

export interface ActivateRuntimeSubjectInput {
  /** Required when allocating a subject; existing subjects keep their recorded image. */
  readonly runtimeId?: string;
  readonly agentId: AgentId | null;
  readonly executionOwnerUserId: AccountId;
  readonly diagnosticContext?: RuntimeDiagnosticContext;
  readonly networkConstraints: SandboxNetworkConstraints;
  readonly purpose?: RuntimeSubjectActivationPurpose;
  readonly runtimeSubjectId: SandboxId;
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly timing?: RuntimeTimingRecorder;
}

export interface ActiveRuntimeSubject {
  readonly subject: SandboxHandle;
}

function measureOptional<T>(
  timing: RuntimeTimingRecorder | undefined,
  name: string,
  task: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, task) : task();
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

function isPrewarmActivationClaim(record: RuntimeSubjectActivationRecord): boolean {
  return record.claimOwner?.startsWith(PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX) ?? false;
}

function isClaimableRuntimeSubjectStatus(record: RuntimeSubjectActivationRecord): boolean {
  return record.status === "active" || record.status === "cold";
}

function isUnstartedMaintenanceClaim(record: RuntimeSubjectActivationRecord): boolean {
  return (
    record.status === "active" &&
    record.claimOwner !== null &&
    MAINTENANCE_CLAIM_OWNER_PREFIXES.some((prefix) => record.claimOwner?.startsWith(prefix))
  );
}

export class RuntimeSubjectLifecycleService {
  readonly #accountConcurrentSandboxLimit: number;
  readonly #bindings: ApiBindings;

  constructor(bindings: ApiBindings) {
    const accountConcurrentSandboxLimit = Number(
      bindings.MOSOO_ACCOUNT_CONCURRENT_SANDBOX_LIMIT ?? 5,
    );
    if (
      !Number.isSafeInteger(accountConcurrentSandboxLimit) ||
      accountConcurrentSandboxLimit <= 0
    ) {
      throw new Error("MOSOO_ACCOUNT_CONCURRENT_SANDBOX_LIMIT must be a positive integer.");
    }

    this.#accountConcurrentSandboxLimit = accountConcurrentSandboxLimit;
    this.#bindings = bindings;
  }

  async getHandle(runtimeSubjectId: SandboxId): Promise<SandboxHandle> {
    return getRuntimeSubjectKeepAliveHandle(this.#bindings, runtimeSubjectId);
  }

  async activate(input: ActivateRuntimeSubjectInput): Promise<ActiveRuntimeSubject> {
    const purpose = input.purpose ?? "interactive";
    const claimOwner = createRuntimeSubjectActivationClaimOwner(purpose);
    const record = await measureOptional(input.timing, "runtimeSubject.admitLifecycle", () =>
      this.#admitActivation(input, claimOwner, purpose),
    );
    const subject = await this.getHandle(input.runtimeSubjectId);
    const isCold = record === null || record.status === "cold";

    try {
      // Apply the Session policy before any container-starting RPC.
      await measureOptional(input.timing, "runtimeSubject.configureNetwork", () =>
        configureRuntimeSubjectNetwork(subject, input.networkConstraints),
      );
      await measureOptional(input.timing, "runtimeSubject.prepareFilesystem", async () => {
        const allowStartupRecovery =
          isCold &&
          (await listRuntimeSubjectDriverIds(this.#bindings.DB, input.runtimeSubjectId)).length ===
            0;
        await prepareRuntimeSubjectFilesystem(subject, {
          allowStartupRecovery,
          runtimeSubjectId: input.runtimeSubjectId,
        });
      });

      if (isCold) {
        const restoring = await measureOptional(input.timing, "runtimeSubject.markRestoring", () =>
          markRuntimeSubjectRestoring(this.#bindings.DB, {
            claimOwner,
            runtimeSubjectId: input.runtimeSubjectId,
          }),
        );

        if (!restoring) {
          throw new Error("Runtime subject activation claim expired before restore.");
        }
      }

      const activated = await measureOptional(input.timing, "runtimeSubject.markActive", () =>
        markRuntimeSubjectActive(this.#bindings.DB, {
          claimOwner,
          runtimeSubjectId: input.runtimeSubjectId,
        }),
      );

      if (!activated) {
        throw new Error("Runtime subject activation claim expired before completion.");
      }

      if (isCold) {
        await captureServerProductEvent(this.#bindings, {
          distinctId: input.executionOwnerUserId,
          event: SERVER_PRODUCT_ANALYTICS_EVENTS.sandboxCreated,
          properties: {
            activation_purpose: purpose,
            agent_id: input.diagnosticContext?.agentId ?? input.agentId ?? undefined,
            execution_owner_id: input.executionOwnerUserId,
            sandbox_id: input.runtimeSubjectId,
            session_id: input.sessionId,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime subject activation failed.";
      const errorCode = getRuntimeSubjectErrorCode(error);
      const operationId = createPlatformId<RuntimeOperationId>();
      let destroyingRecorded = false;

      try {
        destroyingRecorded = await markRuntimeSubjectActivationDestroying(this.#bindings.DB, {
          claimOwner,
          errorCode,
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

      // Teardown is bounded by the provision timeout. Only confirmed teardown
      // may advertise cold; failure leaves destroying + operationId for the
      // maintenance repair loop. Neither path masks the activation error.
      let destroyed = false;

      if (destroyingRecorded) {
        try {
          await destroyRuntimeSubjectContainer(this.#bindings, input.runtimeSubjectId);
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
          await markRuntimeSubjectActivationFailed(this.#bindings.DB, {
            errorCode,
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

    return { subject };
  }

  async acquireRunLease(input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
    readonly sessionRunId: SessionRunId;
  }): Promise<RuntimeRunLeaseTransitionOutcome> {
    return recordRuntimeRunLeaseAcquiredOutcome(this.#bindings.DB, input);
  }

  async releaseRunLease(input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedSessionRunId: SessionRunId;
  }): Promise<boolean> {
    return recordRuntimeRunLeaseReleased(this.#bindings.DB, input);
  }

  async #admitActivation(
    input: ActivateRuntimeSubjectInput,
    claimOwner: string,
    purpose: RuntimeSubjectActivationPurpose,
  ): Promise<RuntimeSubjectActivationRecord | null> {
    const now = currentTimestampMs();
    const claimExpiresAt = now + RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS;
    const record = await getRuntimeSubjectActivationRecord(
      this.#bindings.DB,
      input.runtimeSubjectId,
    );

    if (!record) {
      if (input.runtimeId === undefined) {
        throw new Error("A new runtime subject requires its admitted runtime.");
      }
      const runtimeSubjectId = await ensureRuntimeSubjectId(this.#bindings.DB, {
        runtimeId: input.runtimeId,
        runtimeImagesEnabled: runtimeImagesEnabled(this.#bindings.MOSOO_RUNTIME_IMAGES_ENABLED),
        agentId: input.agentId,
        projectId: input.projectId,
        executionOwnerUserId: input.executionOwnerUserId,
        now,
        runtimeSubjectId: input.runtimeSubjectId,
        sessionId: input.sessionId,
      });

      if (runtimeSubjectId !== input.runtimeSubjectId) {
        throw new Error("Runtime subject activation resolved a different lifecycle record.");
      }

      const createdByAnotherActivation = await getRuntimeSubjectActivationRecord(
        this.#bindings.DB,
        input.runtimeSubjectId,
      );

      if (!createdByAnotherActivation) {
        throw new Error("Runtime subject activation could not create a lifecycle record.");
      }

      return this.#claimExistingActivation({
        activation: input,
        claimExpiresAt,
        claimOwner,
        now,
        purpose,
        record: createdByAnotherActivation,
      });
    }

    return this.#claimExistingActivation({
      activation: input,
      claimExpiresAt,
      claimOwner,
      now,
      purpose,
      record,
    });
  }

  async #claimExistingActivation(input: {
    readonly activation: ActivateRuntimeSubjectInput;
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly now: number;
    readonly purpose: RuntimeSubjectActivationPurpose;
    readonly record: RuntimeSubjectActivationRecord;
  }): Promise<RuntimeSubjectActivationRecord> {
    let record = input.record;

    assertSessionRuntimeSubjectBinding(record, input.activation);

    if (record.status === "backing_up" || record.status === "destroying") {
      throw new Error("Runtime subject is busy with lifecycle maintenance.");
    }

    if (this.#canPreemptRuntimeSubjectClaim(input, record, "prewarm_only")) {
      const preempted = await this.#preemptRuntimeSubjectClaim(input, record);

      if (preempted) {
        return record;
      }

      const refreshed = await getRuntimeSubjectActivationRecord(
        this.#bindings.DB,
        input.activation.runtimeSubjectId,
      );
      if (!refreshed) {
        throw new Error("Runtime subject activation could not refresh the lifecycle record.");
      }
      record = refreshed;
    }

    // A concurrent activation can hold the claim through `cold` / `restoring` for tens of
    // seconds (Apple Silicon cold-start stalls inside `prepareFilesystem`). Wait briefly
    // for the in-flight activation to finish before failing this one.
    const waitDeadline = currentTimestampMs() + RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS;
    while (
      (record.status === "restoring" ||
        hasActiveRuntimeSubjectClaim(record, currentTimestampMs())) &&
      currentTimestampMs() < waitDeadline
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS),
      );
      const refreshed = await getRuntimeSubjectActivationRecord(
        this.#bindings.DB,
        input.activation.runtimeSubjectId,
      );
      if (!refreshed) {
        throw new Error("Runtime subject activation could not refresh the lifecycle record.");
      }
      record = refreshed;
      assertSessionRuntimeSubjectBinding(record, input.activation);
      if (record.status === "backing_up" || record.status === "destroying") {
        throw new Error("Runtime subject is busy with lifecycle maintenance.");
      }
    }

    if (record.status === "restoring") {
      throw new Error("Runtime subject is busy with lifecycle maintenance.");
    }

    if (hasActiveRuntimeSubjectClaim(record, currentTimestampMs())) {
      const preempted = this.#canPreemptRuntimeSubjectClaim(input, record, "all_low_priority")
        ? await this.#preemptRuntimeSubjectClaim(input, record)
        : false;

      if (preempted) {
        return record;
      }

      throw new Error("Runtime subject is claimed by lifecycle maintenance.");
    }

    const claimed = await claimRuntimeSubjectActivation(this.#bindings.DB, {
      accountConcurrentSandboxLimit: this.#accountConcurrentSandboxLimit,
      agentId: input.activation.agentId,
      projectId: input.activation.projectId,
      sessionId: input.activation.sessionId,
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
      executionOwnerUserId: input.activation.executionOwnerUserId,
      expectedStatus: record.status,
      now: currentTimestampMs(),
      runtimeSubjectId: input.activation.runtimeSubjectId,
    });

    if (!claimed) {
      throw new Error("Runtime subject is busy with lifecycle maintenance.");
    }

    return record;
  }

  #canPreemptRuntimeSubjectClaim(
    input: {
      readonly purpose: RuntimeSubjectActivationPurpose;
    },
    record: RuntimeSubjectActivationRecord,
    mode: "all_low_priority" | "prewarm_only",
  ): boolean {
    if (
      input.purpose !== "interactive" ||
      record.claimOwner === null ||
      record.claimExpiresAt === null
    ) {
      return false;
    }

    if (!isClaimableRuntimeSubjectStatus(record)) {
      return false;
    }

    if (isPrewarmActivationClaim(record)) {
      return true;
    }

    return mode === "all_low_priority" && isUnstartedMaintenanceClaim(record);
  }

  async #preemptRuntimeSubjectClaim(
    input: {
      readonly activation: ActivateRuntimeSubjectInput;
      readonly claimExpiresAt: number;
      readonly claimOwner: string;
    },
    record: RuntimeSubjectActivationRecord,
  ): Promise<boolean> {
    if (record.claimOwner === null || record.claimExpiresAt === null) {
      return false;
    }

    return preemptRuntimeSubjectActivationClaim(this.#bindings.DB, {
      agentId: input.activation.agentId,
      projectId: input.activation.projectId,
      sessionId: input.activation.sessionId,
      executionOwnerUserId: input.activation.executionOwnerUserId,
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
      expectedClaimExpiresAt: record.claimExpiresAt,
      expectedClaimOwner: record.claimOwner,
      expectedStatus: record.status,
      now: currentTimestampMs(),
      runtimeSubjectId: input.activation.runtimeSubjectId,
    });
  }
}

export function createRuntimeSubjectLifecycleService(
  bindings: ApiBindings,
): RuntimeSubjectLifecycleService {
  return new RuntimeSubjectLifecycleService(bindings);
}

export {
  getRuntimeSubjectKeepAliveHandle,
  prepareRuntimeSubjectFilesystem,
} from "./runtime-subject-platform";
