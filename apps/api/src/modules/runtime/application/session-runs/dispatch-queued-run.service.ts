import type { UserWarning } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";

import { logError, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { fileStore } from "../../../files/application/file-store";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { hydrateCachedRunContextFromSession } from "../session-definition/hydrate-run-context.service";
import { appendSessionResourceContextToPrompt } from "../session-resources/session-resource-prompt.service";
import { dispatchSessionRun } from "./dispatch-run.service";
import { describeRunError } from "./run-error-message";
import { getSessionRunState } from "./session-run-state.repository";
import { recordCanonicalSessionRunTerminal } from "./session-run-terminal-failure.service";
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
  const outcome = await recordCanonicalSessionRunTerminal(bindings, {
    assistantMessage: null,
    error: runError,
    expectedRunStatus: "queued",
    runId: input.sessionRunId,
    sessionId: input.sessionId,
    source: "api",
    status: "failed",
  });

  if (outcome.kind === "stale") {
    logWarn("session.run.context_hydration.failed.run-not-queued", {
      message,
      runId: input.sessionRunId,
      sessionId: input.sessionId,
      status: outcome.run.status,
      traceId: input.traceId,
    });

    return;
  }

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
): Promise<UserWarning[]> {
  const { bindings, input, requestUrl, viewer } = request;

  // Inline dispatch starts inside the request that just created the queued
  // run, so re-reading its status is a wasted D1 round trip. Queue delivery
  // can arrive late or duplicated and must still skip stale runs.
  if (input.dispatchSource === "queue") {
    const runState = await getSessionRunState(bindings.DB, input.sessionRunId);

    if (!runState) {
      throw new Error("Session run not found.");
    }

    if (runState.status !== "queued") {
      logInfo("session.run.context_hydration.skipped", {
        dispatchSource: input.dispatchSource,
        runId: input.sessionRunId,
        sessionId: input.session.id,
        status: runState.status,
        traceId: input.traceId,
      });
      return [];
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
        hydrateCachedRunContextFromSession(bindings, viewer, {
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
    dispatchSource: input.dispatchSource,
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
