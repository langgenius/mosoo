import type {
  AgentSessionDiagnostics,
  AgentSessionExecutionDiagnostics,
  AgentSessionNativeRuntimeRefDiagnostics,
  AgentSessionRecoverability,
  AgentSessionRetrieveResult,
  SessionExecutionSkillReference,
  SessionExecutionSpaceReference,
  SessionExecutionToolReference,
  SessionSummary,
} from "@mosoo/contracts/session";
import { getAgentSessionUserLifecycleProjection } from "@mosoo/contracts/session";
import { nativeResumeRefsTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { getAgentSessionActionCapabilities } from "@mosoo/session-policy";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { findSessionExecutionPlan } from "../../runtime/application/session-definition/session-execution.repository";
import { loadSessionViewerState } from "./session-live-state.service";
import {
  getSessionSummaryAccessById,
  getSessionSummaryById,
  getSessionSummaryForCreator,
} from "./session-summary-query.service";

interface AgentSessionLookupInput {
  sessionId: SessionId;
}

interface NativeRuntimeRefDiagnosticsRow {
  kind: string | null;
  runtimeId: string | null;
  value: string;
}

function toDiagnosticSkillReference(
  sessionId: SessionId,
  skill: Omit<SessionExecutionSkillReference, "sessionId">,
): SessionExecutionSkillReference {
  return {
    resolutionMode: skill.resolutionMode,
    sessionId,
    skillId: skill.skillId,
    skillName: skill.skillName,
    snapshotId: skill.snapshotId,
    sortOrder: skill.sortOrder,
  };
}

function toDiagnosticSpaceReference(
  sessionId: SessionId,
  space: Omit<SessionExecutionSpaceReference, "sessionId">,
): SessionExecutionSpaceReference {
  return {
    sessionId,
    sortOrder: space.sortOrder,
    spaceId: space.spaceId,
  };
}

function toDiagnosticToolReference(
  sessionId: SessionId,
  tool: Omit<SessionExecutionToolReference, "sessionId">,
): SessionExecutionToolReference {
  return {
    agentCredentialId: tool.agentCredentialId,
    credentialMode: tool.credentialMode,
    serverId: tool.serverId,
    sessionId,
    sortOrder: tool.sortOrder,
  };
}

export async function retrieveAgentSession(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AgentSessionLookupInput,
): Promise<AgentSessionRetrieveResult> {
  const access = await getSessionSummaryAccessById(database, viewer.id, input.sessionId);

  return toAgentSessionRetrieveResult(access);
}

export async function retrieveThreadAgentSession(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AgentSessionLookupInput,
): Promise<AgentSessionRetrieveResult> {
  const session = await getSessionSummaryForCreator(database, viewer.id, input.sessionId);

  return toAgentSessionRetrieveResult({
    isSessionCreator: true,
    session,
  });
}

export function toAgentSessionRetrieveResult(input: {
  isSessionCreator: boolean;
  session: SessionSummary;
}): AgentSessionRetrieveResult {
  return {
    capabilities: getAgentSessionActionCapabilities({
      ...input.session,
      isSessionCreator: input.isSessionCreator,
    }),
    recoverability: getAgentSessionRecoverability(input.session),
    session: input.session,
  };
}

function getAgentSessionRecoverability(
  session: Pick<SessionSummary, "archivedAt" | "status">,
): AgentSessionRecoverability {
  return getAgentSessionUserLifecycleProjection(session).recoverability;
}

export async function getAgentSessionDiagnostics(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AgentSessionLookupInput,
): Promise<AgentSessionDiagnostics> {
  const session = await getSessionSummaryById(database, viewer.id, input.sessionId);
  const [execution, viewerState, nativeRuntimeRef] = await Promise.all([
    loadSessionExecutionDiagnostics(database, input.sessionId),
    loadSessionViewerState(database, {
      sessionId: input.sessionId,
      viewerId: viewer.id,
    }),
    loadNativeRuntimeRefDiagnosticsRow(database, input.sessionId),
  ]);

  return {
    execution,
    generatedAt: new Date().toISOString(),
    nativeRuntimeRef: toNativeRuntimeRefDiagnostics(
      nativeRuntimeRef,
      execution?.binding.runtimeId ?? null,
    ),
    pendingPermissionCount: viewerState.permissionRequests.length,
    session,
  };
}

async function loadSessionExecutionDiagnostics(
  database: D1Database,
  sessionId: SessionId,
): Promise<AgentSessionExecutionDiagnostics | null> {
  const plan = await findSessionExecutionPlan(database, sessionId);

  if (!plan) {
    return null;
  }

  return {
    binding: {
      ...plan.binding,
      sessionId,
    },
    skills: plan.skills
      .toSorted((left, right) => left.sortOrder - right.sortOrder)
      .map((skill) => toDiagnosticSkillReference(sessionId, skill)),
    spaces: plan.spaces
      .toSorted((left, right) => left.sortOrder - right.sortOrder)
      .map((space) => toDiagnosticSpaceReference(sessionId, space)),
    tools: plan.tools
      .toSorted((left, right) => left.sortOrder - right.sortOrder)
      .map((tool) => toDiagnosticToolReference(sessionId, tool)),
  };
}

async function loadNativeRuntimeRefDiagnosticsRow(
  database: D1Database,
  sessionId: SessionId,
): Promise<NativeRuntimeRefDiagnosticsRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        kind: nativeResumeRefsTable.kind,
        runtimeId: nativeResumeRefsTable.runtimeId,
        value: nativeResumeRefsTable.value,
      })
      .from(nativeResumeRefsTable)
      .where(eq(nativeResumeRefsTable.sessionId, sessionId))
      .limit(1)
      .get()) ?? null
  );
}

function toNativeRuntimeRefDiagnostics(
  row: NativeRuntimeRefDiagnosticsRow | null,
  fallbackRuntimeId: string | null,
): AgentSessionNativeRuntimeRefDiagnostics {
  if (!row) {
    return {
      kind: null,
      runtimeId: fallbackRuntimeId,
      status: "absent",
      valuePreview: null,
    };
  }

  return {
    kind: row.kind,
    runtimeId: row.runtimeId,
    status: "present",
    valuePreview: previewNativeRuntimeRef(row.value),
  };
}

function previewNativeRuntimeRef(value: string): string {
  if (value.length <= 12) {
    return "redacted";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
