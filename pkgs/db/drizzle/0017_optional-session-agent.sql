-- Optional Agent provenance for Project-owned Sessions.
-- Reviewed replacement of Drizzle table rebuilds: D1 keeps foreign keys active,
-- so dropping Session/Run parents could cascade-delete durable history. Swap
-- only the association column, retaining IDs, children, checks, and indexes.
-- This data rewrite requires a verified backup, matched nullable-aware
-- Host/Driver rollback artifacts, and explicit approval before production.
ALTER TABLE `session` ADD COLUMN `agent_id_optional` text CHECK ("agent_id_optional" = upper("agent_id_optional") AND length("agent_id_optional") = 26 AND substr("agent_id_optional", 1, 1) GLOB '[0-7]' AND "agent_id_optional" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*');
--> statement-breakpoint
UPDATE `session` SET `agent_id_optional` = `agent_id`;
--> statement-breakpoint
DROP INDEX `session_agent_updated_idx`;
--> statement-breakpoint
ALTER TABLE `session` DROP COLUMN `agent_id`;
--> statement-breakpoint
ALTER TABLE `session` RENAME COLUMN `agent_id_optional` TO `agent_id`;
--> statement-breakpoint
CREATE INDEX `session_agent_updated_idx` ON `session` (`agent_id`,`updated_at`,`id`);
--> statement-breakpoint
ALTER TABLE `session_run` ADD COLUMN `agent_id_optional` text CHECK ("agent_id_optional" = upper("agent_id_optional") AND length("agent_id_optional") = 26 AND substr("agent_id_optional", 1, 1) GLOB '[0-7]' AND "agent_id_optional" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*');
--> statement-breakpoint
UPDATE `session_run` SET `agent_id_optional` = `agent_id`;
--> statement-breakpoint
ALTER TABLE `session_run` DROP COLUMN `agent_id`;
--> statement-breakpoint
ALTER TABLE `session_run` RENAME COLUMN `agent_id_optional` TO `agent_id`;
--> statement-breakpoint
ALTER TABLE `session_event` ADD COLUMN `agent_id_optional` text CHECK ("agent_id_optional" = upper("agent_id_optional") AND length("agent_id_optional") = 26 AND substr("agent_id_optional", 1, 1) GLOB '[0-7]' AND "agent_id_optional" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*');
--> statement-breakpoint
UPDATE `session_event` SET `agent_id_optional` = `agent_id`;
--> statement-breakpoint
DROP INDEX `session_event_agent_family_created_idx`;
--> statement-breakpoint
DROP INDEX `session_event_agent_visibility_created_idx`;
--> statement-breakpoint
DROP INDEX `session_event_agent_created_idx`;
--> statement-breakpoint
ALTER TABLE `session_event` DROP COLUMN `agent_id`;
--> statement-breakpoint
ALTER TABLE `session_event` RENAME COLUMN `agent_id_optional` TO `agent_id`;
--> statement-breakpoint
CREATE INDEX `session_event_agent_family_created_idx` ON `session_event` (`agent_id`,`family`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `session_event_agent_visibility_created_idx` ON `session_event` (`agent_id`,`visibility`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `session_event_agent_created_idx` ON `session_event` (`agent_id`,`created_at`,`id`);
--> statement-breakpoint
ALTER TABLE `usage_event` ADD COLUMN `agent_id_optional` text CHECK ("agent_id_optional" = upper("agent_id_optional") AND length("agent_id_optional") = 26 AND substr("agent_id_optional", 1, 1) GLOB '[0-7]' AND "agent_id_optional" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*');
--> statement-breakpoint
UPDATE `usage_event` SET `agent_id_optional` = `agent_id`;
--> statement-breakpoint
DROP INDEX `usage_event_agent_created_idx`;
--> statement-breakpoint
ALTER TABLE `usage_event` DROP COLUMN `agent_id`;
--> statement-breakpoint
ALTER TABLE `usage_event` RENAME COLUMN `agent_id_optional` TO `agent_id`;
--> statement-breakpoint
CREATE INDEX `usage_event_agent_created_idx` ON `usage_event` (`agent_id`,`created_at`);
--> statement-breakpoint
-- Rollups have no inbound foreign keys. Rebuild only this derived table
-- to replace its non-null composite primary key with a unique grouping key.
-- The generated grouping column is omitted from the copy and never represents
-- an Agent ID; stored agent_id remains genuinely NULL for direct execution.
CREATE TABLE `__new_usage_daily_rollup` (
	`actor_user_id` text CHECK ("actor_user_id" = upper("actor_user_id") AND length("actor_user_id") = 26 AND substr("actor_user_id", 1, 1) GLOB '[0-7]' AND "actor_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`agent_scope_key` text GENERATED ALWAYS AS (coalesce("agent_id", '')) VIRTUAL,
	`agent_owner_user_id` text CHECK ("agent_owner_user_id" = upper("agent_owner_user_id") AND length("agent_owner_user_id") = 26 AND substr("agent_owner_user_id", 1, 1) GLOB '[0-7]' AND "agent_owner_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_publication_state_at_run` text NOT NULL,
	`cache_creation_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`date` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`model` text NOT NULL,
	`organization_id` text CHECK ("organization_id" = upper("organization_id") AND length("organization_id") = 26 AND substr("organization_id", 1, 1) GLOB '[0-7]' AND "organization_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`project_id` text CHECK ("project_id" = upper("project_id") AND length("project_id") = 26 AND substr("project_id", 1, 1) GLOB '[0-7]' AND "project_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`output_tokens` integer NOT NULL,
	`provider` text NOT NULL,
	`request_count` integer NOT NULL,
	`run_purpose` text NOT NULL,
	`total_cost_usd_micros` integer NOT NULL,
	`unpriced_request_count` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_usage_daily_rollup` (`actor_user_id`, `agent_id`, `agent_owner_user_id`, `agent_publication_state_at_run`, `cache_creation_tokens`, `cache_read_tokens`, `date`, `input_tokens`, `model`, `organization_id`, `project_id`, `output_tokens`, `provider`, `request_count`, `run_purpose`, `total_cost_usd_micros`, `unpriced_request_count`) SELECT `actor_user_id`, `agent_id`, `agent_owner_user_id`, `agent_publication_state_at_run`, `cache_creation_tokens`, `cache_read_tokens`, `date`, `input_tokens`, `model`, `organization_id`, `project_id`, `output_tokens`, `provider`, `request_count`, `run_purpose`, `total_cost_usd_micros`, `unpriced_request_count` FROM `usage_daily_rollup`;
--> statement-breakpoint
DROP TABLE `usage_daily_rollup`;
--> statement-breakpoint
ALTER TABLE `__new_usage_daily_rollup` RENAME TO `usage_daily_rollup`;
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_daily_rollup_dimensions_idx` ON `usage_daily_rollup` (`organization_id`,`project_id`,`agent_scope_key`,`actor_user_id`,`agent_owner_user_id`,`date`,`agent_publication_state_at_run`,`run_purpose`,`provider`,`model`);
--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_project_date_idx` ON `usage_daily_rollup` (`project_id`,`date`);
--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_organization_date_idx` ON `usage_daily_rollup` (`organization_id`,`date`);
--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_agent_date_idx` ON `usage_daily_rollup` (`agent_id`,`date`);
--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_actor_date_idx` ON `usage_daily_rollup` (`actor_user_id`,`date`);
--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_owner_date_idx` ON `usage_daily_rollup` (`agent_owner_user_id`,`date`);
