import type {
  AgentMcpBinding,
  McpAuthorizationState,
  McpCredentialStatus,
  McpCredentialSummary,
  McpOAuthFlowState,
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

function resolveIconUrl(row: { iconUrl: string | null; url: string }): string {
  return isTruthy(row.iconUrl)
    ? row.iconUrl
    : new URL("/favicon.ico", new URL(row.url).origin).toString();
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

function getStoredCredentialStatus(row: CredentialRow): CredentialRow["status"] {
  return row.status === "active" && row.expiresAt !== null && row.expiresAt <= Date.now()
    ? "expired"
    : row.status;
}

export function getCredentialStatus(row: CredentialRow | null): McpCredentialStatus {
  return row === null ? "none" : getStoredCredentialStatus(row);
}

export function toAuthorizationState(
  server: Pick<ServerRow, "enabled">,
  credential: CredentialRow | null,
): McpAuthorizationState {
  if (!server.enabled) {
    return "disabled";
  }

  return credential === null ? "authorization_required" : getStoredCredentialStatus(credential);
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
    status: getStoredCredentialStatus(row),
    subjectLabel: row.subjectLabel,
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toServerWithCredential(
  row: ServerRow,
  credential: CredentialRow | null,
): McpServerWithCredential {
  return {
    authType: row.authType,
    authorizationState: toAuthorizationState(row, credential),
    createdAt: toIsoString(row.createdAt),
    credential: credential ? toCredentialSummary(credential) : null,
    credentialScope: row.credentialScope,
    credentialStatus: getCredentialStatus(credential),
    description: row.description,
    enabled: row.enabled,
    hasCredential: credential?.status === "active",
    iconUrl: resolveIconUrl(row),
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    ownerName: row.ownerName ?? "Unknown",
    projectId: row.projectId,
    source: row.source,
    updatedAt: toIsoString(row.updatedAt),
    url: row.url,
  };
}

export function toAgentBinding(
  row: AgentBindingRow,
  credential: CredentialRow | null,
): AgentMcpBinding {
  return {
    authType: row.authType,
    authorizationState: row.enabled
      ? toAuthorizationState({ enabled: row.serverEnabled }, credential)
      : "disabled",
    createdAt: toIsoString(row.createdAt),
    credentialMode: row.credentialMode,
    credentialScope: row.credentialScope,
    credentialStatus: getCredentialStatus(credential),
    credentialSubject: credential?.subjectLabel ?? null,
    enabled: row.enabled,
    hasCredential: credential?.status === "active",
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
      flow.status === "succeeded" ? (server.enabled ? "active" : "disabled") : null,
    errorMessage: flow.errorMessage,
    flowId: flow.id,
    serverId: flow.serverId,
    status: flow.status,
    subjectLabel: flow.subjectLabel,
  };
}
