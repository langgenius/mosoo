import type { McpAuthorizationState } from "@mosoo/contracts/mcp";
import type { AccountId, AgentId, CredentialId, McpServerId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs, toIsoString } from "../../../time";
import { getAgentRow } from "../../agents/application/agent-repository";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { DriverResolvedMcpServer } from "../../runtime/domain/driver-snapshot";
import { readMcpCredentialSecret } from "./mcp-credential-secret-resolution";
import {
  expireCredential,
  getCredentialById,
  resolveCredentialsForMcpBindings,
  writeCredential,
} from "./mcp-credential.repository";
import {
  decodeJsonArray,
  getCredentialStatus,
  toAuthorizationState,
  toUnavailableCredentialStatus,
} from "./mcp-mappers";
import { exchangeOAuthToken, getOrDiscoverOAuthMetadata } from "./mcp-oauth.service";
import { readAccountId, readAgentId, readCredentialId, readMcpServerId } from "./mcp-platform-ids";
import { getServerRow, listServerRowsById } from "./mcp-server.repository";
import type {
  AgentBindingRow,
  CredentialRow,
  RefreshedRuntimeCredential,
  ServerRow,
} from "./mcp-types";
interface RuntimeMcpBindingSnapshot {
  agentCredentialId: CredentialId | string | null;
  credentialMode: AgentBindingRow["credentialMode"];
  enabled: boolean;
  serverId: McpServerId | string;
  sortOrder: number;
}

export interface RuntimeMcpDatabaseBindings {
  readonly DB: D1Database;
}

function toRuntimeResolvedMcpServer(input: {
  authorizationState?: McpAuthorizationState;
  credential: CredentialRow | null;
  server: ServerRow;
}): DriverResolvedMcpServer {
  const authorizationState =
    input.authorizationState ?? toAuthorizationState(input.server, input.credential);
  const credentialStatus = getCredentialStatus(input.credential);
  const base = {
    authType: input.server.authType,
    credentialScope: input.server.credentialScope,
    name: input.server.name,
    appId: input.server.appId,
    serverId: input.server.id,
    subjectLabel: input.credential?.subjectLabel ?? null,
  } as const;

  if (authorizationState === "active") {
    if (!input.credential) {
      throw new Error("Active MCP authorization requires a credential.");
    }

    if (credentialStatus !== "active") {
      throw new Error("Active MCP authorization requires an active credential.");
    }

    return {
      ...base,
      authorizationState: "active",
      credentialId: input.credential.id,
      credentialStatus: "active",
    };
  }

  return {
    ...base,
    authorizationState,
    credentialStatus: toUnavailableCredentialStatus(authorizationState, credentialStatus),
  };
}

