import type { SessionRunSummary, UserWarning } from "@mosoo/contracts/session-run";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  FileId,
  AppId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { generateTraceId } from "@mosoo/observability";
import type { SQL } from "drizzle-orm";

import { logError, logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, createApiError } from "../../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { createSessionRunDispatchApiCommandInput } from "../../../api-command/application/api-command-enqueue";
import {
  deliverApiCommand,
  prepareApiCommand,
} from "../../../api-command/application/api-command-ledger";
import type { ApiCommandAdmission } from "../../../api-command/application/api-command-ledger";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { resolveReadyEnvironmentPackageArtifact } from "../../../environments/application/environment-package-artifact.service";
import { fileStore } from "../../../files/application/file-store";
import { publishPersistedSessionRuntimeEvents } from "../../../sessions/application/session-event-write.service";
import type { BoundCapabilityRunProvenance } from "../../domain/bound-capability-run-provenance";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import {
  commitQueuedSessionRunAdmission,
  hasSessionRunAdmissionClientRequestReceipt,
} from "../../infrastructure/session-runs/session-run-admission.repository";
import { getActiveSessionRunSummary } from "../../infrastructure/session-runs/session-run-read.repository";
import { SessionRunCreationGuardRejectedError } from "../../infrastructure/session-runs/session-run-store.repository";
import { createInsertedSessionRunSummary } from "../../infrastructure/session-runs/session-run-write.repository";
import { getSessionExecutionPlan } from "../session-definition/session-execution.repository";
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
  boundCapabilityProvenance?: BoundCapabilityRunProvenance;
  clientRequestId: string | null;
  prompt: string;
  runCreationGuard?: SQL;
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

export { SessionRunCreationGuardRejectedError };

export async function queueSessionRun(request: QueueSessionRunRequest): Promise<{
  run: SessionRunSummary;
  sessionState: QueuedSessionRunState;
  warnings: UserWarning[];
}> {
  const { bindings, input, requestUrl, viewer } = request;
  const queueStartedAtMs = Date.now();

  const runtimeId = getSupportedRuntimeId(input.session.runtime_id);
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer id");

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${input.session.runtime_id}.`);
  }

  // Pre-admission guards are independent; run them concurrently instead of
  // paying three serial D1 round trips before the run row exists.
  await Promise.all([
    reconcileStaleActiveSessionRun(bindings.DB, input.session.id),
    getSessionExecutionPlan(bindings.DB, input.session.id).then((executionPlan) =>
      resolveReadyEnvironmentPackageArtifact(
        bindings,
        input.session.app_id,
        executionPlan.environment.packagesJson,
      ),
    ),
    fileStore.ensureSessionAttachments(
      bindings,
      input.accessViewer ?? viewer,
      input.session.id,
      input.attachmentIds,
    ),
  ]);

  const admittedAtMs = currentTimestampMs();
  const runId = createPlatformId<SessionRunId>();
  const traceId = generateTraceId();
  const createdRun = createInsertedSessionRunSummary(
    {
      deploymentVersionId: input.session.deployment_version_id,
      deploymentVersionNumber: input.session.deployment_version_number,
      model: input.session.model,
      provider: input.session.provider,
      sessionId: input.session.id,
      status: "queued",
      trigger: "user_prompt",
    },
    { runId, timestampMs: admittedAtMs, traceId },
  );
  const sessionMessageId = createPlatformId<SessionMessageId>();

  const queuedEvents = createQueuedSessionRunRuntimeEvents({
    prompt: input.prompt,
    run: createdRun,
    sessionId: input.session.id,
    sessionMessageId,
  });
  const queuedAtMs = admittedAtMs;
  const dispatchPayload = {
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
  };
  const apiCommand = prepareApiCommand(createSessionRunDispatchApiCommandInput(dispatchPayload), {
    timestampMs: admittedAtMs,
  });
  const admitted = await commitQueuedSessionRunAdmission(bindings.DB, {
    apiCommand,
    clientRequestId: input.clientRequestId,
    events: queuedEvents,
    message: {
      content: input.prompt,
      createdByAccountId: viewer.id,
      id: sessionMessageId,
      timestampMs: admittedAtMs,
    },
    run: {
      agentId: input.session.agent_id,
      ...(input.boundCapabilityProvenance === undefined
        ? {}
        : { boundCapabilityProvenance: input.boundCapabilityProvenance }),
      createdBy: viewerId,
      deploymentVersionId: input.session.deployment_version_id,
      deploymentVersionNumber: input.session.deployment_version_number,
      id: createdRun.id,
      model: input.session.model,
      provider: input.session.provider,
      runtimeId,
      sessionId: input.session.id,
      timestampMs: admittedAtMs,
      traceId: createdRun.traceId,
      trigger: "user_prompt",
    },
    ...(input.runCreationGuard === undefined ? {} : { runCreationGuard: input.runCreationGuard }),
    session: {
      agentId: input.session.agent_id,
      appId: input.session.app_id,
      id: input.session.id,
    },
  });

  if (!admitted) {
    if (
      await hasSessionRunAdmissionClientRequestReceipt(bindings.DB, {
        clientRequestId: input.clientRequestId,
        sessionId: input.session.id,
      })
    ) {
      throw createApiError(
        API_ERROR_CODE.sessionRunClientRequestDuplicate,
        "This client request has already been applied to the conversation.",
      );
    }

    const activeRun = await getActiveSessionRunSummary(bindings.DB, input.session.id);

    if (activeRun !== null) {
      throw new SessionActiveRunExistsError(activeRun);
    }

    if (input.runCreationGuard !== undefined) {
      throw new SessionRunCreationGuardRejectedError();
    }

    throw new Error("Session cannot accept a new run.");
  }

  await publishPersistedSessionRuntimeEvents({
    bindings,
    events: queuedEvents,
    sessionId: input.session.id,
  });
  const dispatchCommand: ApiCommandAdmission = {
    commandId: apiCommand.commandId,
    kind: apiCommand.record.kind,
    shouldDeliver: true,
  };

  logInfo("session.run.queued", {
    agentId: input.session.agent_id,
    attachmentCount: input.attachmentIds.length,
    clientRequestId: input.clientRequestId,
    queuedLatencyMs: Date.now() - queueStartedAtMs,
    runId: createdRun.id,
    runtimeId,
    sessionId: input.session.id,
    traceId: createdRun.traceId,
    viewerId: viewer.id,
  });

  // Start both paths after durable admission. Queue delivery stays retryable,
  // while the queued->booting CAS prevents duplicate model execution.
  if (request.executionContext) {
    const queueDelivery = deliverApiCommand(bindings, dispatchCommand).catch((error: unknown) => {
      logError("session.run.queue_delivery.failed", {
        commandId: dispatchCommand.commandId,
        message: error instanceof Error ? error.message : String(error),
        runId: createdRun.id,
        sessionId: input.session.id,
        traceId: createdRun.traceId,
      });
    });
    request.executionContext.waitUntil(queueDelivery);
    const inlineDispatch = dispatchQueuedSessionRun({
      bindings,
      input: {
        attachmentIds: input.attachmentIds,
        dispatchSource: "inline",
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
  } else {
    await deliverApiCommand(bindings, dispatchCommand);
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
      lastMessageAt: toIsoString(admittedAtMs),
      sessionId: input.session.id,
      status: "RUNNING",
      updatedAt: toIsoString(admittedAtMs),
    },
    warnings: [],
  };
}
