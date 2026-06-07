import { createPlatformId } from "@mosoo/id";
import type { SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";
import { getSessionOrganizationPath } from "agent-driver/paths";

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
import { buildOrganizationAccessSnapshotFromAliases } from "../../domain/sandbox-layout";
import type { RuntimeConversationSessionRecord } from "../runtime-subject-lifecycle/runtime-subject-store";
import {
  ensureRuntimeConversationSessionRecord,
  getRuntimeConversationSession,
  getRuntimeConversationSessionState,
  recordRuntimeConversationSessionActive,
  recordRuntimeConversationSessionClosed,
  recordRuntimeConversationSessionError,
} from "../runtime-subject-lifecycle/runtime-subject-store";
import { ensureSessionResourcesMounted } from "../session-resources/session-resource-mount.service";
import { ensureSandboxAliasMounts } from "./sandbox-alias-mount.service";
import {
  parseSandboxConversationOrigin,
  parseSandboxConversationSpaceAliases,
} from "./sandbox-conversation-session-codec";
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
}): {
  cloudflareSessionId?: SandboxSessionId;
  shouldCreateCloudflareSession: boolean;
  shouldDeleteErrorSession: boolean;
  shouldRestoreCwd: boolean;
} {
  if (input.existingSession === null) {
    return {
      shouldCreateCloudflareSession: true,
      shouldDeleteErrorSession: false,
      shouldRestoreCwd: false,
    };
  }

  if (input.existingSession.status === "active") {
    return {
      shouldCreateCloudflareSession: false,
      shouldDeleteErrorSession: false,
      shouldRestoreCwd: false,
    };
  }

  const policy = getRuntimeKindPolicy(input.kind);
  const shouldRestoreCwd = runtimeCheckpointRulesInclude(
    policy.checkpoint.createOnHibernate,
    "session_workspaces",
  );
  const shouldUseNewCloudflareSession =
    input.existingSession.status === "closed" && policy.subject.scope === "session";

  return {
    ...(shouldUseNewCloudflareSession
      ? { cloudflareSessionId: createPlatformId<SandboxSessionId>() }
      : {}),
    shouldCreateCloudflareSession: true,
    shouldDeleteErrorSession: input.existingSession.status === "error",
    shouldRestoreCwd,
  };
}

