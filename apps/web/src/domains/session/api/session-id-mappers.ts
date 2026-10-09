import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import type {
  AgentDeploymentVersionId,
  AgentId,
  ProjectId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import type { SessionFieldsFragment } from "@/gql/graphql";

function toSessionRunSummary(run: SessionFieldsFragment["lastRun"]): SessionRunSummary | null {
  if (run === null) {
    return null;
  }

  return {
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    deploymentVersionId: run.deploymentVersionId as AgentDeploymentVersionId | null,
    deploymentVersionNumber: run.deploymentVersionNumber,
    error: run.error,
    id: run.id as SessionRunId,
    model: run.model,
    provider: run.provider,
    startedAt: run.startedAt,
    status: run.status,
    traceId: run.traceId,
    trigger: run.trigger,
    updatedAt: run.updatedAt,
  };
}

export function toSessionSummary(session: SessionFieldsFragment): SessionSummary {
  return {
    agentId: session.agentId as AgentId | null,
    archivedAt: session.archivedAt,
    createdAt: session.createdAt,
    deploymentVersionId: session.deploymentVersionId as AgentDeploymentVersionId | null,
    deploymentVersionNumber: session.deploymentVersionNumber,
    id: session.id as SessionId,
    lastMessageAt: session.lastMessageAt,
    lastRun: toSessionRunSummary(session.lastRun),
    model: session.model,
    provider: session.provider,
    projectId: session.projectId as ProjectId,
    runtimeId: session.runtimeId,
    status: session.status,
    title: session.title,
    type: session.type,
    updatedAt: session.updatedAt,
  };
}