export async function resolveRuntimeMcpServersForSnapshot(
  bindings: RuntimeMcpDatabaseBindings,
  input: {
    agentId: AgentId | string;
    bindings: RuntimeMcpBindingSnapshot[];
    callerUserId: AccountId | string;
    executionOwnerUserId: AccountId | string;
  },
): Promise<DriverResolvedMcpServer[]> {
  const agentId = readAgentId(input.agentId);
  const callerUserId = readAccountId(input.callerUserId, "callerUserId");
  const executionOwnerUserId = readAccountId(input.executionOwnerUserId, "executionOwnerUserId");
  const orderedBindings = [...input.bindings]
    .map((binding) => {
      return {
        agentCredentialId:
          binding.agentCredentialId === null
            ? null
            : readCredentialId(binding.agentCredentialId, "agentCredentialId"),
        credentialMode: binding.credentialMode,
        enabled: binding.enabled,
        serverId: readMcpServerId(binding.serverId),
        sortOrder: binding.sortOrder,
      };
    })
    .toSorted((left, right) => left.sortOrder - right.sortOrder);
  const agent = await getAgentRow(bindings.DB, agentId);
  await ensureAppOwnership(bindings.DB, callerUserId, agent.appId);

  if (executionOwnerUserId !== agent.ownerId) {
    throw new Error("Runtime MCP credentials must resolve for the agent owner.");
  }

  const serversById = await listServerRowsById(
    bindings.DB,
    orderedBindings.map((binding) => binding.serverId),
  );
  const credentialBindings: {
    agentCredentialId: CredentialId | null;
    agentId: AgentId;
    credentialMode: AgentBindingRow["credentialMode"];
    credentialScope: AgentBindingRow["credentialScope"];
    serverId: McpServerId;
  }[] = [];
  const resolvedServers: ServerRow[] = [];
  const enabledByIndex: boolean[] = [];

  for (const snapshot of orderedBindings) {
    const server = serversById.get(snapshot.serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    if (server.appId !== agent.appId) {
      throw new Error("MCP server is not available in this app.");
    }

    if (server.ownerId !== executionOwnerUserId) {
      throw new Error("Runtime MCP credentials must resolve for the App owner.");
    }

    credentialBindings.push({
      agentCredentialId: snapshot.agentCredentialId,
      agentId: agent.id,
      credentialMode: snapshot.credentialMode,
      credentialScope: server.credentialScope,
      serverId: server.id,
    });
    resolvedServers.push(server);
    enabledByIndex.push(snapshot.enabled);
  }

  const credentials = await resolveCredentialsForMcpBindings(bindings.DB, credentialBindings);

  return resolvedServers.map((server, index) => {
    const credential = credentials[index] ?? null;
    const authorizationState =
      enabledByIndex[index] === true
        ? toAuthorizationState(server, credential)
        : ("disabled" as const);

    return toRuntimeResolvedMcpServer({
      authorizationState,
      credential,
      server,
    });
  });
}

export async function refreshRuntimeCredential(
  bindings: ApiBindings,
  credentialId: CredentialId | string,
): Promise<RefreshedRuntimeCredential> {
  const credential = await getCredentialById(bindings.DB, readCredentialId(credentialId));

  if (
    credential.authType !== "oauth" ||
    !isTruthy(credential.refreshSecretId) ||
    !isTruthy(credential.oauthClientId)
  ) {
    await expireCredential(bindings.DB, credential.id);
    throw new Error("This credential cannot be refreshed.");
  }

  const server = await getServerRow(bindings.DB, credential.serverId);

  if (server.authType !== "oauth") {
    await expireCredential(bindings.DB, credential.id);
    throw new Error("This MCP server does not use OAuth authentication.");
  }

  if (credential.appId !== server.appId) {
    await expireCredential(bindings.DB, credential.id);
    throw new Error("MCP credential is not available in this app.");
  }

  const metadata = await getOrDiscoverOAuthMetadata(bindings.DB, server);
  const refreshSecret = await readMcpCredentialSecret(bindings, {
    credential,
    purpose: "runtime_refresh_token",
    appId: server.appId,
    server,
  });

  if (refreshSecret.status === "denied") {
    await expireCredential(bindings.DB, credential.id);
    throw new Error(`MCP credential refresh token unavailable: ${refreshSecret.reason}.`);
  }

  const clientSecret = isTruthy(credential.oauthClientSecretSecretId)
    ? await readMcpCredentialSecret(bindings, {
        credential,
        purpose: "runtime_oauth_client_secret",
        appId: server.appId,
        server,
      })
    : null;

  if (clientSecret !== null && clientSecret.status === "denied") {
    await expireCredential(bindings.DB, credential.id);
    throw new Error(`MCP OAuth client secret unavailable: ${clientSecret.reason}.`);
  }

  const clientSecretValue = clientSecret === null ? null : clientSecret.value;

  try {
    const token = await exchangeOAuthToken({
      clientId: credential.oauthClientId,
      clientSecret: clientSecretValue,
      redirectUri: bindings.WEB_ORIGIN,
      refreshToken: refreshSecret.value,
      tokenEndpoint: metadata.token_endpoint,
    });
    const updated = await writeCredential(bindings.DB, bindings, {
      accessToken: token.access_token,
      agentId: credential.agentId,
      authType: "oauth",
      credentialId: credential.id,
      oauthClientId: credential.oauthClientId,
      oauthClientSecret: clientSecretValue,
      refreshToken: token.refresh_token ?? refreshSecret.value,
      scope: credential.scope,
      scopeValues: isTruthy(token.scope)
        ? token.scope.split(/\s+/).filter(Boolean)
        : decodeJsonArray(credential.scopeValuesJson),
      server,
      subjectLabel: credential.subjectLabel,
      tokenExpiresAt:
        typeof token.expires_in === "number"
          ? currentTimestampMs() + token.expires_in * 1000
          : null,
      ...(isTruthy(credential.userId) ? { userId: credential.userId } : {}),
    });

    return {
      credentialId: updated.id,
      expiresAt: isTruthy(updated.expiresAt) ? toIsoString(updated.expiresAt) : null,
      subjectLabel: updated.subjectLabel,
    };
  } catch (refreshError) {
    await expireCredential(bindings.DB, credential.id);
    throw refreshError;
  }
}

export async function invalidateRuntimeCredential(
  database: D1Database,
  credentialId: CredentialId | string,
): Promise<void> {
  await expireCredential(database, readCredentialId(credentialId));
}

export type { DriverResolvedMcpServer, RefreshedRuntimeCredential };
