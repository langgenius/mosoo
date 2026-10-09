import type {
  PublicApiVersion,
  PublicThreadEventInput,
  PublicThreadApiSendEventsRequest,
  PublicThreadApiSendEventsResponse,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventInput } from "@mosoo/contracts/session";
import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../time";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { sendAgentSessionEvents } from "../runtime/application/session-run.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "../sessions/application/session-lifecycle-mutation.service";
import { claimPublicThreadFiles } from "./public-thread-file-api.service";
import { toPublicThreadEventBatch, toPublicThreadSummary } from "./public-thread-presenter";
import { admitPublicThread } from "./public-thread-session-query.service";

export interface SendPublicThreadSessionEventsRequest {
  apiVersion: PublicApiVersion;
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: PublicThreadApiSendEventsRequest;
  requestUrl: string;
  threadId: SessionId;
}

export interface PublicThreadSessionMutationRequest {
  apiVersion: PublicApiVersion;
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  threadId: SessionId;
}

export interface UnarchivePublicThreadSessionRequest {
  apiVersion: PublicApiVersion;
  caller: AuthenticatedViewer;
  database: D1Database;
  threadId: SessionId;
}

async function toAgentSessionEventInput(input: {
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  event: PublicThreadEventInput;
  admissionRequestedAtMs: number;
  sessionId: SessionId;
}): Promise<AgentSessionEventInput> {
  if (input.event.type !== "user_message") {
    return input.event;
  }

  const fileIds = (input.event.resources ?? []).map((resource) => resource.file_id);
  const attachmentIds = await claimPublicThreadFiles(input.bindings, input.caller, {
    fileIds,
    admissionRequestedAtMs: input.admissionRequestedAtMs,
    sessionId: input.sessionId,
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
): Promise<PublicThreadApiSendEventsResponse<string | null, PublicApiVersion>> {
  // File transfer and durable Run admission must agree on expiry, including
  // when the copy crosses the deadline. This time never comes from the client.
  const admissionRequestedAtMs = currentTimestampMs();
  const thread = await admitPublicThread(
    request.bindings.DB,
    request.caller,
    request.threadId,
    request.apiVersion,
  );
  const events = await Promise.all(
    request.input.events.map((event) =>
      toAgentSessionEventInput({
        bindings: request.bindings,
        caller: request.caller,
        event,
        admissionRequestedAtMs,
        sessionId: request.threadId,
      }),
    ),
  );
  const batch = await sendAgentSessionEvents({
    bindings: request.bindings,
    executionContext: request.executionContext,
    input: {
      events,
      projectId: thread.session.projectId,
      sessionId: request.threadId,
    },
    options: {
      admissionRequestedAtMs,
    },
    requestUrl: request.requestUrl,
    viewer: request.caller,
  });
  return toPublicThreadEventBatch({
    batch,
    thread: toPublicThreadSummary({
      apiVersion: request.apiVersion,
      endUserId: thread.endUserId,
      legacyKind: thread.kind,
      session: batch.session,
    }),
  });
}

export async function archivePublicThreadSession(
  request: PublicThreadSessionMutationRequest,
): Promise<void> {
  const thread = await admitPublicThread(
    request.bindings.DB,
    request.caller,
    request.threadId,
    request.apiVersion,
  );
  await archiveAgentSession({
    bindings: request.bindings,
    projectId: thread.session.projectId,
    sessionId: request.threadId,
    viewer: request.caller,
  });
}

export async function unarchivePublicThreadSession(
  request: UnarchivePublicThreadSessionRequest,
): Promise<void> {
  const thread = await admitPublicThread(
    request.database,
    request.caller,
    request.threadId,
    request.apiVersion,
  );
  await unarchiveAgentSession({
    database: request.database,
    projectId: thread.session.projectId,
    sessionId: request.threadId,
    viewer: request.caller,
  });
}

export async function deletePublicThreadSession(
  request: PublicThreadSessionMutationRequest,
): Promise<void> {
  const thread = await admitPublicThread(
    request.bindings.DB,
    request.caller,
    request.threadId,
    request.apiVersion,
  );
  await deleteAgentSession({
    bindings: request.bindings,
    projectId: thread.session.projectId,
    sessionId: request.threadId,
    viewer: request.caller,
  });
}
