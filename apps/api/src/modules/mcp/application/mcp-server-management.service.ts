import type {
  CreateProjectMcpServerInput,
  McpServerWithCredential,
  UpdateProjectMcpServerInput,
} from "@mosoo/contracts/mcp";
import { agentMcpBindingsTable, mcpServersTable } from "@mosoo/db";
import type { McpServerId, ProjectId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import {
  deleteCredentialArtifactsBatch,
  getProjectCredentialRow,
  hasProjectCredential,
  listCredentialRowsByServerId,
  resolveRegistryCredential,
  revokeCredential,
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
export async function createProjectMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateProjectMcpServerInput,
): Promise<McpServerWithCredential> {
  const viewerId = readAccountId(viewer.id);
  await ensureProjectOwnership(bindings.DB, viewerId, input.projectId);
  const now = currentTimestampMs();
  const serverId = createMcpServerId();
  const serverOwner = {
    authType: input.authType,
    credentialScope: "app" as const,
    id: serverId,
    ownerId: viewerId,
    projectId: input.projectId,
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
          projectId: input.projectId,
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
        projectId: input.projectId,
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
        projectId: input.projectId,
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

export async function updateProjectMcpServer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateProjectMcpServerInput,
): Promise<McpServerWithCredential> {
  const { server: existing } = await ensureServerManageAccess(
    database,
    viewer,
    input.projectId,
    input.serverId,
  );
  const nextUrl = parseHttpsUrl(input.url);
  // A stored credential is bound to the previous endpoint, so a URL change
  // revokes it and drops cached OAuth discovery metadata for re-discovery.
  const urlChanged = nextUrl !== existing.url;

  if (urlChanged) {
    await revokeCredential(database, await getProjectCredentialRow(database, existing.id));
  }

  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({
      description: input.description ?? null,
      iconUrl: input.iconUrl ?? null,
      name: input.name,
      updatedAt: currentTimestampMs(),
      url: nextUrl,
      ...(urlChanged && { oauthMetadataJson: null }),
    })
    .where(eq(mcpServersTable.id, input.serverId))
    .run();

  const server = await getServerRow(database, input.serverId);
  const [credential, hasCredential] = await Promise.all([
    resolveRegistryCredential(database, server),
    hasProjectCredential(database, server.id),
  ]);

  return toServerWithCredential(server, credential, hasCredential);
}

export async function setMcpServerEnabled(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  await ensureServerManageAccess(database, viewer, projectId, serverId);
  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({ enabled, updatedAt: currentTimestampMs() })
    .where(eq(mcpServersTable.id, serverId))
    .run();

  const server = await getServerRow(database, serverId);
  const [credential, hasCredential] = await Promise.all([
    resolveRegistryCredential(database, server),
    hasProjectCredential(database, server.id),
  ]);

  return toServerWithCredential(server, credential, hasCredential);
}

export async function deleteMcpServer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
): Promise<void> {
  const { server } = await ensureServerManageAccess(database, viewer, projectId, serverId);
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
    projectId,
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
