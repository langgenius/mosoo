import { getSessionOrganizationPath } from "@mosoo/agent-driver/paths";
import { createPlatformId } from "@mosoo/id";
import type { SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";

import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import { getRuntimeSubjectInactiveDeadline } from "../../domain/session-runtime-policy";
import { isRuntimeSandboxLocalBucketEnabled } from "../runtime-sandbox-bucket-mount";
import {
  claimIdleSessionScopedConversationForClose,
  ensureRuntimeConversationSessionRecord,
  getRuntimeConversationSession,
  getRuntimeConversationSessionState,
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionClosed,
  recordRuntimeConversationSessionError,
} from "../runtime-subject-lifecycle/runtime-conversation-session-store";
import type {
  RuntimeConversationSessionRecord,
  RuntimeConversationSessionState,
} from "../runtime-subject-lifecycle/runtime-subject-store.types";
import { ensureSessionResourcesMounted } from "../session-resources/session-resource-mount.service";
import { parseSandboxConversationOrigin } from "./sandbox-conversation-session-codec";
import {
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

function resolveConversationContinuationPlan(input: {
  existingSession: RuntimeConversationSessionRecord | null;
}): {
  sandboxSessionId?: SandboxSessionId;
  requireCwdCheckpoint: boolean;
  shouldCreateCloudflareSession: boolean;
  shouldRestoreCwd: boolean;
  shouldRestoreSessionArtifacts: boolean;
} {
  // Pre-checkpoint Sessions retain their recorded artifact recovery
  // path. Sessions admitted with workspace durability require that checkpoint.
  const shouldRestoreSessionArtifacts =
    input.existingSession !== null && !input.existingSession.workspaceCheckpointRequired;

  if (input.existingSession === null) {
    return {
      shouldCreateCloudflareSession: true,
      requireCwdCheckpoint: false,
      shouldRestoreCwd: false,
      shouldRestoreSessionArtifacts,
    };
  }

  if (input.existingSession.status === "active") {
    return {
      shouldCreateCloudflareSession: false,
      requireCwdCheckpoint: false,
      shouldRestoreCwd: false,
      shouldRestoreSessionArtifacts: false,
    };
  }

  return {
    sandboxSessionId: createPlatformId<SandboxSessionId>(),
    shouldCreateCloudflareSession: true,
    requireCwdCheckpoint:
      input.existingSession.status === "closed" &&
      input.existingSession.workspaceCheckpointRequired,
    shouldRestoreCwd: true,
    shouldRestoreSessionArtifacts,
  };
}

async function restoreSandboxSessionCwdIfMissing(input: {
  cwd: string;
  localBucket: boolean;
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
        `Thread ${input.sessionId} has no committed workspace checkpoint. Retry this Thread after the previous turn finishes checkpointing; contact support if recovery remains unavailable.`,
      );
    }

    return;
  }

  try {
    await restoreSandboxConversationDirectoryBackup(input.sandbox, {
      backup: input.latestReadyBackup,
      localBucket: input.localBucket,
    });
  } catch (cause) {
    throw new Error(
      `Thread ${input.sessionId} workspace checkpoint could not be restored. Retry this Thread; contact support if recovery remains unavailable.`,
      { cause },
    );
  }
}

