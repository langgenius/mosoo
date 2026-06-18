import type {
  MosooSessionConfigTraceMcpServer,
  MosooSessionConfigTraceValue,
} from "@mosoo/ag-ui-session";
import type { DriverBootMcpServer, DriverBootPayload } from "agent-driver/boot";

function summarizeMcpServer(server: DriverBootMcpServer): MosooSessionConfigTraceMcpServer {
  return {
    authorizationState: server.authorizationState,
    credentialRef: "credentialId" in server ? "redacted" : "absent",
    name: server.name,
    serverId: server.serverId,
  };
}

function summarizeCredentialRefs(servers: DriverBootMcpServer[]): "redacted"[] {
  return servers.flatMap((server) => ("credentialId" in server ? ["redacted" as const] : []));
}

export function buildSessionConfigTraceValue(
  bootPayload: DriverBootPayload,
): MosooSessionConfigTraceValue {
  const { configRevision } = bootPayload.execution;
  const { session } = bootPayload.execution;

  return {
    agentId: configRevision.agentId,
    configRevisionId: configRevision.deploymentVersionId,
    deploymentVersionId: configRevision.deploymentVersionId,
    deploymentVersionNumber: configRevision.deploymentVersionNumber,
    driverBootPayload: {
      credentialRefs: summarizeCredentialRefs(session.mcpServers),
      cwd: session.cwd,
      mcpServers: session.mcpServers.map(summarizeMcpServer),
      model: bootPayload.execution.model,
      nativeResumeRef: session.nativeResumeRef ? "present" : "absent",
      provider: bootPayload.execution.provider,
      runtimeId: bootPayload.runtime,
      runtimeTransport: bootPayload.runtimeTransport,
    },
    environmentId: configRevision.environmentId,
    environmentRevisionId: configRevision.environmentRevisionId,
    runId: configRevision.runId,
    sessionId: configRevision.sessionId,
  };
}
