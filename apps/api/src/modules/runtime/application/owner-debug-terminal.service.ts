import type { PtyOptions } from "@cloudflare/sandbox";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, SandboxId } from "@mosoo/id";

import { createErrorLogContext, logError, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, ApiError, createApiError } from "../../../platform/errors";
import { ensureAgentOwner } from "../../agents/application/agent-access.service";
import type { AgentRow } from "../../agents/application/agent-types";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import { resolveStableAgentRuntimeSubject } from "../domain/runtime-sandbox-subject";
import { createSandboxExecutionPlaneAdapter } from "../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import { ensureRuntimeSubjectId } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-store";

export interface OwnerDebugTerminalTarget {
  agent: Pick<AgentRow, "id" | "kind" | "name" | "organizationId" | "ownerId">;
  runtimeSubjectId: SandboxId;
  terminalSessionId?: string | undefined;
}

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
): Promise<OwnerDebugTerminalTarget> {
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
    agent,
    runtimeSubjectId: await ensureRuntimeSubjectId(database, subject),
    terminalSessionId: getOwnerDebugTerminalSessionId({
      agentId: agent.id,
      viewerId: input.viewerId,
    }),
  };
}

async function appendOwnerDebugTerminalLifecycleAuditEvent(
  database: D1Database,
  input: {
    agent: OwnerDebugTerminalTarget["agent"];
    durationMs?: number | undefined;
    operation: "terminal_close" | "terminal_open";
    sandboxId: SandboxId;
    terminalSessionId: string;
    viewer: AuthenticatedViewer;
  },
): Promise<void> {
  await appendAuditEvent(database, {
    action: AUDIT_ACTION.agentUpdate,
    ...resolveViewerAuditActor(input.viewer),
    metadata: {
      agentKind: input.agent.kind,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      operation: input.operation,
      sandboxId: input.sandboxId,
      terminalSessionId: input.terminalSessionId,
    },
    organizationId: input.agent.organizationId,
    outcome: "success",
    resourceDisplay: input.agent.name,
    resourceId: input.agent.id,
    resourceType: AUDIT_RESOURCE.agent,
  });
}

function attachOwnerDebugTerminalCloseAudit(
  response: Response,
  input: {
    agent: OwnerDebugTerminalTarget["agent"];
    database: D1Database;
    executionContext: Pick<ExecutionContext, "waitUntil">;
    openAudit: Promise<void>;
    openedAtMs: number;
    sandboxId: SandboxId;
    terminalSessionId: string;
    viewer: AuthenticatedViewer;
  },
): void {
  const socket = response.webSocket;
  if (socket == null) {
    logWarn("owner-debug-terminal.audit_close_socket_missing", {
      agentId: input.agent.id,
      sandboxId: input.sandboxId,
      terminalSessionId: input.terminalSessionId,
    });
    return;
  }

  socket.addEventListener("close", () => {
    input.executionContext.waitUntil(
      input.openAudit
        .then(() =>
          appendOwnerDebugTerminalLifecycleAuditEvent(input.database, {
            agent: input.agent,
            durationMs: Math.max(0, Date.now() - input.openedAtMs),
            operation: "terminal_close",
            sandboxId: input.sandboxId,
            terminalSessionId: input.terminalSessionId,
            viewer: input.viewer,
          }),
        )
        .catch((error: unknown) => {
          logError("owner-debug-terminal.audit_close.failed", {
            ...createErrorLogContext(error),
            agentId: input.agent.id,
            sandboxId: input.sandboxId,
            terminalSessionId: input.terminalSessionId,
          });
        }),
    );
  });
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
  const response = await executionPlane.connectTerminal(bindings, {
    runtimeSubjectId: target.runtimeSubjectId,
    options,
    request: input.request,
    ...(target.terminalSessionId === undefined
      ? {}
      : { terminalSessionId: target.terminalSessionId }),
  });

  if (response.status === 101 && target.terminalSessionId !== undefined) {
    const openedAtMs = Date.now();
    const openAudit = appendOwnerDebugTerminalLifecycleAuditEvent(bindings.DB, {
      agent: target.agent,
      operation: "terminal_open",
      sandboxId: target.runtimeSubjectId,
      terminalSessionId: target.terminalSessionId,
      viewer: input.viewer,
    });
    attachOwnerDebugTerminalCloseAudit(response, {
      agent: target.agent,
      database: bindings.DB,
      executionContext: input.executionContext,
      openAudit,
      openedAtMs,
      sandboxId: target.runtimeSubjectId,
      terminalSessionId: target.terminalSessionId,
      viewer: input.viewer,
    });
    await openAudit;
  }

  return response;
}