export async function ensureSandboxConversationSession(
  bindings: ApiBindings,
  input: EnsureSandboxConversationSessionInput,
): Promise<SandboxConversationSessionResult> {
  const now = Date.now();
  const existingSession = await input.timing.measure("conversation.loadSession", () =>
    getRuntimeConversationSession(bindings.DB, input.sessionId),
  );
  const continuation = resolveConversationContinuationPlan({
    existingSession,
  });
  const cwd = existingSession?.cwd ?? getSessionOrganizationPath(input.sessionId);

  if (existingSession && existingSession.sandboxId !== input.sandboxId) {
    throw new Error("Sandbox session is already bound to a different sandbox.");
  }

  const frozenOrigin = existingSession
    ? parseSandboxConversationOrigin(existingSession.originJson)
    : input.origin;
  // ensureRuntimeConversationSessionRecord only re-reads the row we already
  // loaded above when a record exists (the sandbox-mismatch guard ran there
  // too), so the round trip is only needed for first-time allocation.
  const sessionRecord =
    existingSession ??
    (await input.timing.measure("conversation.ensureRecord", () =>
      ensureRuntimeConversationSessionRecord(bindings.DB, {
        cwd,
        now,
        originJson: JSON.stringify(frozenOrigin),
        runtimeSubjectId: input.sandboxId,
        sessionId: input.sessionId,
      }),
    ));
  const sandboxSessionId = continuation.sandboxSessionId ?? sessionRecord.sandboxSessionId;

  if (continuation.shouldRestoreCwd && existingSession) {
    await input.timing.measure("conversation.restoreCwd", () =>
      restoreSandboxSessionCwdIfMissing({
        cwd,
        localBucket: isRuntimeSandboxLocalBucketEnabled(bindings),
        latestReadyBackup: existingSession.latestReadyBackup,
        requireCheckpoint: continuation.requireCwdCheckpoint,
        sandbox: input.sandbox,
        sessionId: input.sessionId,
      }),
    );
  }

  if (continuation.shouldCreateCloudflareSession) {
    await input.timing.measure("conversation.prepareDirectories", () =>
      prepareSandboxConversationDirectories({
        cwd,
        sandbox: input.sandbox,
      }),
    );

    if (continuation.shouldRestoreSessionArtifacts) {
      await input.timing.measure("conversation.restoreSessionArtifacts", () =>
        restoreSessionArtifactsToWorkspace(bindings, {
          cwd,
          sandbox: input.sandbox,
          sessionId: input.sessionId,
        }),
      );
    }
  }

  if (input.mountSessionResources) {
    await input.timing.measure("conversation.mountResources", () =>
      ensureSessionResourcesMounted({
        bindings,
        sandbox: input.sandbox,
        sessionId: input.sessionId,
      }),
    );
  }

  const cloudflareSession = await input.timing.measure("conversation.openSession", () =>
    openSandboxConversationSession({
      sandboxSessionId,
      cwd,
      sandbox: input.sandbox,
      shouldCreate: continuation.shouldCreateCloudflareSession,
    }),
  );

  try {
    await input.timing.measure("conversation.activateRecord", () =>
      recordRuntimeConversationSessionActive(bindings.DB, {
        expectedSandboxSessionId: sessionRecord.sandboxSessionId,
        sandboxSessionId,
        cwd,
        now,
        runtimeSubjectId: input.sandboxId,
        sessionId: input.sessionId,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sandbox conversation session activation failed.";

    await recordRuntimeConversationSessionError(bindings.DB, {
      expectedSandboxSessionId: sessionRecord.sandboxSessionId,
      errorCode: "runtime.conversation_mount_failed",
      message,
      now,
      runtimeSubjectId: input.sandboxId,
      sessionId: input.sessionId,
    });

    disposeRpcResource(cloudflareSession);
    throw new Error(message, { cause: error });
  }

  return {
    cloudflareSession,
    sandboxSessionId,
    cwd,
    origin: frozenOrigin,
  };
}

export async function closeSandboxConversationSession(
  bindings: ApiBindings,
  input: {
    sandboxId: SandboxId;
    sessionId: SessionId;
  },
): Promise<void> {
  const state = await getRuntimeConversationSessionState(bindings.DB, {
    runtimeSubjectId: input.sandboxId,
    sessionId: input.sessionId,
  });

  if (!state || state.status !== "active") {
    return;
  }

  // Force-close: session-end / cleanup callers must tear down regardless of
  // idleness. The idle sweep uses closeIdleConversationSession instead.
  await finalizeSandboxConversationClose(bindings, {
    sandboxId: input.sandboxId,
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
export async function closeIdleConversationSession(
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

  const claimed = await claimIdleSessionScopedConversationForClose(bindings.DB, {
    idleSinceLte: input.idleSinceLte,
    now: currentTimestampMs(),
    runtimeSubjectId: input.sandboxId,
    sandboxSessionId: state.sandboxSessionId,
    sessionId: input.sessionId,
  });

  if (!claimed) {
    return false;
  }

  await finalizeSandboxConversationClose(bindings, {
    sandboxId: input.sandboxId,
    sessionId: input.sessionId,
    state,
  });

  return true;
}

async function finalizeSandboxConversationClose(
  bindings: ApiBindings,
  input: {
    sandboxId: SandboxId;
    sessionId: SessionId;
    state: RuntimeConversationSessionState;
  },
): Promise<void> {
  const now = currentTimestampMs();
  const { deleteActiveSandboxConversationSession } =
    await import("./sandbox-conversation-session-delete");

  try {
    await deleteActiveSandboxConversationSession(bindings, {
      sandboxSessionId: input.state.sandboxSessionId,
      sandboxId: input.sandboxId,
    });
  } finally {
    // Remote cleanup must not strand the local subject outside reclamation.
    await recordRuntimeConversationSessionClosed(bindings.DB, {
      expectedSandboxSessionId: input.state.sandboxSessionId,
      inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(now),
      now,
      runtimeSubjectId: input.sandboxId,
      sessionId: input.sessionId,
    });
  }
}
