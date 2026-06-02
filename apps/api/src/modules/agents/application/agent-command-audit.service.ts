import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { appendSuccessfulControlOperationAuditEvent } from "../../control-operations/application/control-operation-outcome-audit.service";
import type { AgentRow } from "./agent-types";

type AgentAuditOperationName = "createAgent" | "updateAgentConfig" | "updateAgentPackageSharing";

export async function appendAgentAuditEvent(
  database: D1Database,
  input: {
    agent: AgentRow;
    metadata?: Record<string, string> | undefined;
    operationName: AgentAuditOperationName;
    viewer: AuthenticatedViewer;
    viewerRole?: string;
  },
): Promise<void> {
  await appendSuccessfulControlOperationAuditEvent(database, {
    metadata: {
      ...input.metadata,
      ...(input.viewerRole ? { viewerRole: input.viewerRole } : {}),
    },
    operationName: input.operationName,
    organizationId: input.agent.organizationId,
    resourceDisplay: input.agent.name,
    resourceId: input.agent.id,
    viewer: input.viewer,
  });
}
