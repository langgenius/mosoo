import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";
import type {
  AccountId,
  AgentId,
  DriverInstanceId,
  PlatformId,
  ProjectId,
  RuntimeOperationId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { createPlatformId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../../platform/analytics/product-analytics";
import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import type { RuntimeDiagnosticContext } from "../../application/runtime-diagnostic-events";
import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import {
  getRuntimeKindPolicy,
  runtimeCheckpointRulesInclude,
} from "../../domain/runtime-kind-policy";
import type { SandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import { hashSandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import type { SandboxHandle } from "../sandbox-handles";
import {
  recordRuntimeRunLeaseAcquiredOutcome,
  recordRuntimeRunLeaseReleased,
} from "./runtime-run-lease-store";
import type { RuntimeRunLeaseTransitionOutcome } from "./runtime-run-lease-store";
import { stopRuntimeSubjectDrivers } from "./runtime-subject-driver-stop";
import {
  getRuntimeSubjectErrorCode,
  RuntimeSubjectBackupNotReadyError,
  RuntimeSubjectRestoreFailedError,
} from "./runtime-subject-errors";
import { assertRuntimeSubjectNetworkPolicySupported } from "./runtime-subject-network";
import {
  configureRuntimeSubjectNetwork,
  activateRuntimeSubjectIncarnation,
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
  inspectRuntimeSubjectIncarnation,
  markRuntimeSubjectIncarnationReady,
  prepareRuntimeSubjectFilesystem,
  restoreRuntimeSubjectBackup,
} from "./runtime-subject-platform";
import {
  claimRuntimeSubjectActivation,
  claimRuntimeSubjectOperationForRepair,
  ensureRuntimeSubjectId,
  getRuntimeSubjectActivationRecord,
  markRuntimeSubjectActivationDestroying,
  markRuntimeSubjectActivationFailed,
  markRuntimeSubjectActiveDestroying,
  markRuntimeSubjectActive,
  markRuntimeSubjectOperationRepairNeeded,
  markRuntimeSubjectRestoreApplied,
  markRuntimeSubjectRestoring,
  preemptRuntimeSubjectActivationClaim,
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionError,
  releaseRuntimeSubjectActivationClaim,
  retireRuntimeConversationSessionsForIncarnation,
} from "./runtime-subject-store";
import type { RuntimeSubjectActivationRecord } from "./runtime-subject-store";
import type { RuntimeSubjectOperationLease } from "./runtime-subject-store";
import type { ReadyRuntimeSubjectBackupRecord } from "./runtime-subject-store";

const RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS = 10 * 60_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS = 8_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS = 250;
const INTERACTIVE_ACTIVATION_CLAIM_OWNER_PREFIX = "interactive-activation-";
const PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX = "prewarm-activation-";
const MAINTENANCE_CLAIM_OWNER_PREFIXES = ["scheduled-", "immediate-"] as const;

export type RuntimeSubjectActivationPurpose = "interactive" | "prewarm";

export interface ActivateRuntimeSubjectInput {
  readonly agentId: AgentId;
  readonly executionOwnerUserId: AccountId;
  readonly kind: AgentKind;
  readonly diagnosticContext?: RuntimeDiagnosticContext;
  readonly networkConstraints: SandboxNetworkConstraints;
  readonly purpose?: RuntimeSubjectActivationPurpose;
  readonly provisioningAuthority?: {
    readonly operationId: RuntimeOperationId;
    readonly runId: SessionRunId;
    readonly sessionId: SessionId;
  };
  readonly runtimeSubjectId: SandboxId;
  readonly projectId: ProjectId;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
  readonly timing?: RuntimeTimingRecorder;
}

export interface ActiveRuntimeSubject {
  readonly incarnation: number;
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

export function selectRuntimeSubjectRestoreBackup(input: {
  readonly kind: AgentKind;
  readonly record: RuntimeSubjectActivationRecord | null;
  readonly runtimeSubjectId: SandboxId;
}): ReadyRuntimeSubjectBackupRecord | null {
  const policy = getRuntimeKindPolicy(input.kind);

  if (!runtimeCheckpointRulesInclude(policy.checkpoint.restoreOnActivate, "subject_memory")) {
    return null;
  }

  const lastBackup = input.record?.lastBackup ?? null;
  const readyBackup = input.record?.lastReadyBackup ?? null;

  if (lastBackup === null) {
    return null;
  }

  if (readyBackup === null) {
    throw new RuntimeSubjectBackupNotReadyError({
      backupId: lastBackup.id,
      runtimeSubjectId: input.runtimeSubjectId,
      status: lastBackup.status,
    });
  }

  return readyBackup;
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

  async getHandle(runtimeSubjectId: SandboxId, incarnation: number): Promise<SandboxHandle> {
    return getRuntimeSubjectKeepAliveHandle(this.#bindings, runtimeSubjectId, incarnation);
  }

  async activate(input: ActivateRuntimeSubjectInput): Promise<ActiveRuntimeSubject> {
    assertRuntimeSubjectNetworkPolicySupported({
      kind: input.kind,
      networkPolicy: input.networkConstraints.networkPolicy,
      subjectKind: input.subjectKind,
    });

    const purpose = input.purpose ?? "interactive";
    const claimOwner = createRuntimeSubjectActivationClaimOwner(purpose);
    const networkConstraintsHash = await hashSandboxNetworkConstraints(input.networkConstraints);
    const record = await measureOptional(input.timing, "runtimeSubject.admitLifecycle", () =>
      this.#admitActivation(input, claimOwner, purpose),
    );
    const isCold = record === null || record.status === "cold";
    let activationLease: RuntimeSubjectOperationLease | null = null;
    let subject: SandboxHandle | null = null;
    let subjectTransferred = false;
    let reusedHealthyIncarnation = false;

    try {
      if (isCold) {
        activationLease = await measureOptional(input.timing, "runtimeSubject.markRestoring", () =>
          markRuntimeSubjectRestoring(this.#bindings.DB, {
            claimOwner,
            expectedIncarnation: record?.incarnation ?? 0,
            expectedStatus: "cold",
            networkConstraintsHash,
            operationId: createPlatformId<RuntimeOperationId>(),
            runtimeSubjectId: input.runtimeSubjectId,
          }),
        );

        if (activationLease === null) {
          throw new Error("Runtime subject activation claim expired before restore.");
        }
      } else if (record !== null) {
        if (record.networkConstraintsHash !== networkConstraintsHash) {
          const retired = await this.#retireActiveIncarnation({
            claimOwner,
            errorCode: "runtime.subject_activation_failed",
            message: "Runtime subject network constraints changed.",
            record,
            runtimeSubjectId: input.runtimeSubjectId,
            provisioningAuthority: input.provisioningAuthority,
          });
          if (!retired) {
            throw new Error("Runtime subject activation claim expired before network retirement.");
          }
          throw new Error("Runtime subject network constraints changed; retry activation.");
        }
        subject = await this.getHandle(input.runtimeSubjectId, record.incarnation);
        const health = await inspectRuntimeSubjectIncarnation(
          subject,
          record.incarnation,
          networkConstraintsHash,
        );

        if (health.kind === "healthy") {
          reusedHealthyIncarnation = true;
        } else if (health.kind === "unknown") {
          throw new Error("Runtime subject active-container health is unknown.");
        } else {
          const retired = await this.#retireActiveIncarnation({
            claimOwner,
            errorCode: "runtime.subject_activation_failed",
            message: `Runtime subject active container is ${health.kind}.`,
            record,
            runtimeSubjectId: input.runtimeSubjectId,
            provisioningAuthority: input.provisioningAuthority,
          });
          if (!retired) {
            throw new Error("Runtime subject activation claim expired before recovery.");
          }
          throw new Error("Runtime subject active container was retired; retry activation.");
        }
      }

      const incarnation = activationLease?.incarnation ?? record?.incarnation ?? 0;
      subject ??= await this.getHandle(input.runtimeSubjectId, incarnation);
      const activeSubject = subject;
      if (activationLease !== null) {
        await activateRuntimeSubjectIncarnation(activeSubject, incarnation, networkConstraintsHash);
      }

      // A healthy active incarnation is already prepared. Re-running global
      // container mutations during reuse is both redundant and unsafe: one
      // caller timing out must never poison a Pet container used by another
      // Run. Fresh incarnations still establish network policy before their
      // first container-starting filesystem RPC.
      if (!reusedHealthyIncarnation) {
        if (input.kind === "cattle") {
          await measureOptional(input.timing, "runtimeSubject.configureNetwork", () =>
            configureRuntimeSubjectNetwork(activeSubject, input.networkConstraints),
          );
        }
        await measureOptional(input.timing, "runtimeSubject.prepareFilesystem", () =>
          prepareRuntimeSubjectFilesystem(activeSubject),
        );
      }

      if (activationLease !== null) {
        const lease = activationLease;
        await measureOptional(input.timing, "runtimeSubject.restoreBackup", () =>
          this.#restoreLastBackup({
            kind: input.kind,
            lease,
            record,
            runtimeSubjectId: input.runtimeSubjectId,
            subject: activeSubject,
          }),
        );
        await markRuntimeSubjectIncarnationReady(
          activeSubject,
          incarnation,
          networkConstraintsHash,
        );
      }

      const activated = await measureOptional(input.timing, "runtimeSubject.markActive", () =>
        markRuntimeSubjectActive(this.#bindings.DB, {
          claimOwner,
          incarnation: activationLease?.incarnation ?? record?.incarnation ?? 0,
          kind: input.kind,
          networkConstraintsHash,
          operationId: activationLease?.operationId ?? null,
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
            agent_id:
              input.diagnosticContext?.agentId ??
              (input.subjectKind === "agent" ? input.subjectId : undefined),
            execution_owner_id: input.executionOwnerUserId,
            sandbox_id: input.runtimeSubjectId,
            sandbox_kind: input.kind,
            session_id:
              input.diagnosticContext?.sessionId ??
              (input.subjectKind === "session" ? input.subjectId : undefined),
            subject_id: input.subjectId,
            subject_kind: input.subjectKind,
          },
        });
      }

      if (subject === null) {
        throw new Error("Runtime subject activation completed without a Sandbox handle.");
      }

      subjectTransferred = true;
      return {
        incarnation: activationLease?.incarnation ?? record?.incarnation ?? 0,
        subject,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime subject activation failed.";
      const errorCode = getRuntimeSubjectErrorCode(error);

      let destroyingRecorded = false;

      if (activationLease === null) {
        await releaseRuntimeSubjectActivationClaim(this.#bindings.DB, {
          claimOwner,
          errorCode,
          errorMessage: message,
          incarnation: record?.incarnation ?? 0,
          runtimeSubjectId: input.runtimeSubjectId,
        });
      } else {
        try {
          destroyingRecorded = await markRuntimeSubjectActivationDestroying(this.#bindings.DB, {
            errorCode,
            lease: activationLease,
            message,
            runtimeSubjectId: input.runtimeSubjectId,
          });
        } catch (recordError) {
          logWarn("runtime.subject.activation_failure.destroy_record_failed", {
            ...createErrorLogContext(recordError),
            runtimeSubjectId: input.runtimeSubjectId,
          });
        }
      }

      // Teardown is bounded by the provision timeout. Only confirmed teardown
      // may advertise cold; failure leaves destroying + operationId for the
      // maintenance repair loop. Neither path masks the activation error.
      let destroyed = false;

      if (destroyingRecorded) {
        try {
          await destroyRuntimeSubjectContainer(
            this.#bindings,
            input.runtimeSubjectId,
            activationLease?.incarnation ?? 0,
          );
          destroyed = true;
        } catch (destroyError) {
          logWarn("runtime.subject.activation_failure.destroy_failed", {
            ...createErrorLogContext(destroyError),
            runtimeSubjectId: input.runtimeSubjectId,
          });
        }
      }

      if (activationLease !== null && destroyingRecorded && destroyed) {
        try {
          await markRuntimeSubjectActivationFailed(this.#bindings.DB, {
            errorCode,
            lease: activationLease,
            message,
            runtimeSubjectId: input.runtimeSubjectId,
          });
        } catch (finalizeError) {
          logWarn("runtime.subject.activation_failure.destroy_finalize_failed", {
            ...createErrorLogContext(finalizeError),
            runtimeSubjectId: input.runtimeSubjectId,
          });
        }
      }

      await this.#appendRestoreFailureDiagnostic({
        diagnosticContext: input.diagnosticContext,
        error,
        errorCode,
        record,
        runtimeSubjectId: input.runtimeSubjectId,
      });

      throw new Error(message, { cause: error });
    } finally {
      if (!subjectTransferred) {
        disposeRpcResource(subject);
      }
    }
  }

  async activateConversationSession(input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly sandboxIncarnation: number;
    readonly cwd: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  }): Promise<void> {
    await recordRuntimeConversationSessionActive(this.#bindings.DB, input);
  }

  async failConversationSession(input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly sandboxIncarnation: number;
    readonly cwd: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly message: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  }): Promise<void> {
    await recordRuntimeConversationSessionError(this.#bindings.DB, input);
  }

  async closeConversationSession(input: {
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
  }): Promise<void> {
    const { closeSandboxConversationSession } = await import("../sandbox-session.service");
    await closeSandboxConversationSession(this.#bindings, {
      sandboxId: input.runtimeSubjectId,
      sessionId: input.sessionId,
    });
  }

  async acquireRunLease(input: {
    readonly driverGeneration: number;
    readonly driverInstanceId: DriverInstanceId;
    readonly runtimeSubjectId: SandboxId;
    readonly runtimeSubjectIncarnation: number;
    readonly sessionId: SessionId;
    readonly sessionRunId: SessionRunId;
  }): Promise<RuntimeRunLeaseTransitionOutcome> {
    return recordRuntimeRunLeaseAcquiredOutcome(this.#bindings.DB, input);
  }

  async releaseRunLease(input: {
    readonly driverInstanceId: DriverInstanceId;
    readonly expectedDriverGeneration: number;
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
      const runtimeSubjectId = await ensureRuntimeSubjectId(this.#bindings.DB, {
        agentId: input.agentId,
        projectId: input.projectId,
        executionOwnerUserId: input.executionOwnerUserId,
        kind: input.kind,
        now,
        runtimeSubjectId: input.runtimeSubjectId,
        subjectId: input.subjectId,
        subjectKind: input.subjectKind,
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

    if (
      record.kind !== input.activation.kind ||
      record.subjectKind !== input.activation.subjectKind ||
      record.subjectId !== input.activation.subjectId
    ) {
      throw new Error("Runtime subject identity does not match the activation request.");
    }
    if (
      record.agentId !== input.activation.agentId ||
      record.projectId !== input.activation.projectId ||
      record.ownerAccountId !== input.activation.executionOwnerUserId
    ) {
      throw new Error("Runtime subject ownership does not match the activation request.");
    }

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
      if (
        record.kind !== input.activation.kind ||
        record.subjectKind !== input.activation.subjectKind ||
        record.subjectId !== input.activation.subjectId
      ) {
        throw new Error("Runtime subject identity changed during activation.");
      }
      if (record.status === "backing_up" || record.status === "destroying") {
        throw new Error("Runtime subject is busy with lifecycle maintenance.");
      }
    }

    if (record.status === "restoring") {
      if (
        !hasActiveRuntimeSubjectClaim(record, currentTimestampMs()) &&
        record.operationId !== null &&
        record.operationKind === "activate"
      ) {
        const repairNow = currentTimestampMs();
        const lease = await claimRuntimeSubjectOperationForRepair(this.#bindings.DB, {
          candidate: {
            claimExpiresAt: record.claimExpiresAt,
            claimOwner: record.claimOwner,
            id: record.id,
            incarnation: record.incarnation,
            kind: record.kind,
            operationId: record.operationId,
            operationKind: "activate",
            status: "restoring",
          },
          claimExpiresAt: repairNow + RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS,
          claimOwner: `activation-repair-${crypto.randomUUID()}`,
          now: repairNow,
        });
        if (lease !== null) {
          const { runRuntimeSubjectOperation } =
            await import("./runtime-subject-operations.service");
          await runRuntimeSubjectOperation(this.#bindings, {
            kind: record.kind,
            lease,
            reason: "runtime_subject.activation_takeover",
            runtimeSubjectId: record.id,
          });
          const repaired = await getRuntimeSubjectActivationRecord(this.#bindings.DB, record.id);
          if (repaired === null) {
            throw new Error("Runtime subject activation repair lost its lifecycle record.");
          }
          return this.#claimExistingActivation({ ...input, record: repaired });
        }
      }
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
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
      expectedClaimExpiresAt: record.claimExpiresAt,
      expectedClaimOwner: record.claimOwner,
      expectedStatus: record.status,
      now: currentTimestampMs(),
      runtimeSubjectId: input.activation.runtimeSubjectId,
    });
  }

  async #retireActiveIncarnation(input: {
    readonly claimOwner: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly message: string;
    readonly provisioningAuthority: ActivateRuntimeSubjectInput["provisioningAuthority"];
    readonly record: RuntimeSubjectActivationRecord;
    readonly runtimeSubjectId: SandboxId;
  }): Promise<boolean> {
    if (input.provisioningAuthority === undefined) {
      return false;
    }
    const lease = await markRuntimeSubjectActiveDestroying(this.#bindings.DB, {
      claimOwner: input.claimOwner,
      errorCode: input.errorCode,
      expectedIncarnation: input.record.incarnation,
      message: input.message,
      operationId: createPlatformId<RuntimeOperationId>(),
      provisioningOperationId: input.provisioningAuthority.operationId,
      provisioningRunId: input.provisioningAuthority.runId,
      provisioningSessionId: input.provisioningAuthority.sessionId,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    if (lease === null) {
      return false;
    }

    try {
      await stopRuntimeSubjectDrivers(this.#bindings, {
        operationId: lease.operationId,
        reason: "runtime_subject.active_incarnation_retired",
        runtimeSubjectId: input.runtimeSubjectId,
        sandboxIncarnation: lease.incarnation,
      });
      await destroyRuntimeSubjectContainer(
        this.#bindings,
        input.runtimeSubjectId,
        lease.incarnation,
      );
      await retireRuntimeConversationSessionsForIncarnation(this.#bindings.DB, {
        now: currentTimestampMs(),
        runtimeSubjectId: input.runtimeSubjectId,
        sandboxIncarnation: lease.incarnation,
      });
      if (
        !(await markRuntimeSubjectActivationFailed(this.#bindings.DB, {
          errorCode: input.errorCode,
          lease,
          message: input.message,
          runtimeSubjectId: input.runtimeSubjectId,
        }))
      ) {
        throw new Error("Runtime subject active-incarnation retirement lost ownership.");
      }
    } catch (error) {
      try {
        await markRuntimeSubjectOperationRepairNeeded(this.#bindings.DB, {
          errorCode: getRuntimeSubjectErrorCode(error),
          errorMessage: error instanceof Error ? error.message : input.message,
          expectedStatus: "destroying",
          lease,
          runtimeSubjectId: input.runtimeSubjectId,
          source: "api",
        });
      } catch (recordError) {
        logWarn("runtime.subject.active_retire.repair_record_failed", {
          ...createErrorLogContext(recordError),
          runtimeSubjectId: input.runtimeSubjectId,
        });
      }
      logWarn("runtime.subject.active_retire.failed", {
        ...createErrorLogContext(error),
        runtimeSubjectId: input.runtimeSubjectId,
      });
    }

    return true;
  }

  async #restoreLastBackup(input: {
    readonly kind: AgentKind;
    readonly lease: RuntimeSubjectOperationLease;
    readonly record: RuntimeSubjectActivationRecord | null;
    readonly runtimeSubjectId: SandboxId;
    readonly subject: SandboxHandle;
  }): Promise<void> {
    const readyBackup = selectRuntimeSubjectRestoreBackup({
      kind: input.kind,
      record: input.record,
      runtimeSubjectId: input.runtimeSubjectId,
    });

    if (readyBackup === null) {
      return;
    }

    try {
      await restoreRuntimeSubjectBackup(input.subject, {
        backup: readyBackup,
        runtimeSubjectId: input.runtimeSubjectId,
      });
    } catch (error) {
      throw new RuntimeSubjectRestoreFailedError({
        backupId: readyBackup.id,
        cause: error,
        runtimeSubjectId: input.runtimeSubjectId,
      });
    }
    const recorded = await markRuntimeSubjectRestoreApplied(this.#bindings.DB, {
      backupId: readyBackup.id,
      lease: input.lease,
      runtimeSubjectId: input.runtimeSubjectId,
    });
    if (!recorded) {
      throw new Error("Runtime subject restore lost lifecycle ownership.");
    }
  }

  async #appendRestoreFailureDiagnostic(input: {
    readonly diagnosticContext: RuntimeDiagnosticContext | undefined;
    readonly error: unknown;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly record: RuntimeSubjectActivationRecord | null;
    readonly runtimeSubjectId: SandboxId;
  }): Promise<void> {
    if (
      input.diagnosticContext === undefined ||
      (input.errorCode !== "runtime.subject_backup_not_ready" &&
        input.errorCode !== "runtime.subject_restore_failed")
    ) {
      return;
    }

    const backupId =
      input.error instanceof RuntimeSubjectBackupNotReadyError ||
      input.error instanceof RuntimeSubjectRestoreFailedError
        ? input.error.backupId
        : (input.record?.lastBackup?.id ?? null);

    await appendRuntimeDiagnosticEvent(this.#bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxRestoreFailed.name,
      sessionId: input.diagnosticContext.sessionId,
      value: {
        ...toRuntimeDiagnosticBaseValue(input.diagnosticContext),
        backupId,
        errorCode: input.errorCode,
        reason: toRuntimeDiagnosticReason(input.error, "Runtime subject restore failed."),
        sandboxId: input.runtimeSubjectId,
      },
    });
  }
}

export function createRuntimeSubjectLifecycleService(
  bindings: ApiBindings,
): RuntimeSubjectLifecycleService {
  return new RuntimeSubjectLifecycleService(bindings);
}

export { getRuntimeSubjectKeepAliveHandle } from "./runtime-subject-platform";
