import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  PublishedAgentSendEventsResponse,
  PublishedRunSummary,
  PublishedThreadSummary,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventBatch, SessionSummary } from "@mosoo/contracts/session";
import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, PublicThreadId, SessionRunId } from "@mosoo/id";

import { toPublicThreadId } from "./published-agent-thread-ids";

export interface PublishedSessionProjection {
  agentId: AgentId;
  archivedAt: string | null;
  createdAt: string;
  id: PublicThreadId;
  kind: AgentKind;
  lastMessageAt?: string | null;
  lastRun: PublishedRunSummary | null;
  status: SessionStatus;
  title: string | null;
  updatedAt: string;
}

export function toPublishedRunSummary(run: SessionRunSummary): PublishedRunSummary;
export function toPublishedRunSummary(run: null): null;
export function toPublishedRunSummary(run: SessionRunSummary | null): PublishedRunSummary | null;
export function toPublishedRunSummary(run: SessionRunSummary | null): PublishedRunSummary | null {
  if (!run) {
    return null;
  }

  return {
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    id: parsePlatformId(run.id, "Run ID") as SessionRunId,
    startedAt: run.startedAt,
    status: run.status,
    trigger: run.trigger,
    updatedAt: run.updatedAt,
  };
}

export function toPublishedSessionSummary(session: SessionSummary): PublishedSessionProjection {
  return {
    agentId: parsePlatformId(session.agentId, "Agent ID") as AgentId,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    id: toPublicThreadId(session.id),
    kind: session.kind,
    lastRun: toPublishedRunSummary(session.lastRun),
    status: session.status,
    title: session.title,
    updatedAt: session.updatedAt,
    ...(session.lastMessageAt !== undefined ? { lastMessageAt: session.lastMessageAt } : {}),
  };
}

export function toPublishedEventBatch(input: {
  batch: AgentSessionEventBatch;
  thread: PublishedThreadSummary;
}): PublishedAgentSendEventsResponse {
  return {
    acceptedAt: input.batch.acceptedAt,
    events: input.batch.events.map((event) => ({
      clientRequestId: event.clientRequestId,
      run: toPublishedRunSummary(event.run),
      type: event.type,
    })),
    thread: input.thread,
    warnings: input.batch.warnings,
  };
}
