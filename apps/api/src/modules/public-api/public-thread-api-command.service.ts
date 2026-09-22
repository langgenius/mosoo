import type {
  PublicApiVersion,
  PublicThreadEventInput,
  PublicThreadApiSendEventsRequest,
  PublicThreadApiSendEventsResponse,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventInput } from "@mosoo/contracts/session";
import type { PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../time";
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
  apiVersion?: PublicApiVersion | undefined;
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: PublicThreadApiSendEventsRequest;
  requestUrl: string;
  threadId: PublicThreadId;
}

export interface PublicThreadSessionMutationRequest {
  apiVersion?: PublicApiVersion | undefined;
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  threadId: PublicThreadId;
}

export interface UnarchivePublicThreadSessionRequest {
  apiVersion?: PublicApiVersion | undefined;
  caller: AuthenticatedViewer;
  database: D1Database;
  threadId: PublicThreadId;
}

async function toAgentSessionEventInput(input: {
  apiVersion?: PublicApiVersion | undefined;
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  event: PublicThreadEventInput;
  recoveryRequestedAtMs: number;
  threadId: PublicThreadId;
}): Promise<AgentSessionEventInput> {
  if (input.event.type !== "user_message") {
    return input.event;
  }

  const fileIds = (input.event.resources ?? []).map((resource) => resource.file_id);
  const attachmentIds = await claimPublicThreadFiles(
    input.bindings,
    input.caller,
    {
      fileIds,
      recoveryRequestedAtMs: input.recoveryRequestedAtMs,
      threadId: input.threadId,
    },
    input.apiVersion,
  );
  const { requestId, resources: _resources, ...event } = input.event;

  return {
    ...event,
    ...(attachmentIds.length === 0 ? {} : { attachmentIds }),
    ...(requestId === undefined ? {} : { clientRequestId: requestId }),
  };
}

export async function sendPublicThreadSessionEvents(
  request: SendPublicThreadSessionEventsRequest,
): Promise<PublicThreadApiSendEventsResponse<string | null>> {
  // File transfer and durable Run admission must agree on expiry, including
  // when the copy crosses the deadline. This time never comes from the client.
  const recoveryRequestedAtMs = currentTimestampMs();
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
    request.apiVersion,
  );
  const accessViewer = await getAccountViewer(request.bindings.DB, request.caller.id);

  if (!accessViewer) {
    throw publicNotFound("Agent owner account was not found.");
  }
  const events = await Promise.all(
    request.input.events.map((event) =>
      toAgentSessionEventInput({
        apiVersion: request.apiVersion,
        bindings: request.bindings,
        caller: request.caller,
        event,
        recoveryRequestedAtMs,
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
      recoveryRequestedAtMs,
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
    request.apiVersion,
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
    request.apiVersion,
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
    request.apiVersion,
  );
  await deleteAgentSession({
    authorization: "admitted",
    bindings: request.bindings,
    projectId: admission.session.project_id,
    sessionId,
    viewer: request.caller,
  });
}
