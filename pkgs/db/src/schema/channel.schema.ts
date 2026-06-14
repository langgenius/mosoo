import type { AgentChannelBindingProvider } from "@mosoo/contracts/channel";
import type {
  AccountId,
  AgentId,
  ChannelBindingId,
  PlatformId,
  AppId,
  SemanticPlatformId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { agentsTable } from "./agent.schema";
import { appsTable } from "./app.schema";
import { platformIdColumn } from "./id-column";
import { vaultSecretsTable } from "./mcp.schema";
import { sessionsTable } from "./session/core.schema";
import { sessionRunsTable } from "./session/runs.schema";
import { accountsTable } from "./user.schema";

export type { AgentChannelBindingProvider } from "@mosoo/contracts/channel";

export type ChannelConnectionStateId = SemanticPlatformId<"ChannelConnectionStateId">;
export type ChannelEventReceiptId = SemanticPlatformId<"ChannelEventReceiptId">;
export type ChannelFinalDeliveryJobId = SemanticPlatformId<"ChannelFinalDeliveryJobId">;
export type ChannelThreadSessionId = SemanticPlatformId<"ChannelThreadSessionId">;
export type WeChatChannelPairingId = SemanticPlatformId<"WeChatChannelPairingId">;
export type WeChatContextTokenId = SemanticPlatformId<"WeChatContextTokenId">;

export type AgentChannelBindingStatus = "active" | "error";
export type ChannelFinalDeliveryJobStatus = "delivered" | "dispatched" | "failed";
export type ChannelConnectionStateStatus =
  | "failed"
  | "idle"
  | "reconnecting"
  | "relogin_required"
  | "running"
  | "stale"
  | "starting"
  | "stopped";
export type WeChatChannelAccountStatus = ChannelConnectionStateStatus;

export const agentChannelBindingsTable = sqliteTable(
  "agent_channel_binding",
  {
    agentId: platformIdColumn<AgentId>("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    displayMetadataJson: text("display_metadata_json").notNull().default("{}"),
    encryptedCredsSecretId: platformIdColumn<PlatformId>("encrypted_creds_secret_id")
      .notNull()
      .references(() => vaultSecretsTable.id, { onDelete: "restrict" }),
    externalBotId: text("external_bot_id").notNull(),
    externalTenantId: text("external_tenant_id").notNull(),
    id: platformIdColumn<ChannelBindingId>("id").primaryKey(),
    lastErrorCode: text("last_error_code"),
    provider: text("provider").$type<AgentChannelBindingProvider>().notNull(),
    appId: platformIdColumn<AppId>("app_id")
      .notNull()
      .references(() => appsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<AgentChannelBindingStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_channel_binding_agent_provider_idx").on(table.agentId, table.provider),
    uniqueIndex("agent_channel_binding_provider_tenant_bot_idx").on(
      table.provider,
      table.externalTenantId,
      table.externalBotId,
    ),
    index("agent_channel_binding_agent_status_idx").on(table.agentId, table.status),
    index("agent_channel_binding_app_status_idx").on(table.appId, table.status),
  ],
);

export const channelEventReceiptsTable = sqliteTable(
  "channel_event_receipt",
  {
    bindingId: platformIdColumn<ChannelBindingId>("binding_id")
      .notNull()
      .references(() => agentChannelBindingsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    externalEventId: text("external_event_id").notNull(),
    externalTenantId: text("external_tenant_id").notNull(),
    id: platformIdColumn<ChannelEventReceiptId>("id").primaryKey(),
    provider: text("provider").$type<AgentChannelBindingProvider>().notNull(),
    sessionId: platformIdColumn<SessionId>("session_id"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("channel_event_receipt_provider_tenant_event_idx").on(
      table.provider,
      table.externalTenantId,
      table.externalEventId,
    ),
    index("channel_event_receipt_binding_updated_idx").on(table.bindingId, table.updatedAt),
    index("channel_event_receipt_expires_idx").on(table.expiresAt),
  ],
);

export const channelThreadSessionsTable = sqliteTable(
  "channel_thread_session",
  {
    bindingId: platformIdColumn<ChannelBindingId>("binding_id")
      .notNull()
      .references(() => agentChannelBindingsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    id: platformIdColumn<ChannelThreadSessionId>("id").primaryKey(),
    provider: text("provider").$type<AgentChannelBindingProvider>().notNull(),
    sessionId: platformIdColumn<SessionId>("session_id").references(() => sessionsTable.id, {
      onDelete: "cascade",
    }),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("channel_thread_session_provider_binding_thread_idx").on(
      table.provider,
      table.bindingId,
      table.externalThreadId,
    ),
    index("channel_thread_session_session_idx").on(table.sessionId),
  ],
);

export const channelFinalDeliveryJobsTable = sqliteTable(
  "channel_final_delivery_job",
  {
    attemptCount: integer("attempt_count").notNull().default(0),
    bindingId: platformIdColumn<ChannelBindingId>("binding_id")
      .notNull()
      .references(() => agentChannelBindingsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    externalEventId: text("external_event_id").notNull(),
    id: platformIdColumn<ChannelFinalDeliveryJobId>("id").primaryKey(),
    lastErrorCode: text("last_error_code"),
    payloadJson: text("payload_json").notNull(),
    provider: text("provider").$type<AgentChannelBindingProvider>().notNull(),
    runId: platformIdColumn<SessionRunId>("run_id")
      .notNull()
      .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
    sessionId: platformIdColumn<SessionId>("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    status: text("status").$type<ChannelFinalDeliveryJobStatus>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("channel_final_delivery_provider_binding_event_idx").on(
      table.provider,
      table.bindingId,
      table.externalEventId,
    ),
    index("channel_final_delivery_session_idx").on(table.sessionId),
    index("channel_final_delivery_run_idx").on(table.runId),
  ],
);

export const channelConnectionStatesTable = sqliteTable(
  "channel_runtime_state",
  {
    bindingId: platformIdColumn<ChannelBindingId>("binding_id")
      .notNull()
      .references(() => agentChannelBindingsTable.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<ChannelConnectionStateId>("id").primaryKey(),
    lastErrorCode: text("last_error_code"),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    lastInboundAt: integer("last_inbound_at"),
    lastPollAt: integer("last_poll_at"),
    leaseExpiresAt: integer("lease_expires_at"),
    leaseOwnerId: text("lease_owner_id"),
    provider: text("provider").$type<AgentChannelBindingProvider>().notNull(),
    runtimeAccountId: text("runtime_account_id").notNull().default(""),
    runtimeStateJson: text("runtime_state_json").notNull().default("{}"),
    status: text("status").$type<ChannelConnectionStateStatus>().notNull(),
    statusChangedAt: integer("status_changed_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("channel_runtime_state_provider_binding_account_idx").on(
      table.provider,
      table.bindingId,
      table.runtimeAccountId,
    ),
    index("channel_runtime_state_status_lease_idx").on(table.status, table.leaseExpiresAt),
    index("channel_runtime_state_binding_updated_idx").on(table.bindingId, table.updatedAt),
  ],
);

export const wechatChannelAccountsTable = sqliteTable(
  "wechat_channel_account",
  {
    agentId: platformIdColumn<AgentId>("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    baseUrl: text("base_url").notNull(),
    createdAt: integer("created_at").notNull(),
    cursor: text("cursor"),
    encryptedCredsSecretId: platformIdColumn<PlatformId>("encrypted_creds_secret_id")
      .notNull()
      .references(() => vaultSecretsTable.id, { onDelete: "restrict" }),
    externalAccountId: text("external_account_id").notNull(),
    externalBotId: text("external_bot_id").notNull(),
    id: platformIdColumn<ChannelBindingId>("id").primaryKey(),
    lastErrorCode: text("last_error_code"),
    lastHeartbeatAt: integer("last_heartbeat_at"),
    lastInboundAt: integer("last_inbound_at"),
    lastPollAt: integer("last_poll_at"),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    appId: platformIdColumn<AppId>("app_id")
      .notNull()
      .references(() => appsTable.id, { onDelete: "cascade" }),
    runtimeStateJson: text("runtime_state_json").notNull().default("{}"),
    status: text("status").$type<WeChatChannelAccountStatus>().notNull(),
    statusChangedAt: integer("status_changed_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("wechat_channel_account_agent_idx").on(table.agentId),
    uniqueIndex("wechat_channel_account_external_idx").on(
      table.externalAccountId,
      table.externalBotId,
    ),
    index("wechat_channel_account_status_idx").on(table.status, table.updatedAt),
    index("wechat_channel_account_app_status_idx").on(table.appId, table.status),
  ],
);

export const wechatChannelPairingsTable = sqliteTable(
  "wechat_channel_pairing",
  {
    agentId: platformIdColumn<AgentId>("agent_id")
      .notNull()
      .references(() => agentsTable.id, { onDelete: "cascade" }),
    consumedAt: integer("consumed_at"),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    id: platformIdColumn<WeChatChannelPairingId>("id").primaryKey(),
    appId: platformIdColumn<AppId>("app_id")
      .notNull()
      .references(() => appsTable.id, { onDelete: "cascade" }),
    qrTokenHash: text("qr_token_hash").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("wechat_channel_pairing_qr_token_hash_idx").on(table.qrTokenHash),
    index("wechat_channel_pairing_agent_creator_idx").on(
      table.agentId,
      table.createdByAccountId,
      table.consumedAt,
    ),
    index("wechat_channel_pairing_app_creator_idx").on(
      table.appId,
      table.createdByAccountId,
      table.consumedAt,
    ),
    index("wechat_channel_pairing_expires_idx").on(table.expiresAt),
  ],
);

export const wechatContextTokensTable = sqliteTable(
  "wechat_context_token",
  {
    accountId: platformIdColumn<ChannelBindingId>("account_id")
      .notNull()
      .references(() => wechatChannelAccountsTable.id, { onDelete: "cascade" }),
    contextTokenKey: text("context_token_key").notNull(),
    createdAt: integer("created_at").notNull(),
    encryptedContextTokenSecretId: platformIdColumn<PlatformId>("encrypted_context_token_secret_id")
      .notNull()
      .references(() => vaultSecretsTable.id, { onDelete: "restrict" }),
    externalAccountId: text("external_account_id").notNull(),
    id: platformIdColumn<WeChatContextTokenId>("id").primaryKey(),
    peerId: text("peer_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("wechat_context_token_key_idx").on(table.contextTokenKey),
    uniqueIndex("wechat_context_token_account_peer_idx").on(
      table.accountId,
      table.externalAccountId,
      table.peerId,
    ),
    index("wechat_context_token_account_updated_idx").on(table.accountId, table.updatedAt),
  ],
);

export type AgentChannelBindingRow = typeof agentChannelBindingsTable.$inferSelect;
export type ChannelEventReceiptRow = typeof channelEventReceiptsTable.$inferSelect;
export type ChannelFinalDeliveryJobRow = typeof channelFinalDeliveryJobsTable.$inferSelect;
export type ChannelConnectionStateRow = typeof channelConnectionStatesTable.$inferSelect;
export type ChannelThreadSessionRow = typeof channelThreadSessionsTable.$inferSelect;
export type WeChatChannelAccountRow = typeof wechatChannelAccountsTable.$inferSelect;
export type WeChatChannelPairingRow = typeof wechatChannelPairingsTable.$inferSelect;
export type WeChatContextTokenRow = typeof wechatContextTokensTable.$inferSelect;
