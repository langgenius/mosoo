import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind, SpaceAliasBinding } from "@mosoo/contracts/sandbox";
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
import { materializeRuntimeSpaces } from "./runtime-space-materializer";
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
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionClosed,
  recordRuntimeConversationSessionError,
} from "./runtime-subject-store";
import type { RuntimeSubjectActivationRecord } from "./runtime-subject-store";
import type { ReadyRuntimeSubjectBackupRecord } from "./runtime-subject-store";

const RUNTIME_SUBJECT_ACTIVATION_CLAIM_TTL_MS = 10 * 60_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_WAIT_MAX_MS = 8_000;
const RUNTIME_SUBJECT_ACTIVATION_CLAIM_POLL_INTERVAL_MS = 250;

export interface ActivateRuntimeSubjectInput {
  readonly executionOwnerUserId: AccountId;
  readonly kind: AgentKind;
  readonly onSpaceMountFailed?: (alias: SpaceAliasBinding, error: unknown) => Promise<void>;
  readonly onSpaceMountSucceeded?: (alias: SpaceAliasBinding) => Promise<void>;
  readonly diagnosticContext?: RuntimeDiagnosticContext;
  readonly runtimeSubjectId: SandboxId;
  readonly spaceAliases: SpaceAliasBinding[];
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
    const claimOwner = `activation-${crypto.randomUUID()}`;
    const record = await measureOptional(input.timing, "runtimeSubject.admitLifecycle", () =>
      this.#admitActivation(input, claimOwner),
    );
    const subject = await this.getHandle(input.runtimeSubjectId);
    const isCold = record === null || record.status === "cold";
    const mountedSpaceIds = new Set(record?.mountedSpaceIds);

    await measureOptional(input.timing, "runtimeSubject.prepareFilesystem", () =>
      prepareRuntimeSubjectFilesystem(subject),
    );

    try {
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

      await materializeRuntimeSpaces({
        bindings: this.#bindings,
        executionOwnerUserId: input.executionOwnerUserId,
        isCold,
        mountedSpaceIds,
        ...(input.onSpaceMountFailed ? { onSpaceMountFailed: input.onSpaceMountFailed } : {}),
        ...(input.onSpaceMountSucceeded
          ? { onSpaceMountSucceeded: input.onSpaceMountSucceeded }
          : {}),
        spaceAliases: input.spaceAliases,
        subject,
        ...(input.timing ? { timing: input.timing } : {}),
      });

      const activated = await measureOptional(input.timing, "runtimeSubject.markActive", () =>
        markRuntimeSubjectActive(this.#bindings.DB, {
          claimOwner,
          kind: input.kind,
          mountedSpaceIds,
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
    readonly cloudflareSessionId: SandboxSessionId;
    readonly cwd: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
    readonly spaceAliasesJson: string;
  }): Promise<void> {
    await recordRuntimeConversationSessionActive(this.#bindings.DB, input);
  }

  async failConversationSession(input: {
    readonly cloudflareSessionId: SandboxSessionId;
    readonly cwd: string;
    readonly errorCode: RuntimeSubjectErrorCode;
    readonly message: string;
    readonly now: number;
    readonly originJson: string;
    readonly runtimeSubjectId: SandboxId;
    readonly sessionId: SessionId;
    readonly spaceAliasesJson: string;
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
      cloudflareSessionId: state.cloudflareSessionId,
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
        record: createdByAnotherActivation,
      });
    }

    return this.#claimExistingActivation({
      activation: input,
      claimExpiresAt,
      claimOwner,
      now,
      record,
    });
  }

  async #claimExistingActivation(input: {
    readonly activation: ActivateRuntimeSubjectInput;
    readonly claimExpiresAt: number;
    readonly claimOwner: string;
    readonly now: number;
    readonly record: RuntimeSubjectActivationRecord;
  }): Promise<RuntimeSubjectActivationRecord> {
    let record = input.record;

    if (record.kind !== input.activation.kind) {
      throw new Error("Runtime subject kind does not match the requested runtime kind.");
    }

    if (record.status === "backing_up" || record.status === "destroying") {
      throw new Error("Runtime subject is busy with lifecycle maintenance.");
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
