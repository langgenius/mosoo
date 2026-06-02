import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, OrganizationId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const environmentsTable = sqliteTable(
  "environment",
  {
    createdAt: integer("created_at").notNull(),
    currentRevisionId: platformIdColumn<EnvironmentRevisionId>("current_revision_id").notNull(),
    description: text("description").notNull(),
    forkedFromEnvironmentId: platformIdColumn<EnvironmentId>("forked_from_environment_id"),
    forkedFromEnvironmentName: text("forked_from_environment_name"),
    forkedFromOwnerName: text("forked_from_owner_name"),
    id: platformIdColumn<EnvironmentId>("id").primaryKey(),
    name: text("name").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("environment_organization_updated_at_idx").on(table.organizationId, table.updatedAt),
    index("environment_owner_updated_at_idx").on(table.ownerAccountId, table.updatedAt),
    uniqueIndex("environment_owner_name_idx")
      .on(table.organizationId, table.ownerAccountId, table.name)
      .where(sql`${table.ownerAccountId} IS NOT NULL`),
    uniqueIndex("environment_system_default_idx")
      .on(table.organizationId)
      .where(sql`${table.ownerAccountId} IS NULL`),
  ],
);

export const environmentRevisionsTable = sqliteTable(
  "environment_revision",
  {
    allowMcpServers: integer("allow_mcp_servers", { mode: "boolean" }).notNull(),
    allowPackageManagers: integer("allow_package_managers", { mode: "boolean" }).notNull(),
    allowedHostsJson: text("allowed_hosts_json").notNull(),
    createdAt: integer("created_at").notNull(),
    createdByAccountId: platformIdColumn<AccountId>("created_by_account_id"),
    envVarsJson: text("env_vars_json").notNull(),
    environmentId: platformIdColumn<EnvironmentId>("environment_id").notNull(),
    id: platformIdColumn<EnvironmentRevisionId>("id").primaryKey(),
    networkPolicy: text("network_policy").$type<EnvironmentNetworkPolicy>().notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    packagesJson: text("packages_json").notNull(),
    setupScript: text("setup_script").notNull(),
  },
  (table) => [
    check(
      "environment_revision_network_policy_check",
      sql`${table.networkPolicy} IN ('full', 'limited')`,
    ),
    index("environment_revision_environment_created_at_idx").on(
      table.environmentId,
      table.createdAt,
    ),
    index("environment_revision_organization_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export type EnvironmentRevisionRow = typeof environmentRevisionsTable.$inferSelect;
export type EnvironmentRow = typeof environmentsTable.$inferSelect;
