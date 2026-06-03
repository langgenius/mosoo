export type RuntimeMcpProxyPublicErrorCode =
  | "mcp_credential_unavailable"
  | "mcp_policy_disabled"
  | "mcp_proxy_forbidden"
  | "mcp_proxy_internal_error"
  | "mcp_proxy_not_found"
  | "mcp_upstream_unavailable";

export type RuntimeMcpProxyPublicErrorStatus = 401 | 403 | 404 | 500 | 502;

export interface RuntimeMcpProxyPublicErrorDetails {
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
  message: string;
  status: RuntimeMcpProxyPublicErrorStatus;
}): RuntimeMcpProxyError {
  return new RuntimeMcpProxyError({
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
