import type { UserWarning } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, AppId, SessionId, SessionRunId } from "@mosoo/id";

import { logError, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { fileStore } from "../../../files/application/file-store";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { hydrateCachedRunContextFromSession } from "../session-definition/hydrate-run-context.service";
import { appendSessionResourceContextToPrompt } from "../session-resources/session-resource-prompt.service";
import { dispatchSessionRun } from "./dispatch-run.service";
import { getSessionRunState, updateSessionRunStatusIfActive } from "./session-run-state.repository";
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
  const message =
    input.error instanceof Error ? input.error.message : "Session run context hydration failed.";
  const runError = {
    code: "runtime.context_hydration_failed",
    details: {},
    message,
    retryable: false,
  } as const;
  const failedRun = await updateSessionRunStatusIfActive(bindings.DB, {
    error: runError,
    runId: input.sessionRunId,
    status: "failed",
  });

  if (!failedRun) {
    const state = await getSessionRunState(bindings.DB, input.sessionRunId);

    logWarn("session.run.context_hydration.failed.after-terminal", {
      message,
      runId: input.sessionRunId,
      sessionId: input.sessionId,
      status: state?.status ?? null,
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
  prompt: string;
  queuedAtMs: number;
  session: {
    id: SessionId;
    app_id: AppId;
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
): Promise<UserWarning[]> {
  const { bindings, input, requestUrl, viewer } = request;
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
        hydrateCachedRunContextFromSession(bindings, viewer, {
          id: input.session.id,
          appId: input.session.app_id,
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
  const runtimeId = getSupportedRuntimeId(resolved.hydrated.value.profile.runtimeId);

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${resolved.hydrated.value.profile.runtimeId}.`);
  }

  const hydrationSnapshot = hydrationTiming.snapshot();
  const hydrationTimingEventPromise = appendSessionRuntimeTimingEventBestEffort({
    bindings,
    timing: hydrationSnapshot,
  });

  logInfo("session.run.context_hydrated", {
    cacheHit: resolved.hydrated.cacheHit,
    hydrationLatencyMs: hydrationSnapshot.totalMs,
    queuedToHydratedMs: hydrationSnapshot.completedAtMs - input.queuedAtMs,
    runId: input.sessionRunId,
    runtimeId,
    sessionId: input.session.id,
    sessionResourceCount: resolved.sessionResources.length,
    skillCount: resolved.hydrated.value.skills.length,
    traceId: input.traceId,
  });

  if (resolved.hydrated.value.warnings.length > 0) {
    logInfo("session.run.context_hydration.warnings", {
      runId: input.sessionRunId,
      sessionId: input.session.id,
      traceId: input.traceId,
      warningCodes: resolved.hydrated.value.warnings.map((warning) => warning.code),
    });
  }

  try {
    await dispatchSessionRun(bindings, requestUrl, {
      attachmentIds: resolved.sessionResources.map((resource, index) =>
        parsePlatformId(resource.id, `session resource id ${index}`),
      ),
      builtInTools: resolved.hydrated.value.builtInTools,
      profile: {
        ...resolved.hydrated.value.profile,
        runtimeId,
      },
      prompt: appendSessionResourceContextToPrompt(input.prompt, resolved.sessionResources),
      resolvedMcpServers: resolved.hydrated.value.mcpServers,
      resolvedSkillCatalog: resolved.hydrated.value.skillCatalog,
      resolvedSkills: resolved.hydrated.value.skills,
      sessionId: input.session.id,
      sessionRunId: input.sessionRunId,
      traceId: input.traceId,
    });
  } finally {
    await hydrationTimingEventPromise;
  }

  return resolved.hydrated.value.warnings;
}
