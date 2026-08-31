CREATE TABLE `__runtime_subject_authority_guard` (
	`assertion` text PRIMARY KEY NOT NULL,
	`violation_count` integer NOT NULL,
	CONSTRAINT "runtime_subject_authority_guard_check" CHECK (`violation_count` = 0)
);
--> statement-breakpoint
CREATE TABLE `__runtime_subject_identity` (
	`sandbox_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_account_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__runtime_subject_identity` (`sandbox_id`, `kind`, `subject_kind`, `subject_id`, `agent_id`, `project_id`, `owner_account_id`)
SELECT `sandbox`.`id`, 'pet', 'agent', `sandbox`.`subject_id`, `agent`.`id`, `agent`.`project_id`, `agent`.`owner_account_id`
FROM `sandbox`
INNER JOIN `agent`
	ON `sandbox`.`kind` = 'pet'
	AND `sandbox`.`subject_kind` = 'agent'
	AND `agent`.`id` = `sandbox`.`subject_id`
	AND `agent`.`kind` = 'pet'
INNER JOIN `project` ON `project`.`id` = `agent`.`project_id`
UNION ALL
SELECT `sandbox`.`id`, 'cattle', 'session', `sandbox`.`subject_id`, `agent`.`id`, `session`.`project_id`, `agent`.`owner_account_id`
FROM `sandbox`
INNER JOIN `session`
	ON `sandbox`.`kind` = 'cattle'
	AND `sandbox`.`subject_kind` = 'session'
	AND `session`.`id` = `sandbox`.`subject_id`
	AND `session`.`kind` = 'cattle'
INNER JOIN `agent`
	ON `agent`.`id` = `session`.`agent_id`
	AND `agent`.`project_id` = `session`.`project_id`
	AND `agent`.`kind` = 'cattle'
INNER JOIN `project` ON `project`.`id` = `session`.`project_id`;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'active session runs', COUNT(*)
FROM `session_run`
WHERE `status` IN ('queued', 'booting', 'running', 'waiting_input');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'live driver instances', COUNT(*)
FROM `driver_instance`
WHERE `status` IN ('provisioning', 'connecting', 'ready', 'stopping');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'nonterminal driver commands', COUNT(*)
FROM `driver_command`
WHERE `status` IN ('queued', 'delivered', 'accepted');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'unsettled external tool effects', COUNT(*)
FROM `external_tool_effect`
WHERE `status` IN ('executing', 'claimed');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'nonterminal api commands', COUNT(*)
FROM `api_command`
WHERE `status` IN ('queued', 'running');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'active app deployment runs', COUNT(*)
FROM `project_deployment_run`
WHERE `status` IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'nonstatic sandboxes', COUNT(*)
FROM `sandbox`
WHERE `status` <> 'cold'
	OR `status_operation_id` IS NOT NULL
	OR `claim_owner` IS NOT NULL
	OR `claim_expires_at` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'nonstatic sessions', COUNT(*)
FROM `session`
WHERE `status` NOT IN ('IDLE', 'TERMINATED')
		OR `status_operation_id` IS NOT NULL
		OR NOT (
			`cleanup_operation_kind` IS NULL
			OR (
				`cleanup_operation_kind` = 'archive'
				AND `status` = 'IDLE'
				AND `archived_at` IS NOT NULL
			)
		)
		OR `runtime_provisioning_operation_id` IS NOT NULL
	OR `runtime_provisioning_run_id` IS NOT NULL
	OR `runtime_provisioning_sandbox_id` IS NOT NULL
	OR `runtime_provisioning_heartbeat_at` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'nonstatic sandbox sessions', COUNT(*)
FROM `sandbox_session`
WHERE `status` NOT IN ('closed', 'error');
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'invalid driver generations', COUNT(*)
FROM `driver_instance`
WHERE typeof(`generation`) <> 'integer'
	OR `generation` NOT BETWEEN 0 AND 9007199254740991;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'missing sandbox identity authority', COUNT(*)
FROM `sandbox`
LEFT JOIN `__runtime_subject_identity` AS `identity` ON `identity`.`sandbox_id` = `sandbox`.`id`
WHERE `identity`.`sandbox_id` IS NULL;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'partial or mismatched sandbox identity', COUNT(*)
FROM `sandbox`
INNER JOIN `__runtime_subject_identity` AS `identity` ON `identity`.`sandbox_id` = `sandbox`.`id`
WHERE NOT (
	(`sandbox`.`agent_id` IS NULL AND `sandbox`.`project_id` IS NULL AND `sandbox`.`owner_account_id` IS NULL)
	OR (
		`sandbox`.`agent_id` IS `identity`.`agent_id`
		AND `sandbox`.`project_id` IS `identity`.`project_id`
		AND `sandbox`.`owner_account_id` IS `identity`.`owner_account_id`
	)
);
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'invalid sandbox session authority', COUNT(*)
FROM `sandbox_session`
LEFT JOIN `__runtime_subject_identity` AS `identity` ON `identity`.`sandbox_id` = `sandbox_session`.`sandbox_id`
LEFT JOIN `session` ON `session`.`id` = `sandbox_session`.`session_id`
WHERE `identity`.`sandbox_id` IS NULL
	OR `session`.`id` IS NULL
	OR `session`.`kind` IS NOT `identity`.`kind`
	OR `session`.`agent_id` IS NOT `identity`.`agent_id`
	OR `session`.`project_id` IS NOT `identity`.`project_id`
	OR (`identity`.`subject_kind` = 'session' AND `sandbox_session`.`session_id` IS NOT `identity`.`subject_id`)
	OR (`identity`.`subject_kind` = 'agent' AND `session`.`agent_id` IS NOT `identity`.`subject_id`);
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'invalid sandbox backups', COUNT(*)
FROM `sandbox_backup`
WHERE `status` NOT IN ('ready', 'pruned')
	OR `error_message` IS NOT NULL
	OR typeof(`dir`) <> 'text'
	OR length(`dir`) = 0
	OR typeof(`keep`) <> 'integer'
	OR `keep` NOT IN (0, 1)
	OR typeof(`ttl_seconds`) <> 'integer'
	OR `ttl_seconds` NOT BETWEEN 1 AND 9007199254740991
	OR typeof(`created_at`) <> 'integer'
	OR `created_at` NOT BETWEEN 0 AND 9007199254740991
	OR typeof(`updated_at`) <> 'integer'
	OR `updated_at` NOT BETWEEN `created_at` AND 9007199254740991;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'invalid terminal backup authority', COUNT(*)
FROM `sandbox_backup`
LEFT JOIN `__runtime_subject_identity` AS `identity`
	ON `identity`.`sandbox_id` = `sandbox_backup`.`sandbox_id`
LEFT JOIN `session_run` ON `session_run`.`id` = `sandbox_backup`.`session_run_id`
LEFT JOIN `session` ON `session`.`id` = `session_run`.`session_id`
LEFT JOIN `sandbox_session` AS `workspace`
	ON `workspace`.`session_id` = `session_run`.`session_id`
	AND `workspace`.`sandbox_id` = `sandbox_backup`.`sandbox_id`
	AND `workspace`.`cwd` = `sandbox_backup`.`dir`
WHERE `sandbox_backup`.`session_run_id` IS NOT NULL
	AND (
		`identity`.`sandbox_id` IS NULL
		OR `session_run`.`id` IS NULL
		OR `session_run`.`status` IS NOT 'completed'
		OR `session_run`.`agent_id` IS NOT `identity`.`agent_id`
		OR `session`.`id` IS NULL
		OR `session`.`kind` IS NOT `identity`.`kind`
		OR `workspace`.`session_id` IS NULL
		OR (
			`identity`.`subject_kind` = 'session'
			AND `session`.`id` IS NOT `identity`.`subject_id`
		)
		OR (
			`identity`.`subject_kind` = 'agent'
			AND (
				`session`.`agent_id` IS NOT `identity`.`agent_id`
				OR `session`.`project_id` IS NOT `identity`.`project_id`
			)
		)
	);
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'duplicate terminal backup authority', COUNT(*)
FROM (
	SELECT 1
	FROM `sandbox_backup`
	WHERE `session_run_id` IS NOT NULL
	GROUP BY `sandbox_id`, `dir`, `session_run_id`
	HAVING COUNT(*) > 1
);
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'invalid sandbox backup pointers',
	(SELECT COUNT(*)
	 FROM `sandbox`
	 WHERE `last_backup_id` IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM `sandbox_backup`
			WHERE `sandbox_backup`.`id` = `sandbox`.`last_backup_id`
				AND `sandbox_backup`.`sandbox_id` = `sandbox`.`id`
				AND `sandbox_backup`.`status` = 'ready'
		))
	+
	(SELECT COUNT(*)
	 FROM `sandbox`
	 WHERE `last_restore_backup_id` IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM `sandbox_backup`
			WHERE `sandbox_backup`.`id` = `sandbox`.`last_restore_backup_id`
				AND `sandbox_backup`.`sandbox_id` = `sandbox`.`id`
				AND `sandbox_backup`.`status` IN ('ready', 'pruned')
		));
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'pre-migration foreign key violations', COUNT(*)
FROM pragma_foreign_key_check;
--> statement-breakpoint
ALTER TABLE `api_command` ADD `delivery_generation` integer DEFAULT 1 NOT NULL
	CONSTRAINT "api_command_delivery_generation_check"
	CHECK (
		typeof(`delivery_generation`) = 'integer'
		AND `delivery_generation` BETWEEN 1 AND 9007199254740991
	);
