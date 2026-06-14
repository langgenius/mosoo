import { accountsTable, mcpCredentialsTable, mcpServersTable, appsTable } from "@mosoo/db";
import type { AccountId, AgentId, CredentialId, McpServerId, AppId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { CredentialRow, ServerRow } from "./mcp-types";

const registryViewerAccountsTable = alias(accountsTable, "mcp_registry_viewer_account");
const registryOwnerAccountsTable = alias(accountsTable, "mcp_registry_owner_account");

export interface McpRegistryServerSnapshot {
  credential: CredentialRow | null;
  hasCredential: boolean;
  server: ServerRow;
}

export interface McpRegistrySnapshot {
  currentUserEmail: string | null;
  currentUserName: string | null;
  appId: AppId;
  servers: McpRegistryServerSnapshot[];
}

interface McpRegistrySnapshotRow {
  credentialAgentId: AgentId | null;
  credentialAuthType: CredentialRow["authType"] | null;
  credentialCreatedAt: number | null;
  credentialExpiresAt: number | null;
  credentialId: CredentialId | null;
  credentialLastRefreshedAt: number | null;
  credentialOauthClientId: string | null;
  credentialOauthClientSecretSecretId: string | null;
  credentialAppId: AppId | null;
  credentialRefreshSecretId: string | null;
  credentialScope: CredentialRow["scope"] | null;
  credentialScopeValuesJson: string | null;
  credentialSecretId: string | null;
  credentialServerId: McpServerId | null;
  credentialStatus: CredentialRow["status"] | null;
  credentialSubjectLabel: string | null;
  credentialUpdatedAt: number | null;
  credentialUserId: AccountId | null;
  appId: AppId;
  serverAuthType: ServerRow["authType"] | null;
  serverByoClientId: string | null;
  serverByoClientSecretSecretId: string | null;
  serverCreatedAt: number | null;
  serverCredentialScope: ServerRow["credentialScope"] | null;
  serverDescription: string | null;
  serverEnabled: boolean | number | string | null;
  serverIconUrl: string | null;
  serverId: McpServerId | null;
  serverName: string | null;
  serverOauthMetadataJson: string | null;
  serverOrganizationId: ServerRow["organizationId"] | null;
  serverOwnerId: AccountId | null;
  serverOwnerName: string | null;
  serverAppId: AppId | null;
  serverSource: ServerRow["source"] | null;
  serverUpdatedAt: number | null;
  serverUrl: string | null;
  viewerEmail: string | null;
  viewerName: string | null;
}

function requireRegistryValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw new Error(`MCP registry row is missing ${fieldName}.`);
  }

  return value;
}

function toRegistryServerRow(row: McpRegistrySnapshotRow): ServerRow | null {
  if (row.serverId === null) {
    return null;
  }

  return {
    authType: requireRegistryValue(row.serverAuthType, "server_auth_type"),
    byoClientId: row.serverByoClientId,
    byoClientSecretSecretId: row.serverByoClientSecretSecretId,
    createdAt: requireRegistryValue(row.serverCreatedAt, "server_created_at"),
    credentialScope: requireRegistryValue(row.serverCredentialScope, "server_credential_scope"),
    description: row.serverDescription,
    enabled:
      row.serverEnabled === true || row.serverEnabled === 1 || row.serverEnabled === "1" ? 1 : 0,
    iconUrl: row.serverIconUrl,
    id: row.serverId,
    name: requireRegistryValue(row.serverName, "server_name"),
    oauthMetadataJson: row.serverOauthMetadataJson,
    organizationId: requireRegistryValue(row.serverOrganizationId, "server_organization_id"),
    ownerId: requireRegistryValue(row.serverOwnerId, "server_owner_id"),
    ownerName: row.serverOwnerName,
    appId: requireRegistryValue(row.serverAppId, "server_app_id"),
    source: requireRegistryValue(row.serverSource, "server_source"),
    updatedAt: requireRegistryValue(row.serverUpdatedAt, "server_updated_at"),
    url: requireRegistryValue(row.serverUrl, "server_url"),
  };
}

function toRegistryCredentialRow(row: McpRegistrySnapshotRow): CredentialRow | null {
  if (row.credentialId === null) {
    return null;
  }

  return {
    agentId: row.credentialAgentId,
    authType: requireRegistryValue(row.credentialAuthType, "credential_auth_type"),
    createdAt: requireRegistryValue(row.credentialCreatedAt, "credential_created_at"),
    expiresAt: row.credentialExpiresAt,
    id: row.credentialId,
    lastRefreshedAt: row.credentialLastRefreshedAt,
    oauthClientId: row.credentialOauthClientId,
    oauthClientSecretSecretId: row.credentialOauthClientSecretSecretId,
    appId: requireRegistryValue(row.credentialAppId, "credential_app_id"),
    refreshSecretId: row.credentialRefreshSecretId,
    scope: requireRegistryValue(row.credentialScope, "credential_scope"),
    scopeValuesJson: row.credentialScopeValuesJson,
    secretId: requireRegistryValue(row.credentialSecretId, "credential_secret_id"),
    serverId: requireRegistryValue(row.credentialServerId, "credential_server_id"),
    status: requireRegistryValue(row.credentialStatus, "credential_status"),
    subjectLabel: row.credentialSubjectLabel,
    updatedAt: requireRegistryValue(row.credentialUpdatedAt, "credential_updated_at"),
    userId: row.credentialUserId,
  };
}

