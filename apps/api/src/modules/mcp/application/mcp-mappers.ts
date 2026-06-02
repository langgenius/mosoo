import type {
  AgentMcpBinding,
  McpAuthorizationState,
  McpCredentialStatus,
  McpCredentialSummary,
  McpOAuthFlowState,
  McpServer,
  McpServerWithCredential,
} from "@mosoo/contracts/mcp";

import { isTruthy } from "../../../shared/truthiness";
import { toIsoString } from "../../../time";
import type { AgentBindingRow, CredentialRow, OAuthFlowRow, ServerRow } from "./mcp-types";
export function parseHttpsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);

  if (parsed.protocol !== "https:") {
    throw new Error("Only remote HTTPS MCP servers are supported.");
  }

  parsed.hash = "";
  return parsed.toString();
}

function deriveDefaultFaviconUrl(serverUrl: string): string | null {
  try {
    return new URL("/favicon.ico", new URL(serverUrl).origin).toString();
  } catch {
    return null;
  }
}

function resolveIconUrl(row: { iconUrl: string | null; url: string }): string | null {
  return isTruthy(row.iconUrl) ? row.iconUrl : deriveDefaultFaviconUrl(row.url);
}

export function decodeJsonArray(raw: string | null): string[] {
  if (!isTruthy(raw)) {
    return [];
  }

  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("Expected a JSON string array.");
  }

  return parsed;
}

export function getCredentialStatus(row: CredentialRow | null): McpCredentialStatus {
  if (row?.status === "active" && row.expiresAt !== null && row.expiresAt <= Date.now()) {
    return "expired";
  }

  return row?.status ?? "none";
}

export function toAuthorizationState(
  server: Pick<ServerRow, "enabled">,
  credential: CredentialRow | null,
): McpAuthorizationState {
  if (server.enabled !== 1) {
    return "disabled";
  }

  if (!credential) {
    return "authorization_required";
  }

  switch (getCredentialStatus(credential)) {
    case "active": {
      return "active";
    }
    case "expired": {
      return "expired";
    }
    case "revoked": {
      return "revoked";
    }
    case "none": {
      throw new Error("Credential status cannot be none when a credential row exists.");
    }
    default: {
      throw new Error(`Unsupported MCP credential status: ${getCredentialStatus(credential)}.`);
    }
  }
}

export function toUnavailableCredentialStatus(
  authorizationState: Exclude<McpAuthorizationState, "active">,
  credentialStatus: McpCredentialStatus,
): Exclude<McpCredentialStatus, "active"> {
  switch (authorizationState) {
    case "authorization_required": {
      return "none";
    }
    case "disabled": {
      return credentialStatus === "expired" || credentialStatus === "revoked"
        ? credentialStatus
        : "none";
    }
    case "expired": {
      return "expired";
    }
    case "revoked": {
      return "revoked";
    }
    default: {
      throw new Error("Unsupported MCP authorization state.");
    }
  }
}

function toCredentialSummary(row: CredentialRow): McpCredentialSummary {
  return {
    authType: row.authType,
    createdAt: toIsoString(row.createdAt),
    expiresAt: isTruthy(row.expiresAt) ? toIsoString(row.expiresAt) : null,
    id: row.id,
    scope: row.scope,
    scopeValues: decodeJsonArray(row.scopeValuesJson),
    status: getCredentialStatus(row) as Exclude<McpCredentialStatus, "none">,
    subjectLabel: row.subjectLabel,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toServer(row: ServerRow, hasSharedCredential: boolean): McpServer {
  return {
    authType: row.authType,
    createdAt: toIsoString(row.createdAt),
    credentialScope: row.credentialScope,
    description: row.description,
    enabled: row.enabled === 1,
    hasSharedCredential,
    iconUrl: resolveIconUrl(row),
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    ownerId: row.ownerId,
    ownerName: row.ownerName ?? "Unknown",
    source: row.source,
    updatedAt: toIsoString(row.updatedAt),
    url: row.url,
  };
}

export function toServerWithCredential(
  row: ServerRow,
  credential: CredentialRow | null,
  hasSharedCredential: boolean,
): McpServerWithCredential {
  return {
    ...toServer(row, hasSharedCredential),
    authorizationState: toAuthorizationState(row, credential),
    credential: credential ? toCredentialSummary(credential) : null,
    credentialStatus: getCredentialStatus(credential),
  };
}

export function toAgentBinding(
  row: AgentBindingRow,
  credential: CredentialRow | null,
  hasSharedCredential: boolean,
): AgentMcpBinding {
  const authorizationState =
    row.enabled === 1 && row.serverEnabled === 1
      ? toAuthorizationState({ enabled: row.serverEnabled }, credential)
      : "disabled";

  return {
    authType: row.authType,
    authorizationState,
    createdAt: toIsoString(row.createdAt),
    credentialMode: row.credentialMode,
    credentialScope: row.credentialScope,
    credentialStatus: getCredentialStatus(credential),
    credentialSubject: credential?.subjectLabel ?? null,
    enabled: row.enabled === 1,
    hasSharedCredential,
    iconUrl: resolveIconUrl(row),
    id: row.id,
    name: row.name,
    serverId: row.serverId,
    source: row.source,
    updatedAt: toIsoString(row.updatedAt),
    url: row.url,
  };
}

export function toOAuthFlowState(flow: OAuthFlowRow, server: ServerRow): McpOAuthFlowState {
  return {
    authorizationState:
      flow.status === "succeeded"
        ? ((server.enabled === 1 ? "active" : "disabled") as McpAuthorizationState)
        : null,
    errorMessage: flow.errorMessage,
    flowId: flow.id,
    serverId: flow.serverId,
    status: flow.status,
    subjectLabel: flow.subjectLabel,
  };
}
