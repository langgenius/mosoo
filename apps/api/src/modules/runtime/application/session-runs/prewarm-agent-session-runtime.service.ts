import type { ProjectId, SessionId } from "@mosoo/id";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../../platform/errors";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { assertPreviewAvailable } from "../../../sessions/infrastructure/preview-retention.repository";
import { prewarmDriverSession } from "../../infrastructure/driver-session.service";
import { activateRuntimeSubject } from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { resolveRuntimeSubjectNetworkConstraints } from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-network";
import type { ExecutionSessionHandle, SandboxHandle } from "../../infrastructure/sandbox-handles";
import { ensureSandboxConversationSession } from "../../infrastructure/sandbox-session/sandbox-conversation-session.service";
import { getActiveSessionRunSummary } from "../../infrastructure/session-runs/session-run-store.repository";
import { hydrateRunContextFromSession } from "../session-definition/hydrate-run-context.service";
import {
  appendSessionRuntimeTimingEvent,
  createRuntimeTimingRecorder,
} from "./session-runtime-timing";

interface AgentSessionRuntimePrewarmRequest {
  accessViewer?: AuthenticatedViewer;
  bindings: ApiBindings;
  requestUrl: string;
  session: {
    id: SessionId;
    projectId: ProjectId;
  };
  viewer: AuthenticatedViewer;
}

// Best effort: failures are logged, never thrown.
async function prewarmAgentSessionRuntime(
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
    await assertPreviewAvailable(bindings.DB, session.id, Date.now());
    if ((await getActiveSessionRunSummary(bindings.DB, session.id)) !== null) {
      logInfo("session.runtime.prewarm.skipped", {
        reason: "active_run_present",
        sessionId: session.id,
      });
      return;
    }

    const hydrated = await timing.measure("hydrateRunContext", () =>
      hydrateRunContextFromSession(bindings, viewer, {
        id: session.id,
        projectId: session.projectId,
        ...(accessViewer ? { accessViewer } : {}),
      }),
    );
    const runtimeId = hydrated.profile.runtimeId;
    const sandboxId = hydrated.profile.sandbox.id;
    const sandbox = await timing.measure("activateRuntimeSubject", () =>
      activateRuntimeSubject(bindings, {
        agentId: hydrated.profile.agentId,
        executionOwnerUserId: hydrated.profile.session.origin.executionOwnerUserId,
        networkConstraints: resolveRuntimeSubjectNetworkConstraints(bindings, {
          envVars: hydrated.profile.envVars,
          network: hydrated.profile.network,
          requestUrl: request.requestUrl,
        }),
        runtimeSubjectId: sandboxId,
        projectId: session.projectId,
        purpose: "prewarm",
        sessionId: session.id,
        timing,
      }),
    );
    handles.subject = sandbox;

    const executionSession = await timing.measure("ensureSandboxConversationSession", () =>
      ensureSandboxConversationSession(bindings, {
        mountSessionResources: false,
        origin: hydrated.profile.session.origin,
        sandbox,
        sandboxId,
        sessionId: session.id,
        timing,
      }),
    );
    handles.executionSession = executionSession.cloudflareSession;

    if ((await getActiveSessionRunSummary(bindings.DB, session.id)) !== null) {
      logInfo("session.runtime.prewarm.skipped", {
        reason: "active_run_present_after_session_prepare",
        sessionId: session.id,
      });
      return;
    }

    const driverProfile = {
      ...hydrated.profile,
      session: {
        ...hydrated.profile.session,
        sandboxSessionId: executionSession.sandboxSessionId,
        homePath: hydrated.profile.session.homePath,
        origin: executionSession.origin,
        sessionOrganizationPath: executionSession.cwd,
      },
    };
    const driverPrewarm = await timing.measure("prewarmDriverSession", () =>
      prewarmDriverSession(bindings, request.requestUrl, {
        builtInTools: hydrated.builtInTools,
        cloudflareSession: executionSession.cloudflareSession,
        profile: driverProfile,
        resolvedMcpServers: hydrated.mcpServers,
        resolvedSkillCatalog: hydrated.skillCatalog,
        resolvedSkills: hydrated.skills,
        sandbox,
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
      driverInstanceId: driverPrewarm.driverInstanceId,
      driverPrewarm: "ready",
      runtimeId,
      sessionId: session.id,
      timings: timingSnapshot,
    });
  } catch (error) {
    if (isApiError(error) && error.code === "AGENT_SESSION_NOT_READY") {
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

  input.executionContext.waitUntil(prewarmAgentSessionRuntime(input));
}
