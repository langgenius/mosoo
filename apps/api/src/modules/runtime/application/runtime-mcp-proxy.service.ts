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
      reason: "grant_missing",
      serverId: input.serverId,
      status: 403,
    });
  }

  if (grant.authorizationState !== "active") {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      message: "MCP proxy grant is not active.",
      reason: "grant_inactive",
      serverId: input.serverId,
      status: 403,
    });
  }

  if (!isTruthy(grant.credentialId)) {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      message: "MCP credential is unavailable.",
      reason: "grant_missing_credential",
      serverId: input.serverId,
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
      credentialId,
      message: "MCP server is not available.",
      reason: "server_not_found",
      serverId: input.serverId,
      status: 404,
    });
  }

  if (credential === null) {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      credentialId,
      message: "MCP credential is unavailable.",
      reason: "credential_not_found",
      serverId: server.id,
      status: 401,
    });
  }

  if (credential.serverId !== input.serverId) {
    throw createRuntimeMcpProxyError({
      code: "mcp_proxy_forbidden",
      credentialId: credential.id,
      message: "MCP proxy grant is not allowed.",
      reason: "credential_server_mismatch",
      serverId: server.id,
      status: 403,
    });
  }

  if (server.enabled !== 1) {
    throw createRuntimeMcpProxyError({
      code: "mcp_policy_disabled",
      credentialId: credential.id,
      message: "MCP server is disabled.",
      reason: "server_disabled",
      serverEnabled: false,
      serverId: server.id,
      status: 403,
    });
  }

  const credentialStatus = getCredentialStatus(credential);

  if (credentialStatus !== "active") {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      credentialId: credential.id,
      credentialStatus,
      message: "MCP credential is unavailable.",
      reason: "credential_inactive",
      serverId: server.id,
      status: 401,
    });
  }

  const accessToken = await readMcpCredentialSecret(bindings, {
    credential,
    organizationId: server.organizationId,
    purpose: "runtime_access_token",
    server,
  });

  if (accessToken.status === "denied") {
    throw createRuntimeMcpProxyError({
      code: "mcp_credential_unavailable",
      credentialId: credential.id,
      credentialStatus,
      mcpSecretReadPurpose: accessToken.purpose,
      mcpSecretReadReason: accessToken.reason,
      message: "MCP credential is unavailable.",
      reason: "credential_secret_denied",
      serverId: server.id,
      status: 401,
    });
  }

  return {
    serverId: server.id,
    upstreamAccessToken: accessToken.value,
    url: server.url,
  };
}
