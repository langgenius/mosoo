import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  PublicApiVersion,
  PublicThreadApiCreateThreadResponse,
  PublicThreadApiRetrieveThreadResponse,
  PublicThreadApiSendEventsResponse,
  PublicThreadFinalOutput,
  PublicThreadLinks,
  PublicThreadRunSummary,
  PublicThreadSummary,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventBatch, SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import type { SessionId } from "@mosoo/id";

function createThreadLinks(threadId: SessionId, apiVersion: PublicApiVersion): PublicThreadLinks {
  return {
    thread: `/api/${apiVersion}/threads/${threadId}`,
  };
}

function toPublicThreadRunSummary(
  run: SessionRunSummary | null,
  finalOutput: PublicThreadFinalOutput | null = null,
): PublicThreadRunSummary | null {
  if (run === null) {
    return null;
  }

  return {
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    error:
      run.error === null
        ? null
        : {
            code: run.error.code,
            message: run.error.message,
            retryable: run.error.retryable,
          },
    finalOutput,
    id: run.id,
    startedAt: run.startedAt,
    status: run.status,
    trigger: run.trigger,
    updatedAt: run.updatedAt,
  };
}

export function toPublicThreadSummary<UserId extends string | null>(input: {
  apiVersion: PublicApiVersion;
  endUserId: UserId;
  legacyKind: AgentKind;
  session: SessionSummary;
}): PublicThreadSummary<UserId, PublicApiVersion> {
  return {
    agent_id: input.session.agentId,
    created_at: input.session.createdAt,
    id: input.session.id,
    ...(input.apiVersion === "v2" ? {} : { kind: input.legacyKind }),
    last_run_id: input.session.lastRun?.id ?? null,
    source: "api",
    status: input.session.status,
    title: input.session.title,
    updated_at: input.session.updatedAt,
    userId: input.endUserId,
  };
}

export function toCreateThreadResponse<UserId extends string | null>(input: {
  apiVersion: PublicApiVersion;
  endUserId: UserId;
  legacyKind: AgentKind;
  run: SessionRunSummary | null;
  session: SessionSummary;
}): PublicThreadApiCreateThreadResponse<UserId, PublicApiVersion> {
  return {
    links: createThreadLinks(input.session.id, input.apiVersion),
    run: toPublicThreadRunSummary(input.run),
    thread: toPublicThreadSummary(input),
  };
}

export function toRetrieveThreadResponse<UserId extends string | null>(input: {
  apiVersion: PublicApiVersion;
  endUserId: UserId;
  legacyKind: AgentKind;
  finalOutput: PublicThreadFinalOutput | null;
  session: SessionSummary;
}): PublicThreadApiRetrieveThreadResponse<UserId, PublicApiVersion> {
  return {
    links: createThreadLinks(input.session.id, input.apiVersion),
    run: toPublicThreadRunSummary(input.session.lastRun, input.finalOutput),
    thread: toPublicThreadSummary(input),
  };
}

export function toPublicThreadEventBatch<UserId extends string | null>(input: {
  batch: AgentSessionEventBatch;
  thread: PublicThreadSummary<UserId, PublicApiVersion>;
}): PublicThreadApiSendEventsResponse<UserId, PublicApiVersion> {
  return {
    acceptedAt: input.batch.acceptedAt,
    events: input.batch.events.map((event) => ({
      requestId: event.clientRequestId,
      run: toPublicThreadRunSummary(event.run),
      type: event.type,
    })),
    thread: input.thread,
    warnings: input.batch.warnings,
  };
}
