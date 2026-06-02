import type {
  PublishedAgentSendEventsRequest,
  PublishedAgentSendEventsResponse,
} from "@mosoo/contracts/public-api";
import { accountsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, PublicThreadId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
import { appendAuditEvent } from "../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { sendAgentSessionEvents } from "../runtime/application/session-run.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "../sessions/application/session-lifecycle-mutation.service";
import { createPublishedApiAuditActor } from "./published-agent-api-audit";
import type { PublishedApiAuditOptions } from "./published-agent-api-audit";
import { publicNotFound } from "./published-agent-api-errors";
import { toPublishedEventBatch, toPublishedSessionSummary } from "./published-agent-api-presenter";
import { admitPublicSessionCaller } from "./published-agent-session-query.service";
import { toBackingSessionId } from "./published-agent-thread-ids";
import { toPublishedThreadSummary } from "./published-agent-thread-presenter";

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

function publicApiAuditMetadata(input: {
  agentId: AgentId;
  auditActor: ReturnType<typeof createPublishedApiAuditActor>;
  extra?: Record<string, string> | undefined;
}): Record<string, unknown> {
  return {
    ...input.auditActor.metadata,
    agentId: input.agentId,
    ...input.extra,
  };
}

export interface SendPublishedAgentSessionEventsRequest {
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: PublishedAgentSendEventsRequest;
  options?: PublishedApiAuditOptions;
  requestUrl: string;
  threadId: PublicThreadId;
}

export interface PublishedAgentSessionMutationRequest {
  bindings: ApiBindings;
  caller: AuthenticatedViewer;
  options?: PublishedApiAuditOptions;
  threadId: PublicThreadId;
}

export interface UnarchivePublishedAgentSessionRequest {
  caller: AuthenticatedViewer;
  database: D1Database;
  options?: PublishedApiAuditOptions;
  threadId: PublicThreadId;
}

export async function sendPublishedAgentSessionEvents(
  request: SendPublishedAgentSessionEventsRequest,
): Promise<PublishedAgentSendEventsResponse> {
  const options = request.options ?? {};
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
  );
  const accessViewer = await getAccountViewer(request.bindings.DB, admission.agent.ownerId);
  const auditActor = createPublishedApiAuditActor({
    agent: admission.agent,
    caller: request.caller,
    ...options,
  });
  const batch = await sendAgentSessionEvents({
    bindings: request.bindings,
    executionContext: request.executionContext,
    input: {
      events: request.input.events,
      sessionId,
    },
    options: { accessViewer, actionAuthorization: "admitted" },
    requestUrl: request.requestUrl,
    viewer: request.caller,
  });
  await appendAuditEvent(request.bindings.DB, {
    action: AUDIT_ACTION.sessionUpdate,
    actorDisplay: auditActor.display,
    actorId: auditActor.id,
    actorMetadata: auditActor.metadata,
    actorType: auditActor.type,
    metadata: publicApiAuditMetadata({
      agentId: admission.agent.id,
      auditActor,
      extra: {
        eventCount: String(request.input.events.length),
        eventTypes: request.input.events.map((event) => event.type).join(","),
        kind: "public_api.send_events",
      },
    }),
    organizationId: admission.agent.organizationId,
    outcome: "success",
    resourceDisplay: batch.session.title ?? "Untitled session",
    resourceId: sessionId,
    resourceType: AUDIT_RESOURCE.session,
  });
  return toPublishedEventBatch({
    batch,
    thread: toPublishedThreadSummary({
      metadata: admission.metadata,
      session: toPublishedSessionSummary(batch.session),
    }),
  });
}

export async function archivePublishedAgentSession(
  request: PublishedAgentSessionMutationRequest,
): Promise<void> {
  const options = request.options ?? {};
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
  );
  await archiveAgentSession({
    bindings: request.bindings,
    options: {
      authorization: "admitted",
      auditActor: createPublishedApiAuditActor({
        agent: admission.agent,
        caller: request.caller,
        ...options,
      }),
    },
    sessionId,
    viewer: request.caller,
  });
}

export async function unarchivePublishedAgentSession(
  request: UnarchivePublishedAgentSessionRequest,
): Promise<void> {
  const options = request.options ?? {};
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.database,
    request.caller,
    request.threadId,
  );
  await unarchiveAgentSession({
    database: request.database,
    options: {
      authorization: "admitted",
      auditActor: createPublishedApiAuditActor({
        agent: admission.agent,
        caller: request.caller,
        ...options,
      }),
    },
    sessionId,
    viewer: request.caller,
  });
}

export async function deletePublishedAgentSession(
  request: PublishedAgentSessionMutationRequest,
): Promise<void> {
  const options = request.options ?? {};
  const sessionId = toBackingSessionId(request.threadId);
  const admission = await admitPublicSessionCaller(
    request.bindings.DB,
    request.caller,
    request.threadId,
  );
  await deleteAgentSession({
    bindings: request.bindings,
    options: {
      authorization: "admitted",
      auditActor: createPublishedApiAuditActor({
        agent: admission.agent,
        caller: request.caller,
        ...options,
      }),
    },
    sessionId,
    viewer: request.caller,
  });
}
