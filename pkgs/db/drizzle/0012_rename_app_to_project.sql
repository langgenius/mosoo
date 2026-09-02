-- App -> Project concept rename (YEF-1142).
-- Hand-authored to stay metadata-only: SQLite's RENAME TO / RENAME COLUMN
-- rewrite dependent column CHECKs and index definitions in place, so no
-- table is rebuilt and no row is copied. Drizzle's generated rebuild of 17
-- tables (a data rewrite) was reviewed and replaced by these renames; the
-- 0012 snapshot describes the same final schema.
-- The retired channel/wechat tables removed from the schema by #577 are
-- deliberately NOT dropped here: physically dropping them is a destructive
-- migration that needs its own approval, backup, and rollback plan.
-- Wrangler's local D1 SQLite runs with legacy_alter_table enabled. Disable it
-- while renaming so SQLite rewrites self-qualified CHECK constraints such as
-- app_deployment.source_kind to their new Project table names.
PRAGMA legacy_alter_table = OFF;--> statement-breakpoint
ALTER TABLE `app` RENAME TO `project`;--> statement-breakpoint
ALTER TABLE `app_deployment` RENAME TO `project_deployment`;--> statement-breakpoint
ALTER TABLE `app_deployment_run` RENAME TO `project_deployment_run`;--> statement-breakpoint
ALTER TABLE `app_deployment_secret` RENAME TO `project_deployment_secret`;--> statement-breakpoint
ALTER TABLE `agent` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `project_deployment` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `project_deployment_run` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `project_deployment_secret` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `driver_instance_mcp_grant` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `environment` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `environment_revision` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `mcp_credential` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `mcp_oauth_flow` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `mcp_server` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `sandbox` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `session` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `session_run` RENAME COLUMN `bound_capability_app_id` TO `bound_capability_project_id`;--> statement-breakpoint
ALTER TABLE `skill` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `skill_snapshot` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `usage_daily_rollup` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `usage_event` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
ALTER TABLE `vendor_credential` RENAME COLUMN `app_id` TO `project_id`;--> statement-breakpoint
DROP INDEX `agent_app_owner_account_idx`;--> statement-breakpoint
DROP INDEX `agent_app_status_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_active_app_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_active_subdomain_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_run_active_app_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_run_app_id_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_run_deployment_id_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_secret_app_name_idx`;--> statement-breakpoint
DROP INDEX `app_deployment_secret_vault_secret_idx`;--> statement-breakpoint
DROP INDEX `environment_app_updated_at_idx`;--> statement-breakpoint
DROP INDEX `environment_revision_app_created_at_idx`;--> statement-breakpoint
DROP INDEX `mcp_credential_app_scope_idx`;--> statement-breakpoint
DROP INDEX `mcp_credential_app_scope_status_idx`;--> statement-breakpoint
DROP INDEX `mcp_oauth_flow_app_server_account_idx`;--> statement-breakpoint
DROP INDEX `mcp_server_app_enabled_idx`;--> statement-breakpoint
DROP INDEX `mcp_server_app_url_idx`;--> statement-breakpoint
DROP INDEX `mcp_server_owner_app_idx`;--> statement-breakpoint
DROP INDEX `session_app_attributed_archived_updated_idx`;--> statement-breakpoint
DROP INDEX `session_app_attributed_type_archived_updated_idx`;--> statement-breakpoint
DROP INDEX `session_app_creator_archived_updated_idx`;--> statement-breakpoint
DROP INDEX `session_app_creator_type_archived_updated_idx`;--> statement-breakpoint
DROP INDEX `skill_app_updated_at_idx`;--> statement-breakpoint
DROP INDEX `skill_snapshot_app_created_at_idx`;--> statement-breakpoint
DROP INDEX `usage_daily_rollup_app_date_idx`;--> statement-breakpoint
DROP INDEX `usage_event_app_created_idx`;--> statement-breakpoint
DROP INDEX `vendor_credential_app_vendor_idx`;--> statement-breakpoint
DROP INDEX `vendor_credential_app_vendor_name_idx`;--> statement-breakpoint
CREATE INDEX `agent_project_owner_account_idx` ON `agent` (`project_id`,`owner_account_id`);--> statement-breakpoint
CREATE INDEX `agent_project_status_idx` ON `agent` (`project_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_deployment_active_project_idx` ON `project_deployment` (`project_id`) WHERE "project_deployment"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_deployment_active_subdomain_idx` ON `project_deployment` (`mosoo_subdomain`) WHERE "project_deployment"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_deployment_run_active_project_idx` ON `project_deployment_run` (`project_id`) WHERE "project_deployment_run"."status" IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating');--> statement-breakpoint
CREATE INDEX `project_deployment_run_deployment_id_idx` ON `project_deployment_run` (`deployment_id`,`id`);--> statement-breakpoint
CREATE INDEX `project_deployment_run_project_id_idx` ON `project_deployment_run` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_deployment_secret_project_name_idx` ON `project_deployment_secret` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_deployment_secret_vault_secret_idx` ON `project_deployment_secret` (`vault_secret_id`);--> statement-breakpoint
CREATE INDEX `environment_project_updated_at_idx` ON `environment` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `environment_revision_project_created_at_idx` ON `environment_revision` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_credential_project_scope_idx` ON `mcp_credential` (`server_id`,`scope`) WHERE "mcp_credential"."scope" = 'app';--> statement-breakpoint
CREATE INDEX `mcp_credential_project_scope_status_idx` ON `mcp_credential` (`project_id`,`scope`,`status`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_flow_project_server_account_idx` ON `mcp_oauth_flow` (`project_id`,`server_id`,`initiator_account_id`);--> statement-breakpoint
CREATE INDEX `mcp_server_owner_project_idx` ON `mcp_server` (`owner_account_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `mcp_server_project_enabled_idx` ON `mcp_server` (`project_id`,`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_project_url_idx` ON `mcp_server` (`project_id`,`url`);--> statement-breakpoint
CREATE INDEX `session_project_attributed_archived_updated_idx` ON `session` (`project_id`,`attributed_user_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_project_attributed_type_archived_updated_idx` ON `session` (`project_id`,`attributed_user_id`,`type`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_project_creator_archived_updated_idx` ON `session` (`project_id`,`creator_account_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_project_creator_type_archived_updated_idx` ON `session` (`project_id`,`creator_account_id`,`type`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `skill_project_updated_at_idx` ON `skill` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `skill_snapshot_project_created_at_idx` ON `skill_snapshot` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_project_date_idx` ON `usage_daily_rollup` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `usage_event_project_created_idx` ON `usage_event` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `vendor_credential_project_vendor_idx` ON `vendor_credential` (`project_id`,`vendor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_credential_project_vendor_name_idx` ON `vendor_credential` (`project_id`,`vendor_id`,`name`);--> statement-breakpoint
PRAGMA legacy_alter_table = ON;
