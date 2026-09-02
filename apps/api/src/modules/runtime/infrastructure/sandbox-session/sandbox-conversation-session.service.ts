import { getSessionOrganizationPath } from "@mosoo/agent-driver/paths";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
} from "../../application/runtime-diagnostic-events";
import {
  getRuntimeKindPolicy,
  getRuntimeSubjectInactiveDeadline,
  runtimeCheckpointRulesInclude,
} from "../../domain/runtime-kind-policy";
import {
  heartbeatRuntimeRunProvisioningLease,
  recordRuntimeProvisioningConversationTarget,
} from "../runtime-subject-lifecycle/runtime-provisioning-lease-store";
import type { RuntimeConversationSessionRecord } from "../runtime-subject-lifecycle/runtime-subject-store";
import {
  claimRuntimeConversationSessionCleanup,
  claimIdleSessionScopedConversationForClose,
  ensureRuntimeConversationSessionRecord,
  getRuntimeConversationSession,
  getRuntimeConversationSessionState,
  listPendingRuntimeConversationSessionCleanups,
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionClosed,
  recordRuntimeConversationSessionError,
} from "../runtime-subject-lifecycle/runtime-subject-store";
import type { RuntimeConversationSessionState } from "../runtime-subject-lifecycle/runtime-subject-store";
import { ensureSessionResourcesMounted } from "../session-resources/session-resource-mount.service";
import { parseSandboxConversationOrigin } from "./sandbox-conversation-session-codec";
import {
  deleteSandboxConversationSessionBestEffort,
  openSandboxConversationSession,
  prepareSandboxConversationDirectories,
  restoreSandboxConversationDirectoryBackup,
  sandboxConversationDirectoryHasContent,
} from "./sandbox-conversation-session-platform";
import type {
  EnsureSandboxConversationSessionInput,
  SandboxConversationSessionResult,
} from "./sandbox-session.types";
import { restoreSessionArtifactsToWorkspace } from "./session-artifact-restore.service";

function measureOptional<T>(
  timing: EnsureSandboxConversationSessionInput["timing"],
  name: string,
  task: () => Promise<T>,
): Promise<T> {
  return timing ? timing.measure(name, task) : task();
}

function resolveConversationContinuationPlan(input: {
  existingSession: RuntimeConversationSessionRecord | null;
  kind: EnsureSandboxConversationSessionInput["kind"];
  replaceClosedExecutionSession: boolean;
}): {
  sandboxSessionId?: SandboxSessionId;
  requireCwdCheckpoint: boolean;
  shouldCreateCloudflareSession: boolean;
  shouldDeleteErrorSession: boolean;
  shouldRestoreCwd: boolean;
  shouldRestoreSessionArtifacts: boolean;
} {
  const policy = getRuntimeKindPolicy(input.kind);
  // A workspace being (re)created is the artifact-restore trigger: recorded
  // session artifacts are the only durable workspace state a policy without
  // workspace checkpoints can rehydrate after the sandbox was recycled. A
  // first-ever conversation passes through the same path and finds no
  // artifacts to restore.
  const isLegacyCattleContinuation =
    input.kind === "cattle" &&
    input.existingSession !== null &&
    !input.existingSession.workspaceCheckpointRequired;
  const shouldRestoreSessionArtifacts =
    policy.continuation.restoreSessionArtifacts || isLegacyCattleContinuation;

  if (input.existingSession === null) {
    return {
      shouldCreateCloudflareSession: true,
      shouldDeleteErrorSession: false,
      requireCwdCheckpoint: false,
      shouldRestoreCwd: false,
      shouldRestoreSessionArtifacts,
    };
  }

  if (input.existingSession.status === "active") {
    return {
      shouldCreateCloudflareSession: false,
      shouldDeleteErrorSession: false,
      requireCwdCheckpoint: false,
      shouldRestoreCwd: false,
      shouldRestoreSessionArtifacts: false,
    };
  }

  if (input.existingSession.status === "cleanup_pending") {
    throw new Error("Sandbox conversation cleanup is still pending; retry after maintenance.");
  }

  const shouldRestoreCwd = runtimeCheckpointRulesInclude(
    policy.checkpoint.restoreOnActivate,
    "session_workspaces",
  );
  const shouldUseNewCloudflareSession =
    input.existingSession.status === "closed" &&
    (policy.subject.scope === "session" || input.replaceClosedExecutionSession);

  return {
    ...(shouldUseNewCloudflareSession
      ? { sandboxSessionId: createPlatformId<SandboxSessionId>() }
      : {}),
    shouldCreateCloudflareSession: true,
    shouldDeleteErrorSession: input.existingSession.status === "error",
    requireCwdCheckpoint:
      input.kind === "cattle" &&
      input.existingSession.status === "closed" &&
      input.existingSession.workspaceCheckpointRequired,
    shouldRestoreCwd,
    shouldRestoreSessionArtifacts,
  };
}