async function restoreSandboxSessionCwdIfMissing(input: {
  cwd: string;
  latestReadyBackup: RuntimeConversationSessionRecord["latestReadyBackup"];
  sandbox: EnsureSandboxConversationSessionInput["sandbox"];
}): Promise<void> {
  if (await sandboxConversationDirectoryHasContent(input.sandbox, input.cwd)) {
    return;
  }

  if (!input.latestReadyBackup) {
    return;
  }

  await restoreSandboxConversationDirectoryBackup(input.sandbox, {
    backup: input.latestReadyBackup,
    cwd: input.cwd,
  });
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
  });
  const cwd = existingSession?.cwd ?? getSessionOrganizationPath(input.sessionId);

  if (existingSession && existingSession.sandboxId !== input.sandboxId) {
    throw new Error("Sandbox session is already bound to a different sandbox.");
  }

  const frozenOrigin = existingSession
    ? parseSandboxConversationOrigin(existingSession.originJson)
    : input.origin;
  const frozenAliases = existingSession
    ? parseSandboxConversationSpaceAliases(existingSession.spaceAliasesJson)
    : input.spaceAliases;
  const sessionRecord = await measureOptional(input.timing, "conversation.ensureRecord", () =>
    ensureRuntimeConversationSessionRecord(bindings.DB, {
      cwd,
      now,
      originJson: JSON.stringify(frozenOrigin),
      runtimeSubjectId: input.sandboxId,
      sessionId: input.sessionId,
      spaceAliasesJson: JSON.stringify(frozenAliases),
    }),
  );
  const cloudflareSessionId = continuation.cloudflareSessionId ?? sessionRecord.cloudflareSessionId;
  const organizationAccessSnapshot = buildOrganizationAccessSnapshotFromAliases({
    currentSnapshot: input.currentOrganizationAccessSnapshot,
    spaceAliases: frozenAliases,
  });

  if (continuation.shouldRestoreCwd && existingSession) {
    await measureOptional(input.timing, "conversation.restoreCwd", () =>
      restoreSandboxSessionCwdIfMissing({
        cwd,
        latestReadyBackup: existingSession.latestReadyBackup,
        sandbox: input.sandbox,
      }),
    );
  }

  if (continuation.shouldCreateCloudflareSession) {
    await measureOptional(input.timing, "conversation.prepareDirectories", () =>
      prepareSandboxConversationDirectories({
        createSpaceRoot: frozenAliases.length > 0,
        cwd,
        sandbox: input.sandbox,
        sessionId: input.sessionId,
      }),
    );
  }

  if (input.mountSessionResources) {
    await measureOptional(input.timing, "conversation.mountResources", () =>
      ensureSessionResourcesMounted({
        bindings,
        sandbox: input.sandbox,
        sessionId: input.sessionId,
      }),
    );
  }

  if (continuation.shouldDeleteErrorSession) {
    await measureOptional(input.timing, "conversation.deleteErrorSession", () =>
      deleteSandboxConversationSessionBestEffort({
        cloudflareSessionId: sessionRecord.cloudflareSessionId,
        sandbox: input.sandbox,
      }),
    );
  }

  const openedCloudflareSession = await measureOptional(
    input.timing,
    "conversation.openSession",
    () =>
      openSandboxConversationSession({
        cloudflareSessionId,
        cwd,
        sandbox: input.sandbox,
        shouldCreate: continuation.shouldCreateCloudflareSession,
      }),
  );
  const cloudflareSession = openedCloudflareSession.session;

  try {
    await measureOptional(input.timing, "conversation.ensureAliasMounts", () =>
      ensureSandboxAliasMounts({
        aliases: frozenAliases,
        cloudflareSession,
        sessionId: input.sessionId,
      }),
    );

    await measureOptional(input.timing, "conversation.activateRecord", () =>
      recordRuntimeConversationSessionActive(bindings.DB, {
        cloudflareSessionId,
        cwd,
        now,
        originJson: JSON.stringify(frozenOrigin),
        runtimeSubjectId: input.sandboxId,
        sessionId: input.sessionId,
        spaceAliasesJson: JSON.stringify(frozenAliases),
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Sandbox alias mount failed during session creation.";

    await recordRuntimeConversationSessionError(bindings.DB, {
      cloudflareSessionId,
      cwd,
      errorCode: "runtime.conversation_mount_failed",
      message,
      now,
      originJson: JSON.stringify(frozenOrigin),
      runtimeSubjectId: input.sandboxId,
      sessionId: input.sessionId,
      spaceAliasesJson: JSON.stringify(frozenAliases),
    });

    disposeRpcResource(cloudflareSession);
    throw new Error(message, { cause: error });
  }

  return {
    cloudflareSession,
    cloudflareSessionId,
    cwd,
    organizationAccessSnapshot,
    origin: frozenOrigin,
    spaceAliases: frozenAliases,
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

  const now = currentTimestampMs();
  const { deleteActiveSandboxConversationSession } =
    await import("./sandbox-conversation-session-delete");

  await deleteActiveSandboxConversationSession(bindings, {
    cloudflareSessionId: state.cloudflareSessionId,
    sandboxId: input.sandboxId,
  });

  if (state.agentId) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxSessionDestroyed.name,
      sessionId: input.sessionId,
      value: {
        ...toRuntimeDiagnosticBaseValue({
          agentId: state.agentId,
          sessionId: input.sessionId,
        }),
        reason: "runtime_subject_session_closed",
        sandboxId: input.sandboxId,
      },
    });
  }

  await recordRuntimeConversationSessionClosed(bindings.DB, {
    inactiveDeadlineAt: getRuntimeSubjectInactiveDeadline(getRuntimeKindPolicy(state.kind), now),
    now,
    runtimeSubjectId: input.sandboxId,
    sessionId: input.sessionId,
  });
}
