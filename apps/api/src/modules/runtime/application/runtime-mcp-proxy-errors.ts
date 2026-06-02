import type { McpCredentialStatus } from "@mosoo/contracts/mcp";
import type { CredentialId, McpServerId } from "@mosoo/id";

import type {
  McpCredentialSecretReadDenialReason,
  McpCredentialSecretReadPurpose,
} from "../../mcp/application/mcp-credential-secret-resolution";

export type RuntimeMcpProxyPublicErrorCode =
  | "mcp_credential_unavailable"
  | "mcp_policy_disabled"
  | "mcp_proxy_forbidden"
  | "mcp_proxy_internal_error"
  | "mcp_proxy_not_found"
  | "mcp_upstream_unavailable";

export type RuntimeMcpProxyPublicErrorStatus = 401 | 403 | 404 | 500 | 502;

export type RuntimeMcpProxyFailureReason =
  | "credential_inactive"
  | "credential_not_found"
  | "credential_secret_denied"
  | "credential_server_mismatch"
  | "grant_inactive"
  | "grant_missing"
  | "grant_missing_credential"
  | "internal_error"
  | "server_disabled"
  | "server_not_found"
  | "upstream_request_failed";

export interface RuntimeMcpProxyAuditDetails {
  credentialId?: CredentialId | undefined;
  credentialStatus?: McpCredentialStatus | undefined;
  errorCode: RuntimeMcpProxyPublicErrorCode;
  mcpSecretReadPurpose?: McpCredentialSecretReadPurpose | undefined;
  mcpSecretReadReason?: McpCredentialSecretReadDenialReason | undefined;
  operation: "runtime.mcp_proxy";
  reason: RuntimeMcpProxyFailureReason;
  serverEnabled?: boolean | undefined;
  serverId?: McpServerId | undefined;
  status: RuntimeMcpProxyPublicErrorStatus;
}

export interface RuntimeMcpProxyPublicErrorDetails {
  audit: RuntimeMcpProxyAuditDetails;
  code: RuntimeMcpProxyPublicErrorCode;
  message: string;
  status: RuntimeMcpProxyPublicErrorStatus;
}

export class RuntimeMcpProxyError extends Error {
  readonly details: RuntimeMcpProxyPublicErrorDetails;

  constructor(details: RuntimeMcpProxyPublicErrorDetails) {
    super(details.message);
    this.details = details;
    this.name = "RuntimeMcpProxyError";
  }
}

export function createRuntimeMcpProxyError(input: {
  code: RuntimeMcpProxyPublicErrorCode;
  credentialId?: CredentialId | undefined;
  credentialStatus?: McpCredentialStatus | undefined;
  mcpSecretReadPurpose?: McpCredentialSecretReadPurpose | undefined;
  mcpSecretReadReason?: McpCredentialSecretReadDenialReason | undefined;
  message: string;
  reason: RuntimeMcpProxyFailureReason;
  serverEnabled?: boolean | undefined;
  serverId?: McpServerId | undefined;
  status: RuntimeMcpProxyPublicErrorStatus;
}): RuntimeMcpProxyError {
  return new RuntimeMcpProxyError({
    audit: {
      errorCode: input.code,
      operation: "runtime.mcp_proxy",
      reason: input.reason,
      status: input.status,
      ...(input.credentialId === undefined ? {} : { credentialId: input.credentialId }),
      ...(input.credentialStatus === undefined ? {} : { credentialStatus: input.credentialStatus }),
      ...(input.mcpSecretReadPurpose === undefined
        ? {}
        : { mcpSecretReadPurpose: input.mcpSecretReadPurpose }),
      ...(input.mcpSecretReadReason === undefined
        ? {}
        : { mcpSecretReadReason: input.mcpSecretReadReason }),
      ...(input.serverEnabled === undefined ? {} : { serverEnabled: input.serverEnabled }),
      ...(input.serverId === undefined ? {} : { serverId: input.serverId }),
    },
    code: input.code,
    message: input.message,
    status: input.status,
  });
}

export function toRuntimeMcpProxyPublicErrorDetails(
  error: unknown,
): RuntimeMcpProxyPublicErrorDetails {
  if (error instanceof RuntimeMcpProxyError) {
    return error.details;
  }

  return createRuntimeMcpProxyError({
    code: "mcp_proxy_internal_error",
    message: "MCP proxy request failed.",
    reason: "internal_error",
    status: 500,
  }).details;
}

export function runtimeMcpProxyErrorBody(details: RuntimeMcpProxyPublicErrorDetails): {
  code: RuntimeMcpProxyPublicErrorCode;
  error: string;
} {
  return {
    code: details.code,
    error: details.message,
  };
}