function hasActiveAppCredential(credential: CredentialRow | null): boolean {
  return credential?.scope === "app" && credential.status === "active";
}

function toMcpRegistrySnapshot(rows: McpRegistrySnapshotRow[]): McpRegistrySnapshot {
  const firstRow = rows[0] ?? null;

  if (firstRow === null) {
    throw new Error("App not found.");
  }

  const servers: McpRegistryServerSnapshot[] = [];

  for (const row of rows) {
    const server = toRegistryServerRow(row);

    if (server === null) {
      continue;
    }

    const credential = toRegistryCredentialRow(row);

    servers.push({
      credential,
      hasCredential: hasActiveAppCredential(credential),
      server,
    });
  }

  return {
    currentUserEmail: firstRow.viewerEmail,
    currentUserName: firstRow.viewerName,
    appId: firstRow.appId,
    servers,
  };
}

export async function loadMcpRegistrySnapshot(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
): Promise<McpRegistrySnapshot> {
  const rows = await getAppDatabase(database)
    .select({
      credentialAgentId: mcpCredentialsTable.agentId,
      credentialAuthType: mcpCredentialsTable.authType,
      credentialCreatedAt: mcpCredentialsTable.createdAt,
      credentialExpiresAt: mcpCredentialsTable.expiresAt,
      credentialId: mcpCredentialsTable.id,
      credentialLastRefreshedAt: mcpCredentialsTable.lastRefreshedAt,
      credentialOauthClientId: mcpCredentialsTable.oauthClientId,
      credentialOauthClientSecretSecretId: mcpCredentialsTable.oauthClientSecretSecretId,
      credentialAppId: mcpCredentialsTable.appId,
      credentialRefreshSecretId: mcpCredentialsTable.refreshSecretId,
      credentialScope: mcpCredentialsTable.scope,
      credentialScopeValuesJson: mcpCredentialsTable.scopeValuesJson,
      credentialSecretId: mcpCredentialsTable.secretId,
      credentialServerId: mcpCredentialsTable.serverId,
      credentialStatus: mcpCredentialsTable.status,
      credentialSubjectLabel: mcpCredentialsTable.subjectLabel,
      credentialUpdatedAt: mcpCredentialsTable.updatedAt,
      credentialUserId: mcpCredentialsTable.accountId,
      appId: appsTable.id,
      serverAuthType: mcpServersTable.authType,
      serverByoClientId: mcpServersTable.byoClientId,
      serverByoClientSecretSecretId: mcpServersTable.byoClientSecretSecretId,
      serverCreatedAt: mcpServersTable.createdAt,
      serverCredentialScope: mcpServersTable.credentialScope,
      serverDescription: mcpServersTable.description,
      serverEnabled: mcpServersTable.enabled,
      serverIconUrl: mcpServersTable.iconUrl,
      serverId: mcpServersTable.id,
      serverName: mcpServersTable.name,
      serverOauthMetadataJson: mcpServersTable.oauthMetadataJson,
      serverOrganizationId: mcpServersTable.organizationId,
      serverOwnerId: mcpServersTable.ownerId,
      serverOwnerName: registryOwnerAccountsTable.name,
      serverAppId: mcpServersTable.appId,
      serverSource: mcpServersTable.source,
      serverUpdatedAt: mcpServersTable.updatedAt,
      serverUrl: mcpServersTable.url,
      viewerEmail: registryViewerAccountsTable.email,
      viewerName: registryViewerAccountsTable.name,
    })
    .from(appsTable)
    .leftJoin(registryViewerAccountsTable, eq(registryViewerAccountsTable.id, viewerId))
    .leftJoin(
      mcpServersTable,
      and(eq(mcpServersTable.appId, appsTable.id), eq(mcpServersTable.ownerId, viewerId)),
    )
    .leftJoin(
      registryOwnerAccountsTable,
      eq(registryOwnerAccountsTable.id, mcpServersTable.ownerId),
    )
    .leftJoin(
      mcpCredentialsTable,
      and(
        eq(mcpCredentialsTable.serverId, mcpServersTable.id),
        eq(mcpCredentialsTable.appId, appsTable.id),
        eq(mcpCredentialsTable.scope, "app"),
      ),
    )
    .where(and(eq(appsTable.id, appId), eq(appsTable.ownerAccountId, viewerId)))
    .orderBy(desc(mcpServersTable.updatedAt))
    .all();

  return toMcpRegistrySnapshot(rows);
}
