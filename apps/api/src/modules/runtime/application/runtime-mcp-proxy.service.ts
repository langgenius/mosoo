import { sessionsTable } from "@mosoo/db";
import type { DriverInstanceId, McpServerId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { getCredentialByIdOrNull } from "../../mcp/application/mcp-credential.repository";
import { getCredentialStatus } from "../../mcp/application/mcp-mappers";
import { getServerRowOrNull } from "../../mcp/application/mcp-server.repository";
import { readSecret } from "../../vault/application/vault-secret-store";
import { isDriverInstanceGenerationActive } from "../infrastructure/driver-instance/driver-instance-record.repository";
import { getDriverInstanceMcpProxyGrant } from "../infrastructure/driver-instance/mcp-grants.repository";
import { getRuntimeSessionLink } from "../infrastructure/driver-instance/session-link.repository";
import { createRuntimeMcpDelegationToken } from "./runtime-mcp-delegation";
import { RuntimeMcpProxyError } from "./runtime-mcp-proxy-errors";
export interface RuntimeMcpProxyTarget {
  delegationToken: string | null;
  serverId: McpServerId;
  upstreamAccessToken: string;
  url: string;
}

async function createDelegationToken(
  bindings: ApiBindings,
  input: {
    accessToken: string;
    driverInstanceId: DriverInstanceId;
    toolCallId: string | null;
    url: string;
  },
): Promise<string | null> {
  const link = await getRuntimeSessionLink(bindings.DB, input.driverInstanceId);
  if (link.sessionId === null) return null;
  const row = await getAppDatabase(bindings.DB)
    .select({ endUserId: sessionsTable.endUserId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, link.sessionId))
    .limit(1)
    .get();
  if (row?.endUserId === null) return null;
  if (!row || link.agentId === null || link.projectId === null) {
    throw new RuntimeMcpProxyError(
      "mcp_proxy_forbidden",
      403,
      "MCP end-user delegation context is unavailable.",
    );
  }
  return createRuntimeMcpDelegationToken({
    accessToken: input.accessToken,
    audience: input.url,
    claims: {
      agentId: link.agentId,
      projectId: link.projectId,
      endUserId: row.endUserId,
      runId: link.sessionRunId,
      threadId: link.sessionId,
      toolCallId: input.toolCallId,
    },
  });
}

export async function resolveRuntimeMcpProxyTarget(
  bindings: ApiBindings,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
    toolCallId: string | null;
  },
): Promise<RuntimeMcpProxyTarget> {
  const driverIsActive = await isDriverInstanceGenerationActive(bindings.DB, {
    driverInstanceId: input.driverInstanceId,
    generation: input.driverGeneration,
  });

  if (!driverIsActive) {
    throw new RuntimeMcpProxyError(
      "mcp_proxy_forbidden",
      403,
      "MCP proxy grant driver instance is not active.",
    );
  }

  const grant = await getDriverInstanceMcpProxyGrant(bindings.DB, input);

  if (grant === null) {
    throw new RuntimeMcpProxyError("mcp_proxy_forbidden", 403, "MCP proxy grant is not available.");
  }

  if (grant.authorizationState !== "active") {
    throw new RuntimeMcpProxyError("mcp_proxy_forbidden", 403, "MCP proxy grant is not active.");
  }

  if (!isTruthy(grant.credentialId)) {
    throw new RuntimeMcpProxyError(
      "mcp_credential_unavailable",
      401,
      "MCP credential is unavailable.",
    );
  }

  const [credential, server] = await Promise.all([
    getCredentialByIdOrNull(bindings.DB, grant.credentialId),
    getServerRowOrNull(bindings.DB, input.serverId),
  ]);

  if (server === null) {
    throw new RuntimeMcpProxyError("mcp_proxy_not_found", 404, "MCP server is not available.");
  }

  if (credential === null) {
    throw new RuntimeMcpProxyError(
      "mcp_credential_unavailable",
      401,
      "MCP credential is unavailable.",
    );
  }

  if (credential.serverId !== input.serverId) {
    throw new RuntimeMcpProxyError("mcp_proxy_forbidden", 403, "MCP proxy grant is not allowed.");
  }

  if (server.projectId !== grant.projectId || credential.projectId !== grant.projectId) {
    throw new RuntimeMcpProxyError(
      "mcp_proxy_forbidden",
      403,
      "MCP proxy grant is not allowed for this project.",
    );
  }

  if (!server.enabled) {
    throw new RuntimeMcpProxyError("mcp_policy_disabled", 403, "MCP server is disabled.");
  }

  const credentialStatus = getCredentialStatus(credential);

  if (credentialStatus !== "active") {
    throw new RuntimeMcpProxyError(
      "mcp_credential_unavailable",
      401,
      "MCP credential is unavailable.",
    );
  }

  const accessToken = await readSecret(bindings.DB, bindings, credential.secretId);

  return {
    delegationToken: await createDelegationToken(bindings, {
      accessToken,
      driverInstanceId: input.driverInstanceId,
      toolCallId: input.toolCallId,
      url: server.url,
    }),
    serverId: server.id,
    upstreamAccessToken: accessToken,
    url: server.url,
  };
}
