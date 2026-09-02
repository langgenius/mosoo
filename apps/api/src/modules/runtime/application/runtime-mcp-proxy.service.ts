import { sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { CredentialId, DriverInstanceId, McpServerId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { readMcpCredentialSecret } from "../../mcp/application/mcp-credential-secret-resolution";
import { getCredentialByIdOrNull } from "../../mcp/application/mcp-credential.repository";
import { getCredentialStatus } from "../../mcp/application/mcp-mappers";
import { getServerRowOrNull } from "../../mcp/application/mcp-server.repository";
import { getDriverInstanceMcpProxyGrant } from "../infrastructure/driver-instance/mcp-grants.repository";
import { getRuntimeSessionLink } from "../infrastructure/driver-instance/session-link.repository";
import { createRuntimeMcpDelegationToken } from "./runtime-mcp-delegation";
import { createRuntimeMcpProxyError } from "./runtime-mcp-proxy-errors";
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
  if (!row) return null;
  if (row.endUserId === null) return null;
  if (link.agentId === null || link.projectId === null) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP end-user delegation context is unavailable.",
      status: 403,
    });
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
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
    toolCallId: string | null;
  },
): Promise<RuntimeMcpProxyTarget> {
  const grant = await getDriverInstanceMcpProxyGrant(bindings.DB, input);

  if (grant === null) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP proxy grant is not available.",
      status: 403,
    });
  }

  if (grant.authorizationState !== "active") {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP proxy grant is not active.",
      status: 403,
    });
  }

  if (!isTruthy(grant.credentialId)) {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      message: "MCP credential is unavailable.",
      status: 401,
    });
  }

  const credentialId = parsePlatformId<CredentialId>(grant.credentialId, "MCP credential id");
  const [credential, server] = await Promise.all([
    getCredentialByIdOrNull(bindings.DB, credentialId),
    getServerRowOrNull(bindings.DB, input.serverId),
  ]);

  if (server === null) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_not_found",
      message: "MCP server is not available.",
      status: 404,
    });
  }

  if (credential === null) {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      message: "MCP credential is unavailable.",
      status: 401,
    });
  }

  if (credential.serverId !== input.serverId) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP proxy grant is not allowed.",
      status: 403,
    });
  }

  if (server.projectId !== grant.projectId || credential.projectId !== grant.projectId) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP proxy grant is not allowed for this project.",
      status: 403,
    });
  }

  if (server.enabled !== 1) {
    throw createRuntimeMcpProxyError({
      code: "mcp_policy_disabled",
      message: "MCP server is disabled.",
      status: 403,
    });
  }

  const credentialStatus = getCredentialStatus(credential);

  if (credentialStatus !== "active") {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      message: "MCP credential is unavailable.",
      status: 401,
    });
  }

  const accessToken = await readMcpCredentialSecret(bindings, {
    credential,
    purpose: "runtime_access_token",
    projectId: grant.projectId,
    server,
  });

  if (accessToken.status === "denied") {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      message: "MCP credential is unavailable.",
      status: 401,
    });
  }

  return {
    delegationToken: await createDelegationToken(bindings, {
      accessToken: accessToken.value,
      driverInstanceId: input.driverInstanceId,
      toolCallId: input.toolCallId,
      url: server.url,
    }),
    serverId: server.id,
    upstreamAccessToken: accessToken.value,
    url: server.url,
  };
}
