type RuntimeMcpProxyErrorCode =
  | "mcp_credential_unavailable"
  | "mcp_policy_disabled"
  | "mcp_proxy_forbidden"
  | "mcp_proxy_not_found"
  | "mcp_upstream_unavailable";

export class RuntimeMcpProxyError extends Error {
  readonly code: RuntimeMcpProxyErrorCode;
  readonly status: 401 | 403 | 404 | 502;

  constructor(code: RuntimeMcpProxyErrorCode, status: 401 | 403 | 404 | 502, message: string) {
    super(message);
    this.name = "RuntimeMcpProxyError";
    this.code = code;
    this.status = status;
  }

  toResponse(): Response {
    return Response.json({ code: this.code, error: this.message }, { status: this.status });
  }
}
