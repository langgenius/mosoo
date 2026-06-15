import type { AgentDeploymentVersionId, SessionMessageId, SessionRunId } from "@mosoo/contracts/id";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";

import { toAgentId, toAppId, toSessionId } from "@/routes/typed-id";

interface SessionRunSummaryLike {
  completedAt: string | null;
  createdAt: string;
  deploymentVersionId: string | null;
  deploymentVersionNumber: number | null;
  error: SessionRunSummary["error"];
  id: string;
  model: string | null;
  provider: string | null;
  startedAt: string | null;
  status: SessionRunSummary["status"];
  traceId: string;
  trigger: SessionRunSummary["trigger"];
  updatedAt: string;
}

interface SessionSummaryLike {
  agentId: string;
  archivedAt: string | null;
  createdAt: string;
  deploymentVersionId: string | null;
  deploymentVersionNumber: number | null;
  id: string;
  kind: SessionSummary["kind"];
  lastMessageAt?: string | null | undefined;
  lastRun: SessionRunSummaryLike | null;
  model: string;
  provider: string;
  appId: string;
  runtimeId: string;
  status: SessionSummary["status"];
  title: string | null;
  type: SessionSummary["type"];
  updatedAt: string;
}

function toNullableAgentDeploymentVersionId(id: string | null): AgentDeploymentVersionId | null {
  return id === null
    ? null
    : (parsePlatformId(id, "Deployment version ID") as AgentDeploymentVersionId);
}

export function toSessionMessageId(id: string): SessionMessageId {
  return parsePlatformId(id, "Session message ID") as SessionMessageId;
}

function toSessionRunId(id: string): SessionRunId {
  return parsePlatformId(id, "Session run ID") as SessionRunId;
}

function toSessionRunSummary(run: SessionRunSummaryLike | null): SessionRunSummary | null {
  if (run === null) {
    return null;
  }

  return {
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    deploymentVersionId: toNullableAgentDeploymentVersionId(run.deploymentVersionId),
    deploymentVersionNumber: run.deploymentVersionNumber,
    error: run.error,
    id: toSessionRunId(run.id),
    model: run.model,
    provider: run.provider,
    startedAt: run.startedAt,
    status: run.status,
    traceId: run.traceId,
    trigger: run.trigger,
    updatedAt: run.updatedAt,
  };
}

export function toSessionSummary(session: SessionSummaryLike): SessionSummary {
  return {
    agentId: toAgentId(session.agentId),
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    deploymentVersionId: toNullableAgentDeploymentVersionId(session.deploymentVersionId),
    deploymentVersionNumber: session.deploymentVersionNumber,
    id: toSessionId(session.id),
    kind: session.kind,
    lastRun: toSessionRunSummary(session.lastRun),
    model: session.model,
    provider: session.provider,
    appId: toAppId(session.appId),
    runtimeId: session.runtimeId,
    status: session.status,
    title: session.title,
    type: session.type,
    updatedAt: session.updatedAt,
    ...(session.lastMessageAt !== undefined ? { lastMessageAt: session.lastMessageAt } : {}),
  };
}
