/**
 * Migration-only physical history for the retired App Deployment product.
 *
 * Do not import these tables into product or runtime code. They remain in the
 * Drizzle input solely to prevent destructive drop migrations against the
 * append-only D1 chain. Issue #580 removed every active reader and writer.
 */
import type { AccountId, AppId, PlatformId, SessionId, SessionRunId } from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";
import { vaultSecretsTable } from "./mcp.schema";
import { defineSessionRunsTable } from "./session/session-run-table";

export const retiredAppDeploymentsStorage = sqliteTable(
  "app_deployment",
  {
    appId: platformIdColumn<AppId>("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
    defaultBranch: text("default_branch").notNull(),
    deletedAt: integer("deleted_at"),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    lastSuccessfulUrl: text("last_successful_url"),
    latestRunId: platformIdColumn<PlatformId>("latest_run_id"),
    mosooSubdomain: text("mosoo_subdomain").notNull(),
    ownerAccountId: platformIdColumn<AccountId>("owner_account_id").notNull(),
    repoName: text("repo_name").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoUrl: text("repo_url").notNull(),
    sourceKind: text("source_kind").notNull(),
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

export const retiredAppDeploymentRunsStorage = sqliteTable(
  "app_deployment_run",
  {
    appId: platformIdColumn<AppId>("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
    deploymentId: platformIdColumn<PlatformId>("deployment_id").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    externalDeploymentId: text("external_deployment_id"),
    externalProjectId: text("external_project_id"),
    externalVersionId: text("external_version_id"),
    generatedWranglerConfigJson: text("generated_wrangler_config_json"),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    mosooConfigJson: text("mosoo_config_json"),
    planJson: text("plan_json"),
    sourceBranch: text("source_branch").notNull(),
    sourceCommitSha: text("source_commit_sha").notNull(),
    status: text("status").notNull(),
    targetKind: text("target_kind"),
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

export const retiredAppDeploymentSecretsStorage = sqliteTable(
  "app_deployment_secret",
  {
    appId: platformIdColumn<AppId>("app_id").notNull(),
    createdAt: integer("created_at").notNull(),
    name: text("name").notNull(),
    vaultSecretId: platformIdColumn<PlatformId>("vault_secret_id")
      .notNull()
      .references(() => vaultSecretsTable.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("app_deployment_secret_app_name_idx").on(table.appId, table.name),
    uniqueIndex("app_deployment_secret_vault_secret_idx").on(table.vaultSecretId),
  ],
);

export const retiredBoundAgentCallIdempotencyStorage = sqliteTable(
  "bound_agent_call_idempotency_key",
  {
    bodyHash: text("body_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    runId: platformIdColumn<SessionRunId>("run_id"),
    sessionId: platformIdColumn<SessionId>("session_id").notNull(),
    subjectHash: text("subject_hash").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("bound_agent_call_idempotency_subject_key_idx").on(
      table.subjectHash,
      table.idempotencyKey,
    ),
    index("bound_agent_call_idempotency_updated_idx").on(table.updatedAt),
  ],
);

export const retiredSessionRunsPhysicalStorage = defineSessionRunsTable({
  retiredBoundCapabilityAgentId: platformIdColumn<PlatformId>("bound_capability_agent_id"),
  retiredBoundCapabilityAppId: platformIdColumn<PlatformId>("bound_capability_app_id"),
  retiredBoundCapabilityBindingEnv: text("bound_capability_binding_env"),
  retiredBoundCapabilityBindingName: text("bound_capability_binding_name"),
  retiredBoundCapabilityDeploymentId: platformIdColumn<PlatformId>(
    "bound_capability_deployment_id",
  ),
  retiredBoundCapabilityDeploymentRunId: platformIdColumn<PlatformId>(
    "bound_capability_deployment_run_id",
  ),
});
