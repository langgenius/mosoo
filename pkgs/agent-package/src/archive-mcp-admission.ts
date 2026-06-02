import type { AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";

import { createArchiveIssue } from "./archive-issue";

const MCP_REMOTE_TRANSPORT_TYPES = new Set(["http", "sse"]);
const MCP_REMOTE_SIDECAR_FIELDS = new Set(["description", "iconUrl", "type", "url"]);
const MCP_SIDECAR_FORBIDDEN_SECRET_FIELDS = new Set([
  "access_token",
  "accesstoken",
  "api_key",
  "apikey",
  "authorization",
  "bearer_token",
  "bearertoken",
  "client_secret",
  "clientsecret",
  "credential",
  "credential_id",
  "credentialid",
  "credentials",
  "headers",
  "oauth_client_secret",
  "oauthclientsecret",
  "password",
  "refresh_token",
  "refreshtoken",
  "secret",
  "secret_id",
  "secretid",
  "source_credential_id",
  "sourcecredentialid",
  "token",
  "vault",
  "vault_locator",
  "vaultlocator",
  "lookup_key",
  "lookupkey",
]);

type McpSidecarAdmissionResult =
  | {
      ok: false;
      issue: AgentResolutionIssue;
    }
  | {
      normalizedServer: Record<string, unknown>;
      ok: true;
    };

export function admitMcpSidecarServer(
  name: string,
  server: Record<string, unknown>,
): McpSidecarAdmissionResult {
  const type = typeof server["type"] === "string" ? server["type"] : null;
  const hasCommand = typeof server["command"] === "string";

  if (hasCommand || type === "stdio") {
    return {
      issue: createArchiveIssue({
        code: "package.mcp.unsupported",
        message: `Package MCP server ${name} uses stdio command config, which is not supported by V1 Agent packages.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
      ok: false,
    };
  }

  if (type === null || !MCP_REMOTE_TRANSPORT_TYPES.has(type)) {
    return {
      issue: createArchiveIssue({
        code: "package.mcp.unsupported",
        message: `Package MCP server ${name} must use type http or sse.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
      ok: false,
    };
  }

  for (const field of Object.keys(server)) {
    if (MCP_REMOTE_SIDECAR_FIELDS.has(field)) {
      continue;
    }

    return {
      issue: createArchiveIssue({
        code: "package.mcp.field.unsupported",
        message: `Package MCP server ${name} field ${field} is not supported in V1.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
      ok: false,
    };
  }

  const url = typeof server["url"] === "string" ? server["url"] : null;

  if (url === null || !isHttpsUrl(url)) {
    return {
      issue: createArchiveIssue({
        code: "package.mcp.url.invalid",
        message: `Package MCP server ${name} must use an https URL.`,
        status: "unsupported",
        targetLabel: name,
        targetType: "mcp_server",
      }),
      ok: false,
    };
  }

  return {
    normalizedServer: {
      authType: "oauth",
      credentialScope: "user",
      iconUrl: typeof server["iconUrl"] === "string" ? server["iconUrl"] : null,
      source: "personal",
      url,
    },
    ok: true,
  };
}

export function findForbiddenMcpSecretFieldPath(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenMcpSecretFieldPath(value[index], `${path}[${index}]`);

      if (match !== null) {
        return match;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll("-", "_");
    const childPath = path.length > 0 ? `${path}.${key}` : key;

    if (MCP_SIDECAR_FORBIDDEN_SECRET_FIELDS.has(normalizedKey)) {
      return childPath;
    }

    const match = findForbiddenMcpSecretFieldPath(childValue, childPath);

    if (match !== null) {
      return match;
    }
  }

  return null;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
