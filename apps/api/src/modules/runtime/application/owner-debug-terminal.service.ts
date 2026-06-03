import type { PtyOptions } from "@cloudflare/sandbox";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, SandboxId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, ApiError, createApiError } from "../../../platform/errors";
import { ensureAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import { resolveStableAgentRuntimeSubject } from "../domain/runtime-sandbox-subject";
import { createSandboxExecutionPlaneAdapter } from "../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import { ensureRuntimeSubjectId } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-store";

const DEFAULT_OWNER_DEBUG_TERMINAL_OPTIONS: PtyOptions = { cols: 120, rows: 32 };
const executionPlane = createSandboxExecutionPlaneAdapter();

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
): Promise<{ runtimeSubjectId: SandboxId; terminalSessionId: string }> {
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
    runtimeSubjectId: await ensureRuntimeSubjectId(database, subject),
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
  return executionPlane.connectTerminal(bindings, {
    runtimeSubjectId: target.runtimeSubjectId,
    options,
    request: input.request,
    terminalSessionId: target.terminalSessionId,
  });
}
