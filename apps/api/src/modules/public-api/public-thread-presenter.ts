import type {
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadFinalOutput,
  PublicThreadLinks,
  PublicThreadSummary,
} from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import type { AccountId, PublicThreadId } from "@mosoo/id";

import {
  toPublicThreadRunSummary,
  toPublicThreadSessionSummary,
} from "./public-thread-api-presenter";
import type { PublicThreadSessionProjection } from "./public-thread-api-presenter";
import type { PublicApiThreadMetadata } from "./public-thread-metadata";

function createThreadLinks(threadId: PublicThreadId): PublicThreadLinks {
  return {
    thread: `/api/v1/threads/${threadId}`,
  };
}

export function toPublicThreadSummary(input: {
  attributedUserId: AccountId | null;
  metadata: PublicApiThreadMetadata;
  session: PublicThreadSessionProjection;
}): PublicThreadSummary {
  return {
    agent_id: input.session.agentId,
    attributed_user:
      input.attributedUserId === null
        ? null
        : {
            id: input.attributedUserId,
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
}): PublicThreadSessionProjection {
  return toPublicThreadSessionSummary({
    ...input.session,
    lastMessageAt: input.sessionState.lastMessageAt,
    lastRun: input.run,
    status: input.sessionState.status,
    title: input.titleUpdate.title,
    updatedAt: input.titleUpdate.updatedAt,
  });
}

export function toCreateEmptyThreadSessionSummary(
  session: SessionSummary,
): PublicThreadSessionProjection {
  return toPublicThreadSessionSummary(session);
}

export function toCreateThreadResponse(input: {
  attributedUserId: AccountId | null;
  metadata: PublicApiThreadMetadata;
  run: SessionRunSummary | null;
  session: PublicThreadSessionProjection;
}): PublicThreadApiCreateThreadResponse {
  return {
    links: createThreadLinks(input.session.id),
    run: toPublicThreadRunSummary(input.run),
    thread: toPublicThreadSummary({
      attributedUserId: input.attributedUserId,
      metadata: input.metadata,
      session: input.session,
    }),
  };
}

export function toRetrieveThreadResponse(input: {
  attributedUserId: AccountId | null;
  finalOutput: PublicThreadFinalOutput | null;
  metadata: PublicApiThreadMetadata;
  session: SessionSummary;
}): PublicThreadApiRetrieveThreadResponse {
  const session = toPublicThreadSessionSummary(input.session);

  return {
    links: createThreadLinks(session.id),
    run:
      input.session.lastRun === null
        ? null
        : toPublicThreadRunSummary(input.session.lastRun, { finalOutput: input.finalOutput }),
    thread: toPublicThreadSummary({
      attributedUserId: input.attributedUserId,
      metadata: input.metadata,
      session,
    }),
  };
}
