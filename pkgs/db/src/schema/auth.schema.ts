import type {
  AccountId,
  AgentId,
  OrganizationId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
} from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const authSessionsTable = sqliteTable(
  "auth_session",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    userAgent: text("user_agent"),
    userId: platformIdColumn<AccountId>("account_id").notNull(),
  },
  (table) => [
    index("auth_session_expires_at_idx").on(table.expiresAt),
    uniqueIndex("auth_session_token_idx").on(table.token),
    index("auth_session_account_id_idx").on(table.userId),
  ],
);

export const authAccountsTable = sqliteTable(
  "auth_account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    accountId: text("provider_account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    userId: platformIdColumn<AccountId>("account_id").notNull(),
  },
  (table) => [
    uniqueIndex("auth_account_provider_account_idx").on(table.providerId, table.accountId),
    index("auth_account_account_id_idx").on(table.userId),
  ],
);

export const authVerificationsTable = sqliteTable(
  "auth_verification",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    index("auth_verification_expires_at_idx").on(table.expiresAt),
    index("auth_verification_identifier_idx").on(table.identifier),
  ],
);

export type AuthAccountRow = typeof authAccountsTable.$inferSelect;
export type AuthSessionRow = typeof authSessionsTable.$inferSelect;
export type AuthVerificationRow = typeof authVerificationsTable.$inferSelect;

export const personalAccessTokensTable = sqliteTable(
  "personal_access_token",
  {
    accountId: platformIdColumn<AccountId>("account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: platformIdColumn<PersonalAccessTokenId>("id").primaryKey(),
    label: text("label").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    tokenHash: text("token_hash").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("personal_access_token_account_created_idx").on(table.accountId, table.createdAt),
    uniqueIndex("personal_access_token_hash_idx").on(table.tokenHash),
  ],
);

export type PersonalAccessTokenRow = typeof personalAccessTokensTable.$inferSelect;

export const organizationServiceTokensTable = sqliteTable(
  "organization_service_token",
  {
    allowAttribution: integer("allow_attribution", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    id: platformIdColumn<OrganizationServiceTokenId>("id").primaryKey(),
    label: text("label").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    tokenHash: text("token_hash").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("organization_service_token_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    uniqueIndex("organization_service_token_hash_idx").on(table.tokenHash),
  ],
);

export const organizationServiceTokenAgentsTable = sqliteTable(
  "organization_service_token_agent",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    tokenId: platformIdColumn<OrganizationServiceTokenId>("token_id").notNull(),
  },
  (table) => [
    index("organization_service_token_agent_agent_idx").on(table.organizationId, table.agentId),
    uniqueIndex("organization_service_token_agent_token_agent_idx").on(
      table.tokenId,
      table.agentId,
    ),
  ],
);

export type OrganizationServiceTokenAgentRow =
  typeof organizationServiceTokenAgentsTable.$inferSelect;
export type OrganizationServiceTokenRow = typeof organizationServiceTokensTable.$inferSelect;
