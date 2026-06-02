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
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureOrganizationMembership,
  ensureOrganizationPermission,
} from "../../organizations/domain/organization-access.policy";
import { listServerBindingArtifacts } from "./mcp-agent-binding.repository";
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
  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.mcpBindingCreate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      authType: server.authType,
      credentialScope: server.credentialScope,
      source: server.source,
    },
    organizationId: server.organizationId,
    outcome: "success",
    resourceDisplay: server.name,
    resourceId: server.id,
    resourceType: AUDIT_RESOURCE.mcpBinding,
  });
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

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.mcpBindingCreate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      authType: server.authType,
      credentialScope: server.credentialScope,
      source: server.source,
    },
    organizationId: server.organizationId,
    outcome: "success",
    resourceDisplay: server.name,
    resourceId: server.id,
    resourceType: AUDIT_RESOURCE.mcpBinding,
  });

  if (credential) {
    await appendAuditEvent(bindings.DB, {
      action: AUDIT_ACTION.credentialCreate,
      ...resolveViewerAuditActor(viewer),
      metadata: {
        kind: "mcp_organization_shared_bearer",
        serverId: server.id,
        status: credential.status,
      },
      organizationId: server.organizationId,
      outcome: "success",
      resourceDisplay: server.name,
      resourceId: credential.id,
      resourceType: AUDIT_RESOURCE.credential,
    });
  }

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
  await appendAuditEvent(database, {
    action: AUDIT_ACTION.mcpBindingUpdate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      enabled: Boolean(server.enabled),
      kind: "mcp_server_enabled",
    },
    organizationId: server.organizationId,
    outcome: "success",
    resourceDisplay: server.name,
    resourceId: server.id,
    resourceType: AUDIT_RESOURCE.mcpBinding,
  });
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
  const [bindingRows, credentialRows, oauthFlowRows] = await Promise.all([
    listServerBindingArtifacts(database, serverId),
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

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.mcpBindingDelete,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      ...(bindingRows.length > 0
        ? { cascadeDeletedMcpBindingIds: bindingRows.map((row) => row.id).join(", ") }
        : {}),
      ...(credentialRows.length > 0
        ? { cascadeDeletedCredentialIds: credentialRows.map((row) => row.id).join(", ") }
        : {}),
      owner_at_time_id: server.ownerId,
      ...(server.ownerId !== readAccountId(viewer.id) ? { override: "organization_admin" } : {}),
    },
    organizationId: server.organizationId,
    outcome: "success",
    resourceDisplay: server.name,
    resourceId: server.id,
    resourceType: AUDIT_RESOURCE.mcpBinding,
  });
}
