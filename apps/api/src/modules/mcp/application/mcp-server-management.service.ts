import type {
  CreateOrganizationMcpServerInput,
  CreatePersonalMcpServerInput,
  McpServerWithCredential,
} from "@mosoo/contracts/mcp";
import { Permission } from "@mosoo/contracts/permission";
import { agentMcpBindingsTable, mcpServersTable } from "@mosoo/db";
import type { McpServerId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureOrganizationMembership,
  ensureOrganizationPermission,
} from "../../organizations/domain/organization-access.policy";
import {
  deleteCredentialArtifactsBatch,
  getSharedCredentialRow,
  hasSharedCredential,
  listCredentialRowsByServerId,
  resolveRegistryCredential,
  writeCredential,
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
export async function createPersonalMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreatePersonalMcpServerInput,
): Promise<McpServerWithCredential> {
  const viewerId = readAccountId(viewer.id);
  const membership = await ensureOrganizationMembership(
    bindings.DB,
    viewerId,
    input.organizationId,
  );
  const now = currentTimestampMs();
  const serverId = createMcpServerId();
  const serverOwner = {
    authType: input.authType,
    credentialScope: "user" as const,
    id: serverId,
    organizationId: input.organizationId,
    ownerId: viewerId,
    source: "personal" as const,
  };
  const actor = {
    accountId: viewerId,
    organizationRole: membership.role,
    type: "user" as const,
  };
  const byoClientSecretSecretId =
    input.authType === "oauth" &&
    input.oauthClientSecret !== null &&
    input.oauthClientSecret !== undefined
      ? await storeMcpOAuthServerClientSecret(bindings, {
          actor,
          organizationId: input.organizationId,
          purpose: "oauth_server_create_client_secret",
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
        credentialScope: "user",
        description: input.description ?? null,
        enabled: true,
        iconUrl: input.iconUrl ?? null,
        id: serverId,
        name: input.name,
        organizationId: input.organizationId,
        ownerId: viewerId,
        source: "personal",
        updatedAt: now,
        url: parseHttpsUrl(input.url),
      })
      .run();
  } catch (error) {
    await cleanupStoredMcpOAuthServerClientSecret({
      command: {
        actor,
        organizationId: input.organizationId,
        purpose: "oauth_server_create_cleanup",
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

export async function createOrganizationMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateOrganizationMcpServerInput,
): Promise<McpServerWithCredential> {
  const viewerId = readAccountId(viewer.id);
  const membership = await ensureOrganizationPermission(
    bindings.DB,
    viewerId,
    input.organizationId,
    Permission.McpOrganizationManage,
  );

  if (input.credentialScope === "organization_shared" && input.authType !== "bearer") {
    throw new Error("Organization shared MCP servers only support bearer authentication.");
  }

  const now = currentTimestampMs();
  const serverId = createMcpServerId();
  const serverOwner = {
    authType: input.authType,
    credentialScope: input.credentialScope,
    id: serverId,
    organizationId: input.organizationId,
    ownerId: viewerId,
    source: "organization_shared" as const,
  };
  const actor = {
    accountId: viewerId,
    organizationRole: membership.role,
    type: "user" as const,
  };
  const byoClientSecretSecretId =
    input.authType === "oauth" &&
    input.oauthClientSecret !== null &&
    input.oauthClientSecret !== undefined
      ? await storeMcpOAuthServerClientSecret(bindings, {
          actor,
          organizationId: input.organizationId,
          purpose: "oauth_server_create_client_secret",
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
        credentialScope: input.credentialScope,
        description: input.description ?? null,
        enabled: true,
        iconUrl: input.iconUrl ?? null,
        id: serverId,
        name: input.name,
        organizationId: input.organizationId,
        ownerId: viewerId,
        source: "organization_shared",
        updatedAt: now,
        url: parseHttpsUrl(input.url),
      })
      .run();
  } catch (error) {
    await cleanupStoredMcpOAuthServerClientSecret({
      command: {
        actor,
        organizationId: input.organizationId,
        purpose: "oauth_server_create_cleanup",
        secretId: byoClientSecretSecretId,
        secretKind: "server_client_secret",
        server: serverOwner,
      },
      database: bindings.DB,
    });
    throw error;
  }

  const server = await getServerRow(bindings.DB, serverId);

  if (
    input.sharedBearerToken !== null &&
    input.sharedBearerToken !== undefined &&
    input.authType === "bearer" &&
    input.credentialScope === "organization_shared"
  ) {
    await writeCredential(bindings.DB, bindings, {
      accessToken: input.sharedBearerToken,
      authType: "bearer",
      scope: "organization_shared",
      scopeValues: [],
      server,
      subjectLabel: null,
    });
  }

  const credential =
    server.credentialScope === "organization_shared"
      ? await getSharedCredentialRow(bindings.DB, server.id)
      : null;

  return toServerWithCredential(
    server,
    credential,
    await hasSharedCredential(bindings.DB, server.id),
  );
}

export async function setMcpServerEnabled(
  database: D1Database,
  viewer: AuthenticatedViewer,
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  await ensureServerManageAccess(database, viewer, serverId);
  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({ enabled, updatedAt: currentTimestampMs() })
    .where(eq(mcpServersTable.id, serverId))
    .run();

  const server = await getServerRow(database, serverId);
  const [credential, shared] = await Promise.all([
    resolveRegistryCredential(database, server, viewer.id),
    hasSharedCredential(database, server.id),
  ]);

  return toServerWithCredential(server, credential, shared);
}

export async function deleteMcpServer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  serverId: McpServerId,
): Promise<void> {
  const { membership, server } = await ensureServerManageAccess(database, viewer, serverId);
  const [credentialRows, oauthFlowRows] = await Promise.all([
    listCredentialRowsByServerId(database, serverId),
    listOAuthFlowRowsByServerId(database, serverId),
  ]);

  await deleteCredentialArtifactsBatch(database, credentialRows);
  const serverSecretDelete = await deleteMcpOAuthServerClientSecret(database, {
    actor: {
      accountId: readAccountId(viewer.id),
      organizationRole: membership.role,
      type: "user",
    },
    organizationId: server.organizationId,
    purpose: "oauth_server_delete_cleanup",
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
