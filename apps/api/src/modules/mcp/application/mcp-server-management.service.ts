import type { CreateAppMcpServerInput, McpServerWithCredential } from "@mosoo/contracts/mcp";
import { agentMcpBindingsTable, mcpServersTable } from "@mosoo/db";
import type { McpServerId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  deleteCredentialArtifactsBatch,
  hasAppCredential,
  listCredentialRowsByServerId,
  resolveRegistryCredential,
} from "./mcp-credential.repository";
import { parseHttpsUrl, toServerWithCredential } from "./mcp-mappers";
import {
  destroyOAuthFlowArtifactsBatch,
  listOAuthFlowRowsByServerId,
} from "./mcp-oauth-flow.repository";
import {
  cleanupStoredMcpOAuthServerClientSecret,
  deleteMcpOAuthServerClientSecret,
  storeMcpOAuthServerClientSecret,
} from "./mcp-oauth-secret-resolution";
import { createMcpServerId, readAccountId } from "./mcp-platform-ids";
import { ensureServerManageAccess, getServerRow } from "./mcp-server.repository";
export async function createAppMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateAppMcpServerInput,
): Promise<McpServerWithCredential> {
  const viewerId = readAccountId(viewer.id);
  await ensureAppOwnership(bindings.DB, viewerId, input.appId);
  const now = currentTimestampMs();
  const serverId = createMcpServerId();
  const serverOwner = {
    authType: input.authType,
    credentialScope: "app" as const,
    id: serverId,
    ownerId: viewerId,
    appId: input.appId,
    source: "app" as const,
  };
  const actor = {
    accountId: viewerId,
    type: "user" as const,
  };
  const byoClientSecretSecretId =
    input.authType === "oauth" &&
    input.oauthClientSecret !== null &&
    input.oauthClientSecret !== undefined
      ? await storeMcpOAuthServerClientSecret(bindings, {
          actor,
          purpose: "oauth_server_create_client_secret",
          appId: input.appId,
          secretKind: "server_client_secret",
          server: serverOwner,
          value: input.oauthClientSecret,
        })
      : null;

  try {
    await getAppDatabase(bindings.DB)
      .insert(mcpServersTable)
      .values({
        authType: input.authType,
        byoClientId: input.oauthClientId ?? null,
        byoClientSecretSecretId,
        createdAt: now,
        credentialScope: "app",
        description: input.description ?? null,
        enabled: true,
        iconUrl: input.iconUrl ?? null,
        id: serverId,
        name: input.name,
        ownerId: viewerId,
        appId: input.appId,
        source: "app",
        updatedAt: now,
        url: parseHttpsUrl(input.url),
      })
      .run();
  } catch (error) {
    await cleanupStoredMcpOAuthServerClientSecret({
      command: {
        actor,
        purpose: "oauth_server_create_cleanup",
        appId: input.appId,
        secretId: byoClientSecretSecretId,
        secretKind: "server_client_secret",
        server: serverOwner,
      },
      database: bindings.DB,
    });
    throw error;
  }

  const server = await getServerRow(bindings.DB, serverId);
  return toServerWithCredential(server, null, false);
}

export async function setMcpServerEnabled(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  await ensureServerManageAccess(database, viewer, appId, serverId);
  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({ enabled, updatedAt: currentTimestampMs() })
    .where(eq(mcpServersTable.id, serverId))
    .run();

  const server = await getServerRow(database, serverId);
  const [credential, hasCredential] = await Promise.all([
    resolveRegistryCredential(database, server),
    hasAppCredential(database, server.id),
  ]);

  return toServerWithCredential(server, credential, hasCredential);
}

export async function deleteMcpServer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
  serverId: McpServerId,
): Promise<void> {
  const { server } = await ensureServerManageAccess(database, viewer, appId, serverId);
  const [credentialRows, oauthFlowRows] = await Promise.all([
    listCredentialRowsByServerId(database, serverId),
    listOAuthFlowRowsByServerId(database, serverId),
  ]);

  await deleteCredentialArtifactsBatch(database, credentialRows);
  const serverSecretDelete = await deleteMcpOAuthServerClientSecret(database, {
    actor: {
      accountId: readAccountId(viewer.id),
      type: "user",
    },
    purpose: "oauth_server_delete_cleanup",
    appId,
    secretId: server.byoClientSecretSecretId,
    secretKind: "server_client_secret",
    server,
  });

  if (serverSecretDelete.status === "denied") {
    throw new Error(`MCP OAuth server client secret cleanup denied: ${serverSecretDelete.reason}.`);
  }

  await destroyOAuthFlowArtifactsBatch(database, oauthFlowRows, {
    name: "mcp_oauth_server_delete_cascade",
    type: "system",
  });

  await getAppDatabase(database)
    .delete(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.serverId, serverId))
    .run();
  await getAppDatabase(database)
    .delete(mcpServersTable)
    .where(eq(mcpServersTable.id, serverId))
    .run();
}
