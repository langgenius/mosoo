CREATE TABLE `environment_package_artifact_backup` (
	`project_id` text CHECK ("project_id" = upper("project_id") AND length("project_id") = 26 AND substr("project_id", 1, 1) GLOB '[0-7]' AND "project_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`attempt_count` integer NOT NULL,
	`backup_id` text CHECK ("backup_id" = upper("backup_id") AND length("backup_id") = 26 AND substr("backup_id", 1, 1) GLOB '[0-7]' AND "backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`command_id` text CHECK ("command_id" = upper("command_id") AND length("command_id") = 26 AND substr("command_id", 1, 1) GLOB '[0-7]' AND "command_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`committed_at` integer NOT NULL,
	`delivery_generation` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`input_digest` text NOT NULL,
	`manifest_generation` integer NOT NULL,
	`paths_json` text NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `api_command`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "environment_package_artifact_backup_attempt_check" CHECK(typeof("environment_package_artifact_backup"."attempt_count") = 'integer' AND "environment_package_artifact_backup"."attempt_count" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_delivery_check" CHECK(typeof("environment_package_artifact_backup"."delivery_generation") = 'integer' AND "environment_package_artifact_backup"."delivery_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_generation_check" CHECK(typeof("environment_package_artifact_backup"."manifest_generation") = 'integer' AND "environment_package_artifact_backup"."manifest_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_digest_check" CHECK(length("environment_package_artifact_backup"."input_digest") = 64 AND "environment_package_artifact_backup"."input_digest" = lower("environment_package_artifact_backup"."input_digest") AND "environment_package_artifact_backup"."input_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "environment_package_artifact_backup_paths_check" CHECK(json_valid("environment_package_artifact_backup"."paths_json") = 1 AND json_type("environment_package_artifact_backup"."paths_json") IS 'object' AND json_type("environment_package_artifact_backup"."paths_json", '$.executable') IS 'array' AND json_type("environment_package_artifact_backup"."paths_json", '$.node') IS 'array' AND json_type("environment_package_artifact_backup"."paths_json", '$.python') IS 'array'),
	CONSTRAINT "environment_package_artifact_backup_time_check" CHECK(typeof("environment_package_artifact_backup"."committed_at") = 'integer' AND "environment_package_artifact_backup"."committed_at" BETWEEN 0 AND 9007199254740991 AND typeof("environment_package_artifact_backup"."expires_at") = 'integer' AND "environment_package_artifact_backup"."expires_at" BETWEEN "environment_package_artifact_backup"."committed_at" + 86400001 AND 9007199254740991)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_package_artifact_backup_key_idx` ON `environment_package_artifact_backup` (`project_id`,`input_digest`);--> statement-breakpoint
CREATE INDEX `environment_package_artifact_backup_expiry_idx` ON `environment_package_artifact_backup` (`expires_at`,`backup_id`);--> statement-breakpoint
CREATE TABLE `sandbox_backup_delete_intent` (
	`attempted_at` integer,
	`backup_id` text CHECK ("backup_id" = upper("backup_id") AND length("backup_id") = 26 AND substr("backup_id", 1, 1) GLOB '[0-7]' AND "backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`delete_after` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "sandbox_backup_delete_intent_time_check" CHECK(typeof("sandbox_backup_delete_intent"."created_at") = 'integer' AND "sandbox_backup_delete_intent"."created_at" BETWEEN 0 AND 9007199254740991 AND typeof("sandbox_backup_delete_intent"."delete_after") = 'integer' AND "sandbox_backup_delete_intent"."delete_after" BETWEEN "sandbox_backup_delete_intent"."created_at" AND 9007199254740991 AND ("sandbox_backup_delete_intent"."attempted_at" IS NULL OR (typeof("sandbox_backup_delete_intent"."attempted_at") = 'integer' AND "sandbox_backup_delete_intent"."attempted_at" BETWEEN "sandbox_backup_delete_intent"."delete_after" AND 9007199254740991)) AND ("sandbox_backup_delete_intent"."deleted_at" IS NULL OR (typeof("sandbox_backup_delete_intent"."deleted_at") = 'integer' AND "sandbox_backup_delete_intent"."deleted_at" BETWEEN coalesce("sandbox_backup_delete_intent"."attempted_at", "sandbox_backup_delete_intent"."delete_after") AND 9007199254740991)))
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `sandbox_backup_delete_intent_pending_idx` ON `sandbox_backup_delete_intent` (`delete_after`,`attempted_at`,`created_at`,`backup_id`) WHERE "sandbox_backup_delete_intent"."deleted_at" IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER IF EXISTS `__protocol_v3_cutover_sandbox_backup_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `__protocol_v3_cutover_sandbox_backup_update`;--> statement-breakpoint
CREATE TABLE `__new_sandbox_backup` (
	`created_at` integer NOT NULL,
	`dir` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`keep` integer DEFAULT false NOT NULL,
	`operation_id` text CHECK ("operation_id" = upper("operation_id") AND length("operation_id") = 26 AND substr("operation_id", 1, 1) GLOB '[0-7]' AND "operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`sandbox_id` text CHECK ("sandbox_id" = upper("sandbox_id") AND length("sandbox_id") = 26 AND substr("sandbox_id", 1, 1) GLOB '[0-7]' AND "sandbox_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`sandbox_incarnation` integer NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`staging_id` text CHECK ("staging_id" = upper("staging_id") AND length("staging_id") = 26 AND substr("staging_id", 1, 1) GLOB '[0-7]' AND "staging_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`ttl_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`workspace_session_id` text CHECK ("workspace_session_id" = upper("workspace_session_id") AND length("workspace_session_id") = 26 AND substr("workspace_session_id", 1, 1) GLOB '[0-7]' AND "workspace_session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "sandbox_backup_status_check" CHECK("__new_sandbox_backup"."status" IN ('ready', 'pruned')),
	CONSTRAINT "sandbox_backup_dir_check" CHECK(typeof("__new_sandbox_backup"."dir") = 'text' AND length("__new_sandbox_backup"."dir") > 0),
	CONSTRAINT "sandbox_backup_keep_check" CHECK(typeof("__new_sandbox_backup"."keep") = 'integer' AND "__new_sandbox_backup"."keep" IN (false, true)),
	CONSTRAINT "sandbox_backup_incarnation_check" CHECK(typeof("__new_sandbox_backup"."sandbox_incarnation") = 'integer' AND "__new_sandbox_backup"."sandbox_incarnation" BETWEEN 0 AND 9007199254740991 AND ("__new_sandbox_backup"."sandbox_incarnation" > 0 OR "__new_sandbox_backup"."staging_id" = "__new_sandbox_backup"."id")),
	CONSTRAINT "sandbox_backup_ttl_check" CHECK(typeof("__new_sandbox_backup"."ttl_seconds") = 'integer' AND "__new_sandbox_backup"."ttl_seconds" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "sandbox_backup_timestamps_check" CHECK(typeof("__new_sandbox_backup"."created_at") = 'integer' AND "__new_sandbox_backup"."created_at" BETWEEN 0 AND 9007199254740991 AND typeof("__new_sandbox_backup"."updated_at") = 'integer' AND "__new_sandbox_backup"."updated_at" BETWEEN "__new_sandbox_backup"."created_at" AND 9007199254740991),
	CONSTRAINT "sandbox_backup_scope_check" CHECK(("__new_sandbox_backup"."session_run_id" IS NULL OR "__new_sandbox_backup"."workspace_session_id" IS NOT NULL) AND (("__new_sandbox_backup"."operation_id" IS NOT NULL) <> ("__new_sandbox_backup"."session_run_id" IS NOT NULL) OR ("__new_sandbox_backup"."operation_id" IS NULL AND "__new_sandbox_backup"."session_run_id" IS NULL AND "__new_sandbox_backup"."workspace_session_id" IS NULL AND "__new_sandbox_backup"."staging_id" = "__new_sandbox_backup"."id" AND "__new_sandbox_backup"."sandbox_incarnation" = 0)))
) WITHOUT ROWID;
--> statement-breakpoint
INSERT INTO `__new_sandbox_backup` (
	`created_at`, `dir`, `id`, `keep`, `operation_id`, `sandbox_id`, `sandbox_incarnation`,
	`session_run_id`, `staging_id`, `status`, `ttl_seconds`, `updated_at`, `workspace_session_id`
)
SELECT
	`created_at`, `dir`, `id`, `keep`, `operation_id`, `sandbox_id`, `sandbox_incarnation`,
	`session_run_id`, `staging_id`, `status`, `ttl_seconds`, `updated_at`, `workspace_session_id`
FROM `sandbox_backup`;--> statement-breakpoint
DROP TABLE `sandbox_backup`;--> statement-breakpoint
ALTER TABLE `__new_sandbox_backup` RENAME TO `sandbox_backup`;--> statement-breakpoint
CREATE INDEX `sandbox_backup_sandbox_status_dir_created_idx` ON `sandbox_backup` (`sandbox_id`,`status`,`dir`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `sandbox_backup_workspace_status_updated_idx` ON `sandbox_backup` (`workspace_session_id`,`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_idx` ON `sandbox_backup` (`staging_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_terminal_checkpoint_idx` ON `sandbox_backup` (`sandbox_id`,`sandbox_incarnation`,`dir`,`session_run_id`) WHERE "sandbox_backup"."session_run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_operation_checkpoint_idx` ON `sandbox_backup` (`sandbox_id`,`sandbox_incarnation`,`operation_id`,`dir`) WHERE "sandbox_backup"."operation_id" IS NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS `environment_package_artifact_backup_staging_authority`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `environment_package_artifact_backup_staging_immutable`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `__protocol_v3_cutover_environment_artifact_backup_staging_insert`;--> statement-breakpoint
CREATE TABLE `__new_environment_package_artifact_backup_staging` (
	`actual_backup_id` text CHECK ("actual_backup_id" = upper("actual_backup_id") AND length("actual_backup_id") = 26 AND substr("actual_backup_id", 1, 1) GLOB '[0-7]' AND "actual_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`project_id` text CHECK ("project_id" = upper("project_id") AND length("project_id") = 26 AND substr("project_id", 1, 1) GLOB '[0-7]' AND "project_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`attempt_count` integer NOT NULL,
	`claim_owner` text NOT NULL,
	`command_id` text CHECK ("command_id" = upper("command_id") AND length("command_id") = 26 AND substr("command_id", 1, 1) GLOB '[0-7]' AND "command_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`delivery_generation` integer NOT NULL,
	`dir` text NOT NULL,
	`input_digest` text NOT NULL,
	`paths_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `api_command`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "environment_package_artifact_backup_staging_attempt_check" CHECK(typeof("__new_environment_package_artifact_backup_staging"."attempt_count") = 'integer' AND "__new_environment_package_artifact_backup_staging"."attempt_count" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_staging_claim_owner_check" CHECK(typeof("__new_environment_package_artifact_backup_staging"."claim_owner") = 'text' AND length("__new_environment_package_artifact_backup_staging"."claim_owner") > 0),
	CONSTRAINT "environment_package_artifact_backup_staging_delivery_check" CHECK(typeof("__new_environment_package_artifact_backup_staging"."delivery_generation") = 'integer' AND "__new_environment_package_artifact_backup_staging"."delivery_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_staging_digest_check" CHECK(length("__new_environment_package_artifact_backup_staging"."input_digest") = 64 AND "__new_environment_package_artifact_backup_staging"."input_digest" = lower("__new_environment_package_artifact_backup_staging"."input_digest") AND "__new_environment_package_artifact_backup_staging"."input_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "environment_package_artifact_backup_staging_dir_check" CHECK(typeof("__new_environment_package_artifact_backup_staging"."dir") = 'text' AND length("__new_environment_package_artifact_backup_staging"."dir") > 0),
	CONSTRAINT "environment_package_artifact_backup_staging_paths_check" CHECK(json_valid("__new_environment_package_artifact_backup_staging"."paths_json") = 1 AND json_type("__new_environment_package_artifact_backup_staging"."paths_json") = 'object' AND json_type("__new_environment_package_artifact_backup_staging"."paths_json", '$.executable') = 'array' AND json_type("__new_environment_package_artifact_backup_staging"."paths_json", '$.node') = 'array' AND json_type("__new_environment_package_artifact_backup_staging"."paths_json", '$.python') = 'array'),
	CONSTRAINT "environment_package_artifact_backup_staging_time_check" CHECK(typeof("__new_environment_package_artifact_backup_staging"."created_at") = 'integer' AND "__new_environment_package_artifact_backup_staging"."created_at" BETWEEN 0 AND 9007199254740991 AND typeof("__new_environment_package_artifact_backup_staging"."updated_at") = 'integer' AND "__new_environment_package_artifact_backup_staging"."updated_at" BETWEEN "__new_environment_package_artifact_backup_staging"."created_at" AND 9007199254740991)
) WITHOUT ROWID;
--> statement-breakpoint
INSERT INTO `__new_environment_package_artifact_backup_staging` (
	`actual_backup_id`, `project_id`, `attempt_count`, `claim_owner`, `command_id`, `created_at`,
	`delivery_generation`, `dir`, `input_digest`, `paths_json`, `updated_at`
)
SELECT
	`actual_backup_id`, `project_id`, `attempt_count`, `claim_owner`, `command_id`, `created_at`,
	`delivery_generation`, `dir`, `input_digest`, `paths_json`, `updated_at`
FROM `environment_package_artifact_backup_staging`;--> statement-breakpoint
DROP TABLE `environment_package_artifact_backup_staging`;--> statement-breakpoint
ALTER TABLE `__new_environment_package_artifact_backup_staging` RENAME TO `environment_package_artifact_backup_staging`;--> statement-breakpoint
CREATE UNIQUE INDEX `environment_package_artifact_backup_staging_actual_idx` ON `environment_package_artifact_backup_staging` (`actual_backup_id`) WHERE "environment_package_artifact_backup_staging"."actual_backup_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `environment_package_artifact_backup_staging_intent_idx` ON `environment_package_artifact_backup_staging` (`project_id`,`input_digest`);--> statement-breakpoint
CREATE INDEX `environment_package_artifact_backup_staging_updated_idx` ON `environment_package_artifact_backup_staging` (`updated_at`,`command_id`);--> statement-breakpoint
CREATE TABLE `__new_sandbox_backup_staging` (
	`actual_backup_id` text CHECK ("actual_backup_id" = upper("actual_backup_id") AND length("actual_backup_id") = 26 AND substr("actual_backup_id", 1, 1) GLOB '[0-7]' AND "actual_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`claim_owner` text,
	`created_at` integer NOT NULL,
	`dir` text NOT NULL,
	`driver_generation` integer,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`operation_id` text CHECK ("operation_id" = upper("operation_id") AND length("operation_id") = 26 AND substr("operation_id", 1, 1) GLOB '[0-7]' AND "operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`sandbox_id` text CHECK ("sandbox_id" = upper("sandbox_id") AND length("sandbox_id") = 26 AND substr("sandbox_id", 1, 1) GLOB '[0-7]' AND "sandbox_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`sandbox_incarnation` integer NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`ttl_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updates_subject_backup` integer DEFAULT false NOT NULL,
	`workspace_session_id` text CHECK ("workspace_session_id" = upper("workspace_session_id") AND length("workspace_session_id") = 26 AND substr("workspace_session_id", 1, 1) GLOB '[0-7]' AND "workspace_session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	CONSTRAINT "sandbox_backup_staging_claim_owner_check" CHECK("__new_sandbox_backup_staging"."claim_owner" IS NULL OR (typeof("__new_sandbox_backup_staging"."claim_owner") = 'text' AND length("__new_sandbox_backup_staging"."claim_owner") > 0)),
	CONSTRAINT "sandbox_backup_staging_dir_check" CHECK(typeof("__new_sandbox_backup_staging"."dir") = 'text' AND length("__new_sandbox_backup_staging"."dir") > 0),
	CONSTRAINT "sandbox_backup_staging_incarnation_check" CHECK(typeof("__new_sandbox_backup_staging"."sandbox_incarnation") = 'integer' AND "__new_sandbox_backup_staging"."sandbox_incarnation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "sandbox_backup_staging_ttl_check" CHECK(typeof("__new_sandbox_backup_staging"."ttl_seconds") = 'integer' AND "__new_sandbox_backup_staging"."ttl_seconds" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "sandbox_backup_staging_timestamps_check" CHECK(typeof("__new_sandbox_backup_staging"."created_at") = 'integer' AND "__new_sandbox_backup_staging"."created_at" BETWEEN 0 AND 9007199254740991 AND typeof("__new_sandbox_backup_staging"."updated_at") = 'integer' AND "__new_sandbox_backup_staging"."updated_at" BETWEEN "__new_sandbox_backup_staging"."created_at" AND 9007199254740991),
	CONSTRAINT "sandbox_backup_staging_scope_check" CHECK((("__new_sandbox_backup_staging"."operation_id" IS NOT NULL AND "__new_sandbox_backup_staging"."claim_owner" IS NOT NULL AND "__new_sandbox_backup_staging"."session_run_id" IS NULL AND "__new_sandbox_backup_staging"."driver_instance_id" IS NULL AND "__new_sandbox_backup_staging"."driver_generation" IS NULL) OR ("__new_sandbox_backup_staging"."operation_id" IS NULL AND "__new_sandbox_backup_staging"."claim_owner" IS NULL AND "__new_sandbox_backup_staging"."session_run_id" IS NOT NULL AND "__new_sandbox_backup_staging"."workspace_session_id" IS NOT NULL AND "__new_sandbox_backup_staging"."driver_instance_id" IS NOT NULL AND typeof("__new_sandbox_backup_staging"."driver_generation") = 'integer' AND "__new_sandbox_backup_staging"."driver_generation" BETWEEN 0 AND 9007199254740991)) AND ("__new_sandbox_backup_staging"."updates_subject_backup" = false OR ("__new_sandbox_backup_staging"."operation_id" IS NOT NULL AND "__new_sandbox_backup_staging"."workspace_session_id" IS NULL))),
	CONSTRAINT "sandbox_backup_staging_updates_subject_check" CHECK(typeof("__new_sandbox_backup_staging"."updates_subject_backup") = 'integer' AND "__new_sandbox_backup_staging"."updates_subject_backup" IN (false, true))
) WITHOUT ROWID;
--> statement-breakpoint
INSERT INTO `__new_sandbox_backup_staging`("actual_backup_id", "claim_owner", "created_at", "dir", "driver_generation", "driver_instance_id", "id", "operation_id", "sandbox_id", "sandbox_incarnation", "session_run_id", "ttl_seconds", "updated_at", "updates_subject_backup", "workspace_session_id")
SELECT "legacy"."actual_backup_id",
  CASE WHEN "legacy"."operation_id" IS NULL THEN NULL ELSE coalesce((
    SELECT "subject"."claim_owner" FROM "sandbox" AS "subject"
    WHERE "subject"."id" = "legacy"."sandbox_id"
      AND "subject"."incarnation" = "legacy"."sandbox_incarnation"
      AND "subject"."status" = 'backing_up'
      AND "subject"."status_operation_id" = "legacy"."operation_id"
      AND "subject"."claim_owner" IS NOT NULL
    LIMIT 1
  ), '__legacy_stale__') END,
  "legacy"."created_at", "legacy"."dir", "legacy"."driver_generation",
  "legacy"."driver_instance_id", "legacy"."id", "legacy"."operation_id",
  "legacy"."sandbox_id", "legacy"."sandbox_incarnation", "legacy"."session_run_id",
  "legacy"."ttl_seconds", "legacy"."updated_at", "legacy"."updates_subject_backup",
  "legacy"."workspace_session_id"
FROM `sandbox_backup_staging` AS "legacy";--> statement-breakpoint
DROP TABLE `sandbox_backup_staging`;--> statement-breakpoint
ALTER TABLE `__new_sandbox_backup_staging` RENAME TO `sandbox_backup_staging`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sandbox_backup_staging_updated_idx` ON `sandbox_backup_staging` (`updated_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_actual_idx` ON `sandbox_backup_staging` (`actual_backup_id`) WHERE "sandbox_backup_staging"."actual_backup_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_terminal_checkpoint_idx` ON `sandbox_backup_staging` (`sandbox_id`,`sandbox_incarnation`,`dir`,`session_run_id`) WHERE "sandbox_backup_staging"."session_run_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_operation_checkpoint_idx` ON `sandbox_backup_staging` (`sandbox_id`,`sandbox_incarnation`,`operation_id`,`dir`) WHERE "sandbox_backup_staging"."operation_id" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_staging_authority`
BEFORE INSERT ON `environment_package_artifact_backup_staging`
WHEN NOT EXISTS (
  SELECT 1
  FROM `api_command` AS `command`
  WHERE `command`.`id` = NEW.`command_id`
    AND `command`.`kind` = 'environment_package_artifact_build'
    AND `command`.`status` = 'running'
    AND `command`.`delivery_generation` = NEW.`delivery_generation`
    AND `command`.`attempt_count` = NEW.`attempt_count`
    AND `command`.`claim_owner` = NEW.`claim_owner`
    AND typeof(`command`.`claim_expires_at`) = 'integer'
    AND `command`.`claim_expires_at` > unixepoch('subsec') * 1000
    AND json_valid(`command`.`payload_json`) = 1
    AND json_extract(`command`.`payload_json`, '$.projectId') = NEW.`project_id`
    AND json_extract(`command`.`payload_json`, '$.inputDigest') = NEW.`input_digest`
)
BEGIN
  SELECT RAISE(ABORT, 'environment artifact backup stage lacks command authority');
END;--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_staging_immutable`
BEFORE UPDATE OF `project_id`, `attempt_count`, `claim_owner`, `command_id`, `created_at`, `delivery_generation`, `dir`, `input_digest`, `paths_json` ON `environment_package_artifact_backup_staging`
BEGIN
  SELECT RAISE(ABORT, 'environment artifact backup stage is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_authority`
BEFORE INSERT ON `sandbox_backup_delete_intent`
FOR EACH ROW
WHEN NEW.`created_at` IS NOT CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.`delete_after` < NEW.`created_at`
  OR NEW.`attempted_at` IS NOT NULL
  OR NEW.`deleted_at` IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent`
    WHERE `backup_id` = NEW.`backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `id` = NEW.`backup_id` AND `status` = 'ready'
    UNION ALL
    SELECT 1 FROM `sandbox_backup_staging`
    WHERE `actual_backup_id` = NEW.`backup_id`
    UNION ALL
    SELECT 1 FROM `environment_package_artifact_backup_staging`
    WHERE `actual_backup_id` = NEW.`backup_id`
    UNION ALL
    SELECT 1 FROM `environment_package_artifact_backup`
    WHERE `backup_id` = NEW.`backup_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup deletion lacks D1 authority');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_runtime_record`
BEFORE INSERT ON `sandbox_backup`
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM `sandbox_backup` AS `existing`
    WHERE `existing`.`id` = NEW.`id`
      OR `existing`.`staging_id` = NEW.`staging_id`
      OR (`existing`.`sandbox_id` = NEW.`sandbox_id`
        AND `existing`.`sandbox_incarnation` = NEW.`sandbox_incarnation`
        AND `existing`.`dir` = NEW.`dir`
        AND ((NEW.`operation_id` IS NOT NULL
            AND `existing`.`operation_id` = NEW.`operation_id`)
          OR (NEW.`session_run_id` IS NOT NULL
            AND `existing`.`session_run_id` = NEW.`session_run_id`)))
  )
  OR (NEW.`status` = 'ready' AND EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent` WHERE `backup_id` = NEW.`id`
  ))
  OR EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup`
    WHERE `backup_id` = NEW.`id`
    UNION ALL
    SELECT 1 FROM `environment_package_artifact_backup_staging`
    WHERE `actual_backup_id` = NEW.`id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup_staging` AS `stage`
    WHERE `stage`.`actual_backup_id` = NEW.`id`
      AND NOT (
        NEW.`status` = 'ready'
        AND NEW.`keep` = 0
        AND `stage`.`id` = NEW.`staging_id`
        AND `stage`.`created_at` = NEW.`created_at`
        AND `stage`.`dir` = NEW.`dir`
        AND `stage`.`operation_id` IS NEW.`operation_id`
        AND `stage`.`sandbox_id` = NEW.`sandbox_id`
        AND `stage`.`sandbox_incarnation` = NEW.`sandbox_incarnation`
        AND `stage`.`session_run_id` IS NEW.`session_run_id`
        AND `stage`.`ttl_seconds` = NEW.`ttl_seconds`
        AND `stage`.`workspace_session_id` IS NEW.`workspace_session_id`
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup object is tombstoned or already referenced');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_runtime_record_update`
BEFORE UPDATE OF `id`, `status` ON `sandbox_backup`
FOR EACH ROW
WHEN (NEW.`status` = 'ready' AND EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent` WHERE `backup_id` = NEW.`id`
  ))
  OR EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup`
    WHERE `backup_id` = NEW.`id`
    UNION ALL
    SELECT 1 FROM `environment_package_artifact_backup_staging`
    WHERE `actual_backup_id` = NEW.`id`
  )
  OR (NEW.`status` = 'pruned' AND EXISTS (
    SELECT 1 FROM `sandbox_backup_staging`
    WHERE `id` = OLD.`staging_id` OR `actual_backup_id` = OLD.`id`
  ))
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup object is tombstoned or already referenced');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_identity_immutable`
BEFORE UPDATE OF `created_at`, `dir`, `id`, `operation_id`, `sandbox_id`, `sandbox_incarnation`, `session_run_id`, `staging_id`, `ttl_seconds`, `workspace_session_id` ON `sandbox_backup`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_status_monotonic`
BEFORE UPDATE OF `status` ON `sandbox_backup`
FOR EACH ROW
WHEN OLD.`status` = 'pruned' AND NEW.`status` <> 'pruned'
BEGIN
  SELECT RAISE(ABORT, 'pruned sandbox backup cannot become ready');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_permanent`
BEFORE DELETE ON `sandbox_backup`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup record is permanent');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_runtime_stage_insert`
BEFORE INSERT ON `sandbox_backup_staging`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `sandbox_backup_staging` AS `existing`
  WHERE `existing`.`id` = NEW.`id`
    OR (NEW.`actual_backup_id` IS NOT NULL
      AND `existing`.`actual_backup_id` = NEW.`actual_backup_id`)
    OR (`existing`.`sandbox_id` = NEW.`sandbox_id`
      AND `existing`.`sandbox_incarnation` = NEW.`sandbox_incarnation`
      AND `existing`.`dir` = NEW.`dir`
      AND ((NEW.`operation_id` IS NOT NULL
          AND `existing`.`operation_id` = NEW.`operation_id`)
        OR (NEW.`session_run_id` IS NOT NULL
          AND `existing`.`session_run_id` = NEW.`session_run_id`)))
)
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `staging_id` = NEW.`id`
  )
  OR (NEW.`actual_backup_id` IS NOT NULL AND (
    EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent` WHERE `backup_id` = NEW.`actual_backup_id`
    )
    OR EXISTS (
      SELECT 1 FROM `sandbox_backup`
      WHERE `id` = NEW.`actual_backup_id`
    )
    OR EXISTS (
      SELECT 1 FROM `environment_package_artifact_backup`
      WHERE `backup_id` = NEW.`actual_backup_id`
      UNION ALL
      SELECT 1 FROM `environment_package_artifact_backup_staging`
      WHERE `actual_backup_id` = NEW.`actual_backup_id`
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup stage identity is already owned');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_staging_identity_immutable`
BEFORE UPDATE OF `claim_owner`, `created_at`, `dir`, `driver_generation`, `driver_instance_id`, `id`, `operation_id`, `sandbox_id`, `sandbox_incarnation`, `session_run_id`, `ttl_seconds`, `updates_subject_backup`, `workspace_session_id` ON `sandbox_backup_staging`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup stage identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_runtime_stage_update`
BEFORE UPDATE OF `actual_backup_id` ON `sandbox_backup_staging`
FOR EACH ROW
WHEN NEW.`actual_backup_id` IS NOT NULL AND (
  EXISTS (
    SELECT 1 FROM `sandbox_backup_staging` AS `existing`
    WHERE `existing`.`id` <> OLD.`id`
      AND `existing`.`actual_backup_id` = NEW.`actual_backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent` WHERE `backup_id` = NEW.`actual_backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `id` = NEW.`actual_backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup`
    WHERE `backup_id` = NEW.`actual_backup_id`
    UNION ALL
    SELECT 1 FROM `environment_package_artifact_backup_staging`
    WHERE `actual_backup_id` = NEW.`actual_backup_id`
  )
)
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `staging_id` = OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup stage identity is already owned');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_environment_stage_insert`
BEFORE INSERT ON `environment_package_artifact_backup_staging`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `environment_package_artifact_backup_staging` AS `existing`
  WHERE `existing`.`command_id` = NEW.`command_id`
    OR (`existing`.`project_id` = NEW.`project_id`
      AND `existing`.`input_digest` = NEW.`input_digest`)
    OR (NEW.`actual_backup_id` IS NOT NULL
      AND `existing`.`actual_backup_id` = NEW.`actual_backup_id`)
)
  OR (NEW.`actual_backup_id` IS NOT NULL AND (
    EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent` WHERE `backup_id` = NEW.`actual_backup_id`
    )
    OR EXISTS (
      SELECT 1 FROM `sandbox_backup`
      WHERE `id` = NEW.`actual_backup_id`
      UNION ALL
      SELECT 1 FROM `sandbox_backup_staging`
      WHERE `actual_backup_id` = NEW.`actual_backup_id`
    )
    OR EXISTS (
      SELECT 1 FROM `environment_package_artifact_backup`
      WHERE `backup_id` = NEW.`actual_backup_id`
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'environment artifact backup stage identity is already owned');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_environment_stage_update`
BEFORE UPDATE OF `actual_backup_id` ON `environment_package_artifact_backup_staging`
FOR EACH ROW
WHEN NEW.`actual_backup_id` IS NOT NULL AND (
  EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup_staging` AS `existing`
    WHERE `existing`.`command_id` <> OLD.`command_id`
      AND `existing`.`actual_backup_id` = NEW.`actual_backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent` WHERE `backup_id` = NEW.`actual_backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `id` = NEW.`actual_backup_id`
    UNION ALL
    SELECT 1 FROM `sandbox_backup_staging`
    WHERE `actual_backup_id` = NEW.`actual_backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup`
    WHERE `backup_id` = NEW.`actual_backup_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'environment artifact backup stage identity is already owned');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_blocks_environment_commit`
BEFORE INSERT ON `environment_package_artifact_backup`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `sandbox_backup_delete_intent`
  WHERE `backup_id` = NEW.`backup_id`
  UNION ALL
  SELECT 1 FROM `sandbox_backup`
  WHERE `id` = NEW.`backup_id`
  UNION ALL
  SELECT 1 FROM `sandbox_backup_staging`
  WHERE `actual_backup_id` = NEW.`backup_id`
)
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup object is tombstoned or already referenced');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_identity_immutable`
BEFORE UPDATE OF `backup_id`, `created_at`, `delete_after` ON `sandbox_backup_delete_intent`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup deletion intent identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_attempt_clock`
BEFORE UPDATE OF `attempted_at` ON `sandbox_backup_delete_intent`
FOR EACH ROW
WHEN NEW.`deleted_at` IS NOT NULL
  OR NEW.`attempted_at` IS NOT CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.`attempted_at` < OLD.`delete_after`
  OR (OLD.`attempted_at` IS NOT NULL AND NEW.`attempted_at` < OLD.`attempted_at`)
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup deletion retry must use monotonic D1 time');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_completion_monotonic`
BEFORE UPDATE OF `deleted_at` ON `sandbox_backup_delete_intent`
FOR EACH ROW
WHEN (OLD.`deleted_at` IS NOT NULL AND NEW.`deleted_at` IS NOT OLD.`deleted_at`)
  OR (OLD.`deleted_at` IS NULL AND NEW.`deleted_at` IS NOT NULL
    AND (OLD.`attempted_at` IS NULL
      OR NEW.`deleted_at` IS NOT CAST(unixepoch('subsec') * 1000 AS INTEGER)))
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup deletion completion must use D1 time and is irreversible');
END;--> statement-breakpoint
CREATE TRIGGER `sandbox_backup_delete_intent_permanent`
BEFORE DELETE ON `sandbox_backup_delete_intent`
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sandbox backup deletion intent is permanent');
END;--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_authority`
BEFORE INSERT ON `environment_package_artifact_backup`
FOR EACH ROW
WHEN NEW.`committed_at` IS NOT CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.`manifest_generation` IS NOT 1
  OR NEW.`expires_at` <= NEW.`committed_at` + 86400000
  OR NEW.`expires_at` > NEW.`committed_at` + 315360000000
  OR EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup`
    WHERE `backup_id` = NEW.`backup_id`
      OR (`project_id` = NEW.`project_id` AND `input_digest` = NEW.`input_digest`)
  )
  OR NOT (
    EXISTS (
      SELECT 1
      FROM `environment_package_artifact_backup_staging` AS `stage`
      JOIN `api_command` AS `command` ON `command`.`id` = `stage`.`command_id`
      WHERE `stage`.`actual_backup_id` = NEW.`backup_id`
        AND `stage`.`project_id` = NEW.`project_id`
        AND `stage`.`attempt_count` = NEW.`attempt_count`
        AND `stage`.`command_id` = NEW.`command_id`
        AND `stage`.`delivery_generation` = NEW.`delivery_generation`
        AND `stage`.`dir` = '/workspace/.mosoo/environment-artifacts/' || NEW.`input_digest`
        AND `stage`.`input_digest` = NEW.`input_digest`
        AND `stage`.`paths_json` = NEW.`paths_json`
        AND `command`.`kind` = 'environment_package_artifact_build'
        AND `command`.`status` = 'running'
        AND `command`.`attempt_count` = `stage`.`attempt_count`
        AND `command`.`claim_owner` = `stage`.`claim_owner`
        AND typeof(`command`.`claim_expires_at`) = 'integer'
        AND `command`.`claim_expires_at` > CAST(unixepoch('subsec') * 1000 AS INTEGER)
        AND `command`.`delivery_generation` = `stage`.`delivery_generation`
        AND json_valid(`command`.`payload_json`) = 1
        AND json_extract(`command`.`payload_json`, '$.projectId') = `stage`.`project_id`
        AND json_extract(`command`.`payload_json`, '$.inputDigest') = `stage`.`input_digest`
    )
    OR EXISTS (
      SELECT 1 FROM `api_command` AS `command`
      WHERE `command`.`id` = NEW.`command_id`
        AND `command`.`kind` = 'environment_package_artifact_build'
        AND `command`.`status` = 'succeeded'
        AND typeof(`command`.`completed_at`) = 'integer'
        AND `command`.`claim_owner` IS NULL
        AND `command`.`claim_expires_at` IS NULL
        AND `command`.`attempt_count` = NEW.`attempt_count`
        AND `command`.`delivery_generation` = NEW.`delivery_generation`
        AND json_valid(`command`.`payload_json`) = 1
        AND json_extract(`command`.`payload_json`, '$.projectId') = NEW.`project_id`
        AND json_extract(`command`.`payload_json`, '$.inputDigest') = NEW.`input_digest`
        AND NOT EXISTS (
          SELECT 1 FROM `environment_package_artifact_backup_staging`
          WHERE `actual_backup_id` = NEW.`backup_id`
        )
    )
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent`
    WHERE `backup_id` = NEW.`backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `id` = NEW.`backup_id`
    UNION ALL
    SELECT 1 FROM `sandbox_backup_staging`
    WHERE `actual_backup_id` = NEW.`backup_id`
  )
  OR (SELECT count(*) FROM json_each(NEW.`paths_json`)) <> 3
  OR (SELECT count(*) FROM json_each(NEW.`paths_json`) WHERE `key` = 'executable') <> 1
  OR (SELECT count(*) FROM json_each(NEW.`paths_json`) WHERE `key` = 'node') <> 1
  OR (SELECT count(*) FROM json_each(NEW.`paths_json`) WHERE `key` = 'python') <> 1
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.`paths_json`) AS `entry`
    WHERE `entry`.`key` NOT IN ('executable', 'node', 'python')
  )
  OR EXISTS (
    SELECT 1
    FROM (
      SELECT `value`, `type` FROM json_each(NEW.`paths_json`, '$.executable')
      UNION ALL
      SELECT `value`, `type` FROM json_each(NEW.`paths_json`, '$.node')
      UNION ALL
      SELECT `value`, `type` FROM json_each(NEW.`paths_json`, '$.python')
    ) AS `path`
    WHERE `path`.`type` <> 'text'
      OR NOT (`path`.`value` GLOB ('/workspace/.mosoo/environment-artifacts/' || NEW.`input_digest` || '/*'))
      OR instr(`path`.`value`, char(0)) > 0
      OR instr(`path`.`value`, ':') > 0
      OR instr(`path`.`value`, '//') > 0
      OR substr(`path`.`value`, -1) = '/'
      OR substr(`path`.`value`, -2) = '/.'
      OR substr(`path`.`value`, -3) = '/..'
      OR `path`.`value` GLOB '*/./*'
      OR `path`.`value` GLOB '*/../*'
  )
  OR EXISTS (
    SELECT 1
    FROM (
      SELECT `value` FROM json_each(NEW.`paths_json`, '$.executable')
      UNION ALL
      SELECT `value` FROM json_each(NEW.`paths_json`, '$.node')
      UNION ALL
      SELECT `value` FROM json_each(NEW.`paths_json`, '$.python')
    ) AS `path`
    GROUP BY `path`.`value`
    HAVING count(*) > 1
  )
BEGIN
  SELECT RAISE(ABORT, 'environment package artifact backup lacks D1 authority');
END;--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_rotation_authority`
BEFORE UPDATE ON `environment_package_artifact_backup`
FOR EACH ROW
WHEN NEW.`project_id` IS NOT OLD.`project_id`
  OR NEW.`input_digest` IS NOT OLD.`input_digest`
  OR NEW.`paths_json` IS NOT OLD.`paths_json`
  OR NEW.`backup_id` IS OLD.`backup_id`
  OR OLD.`manifest_generation` >= 9007199254740991
  OR NEW.`manifest_generation` IS NOT OLD.`manifest_generation` + 1
  OR NEW.`committed_at` IS NOT CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.`committed_at` < OLD.`committed_at`
  OR NEW.`expires_at` <= NEW.`committed_at` + 86400000
  OR NEW.`expires_at` > NEW.`committed_at` + 315360000000
  OR NEW.`expires_at` <= OLD.`expires_at`
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup_delete_intent`
    WHERE `backup_id` = NEW.`backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `sandbox_backup`
    WHERE `id` = NEW.`backup_id`
    UNION ALL
    SELECT 1 FROM `sandbox_backup_staging`
    WHERE `actual_backup_id` = NEW.`backup_id`
  )
  OR EXISTS (
    SELECT 1 FROM `environment_package_artifact_backup` AS `other`
    WHERE `other`.`backup_id` = NEW.`backup_id`
      AND (`other`.`project_id` <> OLD.`project_id` OR `other`.`input_digest` <> OLD.`input_digest`)
  )
  OR NOT EXISTS (
    SELECT 1
    FROM `environment_package_artifact_backup_staging` AS `stage`
    JOIN `api_command` AS `command` ON `command`.`id` = `stage`.`command_id`
    WHERE `stage`.`actual_backup_id` = NEW.`backup_id`
      AND `stage`.`project_id` = NEW.`project_id`
      AND `stage`.`attempt_count` = NEW.`attempt_count`
      AND `stage`.`command_id` = NEW.`command_id`
      AND `stage`.`delivery_generation` = NEW.`delivery_generation`
      AND `stage`.`dir` = '/workspace/.mosoo/environment-artifacts/' || NEW.`input_digest`
      AND `stage`.`input_digest` = NEW.`input_digest`
      AND `stage`.`paths_json` = NEW.`paths_json`
      AND `command`.`kind` = 'environment_package_artifact_build'
      AND `command`.`status` = 'running'
      AND `command`.`attempt_count` = `stage`.`attempt_count`
      AND `command`.`claim_owner` = `stage`.`claim_owner`
      AND typeof(`command`.`claim_expires_at`) = 'integer'
      AND `command`.`claim_expires_at` > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND `command`.`delivery_generation` = `stage`.`delivery_generation`
      AND json_valid(`command`.`payload_json`) = 1
      AND json_extract(`command`.`payload_json`, '$.projectId') = `stage`.`project_id`
      AND json_extract(`command`.`payload_json`, '$.inputDigest') = `stage`.`input_digest`
  )
BEGIN
  SELECT RAISE(ABORT, 'environment package artifact backup rotation lacks D1 authority');
END;--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_rotation_tombstone`
AFTER UPDATE OF `backup_id` ON `environment_package_artifact_backup`
FOR EACH ROW
WHEN NEW.`backup_id` IS NOT OLD.`backup_id`
BEGIN
  INSERT INTO `sandbox_backup_delete_intent` (`attempted_at`, `backup_id`, `created_at`, `delete_after`, `deleted_at`)
  VALUES (
    NULL,
    OLD.`backup_id`,
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    max(OLD.`expires_at`, CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    NULL
  );
END;--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_retirement_authority`
BEFORE DELETE ON `environment_package_artifact_backup`
FOR EACH ROW
WHEN OLD.`expires_at` > CAST(unixepoch('subsec') * 1000 AS INTEGER)
BEGIN
  SELECT RAISE(ABORT, 'environment package artifact backup manifest has not expired');
END;--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_retirement_tombstone`
AFTER DELETE ON `environment_package_artifact_backup`
FOR EACH ROW
BEGIN
  INSERT INTO `sandbox_backup_delete_intent` (`attempted_at`, `backup_id`, `created_at`, `delete_after`, `deleted_at`)
  VALUES (
    NULL,
    OLD.`backup_id`,
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    CAST(unixepoch('subsec') * 1000 AS INTEGER),
    NULL
  );
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_backup_insert"
BEFORE INSERT ON "sandbox_backup"
WHEN NEW."status" NOT IN ('ready', 'pruned')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new sandbox backup work');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_backup_update"
BEFORE UPDATE OF "status" ON "sandbox_backup"
WHEN OLD."status" IN ('ready', 'pruned')
  AND NEW."status" NOT IN ('ready', 'pruned')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox backup reactivation');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_environment_artifact_backup_staging_insert"
BEFORE INSERT ON "environment_package_artifact_backup_staging"
WHEN EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "api_command" AS "command"
      ON "command"."id" = NEW."command_id"
     AND "command"."created_at" <= "gate"."started_at"
     AND "command"."kind" = 'environment_package_artifact_build'
     AND "command"."status" = 'running'
     AND "command"."delivery_generation" = NEW."delivery_generation"
     AND "command"."attempt_count" = NEW."attempt_count"
     AND "command"."claim_owner" = NEW."claim_owner"
     AND typeof("command"."claim_expires_at") = 'integer'
     AND "command"."claim_expires_at" > unixepoch('subsec') * 1000
     AND json_valid("command"."payload_json") = 1
     AND json_extract("command"."payload_json", '$.projectId') = NEW."project_id"
     AND json_extract("command"."payload_json", '$.inputDigest') = NEW."input_digest"
    WHERE "gate"."enabled" = 1
      AND "gate"."command_freeze" = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new environment artifact backup staging');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_backup_staging_insert"
BEFORE INSERT ON "sandbox_backup_staging"
WHEN EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."workspace_session_id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    INNER JOIN "sandbox" AS "smoke_sandbox"
      ON "smoke_sandbox"."id" = NEW."sandbox_id"
     AND "smoke_sandbox"."subject_kind" = 'session'
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new sandbox backup staging');
END;
