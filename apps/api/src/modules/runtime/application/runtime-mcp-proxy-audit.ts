import type { DriverInstanceId, McpServerId } from "@mosoo/id";

import { createIngressRequestMetadataProjection } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { appendAuditEvent } from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_OUTCOME, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import { getRuntimeSessionLink } from "../infrastructure/driver-instance/session-link.repository";
import { toRuntimeMcpProxyPublicErrorDetails } from "./runtime-mcp-proxy-errors";

export async function appendRuntimeMcpProxyErrorAuditEvent(
  bindings: Pick<ApiBindings, "DB">,
  input: {
    driverInstanceId: DriverInstanceId;
    error: unknown;
    request: Request;
    serverId: McpServerId;
  },
): Promise<void> {
  const details = toRuntimeMcpProxyPublicErrorDetails(input.error);
  const link = await getRuntimeSessionLink(bindings.DB, input.driverInstanceId);
  const organizationId = link.organizationId;

  if (organizationId === null) {
    return;
  }

  const requestMetadata = createIngressRequestMetadataProjection(input.request);
  const correlationId = requestMetadata.correlationId ?? link.traceId ?? requestMetadata.requestId;

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.mcpBindingUpdate,
    actorDisplay:
      link.agentId === null ? "Runtime driver" : `Runtime agent ${String(link.agentId)}`,
    actorId: link.agentId,
    actorType: link.agentId === null ? "system" : "agent",
    correlationId: correlationId ?? null,
    metadata: {
      ...details.audit,
      ...(link.callerId === null ? {} : { callerId: link.callerId }),
      ...(link.executionOwnerId === null ? {} : { executionOwnerId: link.executionOwnerId }),
      driverInstanceId: input.driverInstanceId,
      ...(requestMetadata.requestId === undefined ? {} : { requestId: requestMetadata.requestId }),
      ...(link.sessionRunId === null ? {} : { sessionRunId: link.sessionRunId }),
      ...(link.traceId === null ? {} : { traceId: link.traceId }),
    },
    organizationId,
    outcome: details.status >= 500 ? AUDIT_OUTCOME.failure : AUDIT_OUTCOME.denied,
    resourceDisplay: `MCP server ${input.serverId}`,
    resourceId: input.serverId,
    resourceType: AUDIT_RESOURCE.mcpBinding,
    sessionId: link.sessionId,
  });
}
