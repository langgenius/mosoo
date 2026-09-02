import type {
  PublicThreadEventInput,
  PublicThreadApiSendEventsRequest,
  PublicThreadApiSendEventsResponse,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventInput } from "@mosoo/contracts/session";
import type { PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAccountViewer } from "../auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { sendAgentSessionEvents } from "../runtime/application/session-run.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "../sessions/application/session-lifecycle-mutation.service";
import { publicNotFound } from "./public-api-errors";
import {
  toPublicThreadEventBatch,
  toPublicThreadSessionSummary,
} from "./public-thread-api-presenter";
import { claimPublicThreadFiles } from "./public-thread-file-api.service";
import { toBackingSessionId } from "./public-thread-ids";
import { toPublicThreadSummary } from "./public-thread-presenter";
import { admitPublicSessionCaller } from "./public-thread-session-query.service";

export interface SendPublicThreadSessionEventsRequest {
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: PublicThreadApiSendEventsRequest;
  requestUrl: string;
  threadId: PublicThreadId;
}

export interface PublicThreadSessionMutationRequest {
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  threadId: PublicThreadId;
}

export interface UnarchivePublicThreadSessionRequest {
  caller: AuthenticatedViewer;
  database: D1Database;
  threadId: PublicThreadId;
}

async function toAgentSessionEventInput(input: {
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  event: PublicThreadEventInput;
  threadId: PublicThreadId;
}): Promise<AgentSessionEventInput> {
  if (input.event.type !== "user_message") {
    return input.event;
  }

  const fileIds = (input.event.resources ?? []).map((resource) => resource.file_id);
  const attachmentIds = await claimPublicThreadFiles(input.bindings, input.caller, {
    fileIds,
    threadId: input.threadId,
  });
  const { requestId, resources: _resources, ...event } = input.event;

  return {
    ...event,
    ...(attachmentIds.length === 0 ? {} : { attachmentIds }),
    ...(requestId === undefined ? {} : { clientRequestId: requestId }),
  };
}

export async function sendPublicThreadSessionEvents(
  request: SendPublicThreadSessionEventsRequest,
): Promise<PublicThreadApiSendEventsResponse> {
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
  );
  const accessViewer = await getAccountViewer(request.bindings.DB, admission.agent.ownerId);

  if (!accessViewer) {
    throw publicNotFound("Agent owner account was not found.");
  }
  const events = await Promise.all(
    request.input.events.map((event) =>
      toAgentSessionEventInput({
        bindings: request.bindings,
        caller: request.caller,
        event,
        threadId: request.threadId,
      }),
    ),
  );
  const batch = await sendAgentSessionEvents({
    bindings: request.bindings,
    executionContext: request.executionContext,
    input: {
      events,
      projectId: admission.session.project_id,
      sessionId,
    },
    options: {
      accessViewer,
      actionAuthorization: "admitted",
    },
    requestUrl: request.requestUrl,
    viewer: request.caller,
  });
  return toPublicThreadEventBatch({
    batch,
    thread: toPublicThreadSummary({
      endUserId: admission.session.end_user_id,
      session: toPublicThreadSessionSummary(batch.session),
    }),
  });
}

export async function archivePublicThreadSession(
  request: PublicThreadSessionMutationRequest,
): Promise<void> {
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
  );
  await archiveAgentSession({
    authorization: "admitted",
    bindings: request.bindings,
    projectId: admission.session.project_id,
    sessionId,
    viewer: request.caller,
  });
}

export async function unarchivePublicThreadSession(
  request: UnarchivePublicThreadSessionRequest,
): Promise<void> {
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.database,
    request.caller,
    request.threadId,
  );
  await unarchiveAgentSession({
    authorization: "admitted",
    database: request.database,
    projectId: admission.session.project_id,
    sessionId,
    viewer: request.caller,
  });
}

export async function deletePublicThreadSession(
  request: PublicThreadSessionMutationRequest,
): Promise<void> {
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
  );
  await deleteAgentSession({
    authorization: "admitted",
    bindings: request.bindings,
    projectId: admission.session.project_id,
    sessionId,
    viewer: request.caller,
  });
}
