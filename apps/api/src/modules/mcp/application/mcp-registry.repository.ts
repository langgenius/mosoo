import { accountsTable, mcpCredentialsTable, mcpServersTable, projectsTable } from "@mosoo/db";
import type { AccountId, AgentId, CredentialId, McpServerId, ProjectId } from "@mosoo/id";
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
  projectId: ProjectId;
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
  credentialProjectId: ProjectId | null;
  credentialRefreshSecretId: string | null;
  credentialScope: CredentialRow["scope"] | null;
  credentialScopeValuesJson: string | null;
  credentialSecretId: string | null;
  credentialServerId: McpServerId | null;
  credentialStatus: CredentialRow["status"] | null;
  credentialSubjectLabel: string | null;
  credentialUpdatedAt: number | null;
  credentialUserId: AccountId | null;
  projectId: ProjectId;
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
  serverOwnerId: AccountId | null;
  serverOwnerName: string | null;
  serverProjectId: ProjectId | null;
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
    ownerId: requireRegistryValue(row.serverOwnerId, "server_owner_id"),
    ownerName: row.serverOwnerName,
    projectId: requireRegistryValue(row.serverProjectId, "server_project_id"),
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
    projectId: requireRegistryValue(row.credentialProjectId, "credential_project_id"),
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

function hasActiveProjectCredential(credential: CredentialRow | null): boolean {
  return credential?.scope === "app" && credential.status === "active";
}

function toMcpRegistrySnapshot(rows: McpRegistrySnapshotRow[]): McpRegistrySnapshot {
  const firstRow = rows[0] ?? null;

  if (firstRow === null) {
    throw new Error("Project not found.");
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
      hasCredential: hasActiveProjectCredential(credential),
      server,
    });
  }

  return {
    currentUserEmail: firstRow.viewerEmail,
    currentUserName: firstRow.viewerName,
    projectId: firstRow.projectId,
    servers,
  };
}

export async function loadMcpRegistrySnapshot(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
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
      credentialProjectId: mcpCredentialsTable.projectId,
      credentialRefreshSecretId: mcpCredentialsTable.refreshSecretId,
      credentialScope: mcpCredentialsTable.scope,
      credentialScopeValuesJson: mcpCredentialsTable.scopeValuesJson,
      credentialSecretId: mcpCredentialsTable.secretId,
      credentialServerId: mcpCredentialsTable.serverId,
      credentialStatus: mcpCredentialsTable.status,
      credentialSubjectLabel: mcpCredentialsTable.subjectLabel,
      credentialUpdatedAt: mcpCredentialsTable.updatedAt,
      credentialUserId: mcpCredentialsTable.accountId,
      projectId: projectsTable.id,
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
      serverOwnerId: mcpServersTable.ownerId,
      serverOwnerName: registryOwnerAccountsTable.name,
      serverProjectId: mcpServersTable.projectId,
      serverSource: mcpServersTable.source,
      serverUpdatedAt: mcpServersTable.updatedAt,
      serverUrl: mcpServersTable.url,
      viewerEmail: registryViewerAccountsTable.email,
      viewerName: registryViewerAccountsTable.name,
    })
    .from(projectsTable)
    .leftJoin(registryViewerAccountsTable, eq(registryViewerAccountsTable.id, viewerId))
    .leftJoin(
      mcpServersTable,
      and(eq(mcpServersTable.projectId, projectsTable.id), eq(mcpServersTable.ownerId, viewerId)),
    )
    .leftJoin(
      registryOwnerAccountsTable,
      eq(registryOwnerAccountsTable.id, mcpServersTable.ownerId),
    )
    .leftJoin(
      mcpCredentialsTable,
      and(
        eq(mcpCredentialsTable.serverId, mcpServersTable.id),
        eq(mcpCredentialsTable.projectId, projectsTable.id),
        eq(mcpCredentialsTable.scope, "app"),
      ),
    )
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.ownerAccountId, viewerId)))
    .orderBy(desc(mcpServersTable.updatedAt))
    .all();

  return toMcpRegistrySnapshot(rows);
}
