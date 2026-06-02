import type {
  PublishedAgentCreateThreadResponse,
  PublishedAgentRetrieveThreadResponse,
  PublishedThreadLinks,
  PublishedThreadSummary,
} from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import type { PublicThreadId } from "@mosoo/id";

import { toPublishedRunSummary, toPublishedSessionSummary } from "./published-agent-api-presenter";
import type { PublishedSessionProjection } from "./published-agent-api-presenter";
import type { PublicApiThreadMetadata } from "./published-agent-thread-metadata";

function createThreadLinks(threadId: PublicThreadId): PublishedThreadLinks {
  return {
    thread: `/api/v1/threads/${threadId}`,
  };
}

export function toPublishedThreadSummary(input: {
  metadata: PublicApiThreadMetadata;
  session: PublishedSessionProjection;
}): PublishedThreadSummary {
  return {
    agent_id: input.session.agentId,
    attributed_user:
      input.metadata.attributed_user_id === null
        ? null
        : {
            id: input.metadata.attributed_user_id,
          },
    client_external_ref: input.metadata.client_external_ref,
    created_at: input.session.createdAt,
    created_by: {
      id: input.metadata.created_by.id,
      kind: input.metadata.created_by.kind,
    },
    id: input.session.id,
    kind: input.session.kind,
    last_run_id: input.session.lastRun?.id ?? null,
    source: "api",
    status: input.session.status,
    title: input.session.title,
    updated_at: input.session.updatedAt,
  };
}

export function toCreateThreadSessionSummary(input: {
  run: SessionRunSummary;
  session: SessionSummary;
  sessionState: {
    lastMessageAt: string;
    status: "RUNNING";
  };
  titleUpdate: {
    title: string;
    updatedAt: string;
  };
}): PublishedSessionProjection {
  return toPublishedSessionSummary({
    ...input.session,
    lastMessageAt: input.sessionState.lastMessageAt,
    lastRun: input.run,
    status: input.sessionState.status,
    title: input.titleUpdate.title,
    updatedAt: input.titleUpdate.updatedAt,
  });
}

export function toCreateThreadResponse(input: {
  metadata: PublicApiThreadMetadata;
  run: SessionRunSummary;
  session: PublishedSessionProjection;
}): PublishedAgentCreateThreadResponse {
  return {
    links: createThreadLinks(input.session.id),
    run: toPublishedRunSummary(input.run),
    thread: toPublishedThreadSummary({
      metadata: input.metadata,
      session: input.session,
    }),
  };
}

export function toRetrieveThreadResponse(input: {
  metadata: PublicApiThreadMetadata;
  session: SessionSummary;
}): PublishedAgentRetrieveThreadResponse {
  const session = toPublishedSessionSummary(input.session);

  return {
    links: createThreadLinks(session.id),
    run: session.lastRun,
    thread: toPublishedThreadSummary({
      metadata: input.metadata,
      session,
    }),
  };
}
