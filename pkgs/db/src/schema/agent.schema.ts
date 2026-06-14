import type { AgentKind, AgentStatus, AgentVisibility } from "@mosoo/contracts/agent";
import type { AgentMcpCredentialMode } from "@mosoo/contracts/mcp";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  AgentMcpBindingId,
  CredentialId,
  EnvironmentId,
  McpServerId,
  AppId,
  SkillId,
  SpaceId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const agentsTable = sqliteTable(
  "agent",
  {
    configJson: text("config_json").notNull(),
    createdAt: integer("created_at").notNull(),
    description: text("description"),
    environmentId: platformIdColumn<EnvironmentId>("environment_id"),
    id: platformIdColumn<AgentId>("id").primaryKey(),
    kind: text("kind").$type<AgentKind>().notNull().default("pet"),
    liveDeploymentVersionId: platformIdColumn<AgentDeploymentVersionId>(
      "live_deployment_version_id",
    ),
    model: text("model").notNull(),
    name: text("name").notNull(),
    ownerId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    appId: platformIdColumn<AppId>("app_id").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider").notNull(),
    runtimeId: text("runtime_id").notNull(),
    status: text("status").$type<AgentStatus>().notNull().default("draft"),
    updatedAt: integer("updated_at").notNull(),
    visibility: text("visibility").$type<AgentVisibility>().notNull().default("private"),
  },
  (table) => [
    check(
      "agent_published_live_deployment_version_check",
      sql`${table.status} <> 'published' OR ${table.liveDeploymentVersionId} IS NOT NULL`,
    ),
    index("agent_app_owner_account_idx").on(table.appId, table.ownerId),
    index("agent_app_status_idx").on(table.appId, table.status),
    index("agent_environment_idx").on(table.environmentId),
  ],
);

export const agentDeploymentVersionsTable = sqliteTable(
  "agent_deployment_version",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    configJson: text("config_json").notNull(),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id").notNull(),
    environmentId: platformIdColumn<EnvironmentId>("environment_id"),
    id: platformIdColumn<AgentDeploymentVersionId>("id").primaryKey(),
    kind: text("kind").$type<AgentKind>().notNull(),
    mcpBindingsJson: text("mcp_bindings_json").notNull(),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider").notNull(),
    runtimeId: text("runtime_id").notNull(),
    skillsJson: text("skills_json").notNull(),
    spaceBindingsJson: text("space_bindings_json").notNull(),
    summary: text("summary").notNull(),
    versionNumber: integer("version_number").notNull(),
  },
  (table) => [
    uniqueIndex("agent_deployment_version_agent_number_idx").on(table.agentId, table.versionNumber),
    index("agent_deployment_version_agent_created_idx").on(table.agentId, table.createdAt),
  ],
);

export const agentMcpBindingsTable = sqliteTable(
  "agent_mcp_binding",
  {
    agentCredentialId: platformIdColumn<CredentialId>("agent_credential_id"),
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    createdAt: integer("created_at").notNull(),
    credentialMode: text("credential_mode")
      .$type<AgentMcpCredentialMode>()
      .notNull()
      .default("runtime_resolved"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    id: platformIdColumn<AgentMcpBindingId>("id").primaryKey(),
    serverId: platformIdColumn<McpServerId>("server_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "agent_mcp_binding_agent_credential_shape_check",
      sql`
        (${table.credentialMode} = 'agent_bound' AND ${table.agentCredentialId} IS NOT NULL)
        OR (${table.credentialMode} = 'runtime_resolved' AND ${table.agentCredentialId} IS NULL)
      `,
    ),
    uniqueIndex("agent_mcp_binding_agent_sort_idx").on(table.agentId, table.sortOrder),
    index("agent_mcp_binding_server_idx").on(table.serverId),
    uniqueIndex("agent_mcp_binding_profile_server_idx").on(table.agentId, table.serverId),
  ],
);

export const agentSkillsTable = sqliteTable(
  "agent_skill",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    createdAt: integer("created_at").notNull(),
    skillId: platformIdColumn<SkillId>("skill_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.agentId, table.skillId],
    }),
    index("agent_skill_agent_sort_idx").on(table.agentId, table.sortOrder),
  ],
);

export const agentSpaceBindingsTable = sqliteTable(
  "agent_space_binding",
  {
    agentId: platformIdColumn<AgentId>("agent_id").notNull(),
    createdAt: integer("created_at").notNull(),
    sortOrder: integer("sort_order").notNull(),
    spaceId: platformIdColumn<SpaceId>("space_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.agentId, table.spaceId],
    }),
    index("agent_space_binding_agent_sort_idx").on(table.agentId, table.sortOrder),
  ],
);

export type AgentDeploymentVersionRow = typeof agentDeploymentVersionsTable.$inferSelect;
export type AgentMcpBindingRow = typeof agentMcpBindingsTable.$inferSelect;
export type AgentRow = typeof agentsTable.$inferSelect;
export type AgentSkillRow = typeof agentSkillsTable.$inferSelect;
export type AgentSpaceBindingRow = typeof agentSpaceBindingsTable.$inferSelect;
