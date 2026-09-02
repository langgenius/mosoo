import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";
import type {
  AccountId,
  ProjectId,
  EnvironmentId,
  EnvironmentRevisionId,
  SandboxBackupId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { apiCommandsTable } from "./api-command.schema";
import type { ApiCommandId } from "./api-command.schema";
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
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id"),
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("environment_project_updated_at_idx").on(table.projectId, table.updatedAt),
    index("environment_owner_updated_at_idx").on(table.ownerAccountId, table.updatedAt),
    uniqueIndex("environment_owner_name_idx")
      .on(table.projectId, table.ownerAccountId, table.name)
      .where(sql`${table.ownerAccountId} IS NOT NULL`),
    uniqueIndex("environment_system_default_idx")
      .on(table.projectId)
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
    packagesJson: text("packages_json").notNull(),
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
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
    index("environment_revision_project_created_at_idx").on(table.projectId, table.createdAt),
  ],
);

export const environmentPackageArtifactBackupsTable = sqliteTable(
  "environment_package_artifact_backup",
  {
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    backupId: platformIdColumn<SandboxBackupId>("backup_id").primaryKey(),
    commandId: platformIdColumn<ApiCommandId>("command_id")
      .notNull()
      .references(() => apiCommandsTable.id, { onDelete: "restrict" }),
    committedAt: integer("committed_at").notNull(),
    deliveryGeneration: integer("delivery_generation").notNull(),
    expiresAt: integer("expires_at").notNull(),
    inputDigest: text("input_digest").notNull(),
    manifestGeneration: integer("manifest_generation").notNull(),
    pathsJson: text("paths_json").notNull(),
  },
  (table) => [
    check(
      "environment_package_artifact_backup_attempt_check",
      sql`typeof(${table.attemptCount}) = 'integer' AND ${table.attemptCount} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "environment_package_artifact_backup_delivery_check",
      sql`typeof(${table.deliveryGeneration}) = 'integer' AND ${table.deliveryGeneration} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "environment_package_artifact_backup_generation_check",
      sql`typeof(${table.manifestGeneration}) = 'integer' AND ${table.manifestGeneration} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "environment_package_artifact_backup_digest_check",
      sql`length(${table.inputDigest}) = 64 AND ${table.inputDigest} = lower(${table.inputDigest}) AND ${table.inputDigest} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "environment_package_artifact_backup_paths_check",
      sql`json_valid(${table.pathsJson}) = 1 AND json_type(${table.pathsJson}) IS 'object' AND json_type(${table.pathsJson}, '$.executable') IS 'array' AND json_type(${table.pathsJson}, '$.node') IS 'array' AND json_type(${table.pathsJson}, '$.python') IS 'array'`,
    ),
    check(
      "environment_package_artifact_backup_time_check",
      sql`typeof(${table.committedAt}) = 'integer' AND ${table.committedAt} BETWEEN 0 AND 9007199254740991 AND typeof(${table.expiresAt}) = 'integer' AND ${table.expiresAt} BETWEEN ${table.committedAt} + 86400001 AND 9007199254740991`,
    ),
    index("environment_package_artifact_backup_expiry_idx").on(table.expiresAt, table.backupId),
    uniqueIndex("environment_package_artifact_backup_key_idx").on(
      table.projectId,
      table.inputDigest,
    ),
  ],
);

export const environmentPackageArtifactBackupStagingTable = sqliteTable(
  "environment_package_artifact_backup_staging",
  {
    actualBackupId: platformIdColumn<SandboxBackupId>("actual_backup_id"),
    projectId: platformIdColumn<ProjectId>("project_id").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    claimOwner: text("claim_owner").notNull(),
    commandId: platformIdColumn<ApiCommandId>("command_id")
      .primaryKey()
      .references(() => apiCommandsTable.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    deliveryGeneration: integer("delivery_generation").notNull(),
    dir: text("dir").notNull(),
    inputDigest: text("input_digest").notNull(),
    pathsJson: text("paths_json").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "environment_package_artifact_backup_staging_attempt_check",
      sql`typeof(${table.attemptCount}) = 'integer' AND ${table.attemptCount} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "environment_package_artifact_backup_staging_claim_owner_check",
      sql`typeof(${table.claimOwner}) = 'text' AND length(${table.claimOwner}) > 0`,
    ),
    check(
      "environment_package_artifact_backup_staging_delivery_check",
      sql`typeof(${table.deliveryGeneration}) = 'integer' AND ${table.deliveryGeneration} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "environment_package_artifact_backup_staging_digest_check",
      sql`length(${table.inputDigest}) = 64 AND ${table.inputDigest} = lower(${table.inputDigest}) AND ${table.inputDigest} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "environment_package_artifact_backup_staging_dir_check",
      sql`typeof(${table.dir}) = 'text' AND length(${table.dir}) > 0`,
    ),
    check(
      "environment_package_artifact_backup_staging_paths_check",
      sql`json_valid(${table.pathsJson}) = 1 AND json_type(${table.pathsJson}) = 'object' AND json_type(${table.pathsJson}, '$.executable') = 'array' AND json_type(${table.pathsJson}, '$.node') = 'array' AND json_type(${table.pathsJson}, '$.python') = 'array'`,
    ),
    check(
      "environment_package_artifact_backup_staging_time_check",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} BETWEEN 0 AND 9007199254740991 AND typeof(${table.updatedAt}) = 'integer' AND ${table.updatedAt} BETWEEN ${table.createdAt} AND 9007199254740991`,
    ),
    uniqueIndex("environment_package_artifact_backup_staging_actual_idx")
      .on(table.actualBackupId)
      .where(sql`${table.actualBackupId} IS NOT NULL`),
    uniqueIndex("environment_package_artifact_backup_staging_intent_idx").on(
      table.projectId,
      table.inputDigest,
    ),
    index("environment_package_artifact_backup_staging_updated_idx").on(
      table.updatedAt,
      table.commandId,
    ),
  ],
);

export type EnvironmentRevisionRow = typeof environmentRevisionsTable.$inferSelect;
export type EnvironmentRow = typeof environmentsTable.$inferSelect;
