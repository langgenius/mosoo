import { parsePlatformId } from "@mosoo/id";
import type { CredentialId, DriverInstanceId, McpServerId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { readMcpCredentialSecret } from "../../mcp/application/mcp-credential-secret-resolution";
import { getCredentialByIdOrNull } from "../../mcp/application/mcp-credential.repository";
import { getCredentialStatus } from "../../mcp/application/mcp-mappers";
import { getServerRowOrNull } from "../../mcp/application/mcp-server.repository";
import { getDriverInstanceMcpProxyGrant } from "../infrastructure/driver-instance/mcp-grants.repository";
import { createRuntimeMcpProxyError } from "./runtime-mcp-proxy-errors";
export interface RuntimeMcpProxyTarget {
  serverId: McpServerId;
  upstreamAccessToken: string;
  url: string;
}

export async function resolveRuntimeMcpProxyTarget(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    serverId: McpServerId;
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

  if (server.appId !== grant.appId || credential.appId !== grant.appId) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP proxy grant is not allowed for this app.",
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
    appId: grant.appId,
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
    serverId: server.id,
    upstreamAccessToken: accessToken.value,
    url: server.url,
  };
}
