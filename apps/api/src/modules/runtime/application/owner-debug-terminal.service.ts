import type { PtyOptions } from "@cloudflare/sandbox";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, ApiError, createApiError } from "../../../platform/errors";
import { ensureAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import { resolveStableAgentRuntimeSubject } from "../domain/runtime-sandbox-subject";
import { connectPreparedSandboxTerminal } from "../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import { createRuntimeSubjectLifecycleService } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { ensureRuntimeSubjectId } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-store";

const DEFAULT_OWNER_DEBUG_TERMINAL_OPTIONS: PtyOptions = { cols: 120, rows: 32 };

function ensureOwnerDebugTerminalWebSocketRequest(request: Request): void {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new ApiError(426, "WEBSOCKET_REQUIRED", "Expected WebSocket upgrade.");
  }
}

function getOwnerDebugTerminalSessionId(input: { agentId: AgentId; viewerId: AccountId }): string {
  return `owner-debug-${input.viewerId}-${input.agentId}`;
}

async function resolveOwnerDebugTerminalTarget(
  database: D1Database,
  input: {
    agentId: AgentId;
    viewerId: AccountId;
  },
) {
  const agent = await ensureAgentOwner(database, input.viewerId, input.agentId);
  const policy = getRuntimeKindPolicy(agent.kind);

  if (policy.operations.terminalTarget !== "stable_subject") {
    throw createApiError(
      API_ERROR_CODE.ownerDebugTerminalUnavailable,
      "Owner debug terminal is only available for Pet agents.",
    );
  }

  const subject = resolveStableAgentRuntimeSubject({
    agentId: agent.id,
    kind: agent.kind,
  });

  return {
    agentId: agent.id,
    projectId: agent.projectId,
    executionOwnerUserId: agent.ownerId,
    kind: agent.kind,
    runtimeSubjectId: await ensureRuntimeSubjectId(database, {
      ...subject,
      agentId: agent.id,
      projectId: agent.projectId,
      executionOwnerUserId: agent.ownerId,
    }),
    subjectId: subject.subjectId,
    subjectKind: subject.subjectKind,
    terminalSessionId: getOwnerDebugTerminalSessionId({
      agentId: agent.id,
      viewerId: input.viewerId,
    }),
  };
}

export async function connectOwnerDebugTerminalWebSocket(
  bindings: ApiBindings,
  input: {
    agentId: string;
    executionContext: Pick<ExecutionContext, "waitUntil">;
    request: Request;
    viewer: AuthenticatedViewer;
  },
  options: PtyOptions = DEFAULT_OWNER_DEBUG_TERMINAL_OPTIONS,
): Promise<Response> {
  ensureOwnerDebugTerminalWebSocketRequest(input.request);
  const agentId = parsePlatformId<AgentId>(input.agentId, "Owner debug terminal agent ID");

  const target = await resolveOwnerDebugTerminalTarget(bindings.DB, {
    agentId,
    viewerId: input.viewer.id,
  });
  const activation = await createRuntimeSubjectLifecycleService(bindings).activate({
    ...target,
    networkConstraints: { allowedHosts: [], networkPolicy: "full" },
  });

  return connectPreparedSandboxTerminal(activation.subject, {
    options,
    request: input.request,
    terminalSessionId: target.terminalSessionId,
  });
}
