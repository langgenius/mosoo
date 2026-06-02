import type {
  McpAuthType,
  McpCredentialRecordScope,
  McpCredentialScope,
  McpOAuthFlowStatus,
  McpServerSource,
} from "@mosoo/contracts/mcp";
import type {
  AccountId,
  AgentId,
  CredentialId,
  McpOAuthFlowId,
  McpServerId,
  OrganizationId,
  PlatformId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const vaultSecretsTable = sqliteTable(
  "vault_secret",
  {
    algorithm: text("algorithm").notNull().default("AES-GCM"),
    ciphertext: text("ciphertext").notNull(),
    ciphertextIv: text("ciphertext_iv").notNull(),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    kind: text("kind").notNull(),
    updatedAt: integer("updated_at").notNull(),
    wrappedDek: text("wrapped_dek").notNull(),
    wrappedDekIv: text("wrapped_dek_iv").notNull(),
  },
  (table) => [index("vault_secret_kind_created_at_idx").on(table.kind, table.createdAt)],
);

export const mcpServersTable = sqliteTable(
  "mcp_server",
  {
    authType: text("auth_type").$type<McpAuthType>().notNull(),
    byoClientId: text("byo_client_id"),
    byoClientSecretSecretId: text("byo_client_secret_secret_id"),
    createdAt: integer("created_at").notNull(),
    credentialScope: text("credential_scope").$type<McpCredentialScope>().notNull(),
    description: text("description"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    iconUrl: text("icon_url"),
    id: platformIdColumn<McpServerId>("id").primaryKey(),
    name: text("name").notNull(),
    oauthMetadataJson: text("oauth_metadata_json"),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    ownerId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    source: text("source").$type<McpServerSource>().notNull(),
    updatedAt: integer("updated_at").notNull(),
    url: text("url").notNull(),
  },
  (table) => [
    check(
      "mcp_server_source_scope_check",
      sql`
        (${table.source} = 'personal' AND ${table.credentialScope} = 'user')
        OR (
          ${table.source} = 'organization_shared'
          AND ${table.credentialScope} IN ('user', 'organization_shared')
        )
      `,
    ),
    check(
      "mcp_server_organization_shared_auth_check",
      sql`${table.credentialScope} != 'organization_shared' OR ${table.authType} = 'bearer'`,
    ),
    index("mcp_server_organization_source_enabled_idx").on(
      table.organizationId,
      table.source,
      table.enabled,
    ),
    index("mcp_server_owner_organization_idx").on(table.ownerId, table.organizationId),
    uniqueIndex("mcp_server_personal_url_idx")
      .on(table.organizationId, table.ownerId, table.url)
      .where(sql`${table.source} = 'personal'`),
    uniqueIndex("mcp_server_shared_url_idx")
      .on(table.organizationId, table.url)
      .where(sql`${table.source} = 'organization_shared'`),
  ],
);

export const mcpCredentialsTable = sqliteTable(
  "mcp_credential",
  {
    accountId: platformIdColumn<AccountId>("account_id"),
    agentId: platformIdColumn<AgentId>("agent_id"),
    authType: text("auth_type").$type<McpAuthType>().notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    id: platformIdColumn<CredentialId>("id").primaryKey(),
    lastRefreshedAt: integer("last_refreshed_at"),
    oauthClientId: text("oauth_client_id"),
    oauthClientSecretSecretId: text("oauth_client_secret_secret_id"),
    refreshSecretId: text("refresh_secret_id"),
    scope: text("scope").$type<McpCredentialRecordScope>().notNull(),
    scopeValuesJson: text("scope_values_json"),
    secretId: text("secret_id").notNull(),
    serverId: platformIdColumn<McpServerId>("server_id").notNull(),
    status: text("status").$type<"active" | "expired" | "revoked">().notNull(),
    subjectLabel: text("subject_label"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "mcp_credential_scope_shape_check",
      sql`
        (${table.scope} = 'user' AND ${table.accountId} IS NOT NULL AND ${table.agentId} IS NULL)
        OR (
          ${table.scope} = 'organization_shared'
          AND ${table.accountId} IS NULL
          AND ${table.agentId} IS NULL
        )
        OR (${table.scope} = 'agent' AND ${table.accountId} IS NULL AND ${table.agentId} IS NOT NULL)
      `,
    ),
    check(
      "mcp_credential_scope_values_json_check",
      sql`
        ${table.scopeValuesJson} IS NULL
        OR (json_valid(${table.scopeValuesJson}) AND json_type(${table.scopeValuesJson}) = 'array')
      `,
    ),
    index("mcp_credential_server_scope_status_idx").on(table.serverId, table.scope, table.status),
    uniqueIndex("mcp_credential_user_scope_idx")
      .on(table.serverId, table.accountId, table.scope)
      .where(sql`${table.scope} = 'user' AND ${table.accountId} IS NOT NULL`),
    uniqueIndex("mcp_credential_shared_scope_idx")
      .on(table.serverId, table.scope)
      .where(sql`${table.scope} = 'organization_shared'`),
    uniqueIndex("mcp_credential_agent_scope_idx")
      .on(table.serverId, table.agentId, table.scope)
      .where(sql`${table.scope} = 'agent' AND ${table.agentId} IS NOT NULL`),
    check(
      "mcp_credential_bearer_shape_check",
      sql`
      ${table.authType} != 'bearer'
      OR (
        ${table.oauthClientId} IS NULL
        AND ${table.oauthClientSecretSecretId} IS NULL
        AND ${table.refreshSecretId} IS NULL
      )
    `,
    ),
  ],
);

export const mcpOauthFlowsTable = sqliteTable(
  "mcp_oauth_flow",
  {
    authorizationEndpoint: text("authorization_endpoint").notNull(),
    cleanupAfter: integer("cleanup_after").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    errorMessage: text("error_message"),
    expiresAt: integer("expires_at").notNull(),
    id: platformIdColumn<McpOAuthFlowId>("id").primaryKey(),
    initiatorUserId: platformIdColumn<AccountId>("initiator_account_id").notNull(),
    oauthClientId: text("oauth_client_id").notNull(),
    oauthClientSecretSecretId: text("oauth_client_secret_secret_id"),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    registrationEndpoint: text("registration_endpoint"),
    returnUrl: text("return_url"),
    scopeValuesJson: text("scope_values_json"),
    serverId: platformIdColumn<McpServerId>("server_id").notNull(),
    status: text("status").$type<McpOAuthFlowStatus>().notNull(),
    subjectLabel: text("subject_label"),
    tokenEndpoint: text("token_endpoint").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "mcp_oauth_flow_scope_values_json_check",
      sql`
        ${table.scopeValuesJson} IS NULL
        OR (json_valid(${table.scopeValuesJson}) AND json_type(${table.scopeValuesJson}) = 'array')
      `,
    ),
    index("mcp_oauth_flow_status_cleanup_after_idx").on(table.status, table.cleanupAfter),
    index("mcp_oauth_flow_expires_at_idx").on(table.expiresAt),
    index("mcp_oauth_flow_server_account_idx").on(table.serverId, table.initiatorUserId),
  ],
);

export type McpCredentialRow = typeof mcpCredentialsTable.$inferSelect;
export type McpOauthFlowRow = typeof mcpOauthFlowsTable.$inferSelect;
export type McpServerRow = typeof mcpServersTable.$inferSelect;
export type VaultSecretRow = typeof vaultSecretsTable.$inferSelect;
