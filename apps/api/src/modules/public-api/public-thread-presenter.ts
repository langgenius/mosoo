import type {
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadArtifact,
  PublicThreadFinalOutput,
  PublicThreadLinks,
  PublicThreadSummary,
} from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import type { PublicThreadId } from "@mosoo/id";

import {
  toPublicThreadRunSummary,
  toPublicThreadSessionSummary,
} from "./public-thread-api-presenter";
import type { PublicThreadSessionProjection } from "./public-thread-api-presenter";

function createThreadLinks(threadId: PublicThreadId): PublicThreadLinks {
  return {
    thread: `/api/v1/threads/${threadId}`,
  };
}

export function toPublicThreadSummary(input: {
  endUserId: string;
  session: PublicThreadSessionProjection;
}): PublicThreadSummary {
  return {
    agent_id: input.session.agentId,
    created_at: input.session.createdAt,
    id: input.session.id,
    kind: input.session.kind,
    last_run_id: input.session.lastRun?.id ?? null,
    source: "api",
    status: input.session.status,
    title: input.session.title,
    updated_at: input.session.updatedAt,
    userId: input.endUserId,
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
  endUserId: string;
  run: SessionRunSummary | null;
  session: PublicThreadSessionProjection;
}): PublicThreadApiCreateThreadResponse {
  return {
    links: createThreadLinks(input.session.id),
    run: toPublicThreadRunSummary(input.run),
    thread: toPublicThreadSummary({
      endUserId: input.endUserId,
      session: input.session,
    }),
  };
}

export function toRetrieveThreadResponse(input: {
  artifacts: PublicThreadArtifact[];
  endUserId: string;
  finalOutput: PublicThreadFinalOutput | null;
  session: SessionSummary;
}): PublicThreadApiRetrieveThreadResponse {
  const session = toPublicThreadSessionSummary(input.session);

  return {
    links: createThreadLinks(session.id),
    run:
      input.session.lastRun === null
        ? null
        : toPublicThreadRunSummary(input.session.lastRun, {
            artifacts: input.artifacts,
            finalOutput: input.finalOutput,
          }),
    thread: toPublicThreadSummary({
      endUserId: input.endUserId,
      session,
    }),
  };
}
