import type {
  AccountId,
  AppDeploymentId,
  AppDeploymentRunId,
  AppId,
  EnvironmentId,
  OrganizationId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export type AppDeploymentSourceKind = "github_public";
export type AppDeploymentTargetKind = "cloudflare_pages" | "cloudflare_worker";
export type AppDeploymentRunStatus =
  | "activating"
  | "building"
  | "failed"
  | "preparing"
  | "queued"
  | "submitted"
  | "submitting"
  | "success";

export const appsTable = sqliteTable("app", {
  createdAt: integer("created_at").notNull(),
  defaultEnvironmentId: platformIdColumn<EnvironmentId>("default_environment_id"),
  id: platformIdColumn<AppId>("id").primaryKey(),
  name: text("name").notNull(),
  organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
  ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const appDeploymentsTable = sqliteTable(
  "app_deployment",
  {
    appId: platformIdColumn<AppId>("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
    defaultBranch: text("default_branch").notNull(),
    deletedAt: integer("deleted_at"),
    id: platformIdColumn<AppDeploymentId>("id").primaryKey(),
    lastSuccessfulUrl: text("last_successful_url"),
    latestRunId: platformIdColumn<AppDeploymentRunId>("latest_run_id"),
    mosooSubdomain: text("mosoo_subdomain").notNull(),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    repoName: text("repo_name").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoUrl: text("repo_url").notNull(),
    sourceKind: text("source_kind").$type<AppDeploymentSourceKind>().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("app_deployment_source_kind_check", sql`${table.sourceKind} IN ('github_public')`),
    uniqueIndex("app_deployment_active_app_idx")
      .on(table.appId)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("app_deployment_active_subdomain_idx")
      .on(table.mosooSubdomain)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const appDeploymentRunsTable = sqliteTable(
  "app_deployment_run",
  {
    appId: platformIdColumn<AppId>("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
    deploymentId: platformIdColumn<AppDeploymentId>("deployment_id").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    externalDeploymentId: text("external_deployment_id"),
    externalProjectId: text("external_project_id"),
    externalVersionId: text("external_version_id"),
    generatedWranglerConfigJson: text("generated_wrangler_config_json"),
    id: platformIdColumn<AppDeploymentRunId>("id").primaryKey(),
    mosooConfigJson: text("mosoo_config_json"),
    nativeResultJson: text("native_result_json"),
    planJson: text("plan_json"),
    sourceBranch: text("source_branch").notNull(),
    sourceCommitSha: text("source_commit_sha").notNull(),
    status: text("status").$type<AppDeploymentRunStatus>().notNull(),
    targetKind: text("target_kind").$type<AppDeploymentTargetKind>(),
    targetProjectName: text("target_project_name"),
    targetScriptName: text("target_script_name"),
    updatedAt: integer("updated_at").notNull(),
    url: text("url"),
  },
  (table) => [
    check(
      "app_deployment_run_status_check",
      sql`${table.status} IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating', 'success', 'failed')`,
    ),
    check(
      "app_deployment_run_target_kind_check",
      sql`${table.targetKind} IS NULL OR ${table.targetKind} IN ('cloudflare_pages', 'cloudflare_worker')`,
    ),
    index("app_deployment_run_app_id_idx").on(table.appId, table.id),
    index("app_deployment_run_deployment_id_idx").on(table.deploymentId, table.id),
    uniqueIndex("app_deployment_run_active_app_idx")
      .on(table.appId)
      .where(
        sql`${table.status} IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating')`,
      ),
  ],
);

export type AppDeploymentRow = typeof appDeploymentsTable.$inferSelect;
export type AppDeploymentRunRow = typeof appDeploymentRunsTable.$inferSelect;
export type AppRow = typeof appsTable.$inferSelect;
