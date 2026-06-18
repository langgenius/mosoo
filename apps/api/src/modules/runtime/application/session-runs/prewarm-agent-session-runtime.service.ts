import type { AppId, SessionId } from "@mosoo/id";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../../platform/errors";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { prewarmDriverSession } from "../../infrastructure/driver-session.service";
import { createRuntimeSubjectLifecycleService } from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import type { ExecutionSessionHandle, SandboxHandle } from "../../infrastructure/sandbox-handles";
import { ensureSandboxConversationSession } from "../../infrastructure/sandbox-session.service";
import { hasActiveSessionRun } from "../../infrastructure/session-runs/session-run-store.repository";
import { hydrateCachedRunContextFromSession } from "../session-definition/hydrate-run-context.service";
import {
  appendSessionRuntimeTimingEvent,
  createRuntimeTimingRecorder,
} from "./session-runtime-timing";

interface AgentSessionRuntimePrewarmRequest {
  accessViewer?: AuthenticatedViewer;
  bindings: ApiBindings;
  failureMode?: "best_effort" | "fail_fast";
  requestUrl: string;
  session: {
    id: SessionId;
    appId: AppId;
  };
  viewer: AuthenticatedViewer;
}

export async function prewarmAgentSessionRuntime(
  request: AgentSessionRuntimePrewarmRequest,
): Promise<void> {
  const { accessViewer, bindings, session, viewer } = request;
  const handles: {
    executionSession: ExecutionSessionHandle | null;
    subject: SandboxHandle | null;
  } = {
    executionSession: null,
    subject: null,
  };
  const timing = createRuntimeTimingRecorder({
    path: "prewarm",
    runId: null,
    sessionId: session.id,
    source: "api",
    stage: "prewarm",
    traceId: null,
  });

  try {
    if (await hasActiveSessionRun(bindings.DB, session.id)) {
      logInfo("session.runtime.prewarm.skipped", {
        reason: "active_run_present",
        sessionId: session.id,
      });
      return;
    }

    const hydrated = await timing.measure("hydrateRunContext", () =>
      hydrateCachedRunContextFromSession(bindings, viewer, {
        id: session.id,
        appId: session.appId,
        ...(accessViewer ? { accessViewer } : {}),
      }),
    );
    const runtimeId = getSupportedRuntimeId(hydrated.value.profile.runtimeId);

    if (runtimeId === null) {
      throw new Error(`Unsupported runtime: ${hydrated.value.profile.runtimeId}.`);
    }

    const sandboxId = hydrated.value.profile.sandbox.id;
    const { subject: sandbox } = await timing.measure("activateRuntimeSubject", () =>
      createRuntimeSubjectLifecycleService(bindings).activate({
        executionOwnerUserId: hydrated.value.profile.session.origin.executionOwnerUserId,
        kind: hydrated.value.profile.kind,
        runtimeSubjectId: sandboxId,
        purpose: "prewarm",
        subjectId: hydrated.value.profile.sandbox.subjectId,
        subjectKind: hydrated.value.profile.sandbox.subjectKind,
        timing,
      }),
    );
    handles.subject = sandbox;

    const executionSession = await timing.measure("ensureSandboxConversationSession", () =>
      ensureSandboxConversationSession(bindings, {
        kind: hydrated.value.profile.kind,
        mountSessionResources: false,
        origin: hydrated.value.profile.session.origin,
        sandbox,
        sandboxId,
        sessionId: session.id,
        timing,
      }),
    );
    handles.executionSession = executionSession.cloudflareSession;

    if (await hasActiveSessionRun(bindings.DB, session.id)) {
      logInfo("session.runtime.prewarm.skipped", {
        reason: "active_run_present_after_session_prepare",
        sessionId: session.id,
      });
      return;
    }

    const driverProfile = {
      ...hydrated.value.profile,
      session: {
        ...hydrated.value.profile.session,
        sandboxSessionId: executionSession.sandboxSessionId,
        homePath: hydrated.value.profile.session.homePath,
        origin: executionSession.origin,
        sessionOrganizationPath: executionSession.cwd,
      },
    };
    const driverPrewarm = await timing.measure("prewarmDriverSession", () =>
      prewarmDriverSession(bindings, request.requestUrl, {
        cloudflareSession: executionSession.cloudflareSession,
        profile: driverProfile,
        resolvedMcpServers: hydrated.value.mcpServers,
        resolvedSkillCatalog: hydrated.value.skillCatalog,
        resolvedSkills: hydrated.value.skills,
        sandbox,
        sandboxSessionId: session.id,
        sessionId: session.id,
      }),
    );

    if (driverPrewarm === null) {
      logInfo("session.runtime.prewarm.skipped", {
        reason: "driver_already_bound_to_run",
        sessionId: session.id,
      });
      return;
    }

    for (const phase of driverPrewarm.timing.phases) {
      timing.addPhase(`driver.${phase.name}`, phase.durationMs);
    }

    const timingSnapshot = timing.snapshot();
    await appendSessionRuntimeTimingEvent({
      bindings,
      timing: timingSnapshot,
    });
    logInfo("session.runtime.prewarm.completed", {
      cacheHit: hydrated.cacheHit,
      driverInstanceId: driverPrewarm.driverInstanceId,
      driverPrewarm: "ready",
      runtimeId,
      sessionId: session.id,
      timings: timingSnapshot,
    });
  } catch (error) {
    if (
      request.failureMode !== "fail_fast" &&
      isApiError(error) &&
      error.code === "AGENT_SESSION_NOT_READY"
    ) {
      logInfo("session.runtime.prewarm.skipped", {
        message: error.message,
        reason: "agent_not_ready",
        sessionId: session.id,
      });
      return;
    }

    logError("session.runtime.prewarm.failed", {
      message: error instanceof Error ? error.message : "Session runtime prewarm failed.",
      sessionId: session.id,
    });
    if (request.failureMode === "fail_fast") {
      throw error;
    }
  } finally {
    disposeRpcResource(handles.executionSession);
    disposeRpcResource(handles.subject);
  }
}

export function scheduleAgentSessionRuntimePrewarm(
  input: AgentSessionRuntimePrewarmRequest & {
    executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  },
): void {
  if (!input.executionContext) {
    return;
  }

  input.executionContext.waitUntil(
    prewarmAgentSessionRuntime({
      ...input,
      failureMode: "best_effort",
    }),
  );
}
