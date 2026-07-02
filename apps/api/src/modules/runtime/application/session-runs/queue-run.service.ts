import type { SessionRunSummary, UserWarning } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  FileId,
  AppId,
  SessionId,
} from "@mosoo/id";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { toIsoString } from "../../../../time";
import { enqueueSessionRunDispatchCommand } from "../../../api-command/application/api-command-enqueue";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { fileStore } from "../../../files/application/file-store";
import { appendSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import { insertSessionMessageRecord } from "../../../sessions/application/session-message-write.service";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { createSessionRunRecordIfSessionIdle } from "../../infrastructure/session-runs/session-run-store.repository";
import { dispatchQueuedSessionRun } from "./dispatch-queued-run.service";
import { createQueuedSessionRunRuntimeEvents } from "./session-run-view-events.service";
import { reconcileStaleActiveSessionRun } from "./stale-run-reconciliation.service";

class SessionActiveRunExistsError extends Error {
  readonly activeRun: SessionRunSummary;

  constructor(activeRun: SessionRunSummary) {
    super("This conversation already has an active run. Wait for it to finish or cancel it first.");
    this.name = "SessionActiveRunExistsError";
    this.activeRun = activeRun;
  }
}

interface QueueSessionRunInput {
  accessViewer?: AuthenticatedViewer;
  attachmentIds: FileId[];
  clientRequestId: string | null;
  prompt: string;
  session: {
    agent_id: AgentId;
    deployment_version_id: AgentDeploymentVersionId | null;
    deployment_version_number: number | null;
    id: SessionId;
    model: string;
    app_id: AppId;
    provider: string;
    runtime_id: string;
  };
}

interface QueueSessionRunRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: QueueSessionRunInput;
  requestUrl: string;
  viewer: AuthenticatedViewer;
}

export interface QueuedSessionRunState {
  lastMessageAt: string;
  sessionId: SessionId;
  status: "RUNNING";
  updatedAt: string;
}

export async function queueSessionRun(request: QueueSessionRunRequest): Promise<{
  run: SessionRunSummary;
  sessionState: QueuedSessionRunState;
  warnings: UserWarning[];
}> {
  const { bindings, input, requestUrl, viewer } = request;
  const queueStartedAtMs = Date.now();

  await reconcileStaleActiveSessionRun(bindings.DB, input.session.id);

  const runtimeId = getSupportedRuntimeId(input.session.runtime_id);
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer id");

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${input.session.runtime_id}.`);
  }

  await fileStore.ensureSessionAttachments(
    bindings,
    input.accessViewer ?? viewer,
    input.session.id,
    input.attachmentIds,
  );

  const createRunResult = await createSessionRunRecordIfSessionIdle(bindings.DB, {
    agentId: input.session.agent_id,
    createdBy: viewerId,
    deploymentVersionId: input.session.deployment_version_id,
    deploymentVersionNumber: input.session.deployment_version_number,
    model: input.session.model,
    provider: input.session.provider,
    runtimeId,
    sessionId: input.session.id,
    status: "queued",
    trigger: "user_prompt",
  });

  if (createRunResult.activeRun) {
    throw new SessionActiveRunExistsError(createRunResult.activeRun);
  }

  const { createdRun } = createRunResult;

  const sessionMessage = await insertSessionMessageRecord(bindings.DB, {
    content: input.prompt,
    createdByAccountId: viewer.id,
    role: "user",
    sessionId: input.session.id,
    sessionRunId: createdRun.id,
  });
  const sessionMessageId = sessionMessage.id;

  const queuedEvents = createQueuedSessionRunRuntimeEvents({
    prompt: input.prompt,
    run: createdRun,
    sessionId: input.session.id,
    sessionMessageId,
  });
  await appendSessionRuntimeEvents({
    bindings,
    events: queuedEvents,
    sessionId: input.session.id,
    sourceEventId: input.clientRequestId,
  });
  const queuedAtMs = Date.now();

  logInfo("session.run.queued", {
    agentId: input.session.agent_id,
    attachmentCount: input.attachmentIds.length,
    clientRequestId: input.clientRequestId,
    queuedLatencyMs: queuedAtMs - queueStartedAtMs,
    runId: createdRun.id,
    runtimeId,
    sessionId: input.session.id,
    traceId: createdRun.traceId,
    viewerId: viewer.id,
  });

  await enqueueSessionRunDispatchCommand(bindings, {
    attachmentIds: input.attachmentIds,
    prompt: input.prompt,
    queuedAtMs,
    requestUrl,
    session: {
      id: input.session.id,
      app_id: input.session.app_id,
    },
    sessionRunId: createdRun.id,
    traceId: createdRun.traceId,
    viewer,
    ...(input.accessViewer ? { accessViewer: input.accessViewer } : {}),
  });

  // O1: dispatch inline via waitUntil so an interactive run does not wait for
  // the api-command queue's batch window (max_batch_timeout = 5s). The queue
  // enqueue above stays as the durable fallback if the worker is evicted before
  // waitUntil runs; the queued->booting CAS inside dispatch makes this
  // exactly-once (whichever path wins, the other logs dispatch.skipped).
  if (request.executionContext) {
    const inlineDispatch = dispatchQueuedSessionRun({
      bindings,
      input: {
        attachmentIds: input.attachmentIds,
        prompt: input.prompt,
        queuedAtMs,
        session: { id: input.session.id, app_id: input.session.app_id },
        sessionRunId: createdRun.id,
        traceId: createdRun.traceId,
        ...(input.accessViewer ? { accessViewer: input.accessViewer } : {}),
      },
      requestUrl,
      viewer,
    }).catch((error: unknown) => {
      logError("session.run.inline_dispatch.failed", {
        message: error instanceof Error ? error.message : String(error),
        runId: createdRun.id,
        sessionId: input.session.id,
        traceId: createdRun.traceId,
      });
    });
    request.executionContext.waitUntil(inlineDispatch);
  }

  logInfo("session.run.accepted", {
    acceptedLatencyMs: Date.now() - queueStartedAtMs,
    agentId: input.session.agent_id,
    attachmentCount: input.attachmentIds.length,
    clientRequestId: input.clientRequestId,
    inlineDispatch: Boolean(request.executionContext),
    runId: createdRun.id,
    runtimeId,
    sessionId: input.session.id,
    traceId: createdRun.traceId,
    viewerId: viewer.id,
  });

  return {
    run: createdRun,
    sessionState: {
      lastMessageAt: toIsoString(sessionMessage.timestampMs),
      sessionId: input.session.id,
      status: "RUNNING",
      updatedAt: toIsoString(sessionMessage.timestampMs),
    },
    warnings: [],
  };
}
