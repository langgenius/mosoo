import type {
  PublicThreadApiSendEventsRequest,
  PublicThreadApiSendEventsResponse,
} from "@mosoo/contracts/public-api";
import { accountsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, PublicThreadId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
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
import { toBackingSessionId } from "./public-thread-ids";
import { toPublicThreadSummary } from "./public-thread-presenter";
import { admitPublicSessionCaller } from "./public-thread-session-query.service";

async function getAccountViewer(
  database: D1Database,
  accountId: AccountId,
): Promise<AuthenticatedViewer> {
  const row =
    (await getAppDatabase(database)
      .select({
        email: accountsTable.email,
        email_verified: accountsTable.emailVerified,
        id: accountsTable.id,
        image_url: accountsTable.image,
        name: accountsTable.name,
      })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw publicNotFound("Agent owner account was not found.");
  }

  return {
    email: row.email,
    emailVerified: row.email_verified,
    id: parsePlatformId(row.id, "Account ID") as AccountId,
    imageUrl: row.image_url,
    name: row.name,
  };
}

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
  const batch = await sendAgentSessionEvents({
    bindings: request.bindings,
    executionContext: request.executionContext,
    input: {
      events: request.input.events,
      appId: admission.session.app_id,
      sessionId,
    },
    options: { accessViewer, actionAuthorization: "admitted" },
    requestUrl: request.requestUrl,
    viewer: request.caller,
  });
  return toPublicThreadEventBatch({
    batch,
    thread: toPublicThreadSummary({
      attributedUserId: admission.session.attributed_user_id,
      metadata: admission.metadata,
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
    appId: admission.session.app_id,
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
    appId: admission.session.app_id,
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
    appId: admission.session.app_id,
    sessionId,
    viewer: request.caller,
  });
}