--> statement-breakpoint
CREATE TABLE `environment_package_artifact_backup_staging` (
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
	CONSTRAINT "environment_package_artifact_backup_staging_attempt_check" CHECK(typeof("environment_package_artifact_backup_staging"."attempt_count") = 'integer' AND "environment_package_artifact_backup_staging"."attempt_count" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_staging_claim_owner_check" CHECK(typeof("environment_package_artifact_backup_staging"."claim_owner") = 'text' AND length("environment_package_artifact_backup_staging"."claim_owner") > 0),
	CONSTRAINT "environment_package_artifact_backup_staging_delivery_check" CHECK(typeof("environment_package_artifact_backup_staging"."delivery_generation") = 'integer' AND "environment_package_artifact_backup_staging"."delivery_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "environment_package_artifact_backup_staging_digest_check" CHECK(length("environment_package_artifact_backup_staging"."input_digest") = 64 AND "environment_package_artifact_backup_staging"."input_digest" = lower("environment_package_artifact_backup_staging"."input_digest") AND "environment_package_artifact_backup_staging"."input_digest" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "environment_package_artifact_backup_staging_dir_check" CHECK(typeof("environment_package_artifact_backup_staging"."dir") = 'text' AND length("environment_package_artifact_backup_staging"."dir") > 0),
	CONSTRAINT "environment_package_artifact_backup_staging_paths_check" CHECK(json_valid("environment_package_artifact_backup_staging"."paths_json") = 1 AND json_type("environment_package_artifact_backup_staging"."paths_json") = 'object' AND json_type("environment_package_artifact_backup_staging"."paths_json", '$.executable') = 'array' AND json_type("environment_package_artifact_backup_staging"."paths_json", '$.node') = 'array' AND json_type("environment_package_artifact_backup_staging"."paths_json", '$.python') = 'array'),
	CONSTRAINT "environment_package_artifact_backup_staging_time_check" CHECK(typeof("environment_package_artifact_backup_staging"."created_at") = 'integer' AND "environment_package_artifact_backup_staging"."created_at" BETWEEN 0 AND 9007199254740991 AND typeof("environment_package_artifact_backup_staging"."updated_at") = 'integer' AND "environment_package_artifact_backup_staging"."updated_at" BETWEEN "environment_package_artifact_backup_staging"."created_at" AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_package_artifact_backup_staging_actual_idx` ON `environment_package_artifact_backup_staging` (`actual_backup_id`) WHERE "environment_package_artifact_backup_staging"."actual_backup_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_package_artifact_backup_staging_intent_idx` ON `environment_package_artifact_backup_staging` (`project_id`,`input_digest`);
--> statement-breakpoint
CREATE INDEX `environment_package_artifact_backup_staging_updated_idx` ON `environment_package_artifact_backup_staging` (`updated_at`,`command_id`);
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
END;
--> statement-breakpoint
CREATE TRIGGER `environment_package_artifact_backup_staging_immutable`
BEFORE UPDATE OF `project_id`, `attempt_count`, `claim_owner`, `command_id`, `created_at`, `delivery_generation`, `dir`, `input_digest`, `paths_json` ON `environment_package_artifact_backup_staging`
BEGIN
  SELECT RAISE(ABORT, 'environment artifact backup stage is immutable');
END;
--> statement-breakpoint
CREATE TABLE `sandbox_backup_staging` (
	`actual_backup_id` text CHECK ("actual_backup_id" = upper("actual_backup_id") AND length("actual_backup_id") = 26 AND substr("actual_backup_id", 1, 1) GLOB '[0-7]' AND "actual_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
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
	CONSTRAINT "sandbox_backup_staging_dir_check" CHECK(typeof("sandbox_backup_staging"."dir") = 'text' AND length("sandbox_backup_staging"."dir") > 0),
	CONSTRAINT "sandbox_backup_staging_incarnation_check" CHECK(typeof("sandbox_backup_staging"."sandbox_incarnation") = 'integer' AND "sandbox_backup_staging"."sandbox_incarnation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "sandbox_backup_staging_ttl_check" CHECK(typeof("sandbox_backup_staging"."ttl_seconds") = 'integer' AND "sandbox_backup_staging"."ttl_seconds" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "sandbox_backup_staging_timestamps_check" CHECK(typeof("sandbox_backup_staging"."created_at") = 'integer' AND "sandbox_backup_staging"."created_at" BETWEEN 0 AND 9007199254740991 AND typeof("sandbox_backup_staging"."updated_at") = 'integer' AND "sandbox_backup_staging"."updated_at" BETWEEN "sandbox_backup_staging"."created_at" AND 9007199254740991),
	CONSTRAINT "sandbox_backup_staging_scope_check" CHECK((("sandbox_backup_staging"."operation_id" IS NOT NULL AND "sandbox_backup_staging"."session_run_id" IS NULL AND "sandbox_backup_staging"."driver_instance_id" IS NULL AND "sandbox_backup_staging"."driver_generation" IS NULL) OR ("sandbox_backup_staging"."operation_id" IS NULL AND "sandbox_backup_staging"."session_run_id" IS NOT NULL AND "sandbox_backup_staging"."workspace_session_id" IS NOT NULL AND "sandbox_backup_staging"."driver_instance_id" IS NOT NULL AND typeof("sandbox_backup_staging"."driver_generation") = 'integer' AND "sandbox_backup_staging"."driver_generation" BETWEEN 0 AND 9007199254740991)) AND ("sandbox_backup_staging"."updates_subject_backup" = false OR ("sandbox_backup_staging"."operation_id" IS NOT NULL AND "sandbox_backup_staging"."workspace_session_id" IS NULL))),
	CONSTRAINT "sandbox_backup_staging_updates_subject_check" CHECK(typeof("sandbox_backup_staging"."updates_subject_backup") = 'integer' AND "sandbox_backup_staging"."updates_subject_backup" IN (false, true))
);
--> statement-breakpoint
CREATE INDEX `sandbox_backup_staging_updated_idx` ON `sandbox_backup_staging` (`updated_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_actual_idx` ON `sandbox_backup_staging` (`actual_backup_id`) WHERE "sandbox_backup_staging"."actual_backup_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_terminal_checkpoint_idx` ON `sandbox_backup_staging` (`sandbox_id`,`sandbox_incarnation`,`dir`,`session_run_id`) WHERE "sandbox_backup_staging"."session_run_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_operation_checkpoint_idx` ON `sandbox_backup_staging` (`sandbox_id`,`sandbox_incarnation`,`operation_id`,`dir`) WHERE "sandbox_backup_staging"."operation_id" IS NOT NULL;
--> statement-breakpoint
-- SQLite validates triggers on other tables while a referenced table is rebuilt.
-- The surrounding D1 migration transaction keeps admissions closed until the
-- canonical post-migration triggers are recreated at the end of this file.
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_environment_artifact_backup_staging_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_backup_staging_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_api_command_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_api_command_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_session_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_session_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_backup_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_backup_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_session_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_session_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_sandbox_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_command_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_driver_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_driver_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_project_deployment_run_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_project_deployment_run_insert";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_session_run_update";
DROP TRIGGER IF EXISTS "__protocol_v3_cutover_session_run_insert";
--> statement-breakpoint
CREATE TABLE `__new_sandbox` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`project_id` text CHECK ("project_id" = upper("project_id") AND length("project_id") = 26 AND substr("project_id", 1, 1) GLOB '[0-7]' AND "project_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`bind_mount_ready` integer DEFAULT false NOT NULL,
	`claim_expires_at` integer,
	`claim_owner` text,
	`created_at` integer NOT NULL,
	`global_mounts_json` text DEFAULT '[]' NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`inactive_deadline_at` integer,
	`incarnation` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`last_backup_id` text CHECK ("last_backup_id" = upper("last_backup_id") AND length("last_backup_id") = 26 AND substr("last_backup_id", 1, 1) GLOB '[0-7]' AND "last_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`last_error` text,
	`last_error_code` text,
	`last_restore_backup_id` text CHECK ("last_restore_backup_id" = upper("last_restore_backup_id") AND length("last_restore_backup_id") = 26 AND substr("last_restore_backup_id", 1, 1) GLOB '[0-7]' AND "last_restore_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`network_constraints_hash` text,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`operation_kind` text,
	`status` text NOT NULL,
	`status_changed_at` integer DEFAULT 0 NOT NULL,
	`status_event` text DEFAULT 'runtime_subject.cold' NOT NULL,
	`status_operation_id` text CHECK ("status_operation_id" = upper("status_operation_id") AND length("status_operation_id") = 26 AND substr("status_operation_id", 1, 1) GLOB '[0-7]' AND "status_operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`status_seq` integer DEFAULT 0 NOT NULL,
	`status_source` text DEFAULT 'system' NOT NULL,
	`subject_id` text CHECK ("subject_id" = upper("subject_id") AND length("subject_id") = 26 AND substr("subject_id", 1, 1) GLOB '[0-7]' AND "subject_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`subject_kind` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sandbox_status_check" CHECK("__new_sandbox"."status" IN ('cold', 'restoring', 'active', 'backing_up', 'destroying')),
	CONSTRAINT "sandbox_status_seq_check" CHECK("__new_sandbox"."status_seq" >= 0),
	CONSTRAINT "sandbox_incarnation_check" CHECK(typeof("__new_sandbox"."incarnation") = 'integer' AND "__new_sandbox"."incarnation" BETWEEN 0 AND 9007199254740991 AND ("__new_sandbox"."status" = 'cold' OR "__new_sandbox"."incarnation" > 0)),
	CONSTRAINT "sandbox_identity_check" CHECK(("__new_sandbox"."kind" = 'pet' AND "__new_sandbox"."subject_kind" = 'agent' AND "__new_sandbox"."subject_id" = "__new_sandbox"."agent_id") OR ("__new_sandbox"."kind" = 'cattle' AND "__new_sandbox"."subject_kind" = 'session')),
	CONSTRAINT "sandbox_network_constraints_hash_check" CHECK(("__new_sandbox"."network_constraints_hash" IS NULL AND "__new_sandbox"."status" = 'cold') OR ("__new_sandbox"."network_constraints_hash" IS NOT NULL AND length("__new_sandbox"."network_constraints_hash") = 64 AND "__new_sandbox"."network_constraints_hash" = lower("__new_sandbox"."network_constraints_hash") AND "__new_sandbox"."network_constraints_hash" NOT GLOB '*[^0-9a-f]*')),
	CONSTRAINT "sandbox_operation_state_check" CHECK(("__new_sandbox"."status" IN ('cold', 'active') AND "__new_sandbox"."operation_kind" IS NULL AND "__new_sandbox"."status_operation_id" IS NULL) OR ("__new_sandbox"."status" = 'restoring' AND "__new_sandbox"."operation_kind" = 'activate' AND "__new_sandbox"."status_operation_id" IS NOT NULL) OR ("__new_sandbox"."status" = 'backing_up' AND "__new_sandbox"."operation_kind" IN ('hibernate', 'recreate', 'reset') AND "__new_sandbox"."status_operation_id" IS NOT NULL) OR ("__new_sandbox"."status" = 'destroying' AND "__new_sandbox"."operation_kind" IN ('activate', 'hibernate', 'recreate', 'reset') AND "__new_sandbox"."status_operation_id" IS NOT NULL)),
	CONSTRAINT "sandbox_claim_check" CHECK(("__new_sandbox"."claim_owner" IS NULL AND "__new_sandbox"."claim_expires_at" IS NULL) OR ("__new_sandbox"."claim_owner" IS NOT NULL AND typeof("__new_sandbox"."claim_expires_at") = 'integer' AND "__new_sandbox"."claim_expires_at" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "sandbox_operation_claim_check" CHECK("__new_sandbox"."status" IN ('cold', 'active') OR "__new_sandbox"."claim_owner" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_sandbox`(
	"agent_id", "project_id", "bind_mount_ready", "claim_expires_at", "claim_owner", "created_at", "global_mounts_json", "id", "inactive_deadline_at", "incarnation", "kind", "last_backup_id", "last_error", "last_error_code", "last_restore_backup_id", "network_constraints_hash", "owner_account_id", "operation_kind", "status", "status_changed_at", "status_event", "status_operation_id", "status_seq", "status_source", "subject_id", "subject_kind", "updated_at"
)
SELECT
	`identity`.`agent_id`,
	`identity`.`project_id`,
	`sandbox`.`bind_mount_ready`,
	NULL,
	NULL,
	`sandbox`.`created_at`,
	`sandbox`.`global_mounts_json`,
	`sandbox`.`id`,
	`sandbox`.`inactive_deadline_at`,
	0,
	`identity`.`kind`,
	`sandbox`.`last_backup_id`,
	`sandbox`.`last_error`,
	`sandbox`.`last_error_code`,
	`sandbox`.`last_restore_backup_id`,
	NULL,
	`identity`.`owner_account_id`,
	NULL,
	'cold',
	`sandbox`.`status_changed_at`,
	`sandbox`.`status_event`,
	NULL,
	`sandbox`.`status_seq`,
	`sandbox`.`status_source`,
	`identity`.`subject_id`,
	`identity`.`subject_kind`,
	`sandbox`.`updated_at`
FROM `sandbox`
INNER JOIN `__runtime_subject_identity` AS `identity` ON `identity`.`sandbox_id` = `sandbox`.`id`;
--> statement-breakpoint
DROP TABLE `sandbox`;
--> statement-breakpoint
ALTER TABLE `__new_sandbox` RENAME TO `sandbox`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_subject_idx` ON `sandbox` (`kind`,`subject_kind`,`subject_id`);
--> statement-breakpoint
CREATE INDEX `sandbox_status_deadline_idx` ON `sandbox` (`status`,`inactive_deadline_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `sandbox_claim_idx` ON `sandbox` (`claim_expires_at`,`claim_owner`);
--> statement-breakpoint
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
);
--> statement-breakpoint
INSERT INTO `__new_sandbox_backup`(
	"created_at", "dir", "id", "keep", "operation_id", "sandbox_id", "sandbox_incarnation", "session_run_id", "staging_id", "status", "ttl_seconds", "updated_at", "workspace_session_id"
)
SELECT
	`sandbox_backup`.`created_at`,
	`sandbox_backup`.`dir`,
	`sandbox_backup`.`id`,
	`sandbox_backup`.`keep`,
	NULL,
	`sandbox_backup`.`sandbox_id`,
	0,
	`sandbox_backup`.`session_run_id`,
	`sandbox_backup`.`id`,
	`sandbox_backup`.`status`,
	`sandbox_backup`.`ttl_seconds`,
	`sandbox_backup`.`updated_at`,
	`session_run`.`session_id`
FROM `sandbox_backup`
LEFT JOIN `session_run` ON `session_run`.`id` = `sandbox_backup`.`session_run_id`;
--> statement-breakpoint
DROP TABLE `sandbox_backup`;
--> statement-breakpoint
ALTER TABLE `__new_sandbox_backup` RENAME TO `sandbox_backup`;
--> statement-breakpoint
CREATE INDEX `sandbox_backup_sandbox_status_dir_created_idx` ON `sandbox_backup` (`sandbox_id`,`status`,`dir`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `sandbox_backup_workspace_status_updated_idx` ON `sandbox_backup` (`workspace_session_id`,`status`,`updated_at`,`id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_staging_idx` ON `sandbox_backup` (`staging_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_terminal_checkpoint_idx` ON `sandbox_backup` (`sandbox_id`,`sandbox_incarnation`,`dir`,`session_run_id`) WHERE "sandbox_backup"."session_run_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_backup_operation_checkpoint_idx` ON `sandbox_backup` (`sandbox_id`,`sandbox_incarnation`,`operation_id`,`dir`) WHERE "sandbox_backup"."operation_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `driver_instance` ADD `sandbox_incarnation` integer DEFAULT 0 NOT NULL
	CONSTRAINT "driver_instance_generation_incarnation_check"
	CHECK (
		typeof(`generation`) = 'integer'
		AND `generation` BETWEEN 0 AND 9007199254740991
		AND typeof(`sandbox_incarnation`) = 'integer'
		AND `sandbox_incarnation` BETWEEN 0 AND 9007199254740991
		AND (`status` IN ('stopped', 'failed') OR `sandbox_incarnation` > 0)
	);
--> statement-breakpoint
DROP INDEX `driver_instance_sandbox_session_idx`;
--> statement-breakpoint
DROP INDEX `driver_instance_live_sandbox_session_idx`;
--> statement-breakpoint
CREATE INDEX `driver_instance_sandbox_session_idx` ON `driver_instance` (`sandbox_id`,`sandbox_incarnation`,`sandbox_session_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `driver_instance_live_sandbox_session_idx` ON `driver_instance` (`sandbox_id`,`sandbox_incarnation`,`sandbox_session_id`) WHERE "driver_instance"."status" IN ('provisioning', 'connecting', 'ready', 'stopping');
--> statement-breakpoint
ALTER TABLE `sandbox_session` ADD `cleanup_operation_id` text
	CHECK ("cleanup_operation_id" = upper("cleanup_operation_id") AND length("cleanup_operation_id") = 26 AND substr("cleanup_operation_id", 1, 1) GLOB '[0-7]' AND "cleanup_operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*')
	CONSTRAINT "sandbox_session_cleanup_check"
	CHECK ((`status` = 'cleanup_pending' AND `cleanup_operation_id` IS NOT NULL) OR (`status` <> 'cleanup_pending' AND `cleanup_operation_id` IS NULL));
--> statement-breakpoint
ALTER TABLE `sandbox_session` ADD `sandbox_incarnation` integer DEFAULT 0 NOT NULL
	CONSTRAINT "sandbox_session_status_incarnation_check"
	CHECK (
		`status` IN ('active', 'cleanup_pending', 'closed', 'error')
		AND typeof(`sandbox_incarnation`) = 'integer'
		AND `sandbox_incarnation` BETWEEN 0 AND 9007199254740991
		AND (`status` IN ('closed', 'error') OR `sandbox_incarnation` > 0)
	);
--> statement-breakpoint
CREATE INDEX `sandbox_session_status_updated_idx` ON `sandbox_session` (`status`,`updated_at`,`session_id`);
--> statement-breakpoint
ALTER TABLE `session` ADD `runtime_provisioning_sandbox_session_id` text
	CHECK ("runtime_provisioning_sandbox_session_id" = upper("runtime_provisioning_sandbox_session_id") AND length("runtime_provisioning_sandbox_session_id") = 26 AND substr("runtime_provisioning_sandbox_session_id", 1, 1) GLOB '[0-7]' AND "runtime_provisioning_sandbox_session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*');
--> statement-breakpoint
ALTER TABLE `session` ADD `runtime_provisioning_sandbox_incarnation` integer
	CONSTRAINT "session_runtime_provisioning_sandbox_pair_check"
	CHECK (
		(`runtime_provisioning_sandbox_session_id` IS NULL AND `runtime_provisioning_sandbox_incarnation` IS NULL)
		OR (
			`runtime_provisioning_operation_id` IS NOT NULL
			AND typeof(`runtime_provisioning_sandbox_incarnation`) = 'integer'
			AND `runtime_provisioning_sandbox_incarnation` BETWEEN 0 AND 9007199254740991
		)
	);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_runtime_provisioning_sandbox_idx` ON `session` (`runtime_provisioning_sandbox_id`) WHERE "session"."runtime_provisioning_operation_id" IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `sandbox_identity_immutable`
BEFORE UPDATE OF `id`, `kind`, `subject_kind`, `subject_id`, `agent_id`, `project_id`, `owner_account_id` ON `sandbox`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`kind` IS NOT OLD.`kind`
  OR NEW.`subject_kind` IS NOT OLD.`subject_kind`
  OR NEW.`subject_id` IS NOT OLD.`subject_id`
  OR NEW.`agent_id` IS NOT OLD.`agent_id`
  OR NEW.`project_id` IS NOT OLD.`project_id`
  OR NEW.`owner_account_id` IS NOT OLD.`owner_account_id`
BEGIN
  SELECT RAISE(ABORT, 'sandbox identity is immutable');
END;
--> statement-breakpoint
INSERT INTO `__runtime_subject_authority_guard` (`assertion`, `violation_count`)
SELECT 'post-migration foreign key violations', COUNT(*)
FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE `__runtime_subject_identity`;
--> statement-breakpoint
DROP TABLE `__runtime_subject_authority_guard`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "__protocol_v3_cutover" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "command_freeze" integer NOT NULL DEFAULT 0 CHECK ("command_freeze" IN (0, 1)),
  "enabled" integer NOT NULL DEFAULT 1 CHECK ("enabled" IN (0, 1)),
  "phase" text NOT NULL DEFAULT 'draining' CHECK ("phase" IN ('draining', 'queues_resuming')),
  "pre_migration_bookmark" text,
  "release_tree_oid" text NOT NULL CHECK ((length("release_tree_oid") = 40 OR length("release_tree_oid") = 64) AND "release_tree_oid" = lower("release_tree_oid") AND "release_tree_oid" NOT GLOB '*[^0-9a-f]*'),
  "smoke_account_id" text,
  "smoke_request_key" text,
  "smoke_session_id" text,
  "target_container_application_version" integer,
  "target_container_image_digest" text,
  "target_worker_version_id" text,
  "started_at" integer NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT "protocol_v3_cutover_phase_check" CHECK (
    ("phase" = 'draining' AND "enabled" = 1)
    OR ("phase" = 'queues_resuming' AND "command_freeze" = 1)
  ),
  CONSTRAINT "protocol_v3_cutover_rollout_check" CHECK (
    ("target_container_application_version" IS NULL AND "target_container_image_digest" IS NULL AND "target_worker_version_id" IS NULL)
    OR ("target_container_application_version" >= 0 AND length("target_container_image_digest") = 64 AND "target_container_image_digest" = lower("target_container_image_digest") AND "target_container_image_digest" NOT GLOB '*[^0-9a-f]*' AND length(trim("target_worker_version_id")) > 0)
  )
);
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_session_run_insert"
BEFORE INSERT ON "session_run"
WHEN NEW."status" IN ('queued', 'booting', 'running', 'waiting_input')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."session_id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active Session Runs');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_session_run_update"
BEFORE UPDATE OF "status" ON "session_run"
WHEN NEW."status" IN ('queued', 'booting', 'running', 'waiting_input')
  AND OLD."status" NOT IN ('queued', 'booting', 'running', 'waiting_input')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."session_id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Session Run reactivation');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_project_deployment_run_insert"
BEFORE INSERT ON "project_deployment_run"
WHEN NEW."status" IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active App deployment Runs');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_project_deployment_run_update"
BEFORE UPDATE OF "status" ON "project_deployment_run"
WHEN NEW."status" IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating')
  AND OLD."status" NOT IN ('queued', 'preparing', 'building', 'submitting', 'submitted', 'activating')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks App deployment Run reactivation');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_driver_insert"
BEFORE INSERT ON "driver_instance"
WHEN NEW."status" IN ('provisioning', 'connecting', 'ready', 'stopping')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."sandbox_session_id"
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
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new live Driver instances');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_driver_update"
BEFORE UPDATE OF "status" ON "driver_instance"
WHEN NEW."status" IN ('provisioning', 'connecting', 'ready', 'stopping')
  AND OLD."status" NOT IN ('provisioning', 'connecting', 'ready', 'stopping')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."sandbox_session_id"
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
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Driver reactivation');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_command_insert"
BEFORE INSERT ON "driver_command"
WHEN EXISTS (
    SELECT 1 FROM "__protocol_v3_cutover"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN ('input.start', 'mcp.execute'))
  )
  AND NOT (
    NEW."kind" = 'session.stop'
    AND EXISTS (
      SELECT 1
      FROM "driver_instance" AS "smoke_driver"
      WHERE "smoke_driver"."id" = NEW."driver_instance_id"
        AND EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = "smoke_driver"."sandbox_session_id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    INNER JOIN "sandbox" AS "smoke_sandbox"
      ON "smoke_sandbox"."id" = "smoke_driver"."sandbox_id"
     AND "smoke_sandbox"."subject_kind" = 'session'
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new Driver commands');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_insert"
BEFORE INSERT ON "sandbox"
WHEN (NEW."status" <> 'cold'
      OR NEW."operation_kind" IS NOT NULL
      OR NEW."status_operation_id" IS NOT NULL
      OR NEW."claim_owner" IS NOT NULL
      OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = 'session' AND EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."subject_id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  ))
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active sandboxes');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_update"
BEFORE UPDATE OF "status", "operation_kind", "status_operation_id", "claim_owner", "claim_expires_at" ON "sandbox"
WHEN OLD."status" = 'cold'
  AND OLD."operation_kind" IS NULL
  AND OLD."status_operation_id" IS NULL
  AND OLD."claim_owner" IS NULL
  AND OLD."claim_expires_at" IS NULL
  AND (NEW."status" <> 'cold'
       OR NEW."operation_kind" IS NOT NULL
       OR NEW."status_operation_id" IS NOT NULL
       OR NEW."claim_owner" IS NOT NULL
       OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = 'session' AND EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."subject_id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  ))
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox activation');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_session_insert"
BEFORE INSERT ON "sandbox_session"
WHEN NEW."status" NOT IN ('closed', 'error')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."session_id"
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
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active sandbox Sessions');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_session_update"
BEFORE UPDATE OF "status" ON "sandbox_session"
WHEN OLD."status" IN ('closed', 'error')
  AND NEW."status" NOT IN ('closed', 'error')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."session_id"
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
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox Session reactivation');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_backup_insert"
BEFORE INSERT ON "sandbox_backup"
WHEN NEW."status" NOT IN ('ready', 'pruned')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new sandbox backup work');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_sandbox_backup_update"
BEFORE UPDATE OF "status" ON "sandbox_backup"
WHEN OLD."status" IN ('ready', 'pruned')
  AND NEW."status" NOT IN ('ready', 'pruned')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox backup reactivation');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_session_insert"
BEFORE INSERT ON "session"
WHEN NOT (NEW."status" IN ('IDLE', 'TERMINATED')
  AND NEW."status_operation_id" IS NULL
  AND (NEW."cleanup_operation_kind" IS NULL
       OR (NEW."cleanup_operation_kind" = 'archive'
           AND NEW."status" = 'IDLE'
           AND NEW."archived_at" IS NOT NULL))
  AND NEW."runtime_provisioning_operation_id" IS NULL
  AND NEW."runtime_provisioning_run_id" IS NULL
  AND NEW."runtime_provisioning_sandbox_id" IS NULL
  AND NEW."runtime_provisioning_sandbox_session_id" IS NULL
  AND NEW."runtime_provisioning_sandbox_incarnation" IS NULL
  AND NEW."runtime_provisioning_heartbeat_at" IS NULL)
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND "gate"."smoke_session_id" IS NULL
      AND "gate"."smoke_account_id" = NEW."creator_account_id"
      AND "gate"."smoke_request_key" = NEW."end_user_id"
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new Session operations');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_session_update"
BEFORE UPDATE OF "status", "status_operation_id", "archived_at", "cleanup_operation_kind", "runtime_provisioning_operation_id", "runtime_provisioning_run_id", "runtime_provisioning_sandbox_id", "runtime_provisioning_sandbox_session_id", "runtime_provisioning_sandbox_incarnation", "runtime_provisioning_heartbeat_at" ON "session"
WHEN (OLD."status" IN ('IDLE', 'TERMINATED')
  AND OLD."status_operation_id" IS NULL
  AND (OLD."cleanup_operation_kind" IS NULL
       OR (OLD."cleanup_operation_kind" = 'archive'
           AND OLD."status" = 'IDLE'
           AND OLD."archived_at" IS NOT NULL))
  AND OLD."runtime_provisioning_operation_id" IS NULL
  AND OLD."runtime_provisioning_run_id" IS NULL
  AND OLD."runtime_provisioning_sandbox_id" IS NULL
  AND OLD."runtime_provisioning_sandbox_session_id" IS NULL
  AND OLD."runtime_provisioning_sandbox_incarnation" IS NULL
  AND OLD."runtime_provisioning_heartbeat_at" IS NULL)
  AND NOT (NEW."status" IN ('IDLE', 'TERMINATED')
  AND NEW."status_operation_id" IS NULL
  AND (NEW."cleanup_operation_kind" IS NULL
       OR (NEW."cleanup_operation_kind" = 'archive'
           AND NEW."status" = 'IDLE'
           AND NEW."archived_at" IS NOT NULL))
  AND NEW."runtime_provisioning_operation_id" IS NULL
  AND NEW."runtime_provisioning_run_id" IS NULL
  AND NEW."runtime_provisioning_sandbox_id" IS NULL
  AND NEW."runtime_provisioning_sandbox_session_id" IS NULL
  AND NEW."runtime_provisioning_sandbox_incarnation" IS NULL
  AND NEW."runtime_provisioning_heartbeat_at" IS NULL)
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "__protocol_v3_cutover" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = NEW."id"
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Session operation acquisition');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_api_command_insert"
BEFORE INSERT ON "api_command"
WHEN NEW."status" IN ('queued', 'running')
  AND EXISTS (
    SELECT 1 FROM "__protocol_v3_cutover"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN ('session_run_dispatch', 'app_deployment_run_dispatch', 'environment_package_artifact_build'))
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new nonterminal API commands');
END;
CREATE TRIGGER IF NOT EXISTS "__protocol_v3_cutover_api_command_update"
BEFORE UPDATE OF "kind", "status", "claim_owner", "claim_expires_at", "delivery_generation" ON "api_command"
WHEN EXISTS (
    SELECT 1 FROM "__protocol_v3_cutover"
    WHERE "enabled" = 1
      AND (
        ("command_freeze" = 1
         AND (
           NEW."delivery_generation" IS NOT OLD."delivery_generation"
           OR (NEW."status" IN ('queued', 'running')
               AND (OLD."status" NOT IN ('queued', 'running') OR NEW."kind" IS NOT OLD."kind"))
         ))
        OR ("command_freeze" = 0
            AND NEW."kind" IN ('session_run_dispatch', 'app_deployment_run_dispatch', 'environment_package_artifact_build')
            AND NEW."status" IN ('queued', 'running')
            AND (OLD."status" NOT IN ('queued', 'running') OR NEW."kind" IS NOT OLD."kind"))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks API command admission');
END;
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
END;