async function restoreSandboxSessionCwdIfMissing(input: {
  cwd: string;
  latestReadyBackup: RuntimeConversationSessionRecord["latestReadyBackup"];
  requireCheckpoint: boolean;
  sandbox: EnsureSandboxConversationSessionInput["sandbox"];
  sessionId: SessionId;
}): Promise<void> {
  if (await sandboxConversationDirectoryHasContent(input.sandbox, input.cwd)) {
    return;
  }

  if (!input.latestReadyBackup) {
    if (input.requireCheckpoint) {
      throw new Error(
        `Thread ${input.sessionId} has no committed workspace checkpoint. Retry after the previous turn finishes checkpointing; if the error persists, start a new Thread or contact support.`,
      );
    }

    return;
  }

  try {
    await restoreSandboxConversationDirectoryBackup(input.sandbox, {
      backup: input.latestReadyBackup,
      cwd: input.cwd,
    });
  } catch (cause) {
    throw new Error(
      `Thread ${input.sessionId} workspace checkpoint could not be restored. Retry the continuation; if the error persists, start a new Thread or contact support.`,
      { cause },
    );
  }
}

export async function ensureSandboxConversationSession(
  bindings: ApiBindings,
  input: EnsureSandboxConversationSessionInput,
): Promise<SandboxConversationSessionResult> {
  const now = Date.now();
  const existingSession = await measureOptional(input.timing, "conversation.loadSession", () =>
    getRuntimeConversationSession(bindings.DB, input.sessionId),
  );
  const continuation = resolveConversationContinuationPlan({
    existingSession,
    kind: input.kind,
    replaceClosedExecutionSession: input.replaceClosedExecutionSession ?? false,
  });
  const cwd = existingSession?.cwd ?? getSessionOrganizationPath(input.sessionId);

  if (existingSession && existingSession.sandboxId !== input.sandboxId) {
    throw new Error("Sandbox session is already bound to a different sandbox.");
  }
  if (
    existingSession &&
    existingSession.status !== "closed" &&
    existingSession.sandboxIncarnation !== input.sandboxIncarnation
  ) {
    throw new Error("Sandbox session belongs to a retired sandbox incarnation.");
  }

  const frozenOrigin = existingSession
    ? parseSandboxConversationOrigin(existingSession.originJson)
    : input.origin;
  // ensureRuntimeConversationSessionRecord only re-reads the row we already
  // loaded above when a record exists (the sandbox-mismatch guard ran there
  // too), so the round trip is only needed for first-time allocation.
  const sessionRecord =
    existingSession ??
    (await measureOptional(input.timing, "conversation.ensureRecord", () =>
      ensureRuntimeConversationSessionRecord(bindings.DB, {
        cwd,
        now,
        originJson: JSON.stringify(frozenOrigin),
        runtimeSubjectId: input.sandboxId,
        sandboxIncarnation: input.sandboxIncarnation,
        sessionId: input.sessionId,
      }),
    ));
  const sandboxSessionId = continuation.sandboxSessionId ?? sessionRecord.sandboxSessionId;
  let provisioningLease = input.provisioningLease;

  if (provisioningLease !== undefined) {
    const recordedLease = await recordRuntimeProvisioningConversationTarget(bindings.DB, {
      lease: provisioningLease,
      sandboxIncarnation: input.sandboxIncarnation,
      sandboxSessionId,
    });
    if (recordedLease === null) {
      throw new Error("Sandbox conversation provisioning lost lifecycle ownership.");
    }
    provisioningLease = recordedLease;
  }

  const measureProvisioning = async <T>(name: string, task: () => Promise<T>): Promise<T> => {
    if (
      provisioningLease !== undefined &&
      !(await heartbeatRuntimeRunProvisioningLease(bindings.DB, provisioningLease))
    ) {
      throw new Error("Sandbox conversation provisioning lost lifecycle ownership.");
    }
    const result = await measureOptional(input.timing, name, task);
    if (
      provisioningLease !== undefined &&
      !(await heartbeatRuntimeRunProvisioningLease(bindings.DB, provisioningLease))
    ) {
      throw new Error("Sandbox conversation provisioning lost lifecycle ownership.");
    }
    return result;
  };

  if (continuation.shouldRestoreCwd && existingSession) {
    await measureProvisioning("conversation.restoreCwd", () =>
      restoreSandboxSessionCwdIfMissing({
        cwd,
        latestReadyBackup: existingSession.latestReadyBackup,
        requireCheckpoint: continuation.requireCwdCheckpoint,
        sandbox: input.sandbox,
        sessionId: input.sessionId,
      }),
    );
  }

  if (continuation.shouldCreateCloudflareSession) {
    await measureProvisioning("conversation.prepareDirectories", () =>
      prepareSandboxConversationDirectories({
        cwd,
        sandbox: input.sandbox,
      }),
    );

    if (continuation.shouldRestoreSessionArtifacts) {
      await measureProvisioning("conversation.restoreSessionArtifacts", () =>
        restoreSessionArtifactsToWorkspace(bindings, {
          agentId: input.agentId,
          cwd,
          sandbox: input.sandbox,
          sandboxId: input.sandboxId,
          sessionId: input.sessionId,
        }),
      );
    }
  }

  if (input.mountSessionResources) {
    await measureProvisioning("conversation.mountResources", () =>
      ensureSessionResourcesMounted({
        bindings,
        sandbox: input.sandbox,
        sessionId: input.sessionId,
      }),
    );
  }

  if (continuation.shouldDeleteErrorSession) {
    await measureProvisioning("conversation.deleteErrorSession", () =>
      deleteSandboxConversationSessionBestEffort({
        sandboxSessionId: sessionRecord.sandboxSessionId,
        sandbox: input.sandbox,
      }),
    );
  }

  const openedCloudflareSession = await measureProvisioning("conversation.openSession", () =>
    openSandboxConversationSession({
      sandboxSessionId,
      cwd,
      sandbox: input.sandbox,
      shouldCreate: continuation.shouldCreateCloudflareSession,
    }),
  );
  const cloudflareSession = openedCloudflareSession.session;
  const activatedAt = currentTimestampMs();

  try {
    const activated = await measureProvisioning("conversation.activateRecord", () =>
      recordRuntimeConversationSessionActive(bindings.DB, {
        sandboxSessionId,
        cwd,
        ...(provisioningLease === undefined
          ? {}
          : { expectedProvisioningOperationId: provisioningLease.operationId }),
        now: activatedAt,
        originJson: JSON.stringify(frozenOrigin),
        runtimeSubjectId: input.sandboxId,
        sandboxIncarnation: input.sandboxIncarnation,
        sessionId: input.sessionId,
      }),
    );
    if (!activated) {
      throw new Error("Sandbox conversation activation lost lifecycle ownership.");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sandbox conversation session activation failed.";

    const recordedError = await recordRuntimeConversationSessionError(bindings.DB, {
      sandboxSessionId,
      sandboxIncarnation: input.sandboxIncarnation,
      cwd,
      errorCode: "runtime.conversation_mount_failed",
      ...(provisioningLease === undefined
        ? {}
        : { expectedProvisioningOperationId: provisioningLease.operationId }),
      message,
      now: activatedAt,
      originJson: JSON.stringify(frozenOrigin),
      runtimeSubjectId: input.sandboxId,
      sessionId: input.sessionId,
    });

    disposeRpcResource(cloudflareSession);
    if (!recordedError) {
      await deleteSandboxConversationSessionBestEffort({
        sandbox: input.sandbox,
        sandboxSessionId,
      });
    }
    throw new Error(message, { cause: error });
  }

  return {
    cloudflareSession,
    sandboxSessionId,
    cwd,
    origin: frozenOrigin,
    ...(provisioningLease === undefined ? {} : { provisioningLease }),
  };
}

export async function closeSandboxConversationSession(
  bindings: ApiBindings,
  input: {
    expectedProvisioningOperationId?: RuntimeOperationId;
    expectedSandboxSessionId?: SandboxSessionId;
    sandboxId: SandboxId;
    sessionId: SessionId;
  },
): Promise<void> {
  const state = await getRuntimeConversationSessionState(bindings.DB, {
    ...(input.expectedProvisioningOperationId === undefined
      ? {}
      : { expectedProvisioningOperationId: input.expectedProvisioningOperationId }),
    ...(input.expectedSandboxSessionId === undefined
      ? {}
      : { expectedSandboxSessionId: input.expectedSandboxSessionId }),
    runtimeSubjectId: input.sandboxId,
    sessionId: input.sessionId,
  });

  if (!state) {
    return;
  }

  let cleanupOperationId =
    state.status === "cleanup_pending"
      ? state.cleanupOperationId
      : await claimRuntimeConversationSessionCleanup(bindings.DB, {
          ...(input.expectedProvisioningOperationId === undefined
            ? {}
            : { expectedProvisioningOperationId: input.expectedProvisioningOperationId }),
          now: currentTimestampMs(),
          runtimeSubjectId: input.sandboxId,
          sandboxIncarnation: state.sandboxIncarnation,
          sandboxSessionId: state.sandboxSessionId,
          sessionId: input.sessionId,
        });
  if (cleanupOperationId === null) {
    const adopted = await getRuntimeConversationSessionState(bindings.DB, {
      expectedSandboxIncarnation: state.sandboxIncarnation,
      expectedSandboxSessionId: state.sandboxSessionId,
      runtimeSubjectId: input.sandboxId,
      sessionId: input.sessionId,
    });
    if (adopted?.status !== "cleanup_pending" || adopted.cleanupOperationId === null) {
      throw new Error("Sandbox conversation cleanup lost lifecycle ownership.");
    }
    cleanupOperationId = adopted.cleanupOperationId;
  }

  // Force-close: session-end / cleanup callers must tear down regardless of
  // idleness. The idle sweep uses closeIdleCattleConversationSession instead.
  await finalizeSandboxConversationClose(bindings, {
    sandboxId: input.sandboxId,
    cleanupOperationId,
    ...(input.expectedProvisioningOperationId === undefined
      ? {}
      : { expectedProvisioningOperationId: input.expectedProvisioningOperationId }),
    sessionId: input.sessionId,
    state,
  });
}

// Sweep-only close. Unlike closeSandboxConversationSession this does NOT
// force-close: it atomically claims the row (active->closed) only if it is
// still the same, still-idle, lease-free session, which closes the
// LIST->CLOSE race where a follow-up turn re-uses the resident session before
// its run lease exists. If the claim loses, the follow-up owns the session and
// the sweep leaves it. Returns true when it closed the conversation.
export async function closeIdleCattleConversationSession(
  bindings: ApiBindings,
  input: {
    idleSinceLte: number;
    sandboxId: SandboxId;
    sessionId: SessionId;
  },
): Promise<boolean> {
  const state = await getRuntimeConversationSessionState(bindings.DB, {
    runtimeSubjectId: input.sandboxId,
    sessionId: input.sessionId,
  });

  if (!state || state.status !== "active") {
    return false;
  }

  const cleanupOperationId = await claimIdleSessionScopedConversationForClose(bindings.DB, {
    idleSinceLte: input.idleSinceLte,
    now: currentTimestampMs(),
    runtimeSubjectId: input.sandboxId,
    sandboxIncarnation: state.sandboxIncarnation,
    sandboxSessionId: state.sandboxSessionId,
    sessionId: input.sessionId,
  });

  if (cleanupOperationId === null) {
    return false;
  }

  await finalizeSandboxConversationClose(bindings, {
    sandboxId: input.sandboxId,
    cleanupOperationId,
    sessionId: input.sessionId,
    state,
  });

  return true;
}

export async function repairPendingSandboxConversationSessionCleanups(
  bindings: ApiBindings,
  limit: number,
): Promise<number> {
  const pending = await listPendingRuntimeConversationSessionCleanups(bindings.DB, limit);

  await Promise.allSettled(
    pending.map((cleanup) =>
      finalizeSandboxConversationClose(bindings, {
        cleanupOperationId: cleanup.cleanupOperationId,
        sandboxId: cleanup.sandboxId,
        sessionId: cleanup.sessionId,
        state: cleanup,
      }),
    ),
  );

  return pending.length;
}

async function finalizeSandboxConversationClose(
  bindings: ApiBindings,
  input: {
    sandboxId: SandboxId;
    cleanupOperationId: RuntimeOperationId;
    expectedProvisioningOperationId?: RuntimeOperationId;
    sessionId: SessionId;
    state: RuntimeConversationSessionState;
  },
): Promise<void> {
  const now = currentTimestampMs();
  const { deleteActiveSandboxConversationSession } =
    await import("./sandbox-conversation-session-delete");

  await deleteActiveSandboxConversationSession(bindings, {
    sandboxSessionId: input.state.sandboxSessionId,
    sandboxId: input.sandboxId,
    sandboxIncarnation: input.state.sandboxIncarnation,
  });

  const recorded = await recordRuntimeConversationSessionClosed(bindings.DB, {
    cleanupOperationId: input.cleanupOperationId,
    ...(input.expectedProvisioningOperationId === undefined
      ? {}
      : { expectedProvisioningOperationId: input.expectedProvisioningOperationId }),
    inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(
      getRuntimeKindPolicy(input.state.kind),
      now,
    ),
    now,
    runtimeSubjectId: input.sandboxId,
    sandboxIncarnation: input.state.sandboxIncarnation,
    sandboxSessionId: input.state.sandboxSessionId,
    sessionId: input.sessionId,
  });
  if (!recorded) {
    throw new Error("Sandbox conversation cleanup lost lifecycle ownership.");
  }

  if (input.state.agentId) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxSessionDestroyed.name,
      sessionId: input.sessionId,
      value: {
        ...toRuntimeDiagnosticBaseValue({
          agentId: input.state.agentId,
          sessionId: input.sessionId,
        }),
        reason: "runtime_subject_session_closed",
        sandboxId: input.sandboxId,
      },
    });
  }
}
