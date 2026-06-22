import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { RuntimeSubjectErrorCode } from "@mosoo/contracts/sandbox";
import type {
  AccountId,
  DriverInstanceId,
  PlatformId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

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
  getRuntimeSubjectInactiveDeadline,
  runtimeCheckpointRulesInclude,
} from "../../domain/runtime-kind-policy";
import type { SandboxHandle } from "../sandbox-handles";
import { deleteActiveSandboxConversationSession } from "../sandbox-session/sandbox-conversation-session-delete";
import {
  recordRuntimeRunLeaseAcquiredOutcome,
  recordRuntimeRunLeaseReleased,
} from "./runtime-run-lease-store";
import type { RuntimeRunLeaseTransitionOutcome } from "./runtime-run-lease-store";
import {
  getRuntimeSubjectErrorCode,
  isRecoverableRuntimeSubjectErrorCode,
  RuntimeSubjectBackupNotReadyError,
  RuntimeSubjectRestoreFailedError,
} from "./runtime-subject-errors";
import {
  getRuntimeSubjectKeepAliveHandle,
  prepareRuntimeSubjectFilesystem,
  restoreRuntimeSubjectBackup,
} from "./runtime-subject-platform";
import {
  claimRuntimeSubjectActivation,
  createClaimedColdRuntimeSubjectRecord,
  getRuntimeConversationSessionState,
  getRuntimeSubjectActivationRecord,
  markRuntimeSubjectActivationFailed,
  markRuntimeSubjectActive,
  markRuntimeSubjectRestoreApplied,
  markRuntimeSubjectRestoring,
  preemptRuntimeSubjectActivationClaim,
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionClosed,
  recordRuntimeConversationSessionError,
} from "./runtime-subject-store";
import type { RuntimeSubjectActivationRecord } from "./runtime-subject-store";
import type { ReadyRuntimeSubjectBackupRecord } from "./runtime-subject-store";

const RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS = 10 * 60_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS = 8_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS = 250;
const INTERACTIVE_ACTIVATION_CLAIM_OWNER_PREFIX = "interactive-activation-";
const PREWARM_ACTIVATION_CLAIM_OWNER_PREFIX = "prewarm-activation-";
const MAINTENANCE_CLAIM_OWNER_PREFIXES = ["scheduled-", "immediate-"] as const;

export type RuntimeSubjectActivationPurpose = "interactive" | "prewarm";

export interface ActivateRuntimeSubjectInput {
  readonly executionOwnerUserId: AccountId;
  readonly kind: AgentKind;
  readonly diagnosticContext?: RuntimeDiagnosticContext;
  readonly purpose?: RuntimeSubjectActivationPurpose;
  readonly runtimeSubjectId: SandboxId;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
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
  return record.status === "active" || record.status === "cold" || record.status === "error";
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
  readonly #bindings: ApiBindings;

  constructor(bindings: ApiBindings) {
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
      await measureOptional(input.timing, "runtimeSubject.prepareFilesystem", () =>
        prepareRuntimeSubjectFilesystem(subject),
      );

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

        await measureOptional(input.timing, "runtimeSubject.restoreBackup", () =>
          this.#restoreLastBackup({
            claimOwner,
            kind: input.kind,
            record,
            runtimeSubjectId: input.runtimeSubjectId,
            subject,
          }),
        );
      }

      const activated = await measureOptional(input.timing, "runtimeSubject.markActive", () =>
        markRuntimeSubjectActive(this.#bindings.DB, {
          claimOwner,
          kind: input.kind,
          runtimeSubjectId: input.runtimeSubjectId,
        }),
      );

      if (!activated) {
        throw new Error("Runtime subject activation claim expired before completion.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime subject activation failed.";
      const errorCode = getRuntimeSubjectErrorCode(error);

      await markRuntimeSubjectActivationFailed(this.#bindings.DB, {
        claimOwner,
        errorCode,
        message,
        runtimeSubjectId: input.runtimeSubjectId,
      });
      await this.#appendRestoreFailureDiagnostic({
        diagnosticContext: input.diagnosticContext,
        error,
        errorCode,
        record,
        runtimeSubjectId: input.runtimeSubjectId,
      });

      throw new Error(message, { cause: error });
    }

    return { subject };
  }

  async activateConversationSession(input: {
    readonly sandboxSessionId: SandboxSessionId;
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
    const state = await getRuntimeConversationSessionState(this.#bindings.DB, input);

    if (!state || state.status !== "active") {
      return;
    }

    const now = currentTimestampMs();

    await deleteActiveSandboxConversationSession(this.#bindings, {
      sandboxSessionId: state.sandboxSessionId,
      sandboxId: input.runtimeSubjectId,
    });

    if (state.agentId) {
      await appendRuntimeDiagnosticEvent(this.#bindings, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxSessionDestroyed.name,
        sessionId: input.sessionId,
        value: {
          ...toRuntimeDiagnosticBaseValue({
            agentId: state.agentId,
            sessionId: input.sessionId,
          }),
          reason: "runtime_subject_session_closed",
          sandboxId: input.runtimeSubjectId,
        },
      });
    }

    await recordRuntimeConversationSessionClosed(this.#bindings.DB, {
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(getRuntimeKindPolicy(state.kind), now),
      now,
      runtimeSubjectId: input.runtimeSubjectId,
      sessionId: input.sessionId,
    });
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
      const created = await createClaimedColdRuntimeSubjectRecord(this.#bindings.DB, {
        ...input,
        claimExpiresAt,
        claimOwner,
        now,
      });

      if (created) {
        return null;
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

    if (record.kind !== input.activation.kind) {
      throw new Error("Runtime subject kind does not match the requested runtime kind.");
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
      if (record.kind !== input.activation.kind) {
        throw new Error("Runtime subject kind does not match the requested runtime kind.");
      }
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

    const canRecoverFromMountError =
      record.status === "error" && isRecoverableRuntimeSubjectErrorCode(record.lastErrorCode);

    if (record.status === "error" && !canRecoverFromMountError) {
      throw new Error(record.lastError ?? "Runtime subject is blocked by a previous error.");
    }

    const claimed = await claimRuntimeSubjectActivation(this.#bindings.DB, {
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner,
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

  async #restoreLastBackup(input: {
    readonly claimOwner: string;
    readonly kind: AgentKind;
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
    await markRuntimeSubjectRestoreApplied(this.#bindings.DB, {
      backupId: readyBackup.id,
      claimOwner: input.claimOwner,
      runtimeSubjectId: input.runtimeSubjectId,
    });
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

export {
  getRuntimeSubjectKeepAliveHandle,
  prepareRuntimeSubjectFilesystem,
} from "./runtime-subject-platform";
