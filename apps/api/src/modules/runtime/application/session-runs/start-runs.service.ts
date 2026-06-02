import type { SessionRunSummary, UserWarning } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { getActiveSessionQueueAccess } from "../../../sessions/domain/session-access.policy";
import { queueSessionRun } from "./queue-run.service";
import type { QueuedSessionRunState } from "./queue-run.service";

interface StartRunRequest {
  attachmentIds: string[];
  clientRequestId?: string;
  prompt: {
    content: string;
  };
  sessionId: string | SessionId;
}

export interface QueueSessionRunsInput {
  requests: StartRunRequest[];
}

export interface QueueSessionRunsOutput {
  acceptedAt: string;
  runs: SessionRunSummary[];
  sessionStates: QueuedSessionRunState[];
  warnings: UserWarning[];
}

export interface StartRunsOptions {
  accessViewer?: AuthenticatedViewer;
}

export interface StartRunsRequest {
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: QueueSessionRunsInput;
  options?: StartRunsOptions;
  requestUrl: string;
  viewer: AuthenticatedViewer;
}

interface QueuedRunsAccumulator {
  runs: SessionRunSummary[];
  sessionStates: QueuedSessionRunState[];
  warnings: UserWarning[];
}

function parseAttachmentIds(values: readonly string[]): FileId[] {
  return values.map((value, index) => parsePlatformId<FileId>(value, `attachment id ${index}`));
}

async function queueRunRequest(
  context: Omit<StartRunsRequest, "input" | "options"> & {
    options: StartRunsOptions;
  },
  runRequest: StartRunRequest,
): Promise<{
  run: SessionRunSummary;
  sessionState: QueuedSessionRunState;
  warnings: UserWarning[];
}> {
  const prompt = runRequest.prompt.content.trim();

  if (prompt.length === 0) {
    throw new Error("Prompt content is required.");
  }

  const sessionId = parsePlatformId<SessionId>(runRequest.sessionId, "session id");
  const viewerId = parsePlatformId<AccountId>(context.viewer.id, "viewer id");
  const session = await getActiveSessionQueueAccess(context.bindings.DB, viewerId, sessionId);
  const queuedRun = await queueSessionRun({
    bindings: context.bindings,
    executionContext: context.executionContext,
    input: {
      attachmentIds: parseAttachmentIds(runRequest.attachmentIds),
      clientRequestId: runRequest.clientRequestId ?? null,
      prompt,
      session,
      ...(context.options.accessViewer ? { accessViewer: context.options.accessViewer } : {}),
    },
    requestUrl: context.requestUrl,
    viewer: context.viewer,
  });

  return {
    run: queuedRun.run,
    sessionState: queuedRun.sessionState,
    warnings: queuedRun.warnings,
  };
}

async function queueRunRequestsSequentially(input: {
  accumulator: QueuedRunsAccumulator;
  context: Omit<StartRunsRequest, "input" | "options"> & {
    options: StartRunsOptions;
  };
  index: number;
  requests: StartRunRequest[];
}): Promise<QueuedRunsAccumulator> {
  const runRequest = input.requests[input.index];

  if (runRequest === undefined) {
    return input.accumulator;
  }

  const queuedRun = await queueRunRequest(input.context, runRequest);

  return queueRunRequestsSequentially({
    accumulator: {
      runs: [...input.accumulator.runs, queuedRun.run],
      sessionStates: [...input.accumulator.sessionStates, queuedRun.sessionState],
      warnings: [...input.accumulator.warnings, ...queuedRun.warnings],
    },
    context: input.context,
    index: input.index + 1,
    requests: input.requests,
  });
}

export async function startRuns(request: StartRunsRequest): Promise<QueueSessionRunsOutput> {
  const { bindings, executionContext, input, requestUrl, viewer } = request;
  const options = request.options ?? {};

  if (input.requests.length === 0) {
    throw new Error("At least one run request is required.");
  }

  const queued = await queueRunRequestsSequentially({
    accumulator: {
      runs: [],
      sessionStates: [],
      warnings: [],
    },
    context: {
      bindings,
      executionContext,
      options,
      requestUrl,
      viewer,
    },
    index: 0,
    requests: input.requests,
  });

  return {
    acceptedAt: new Date().toISOString(),
    runs: queued.runs,
    sessionStates: queued.sessionStates,
    warnings: queued.warnings,
  };
}
