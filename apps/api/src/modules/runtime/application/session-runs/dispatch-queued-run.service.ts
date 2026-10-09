import { parsePlatformId } from "@mosoo/id";
import type { FileId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";

import { logError, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { fileStore } from "../../../files/application/file-store";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { hydrateRunContextFromSession } from "../session-definition/hydrate-run-context.service";
import { appendSessionResourceContextToPrompt } from "../session-resources/session-resource-prompt.service";
import { dispatchSessionRun } from "./dispatch-run.service";
import { describeRunError } from "./run-error-message";
import {
  getSessionRunStatus,
  updateSessionRunStatusIfActive,
} from "./session-run-state.repository";
import { createFailedSessionRunRuntimeEvent } from "./session-run-view-events.service";
import {
  appendSessionRuntimeTimingEventBestEffort,
  createRuntimeTimingRecorder,
} from "./session-runtime-timing";

async function failQueuedSessionRunBeforeDispatch(
  bindings: ApiBindings,
  input: {
    error: unknown;
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    traceId: string;
  },
): Promise<void> {
  const message = describeRunError(input.error, "Session run context hydration failed.");
  const runError = {
    code: "runtime.context_hydration_failed",
    details: {},
    message,
    retryable: false,
  } as const;
  // Only fail the run while it is still queued. Once another dispatcher CASed
  // it to booting, this path is a losing contender and its hydration error
  // must not tear down the run the winner is provisioning.
  const failedRun = await updateSessionRunStatusIfActive(bindings.DB, {
    error: runError,
    expectedCurrentStatus: "queued",
    runId: input.sessionRunId,
    status: "failed",
  });

  if (!failedRun) {
    logWarn("session.run.context_hydration.failed.run-not-queued", {
      message,
      runId: input.sessionRunId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });

    return;
  }

  await appendSessionRuntimeEvents({
    bindings,
    events: [
      createFailedSessionRunRuntimeEvent({
        run: failedRun,
        runError,
        sessionId: input.sessionId,
      }),
    ],
    sessionId: input.sessionId,
  });

  logError("session.run.context_hydration.failed", {
    message,
    runId: input.sessionRunId,
    sessionId: input.sessionId,
    traceId: input.traceId,
  });
}

interface DispatchQueuedSessionRunInput {
  accessViewer?: AuthenticatedViewer;
  attachmentIds: FileId[];
  dispatchSource: "inline" | "queue";
  prompt: string;
  queuedAtMs: number;
  session: {
    id: SessionId;
    project_id: ProjectId;
  };
  sessionRunId: SessionRunId;
  traceId: string;
}

interface DispatchQueuedSessionRunRequest {
  bindings: ApiBindings;
  input: DispatchQueuedSessionRunInput;
  requestUrl: string;
  viewer: AuthenticatedViewer;
}

export async function dispatchQueuedSessionRun(
  request: DispatchQueuedSessionRunRequest,
): Promise<void> {
  const { bindings, input, requestUrl, viewer } = request;

  // Inline dispatch starts inside the request that just created the queued
  // run, so re-reading its status is a wasted D1 round trip. Queue delivery
  // can arrive late or duplicated and must still skip stale runs.
  if (input.dispatchSource === "queue") {
    const runStatus = await getSessionRunStatus(bindings.DB, input.sessionRunId);

    if (runStatus === null) {
      throw new Error("Session run not found.");
    }

    if (runStatus !== "queued") {
      logInfo("session.run.context_hydration.skipped", {
        dispatchSource: input.dispatchSource,
        runId: input.sessionRunId,
        sessionId: input.session.id,
        status: runStatus,
        traceId: input.traceId,
      });
      return;
    }
  }

  const hydrationTiming = createRuntimeTimingRecorder({
    path: "unknown",
    runId: input.sessionRunId,
    sessionId: input.session.id,
    source: "api",
    stage: "context_hydration",
    traceId: input.traceId,
  });
  const resolved = await (async () => {
    try {
      const sessionResources = await hydrationTiming.measure("listSessionResources", () =>
        fileStore.listSessionResourcePathEntries(
          bindings.DB,
          input.session.id,
          input.attachmentIds,
        ),
      );

      const hydrated = await hydrationTiming.measure("hydrateRunContext", () =>
        hydrateRunContextFromSession(bindings, viewer, {
          id: input.session.id,
          projectId: input.session.project_id,
          ...(input.accessViewer ? { accessViewer: input.accessViewer } : {}),
        }),
      );

      return {
        hydrated,
        sessionResources,
      };
    } catch (error) {
      await failQueuedSessionRunBeforeDispatch(bindings, {
        error,
        sessionId: input.session.id,
        sessionRunId: input.sessionRunId,
        traceId: input.traceId,
      });
      throw error;
    }
  })();
  const hydrationSnapshot = hydrationTiming.snapshot();
  const hydrationTimingEventPromise = appendSessionRuntimeTimingEventBestEffort({
    bindings,
    timing: hydrationSnapshot,
  });

  logInfo("session.run.context_hydrated", {
    dispatchSource: input.dispatchSource,
    hydrationLatencyMs: hydrationSnapshot.totalMs,
    queuedToHydratedMs: hydrationSnapshot.completedAtMs - input.queuedAtMs,
    runId: input.sessionRunId,
    runtimeId: resolved.hydrated.profile.runtimeId,
    sessionId: input.session.id,
    sessionResourceCount: resolved.sessionResources.length,
    skillCount: resolved.hydrated.skills.length,
    traceId: input.traceId,
  });

  if (resolved.hydrated.warnings.length > 0) {
    logInfo("session.run.context_hydration.warnings", {
      runId: input.sessionRunId,
      sessionId: input.session.id,
      traceId: input.traceId,
      warningCodes: resolved.hydrated.warnings.map((warning) => warning.code),
    });
  }

  try {
    await dispatchSessionRun(bindings, requestUrl, {
      attachmentIds: resolved.sessionResources.map((resource, index) =>
        parsePlatformId(resource.id, `session resource id ${index}`),
      ),
      builtInTools: resolved.hydrated.builtInTools,
      profile: resolved.hydrated.profile,
      prompt: appendSessionResourceContextToPrompt(input.prompt, resolved.sessionResources),
      resolvedMcpServers: resolved.hydrated.mcpServers,
      resolvedSkillCatalog: resolved.hydrated.skillCatalog,
      resolvedSkills: resolved.hydrated.skills,
      sessionId: input.session.id,
      sessionRunId: input.sessionRunId,
      traceId: input.traceId,
    });
  } finally {
    await hydrationTimingEventPromise;
  }
}
