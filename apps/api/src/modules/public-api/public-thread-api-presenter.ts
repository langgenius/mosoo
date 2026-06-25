import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  PublicThreadApiSendEventsResponse,
  PublicThreadFinalOutput,
  PublicThreadRunSummary,
  PublicThreadSummary,
} from "@mosoo/contracts/public-api";
import type { AgentSessionEventBatch, SessionSummary } from "@mosoo/contracts/session";
import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, PublicThreadId, SessionRunId } from "@mosoo/id";

import { toPublicThreadId } from "./public-thread-ids";

export interface PublicThreadSessionProjection {
  agentId: AgentId;
  archivedAt: string | null;
  createdAt: string;
  id: PublicThreadId;
  kind: AgentKind;
  lastMessageAt?: string | null;
  lastRun: PublicThreadRunSummary | null;
  status: SessionStatus;
  title: string | null;
  updatedAt: string;
}

interface PublicThreadRunSummaryOptions {
  finalOutput?: PublicThreadFinalOutput | null;
}

export function toPublicThreadRunSummary(
  run: SessionRunSummary,
  options?: PublicThreadRunSummaryOptions,
): PublicThreadRunSummary;
export function toPublicThreadRunSummary(run: null): null;
export function toPublicThreadRunSummary(
  run: SessionRunSummary | null,
  options?: PublicThreadRunSummaryOptions,
): PublicThreadRunSummary | null;
export function toPublicThreadRunSummary(
  run: SessionRunSummary | null,
  options: PublicThreadRunSummaryOptions = {},
): PublicThreadRunSummary | null {
  if (!run) {
    return null;
  }

  return {
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    error: run.error,
    finalOutput: options.finalOutput ?? null,
    id: parsePlatformId(run.id, "Run ID") as SessionRunId,
    startedAt: run.startedAt,
    status: run.status,
    trigger: run.trigger,
    updatedAt: run.updatedAt,
  };
}

export function toPublicThreadSessionSummary(
  session: SessionSummary,
): PublicThreadSessionProjection {
  return {
    agentId: parsePlatformId(session.agentId, "Agent ID") as AgentId,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    id: toPublicThreadId(session.id),
    kind: session.kind,
    lastRun: toPublicThreadRunSummary(session.lastRun),
    status: session.status,
    title: session.title,
    updatedAt: session.updatedAt,
    ...(session.lastMessageAt !== undefined ? { lastMessageAt: session.lastMessageAt } : {}),
  };
}

export function toPublicThreadEventBatch(input: {
  batch: AgentSessionEventBatch;
  thread: PublicThreadSummary;
}): PublicThreadApiSendEventsResponse {
  return {
    acceptedAt: input.batch.acceptedAt,
    events: input.batch.events.map((event) => ({
      clientRequestId: event.clientRequestId,
      run: toPublicThreadRunSummary(event.run),
      type: event.type,
    })),
    thread: input.thread,
    warnings: input.batch.warnings,
  };
}
