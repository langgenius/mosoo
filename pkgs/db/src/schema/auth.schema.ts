import type { AccountId, CliOAuthFlowId, PersonalAccessTokenId } from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

type CliOAuthFlowStatus = "pending" | "authorized" | "consumed" | "denied" | "expired";

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

export const cliOAuthFlowsTable = sqliteTable(
  "cli_oauth_flow",
  {
    accountId: platformIdColumn<AccountId>("account_id"),
    authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    deviceCodeHash: text("device_code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    hostname: text("hostname"),
    id: platformIdColumn<CliOAuthFlowId>("id").primaryKey(),
    provider: text("provider").notNull(),
    status: text("status").$type<CliOAuthFlowStatus>().notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    userCode: text("user_code").notNull(),
  },
  (table) => [
    index("cli_oauth_flow_status_expires_idx").on(table.status, table.expiresAt),
    uniqueIndex("cli_oauth_flow_device_code_hash_idx").on(table.deviceCodeHash),
    uniqueIndex("cli_oauth_flow_user_code_idx").on(table.userCode),
  ],
);

export type CliOAuthFlowRow = typeof cliOAuthFlowsTable.$inferSelect;
