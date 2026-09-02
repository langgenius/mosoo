CREATE TABLE IF NOT EXISTS "__production_deploy_lease" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "owner" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "__protocol_v3_legacy_rewrite_authorization" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "gate_id" integer NOT NULL CHECK ("gate_id" = 1) REFERENCES "__protocol_v3_cutover" ("id") ON DELETE CASCADE,
  "bookmark" text NOT NULL CHECK (length(trim("bookmark")) > 0),
  "candidate_count" integer NOT NULL CHECK ("candidate_count" >= 0),
  "candidate_manifest_json" text NOT NULL CHECK (json_valid("candidate_manifest_json") AND json_type("candidate_manifest_json") = 'array'),
  "deploy_owner" text NOT NULL,
  "expires_at" integer NOT NULL,
  "release_tree_oid" text NOT NULL CHECK ((length("release_tree_oid") = 40 OR length("release_tree_oid") = 64) AND "release_tree_oid" = lower("release_tree_oid") AND "release_tree_oid" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `__session_event_v3_terminal_source_guard` (
	`violation_count` integer NOT NULL,
	CONSTRAINT "session_event_v3_terminal_source_guard_check" CHECK(`violation_count` = 0)
);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM (
	SELECT 1
	FROM `session_event`
	WHERE `event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
		AND `run_id` IS NOT NULL
	GROUP BY `session_id`, `run_id`
	HAVING count(*) > 1
);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_event` AS `event`
LEFT JOIN `session_run` AS `run` ON `run`.`id` = `event`.`run_id`
WHERE `event`.`event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
	AND (
		`event`.`run_id` IS NULL
		OR `run`.`id` IS NULL
		OR `run`.`session_id` <> `event`.`session_id`
		OR NOT (
			(`run`.`status` = 'completed' AND `event`.`event_type` = 'run.completed')
			OR (`run`.`status` = 'failed' AND `event`.`event_type` = 'run.failed')
			OR (`run`.`status` IN ('cancelled', 'expired') AND `event`.`event_type` = 'run.cancelled')
		)
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_event` AS `terminal`
WHERE `terminal`.`event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
	AND `terminal`.`source_event_id` <>
		'session-run-terminal:' || `terminal`.`run_id` || ':' || `terminal`.`event_type`
	AND EXISTS (
		SELECT 1
		FROM `session_event` AS `other`
		WHERE `other`.`session_id` = `terminal`.`session_id`
			AND `other`.`source_event_id` =
				'session-run-terminal:' || `terminal`.`run_id` || ':' || `terminal`.`event_type`
			AND `other`.`id` <> `terminal`.`id`
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_run` AS `run`
WHERE `run`.`status` IN ('cancelled', 'completed', 'expired', 'failed')
	AND NOT EXISTS (
		SELECT 1
		FROM `session_event` AS `event`
		WHERE `event`.`session_id` = `run`.`session_id`
			AND `event`.`run_id` = `run`.`id`
			AND `event`.`event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_event` AS `event`
INNER JOIN `session_run` AS `run`
	ON `run`.`id` = `event`.`run_id`
	AND `run`.`session_id` = `event`.`session_id`
LEFT JOIN `session` ON `session`.`id` = `run`.`session_id`
WHERE `event`.`event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
	AND (
		`session`.`id` IS NULL
		OR `run`.`completed_at` IS NULL
		OR `run`.`status_event` <> CASE `run`.`status`
			WHEN 'completed' THEN 'run.complete'
			WHEN 'failed' THEN 'run.fail'
			WHEN 'cancelled' THEN 'run.cancel'
			WHEN 'expired' THEN 'run.expire'
		END
		OR `event`.`seq` > `session`.`runtime_event_seq_cursor`
		OR (
			`session`.`last_run_id` = `run`.`id`
			AND (
				`session`.`status` NOT IN ('IDLE', 'TERMINATED')
				OR `session`.`status_operation_id` IS NOT NULL
			)
		)
		OR EXISTS (
			SELECT 1
			FROM `session_permission_request` AS `permission`
			WHERE `permission`.`session_id` = `run`.`session_id`
				AND `permission`.`run_id` = `run`.`id`
		)
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM (
	SELECT `message`.`session_id`, `message`.`session_run_id`
	FROM `session_message` AS `message`
	INNER JOIN `session_run` AS `run`
		ON `run`.`id` = `message`.`session_run_id`
		AND `run`.`session_id` = `message`.`session_id`
	WHERE `message`.`role` = 'assistant'
		AND `message`.`session_run_id` IS NOT NULL
		AND `run`.`status` = 'completed'
	GROUP BY `message`.`session_id`, `message`.`session_run_id`
	HAVING count(*) > 1
);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_message` AS `message`
LEFT JOIN `session_run` AS `run` ON `run`.`id` = `message`.`session_run_id`
LEFT JOIN `session` ON `session`.`id` = `message`.`session_id`
WHERE `message`.`role` = 'assistant'
	AND `message`.`session_run_id` IS NOT NULL
	AND (
		`run`.`id` IS NULL
		OR `run`.`session_id` <> `message`.`session_id`
		OR `session`.`id` IS NULL
		OR `message`.`seq` > `session`.`message_seq_cursor`
		OR `run`.`status` IN ('cancelled', 'expired', 'failed')
		OR CASE
			WHEN `message`.`plan_json` IS NULL OR `message`.`plan_json` = '' THEN 0
			WHEN json_valid(`message`.`plan_json`) = 0 THEN 1
			WHEN json_type(`message`.`plan_json`) <> 'array' THEN 1
			ELSE 0
		END = 1
		OR CASE
			WHEN `message`.`segments_json` IS NULL OR `message`.`segments_json` = '' THEN 0
			WHEN json_valid(`message`.`segments_json`) = 0 THEN 1
			WHEN json_type(`message`.`segments_json`) <> 'array' THEN 1
			ELSE 0
		END = 1
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_run`
WHERE `status` = 'failed'
	AND (
		`error_code` IS NULL
		OR trim(`error_code`) = ''
		OR `error_message` IS NULL
		OR trim(`error_message`) = ''
		OR CASE
			WHEN `error_details_json` IS NULL THEN 0
			WHEN json_valid(`error_details_json`) = 0 THEN 1
			WHEN json_type(`error_details_json`) <> 'object' THEN 1
			ELSE 0
		END = 1
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_run`
WHERE `status` IN ('cancelled', 'completed', 'expired')
	AND (
		`error_code` IS NOT NULL
		OR `error_details_json` IS NOT NULL
		OR `error_message` IS NOT NULL
	);
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `session_run`
WHERE `status` IN ('queued', 'booting', 'running', 'waiting_input');
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `driver_instance`
WHERE `status` IN ('provisioning', 'connecting', 'ready', 'stopping');
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `driver_command`
WHERE `status` IN ('queued', 'delivered', 'accepted');
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `external_tool_effect`
WHERE `status` IN ('executing', 'claimed');
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `api_command`
WHERE `status` IN ('queued', 'running');
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `sandbox`
WHERE `status` <> 'cold'
	OR `status_operation_id` IS NOT NULL
	OR `claim_owner` IS NOT NULL
	OR `claim_expires_at` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `sandbox_session`
WHERE `status` NOT IN ('closed', 'error');
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `sandbox_backup`
WHERE `status` NOT IN ('ready', 'pruned') OR `error_message` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*) FROM `session`
WHERE `status` NOT IN ('IDLE', 'TERMINATED') OR `status_operation_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT CASE
	WHEN count(*) = 1 AND coalesce(sum(
		`name` = 'session_event_tool_identity_consistency' COLLATE BINARY
		AND `tbl_name` = 'session_event' COLLATE BINARY
		AND `sql` = 'CREATE TRIGGER `session_event_tool_identity_consistency`
BEFORE INSERT ON `session_event`
WHEN NEW.`tool_call_id` IS NOT NULL AND EXISTS (
  SELECT 1
  FROM `session_event` AS existing
  WHERE existing.`session_id` = NEW.`session_id`
    AND existing.`tool_call_id` = NEW.`tool_call_id`
    AND (
      (
        NEW.`tool_name` IS NOT NULL
        AND existing.`tool_name` IS NOT NULL
        AND NEW.`tool_name` <> existing.`tool_name`
      )
      OR (
        NEW.`tool_input_json` IS NOT NULL
        AND existing.`tool_input_json` IS NOT NULL
        AND NEW.`tool_input_json` <> existing.`tool_input_json`
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, ''session_event tool identity conflict'');
END' COLLATE BINARY
	), 0) = 1 THEN 0
	ELSE 1
END
FROM `sqlite_master`
WHERE `type` = 'trigger' AND `tbl_name` COLLATE NOCASE = 'session_event';
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
WITH `expected_gate` (`type`, `name`, `table_name`, `sql`) AS (
	VALUES ('table', '__protocol_v3_cutover', '__protocol_v3_cutover', 'CREATE TABLE "__protocol_v3_cutover" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "command_freeze" integer NOT NULL DEFAULT 0 CHECK ("command_freeze" IN (0, 1)),
  "enabled" integer NOT NULL DEFAULT 1 CHECK ("enabled" IN (0, 1)),
  "phase" text NOT NULL DEFAULT ''draining'' CHECK ("phase" IN (''draining'', ''queues_resuming'')),
  "pre_migration_bookmark" text,
  "release_tree_oid" text NOT NULL CHECK ((length("release_tree_oid") = 40 OR length("release_tree_oid") = 64) AND "release_tree_oid" = lower("release_tree_oid") AND "release_tree_oid" NOT GLOB ''*[^0-9a-f]*''),
  "smoke_account_id" text,
  "smoke_request_key" text,
  "smoke_session_id" text,
  "target_container_application_version" integer,
  "target_container_image_digest" text,
  "target_worker_version_id" text,
  "started_at" integer NOT NULL DEFAULT (CAST(unixepoch(''subsec'') * 1000 AS INTEGER)),
  CONSTRAINT "protocol_v3_cutover_phase_check" CHECK (
    ("phase" = ''draining'' AND "enabled" = 1)
    OR ("phase" = ''queues_resuming'' AND "command_freeze" = 1)
  ),
  CONSTRAINT "protocol_v3_cutover_rollout_check" CHECK (
    ("target_container_application_version" IS NULL AND "target_container_image_digest" IS NULL AND "target_worker_version_id" IS NULL)
    OR ("target_container_application_version" >= 0 AND length("target_container_image_digest") = 64 AND "target_container_image_digest" = lower("target_container_image_digest") AND "target_container_image_digest" NOT GLOB ''*[^0-9a-f]*'' AND length(trim("target_worker_version_id")) > 0)
  )
)'),
         ('trigger', '__protocol_v3_cutover_session_run_insert', 'session_run', 'CREATE TRIGGER "__protocol_v3_cutover_session_run_insert"
BEFORE INSERT ON "session_run"
WHEN NEW."status" IN (''queued'', ''booting'', ''running'', ''waiting_input'')
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
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new active Session Runs'');
END'),
         ('trigger', '__protocol_v3_cutover_session_run_update', 'session_run', 'CREATE TRIGGER "__protocol_v3_cutover_session_run_update"
BEFORE UPDATE OF "status" ON "session_run"
WHEN NEW."status" IN (''queued'', ''booting'', ''running'', ''waiting_input'')
  AND OLD."status" NOT IN (''queued'', ''booting'', ''running'', ''waiting_input'')
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
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks Session Run reactivation'');
END'),
         ('trigger', '__protocol_v3_cutover_project_deployment_run_insert', 'project_deployment_run', 'CREATE TRIGGER "__protocol_v3_cutover_project_deployment_run_insert"
BEFORE INSERT ON "project_deployment_run"
WHEN NEW."status" IN (''queued'', ''preparing'', ''building'', ''submitting'', ''submitted'', ''activating'')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new active App deployment Runs'');
END'),
         ('trigger', '__protocol_v3_cutover_project_deployment_run_update', 'project_deployment_run', 'CREATE TRIGGER "__protocol_v3_cutover_project_deployment_run_update"
BEFORE UPDATE OF "status" ON "project_deployment_run"
WHEN NEW."status" IN (''queued'', ''preparing'', ''building'', ''submitting'', ''submitted'', ''activating'')
  AND OLD."status" NOT IN (''queued'', ''preparing'', ''building'', ''submitting'', ''submitted'', ''activating'')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks App deployment Run reactivation'');
END'),
         ('trigger', '__protocol_v3_cutover_driver_insert', 'driver_instance', 'CREATE TRIGGER "__protocol_v3_cutover_driver_insert"
BEFORE INSERT ON "driver_instance"
WHEN NEW."status" IN (''provisioning'', ''connecting'', ''ready'', ''stopping'')
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
     AND "smoke_sandbox"."subject_kind" = ''session''
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new live Driver instances'');
END'),
         ('trigger', '__protocol_v3_cutover_driver_update', 'driver_instance', 'CREATE TRIGGER "__protocol_v3_cutover_driver_update"
BEFORE UPDATE OF "status" ON "driver_instance"
WHEN NEW."status" IN (''provisioning'', ''connecting'', ''ready'', ''stopping'')
  AND OLD."status" NOT IN (''provisioning'', ''connecting'', ''ready'', ''stopping'')
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
     AND "smoke_sandbox"."subject_kind" = ''session''
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks Driver reactivation'');
END'),
         ('trigger', '__protocol_v3_cutover_command_insert', 'driver_command', 'CREATE TRIGGER "__protocol_v3_cutover_command_insert"
BEFORE INSERT ON "driver_command"
WHEN EXISTS (
    SELECT 1 FROM "__protocol_v3_cutover"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN (''input.start'', ''mcp.execute''))
  )
  AND NOT (
    NEW."kind" = ''session.stop''
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
     AND "smoke_sandbox"."subject_kind" = ''session''
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
    )
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new Driver commands'');
END'),
         ('trigger', '__protocol_v3_cutover_sandbox_insert', 'sandbox', 'CREATE TRIGGER "__protocol_v3_cutover_sandbox_insert"
BEFORE INSERT ON "sandbox"
WHEN (NEW."status" <> ''cold''
      OR NEW."status_operation_id" IS NOT NULL
      OR NEW."claim_owner" IS NOT NULL
      OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = ''session'' AND EXISTS (
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
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new active sandboxes'');
END'),
         ('trigger', '__protocol_v3_cutover_sandbox_update', 'sandbox', 'CREATE TRIGGER "__protocol_v3_cutover_sandbox_update"
BEFORE UPDATE OF "status", "status_operation_id", "claim_owner", "claim_expires_at" ON "sandbox"
WHEN OLD."status" = ''cold''
  AND OLD."status_operation_id" IS NULL
  AND OLD."claim_owner" IS NULL
  AND OLD."claim_expires_at" IS NULL
  AND (NEW."status" <> ''cold''
       OR NEW."status_operation_id" IS NOT NULL
       OR NEW."claim_owner" IS NOT NULL
       OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = ''session'' AND EXISTS (
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
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks sandbox activation'');
END'),
         ('trigger', '__protocol_v3_cutover_sandbox_session_insert', 'sandbox_session', 'CREATE TRIGGER "__protocol_v3_cutover_sandbox_session_insert"
BEFORE INSERT ON "sandbox_session"
WHEN NEW."status" NOT IN (''closed'', ''error'')
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
     AND "smoke_sandbox"."subject_kind" = ''session''
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new active sandbox Sessions'');
END'),
         ('trigger', '__protocol_v3_cutover_sandbox_session_update', 'sandbox_session', 'CREATE TRIGGER "__protocol_v3_cutover_sandbox_session_update"
BEFORE UPDATE OF "status" ON "sandbox_session"
WHEN OLD."status" IN (''closed'', ''error'')
  AND NEW."status" NOT IN (''closed'', ''error'')
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
     AND "smoke_sandbox"."subject_kind" = ''session''
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks sandbox Session reactivation'');
END'),
         ('trigger', '__protocol_v3_cutover_sandbox_backup_insert', 'sandbox_backup', 'CREATE TRIGGER "__protocol_v3_cutover_sandbox_backup_insert"
BEFORE INSERT ON "sandbox_backup"
WHEN NEW."status" NOT IN (''ready'', ''pruned'')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new sandbox backup work'');
END'),
         ('trigger', '__protocol_v3_cutover_sandbox_backup_update', 'sandbox_backup', 'CREATE TRIGGER "__protocol_v3_cutover_sandbox_backup_update"
BEFORE UPDATE OF "status" ON "sandbox_backup"
WHEN OLD."status" IN (''ready'', ''pruned'')
  AND NEW."status" NOT IN (''ready'', ''pruned'')
  AND EXISTS (SELECT 1 FROM "__protocol_v3_cutover" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks sandbox backup reactivation'');
END'),
         ('trigger', '__protocol_v3_cutover_session_insert', 'session', 'CREATE TRIGGER "__protocol_v3_cutover_session_insert"
BEFORE INSERT ON "session"
WHEN (NEW."status" NOT IN (''IDLE'', ''TERMINATED'') OR NEW."status_operation_id" IS NOT NULL)
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
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new Session operations'');
END'),
         ('trigger', '__protocol_v3_cutover_session_update', 'session', 'CREATE TRIGGER "__protocol_v3_cutover_session_update"
BEFORE UPDATE OF "status", "status_operation_id" ON "session"
WHEN OLD."status" IN (''IDLE'', ''TERMINATED'')
  AND OLD."status_operation_id" IS NULL
  AND (NEW."status" NOT IN (''IDLE'', ''TERMINATED'') OR NEW."status_operation_id" IS NOT NULL)
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
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks Session operation acquisition'');
END'),
         ('trigger', '__protocol_v3_cutover_api_command_insert', 'api_command', 'CREATE TRIGGER "__protocol_v3_cutover_api_command_insert"
BEFORE INSERT ON "api_command"
WHEN NEW."status" IN (''queued'', ''running'')
  AND EXISTS (
    SELECT 1 FROM "__protocol_v3_cutover"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN (''session_run_dispatch'', ''app_deployment_run_dispatch'', ''environment_package_artifact_build''))
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks new nonterminal API commands'');
END'),
         ('trigger', '__protocol_v3_cutover_api_command_update', 'api_command', 'CREATE TRIGGER "__protocol_v3_cutover_api_command_update"
BEFORE UPDATE OF "kind", "status", "claim_owner", "claim_expires_at" ON "api_command"
WHEN NEW."status" IN (''queued'', ''running'')
  AND (OLD."status" NOT IN (''queued'', ''running'') OR NEW."kind" IS NOT OLD."kind")
  AND EXISTS (
    SELECT 1 FROM "__protocol_v3_cutover"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN (''session_run_dispatch'', ''app_deployment_run_dispatch'', ''environment_package_artifact_build''))
  )
BEGIN
  SELECT RAISE(ABORT, ''protocol v3 cutover blocks API command admission'');
END')
),
`actual_gate` AS (
  SELECT "type", "name", "tbl_name" AS "table_name", "sql"
  FROM "sqlite_master"
  WHERE "name" COLLATE NOCASE IN ('__protocol_v3_cutover', '__protocol_v3_cutover_session_run_insert', '__protocol_v3_cutover_session_run_update', '__protocol_v3_cutover_project_deployment_run_insert', '__protocol_v3_cutover_project_deployment_run_update', '__protocol_v3_cutover_driver_insert', '__protocol_v3_cutover_driver_update', '__protocol_v3_cutover_command_insert', '__protocol_v3_cutover_sandbox_insert', '__protocol_v3_cutover_sandbox_update', '__protocol_v3_cutover_sandbox_session_insert', '__protocol_v3_cutover_sandbox_session_update', '__protocol_v3_cutover_sandbox_backup_insert', '__protocol_v3_cutover_sandbox_backup_update', '__protocol_v3_cutover_session_insert', '__protocol_v3_cutover_session_update', '__protocol_v3_cutover_api_command_insert', '__protocol_v3_cutover_api_command_update', '__protocol_v3_cutover_sandbox_backup_staging_insert')
    OR (
      "type" = 'trigger'
      AND "tbl_name" COLLATE NOCASE IN ('__production_deploy_lease', '__protocol_v3_cutover', '__protocol_v3_legacy_rewrite_authorization', 'api_command', 'project_deployment_run', 'driver_command', 'driver_instance', 'sandbox', 'sandbox_backup', 'sandbox_backup_staging', 'sandbox_session', 'session', 'session_run')
      AND NOT (
        (
  "type" = 'trigger'
  AND "name" = '__protocol_v3_legacy_rewrite_gate_update' COLLATE BINARY
  AND "tbl_name" = '__protocol_v3_cutover' COLLATE BINARY
  AND "sql" = 'CREATE TRIGGER "__protocol_v3_legacy_rewrite_gate_update"
AFTER UPDATE ON "__protocol_v3_cutover"
BEGIN
  DELETE FROM "__protocol_v3_legacy_rewrite_authorization" WHERE "id" = 1;
END' COLLATE BINARY
)
        OR (
  "type" = 'trigger'
  AND "name" = 'sandbox_identity_immutable' COLLATE BINARY
  AND "tbl_name" = 'sandbox' COLLATE BINARY
  AND "sql" = 'CREATE TRIGGER `sandbox_identity_immutable`
BEFORE UPDATE OF `id`, `kind`, `subject_kind`, `subject_id`, `agent_id`, `project_id`, `owner_account_id` ON `sandbox`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`kind` IS NOT OLD.`kind`
  OR NEW.`subject_kind` IS NOT OLD.`subject_kind`
  OR NEW.`subject_id` IS NOT OLD.`subject_id`
  OR NEW.`agent_id` IS NOT OLD.`agent_id`
  OR NEW.`project_id` IS NOT OLD.`project_id`
  OR NEW.`owner_account_id` IS NOT OLD.`owner_account_id`
BEGIN
  SELECT RAISE(ABORT, ''sandbox identity is immutable'');
END' COLLATE BINARY
)
      )
    )
),
`manifest` AS (
	SELECT
		count(*) AS `candidate_count`,
		json_group_array(json_array(
			`id`, `session_id`, `run_id`, `event_type`, `source_event_id`, `seq`
		)) AS `candidate_manifest_json`
	FROM (
		SELECT `id`, `session_id`, `run_id`, `event_type`, `source_event_id`, `seq`
		FROM `session_event`
		WHERE `event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
			AND `source_event_id` <>
				'session-run-terminal:' || `run_id` || ':' || `event_type`
		ORDER BY `id` COLLATE BINARY
	)
)
SELECT CASE
	WHEN `manifest`.`candidate_count` = 0 THEN 0
		WHEN EXISTS (
			SELECT 1
				FROM `__protocol_v3_legacy_rewrite_authorization` AS `authorization`
				INNER JOIN `__production_deploy_lease` AS `lease`
				ON `lease`.`id` = 1
			AND `lease`.`owner` = `authorization`.`deploy_owner`
			WHERE `authorization`.`id` = 1
				AND `authorization`.`expires_at` > unixepoch()
				AND `authorization`.`candidate_count` = `manifest`.`candidate_count`
				AND `authorization`.`candidate_manifest_json` = `manifest`.`candidate_manifest_json` COLLATE BINARY
				AND (
					SELECT `sql` FROM `sqlite_master`
					WHERE `type` = 'table'
						AND `name` = '__protocol_v3_legacy_rewrite_authorization'
				) = 'CREATE TABLE "__protocol_v3_legacy_rewrite_authorization" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "gate_id" integer NOT NULL CHECK ("gate_id" = 1) REFERENCES "__protocol_v3_cutover" ("id") ON DELETE CASCADE,
  "bookmark" text NOT NULL CHECK (length(trim("bookmark")) > 0),
  "candidate_count" integer NOT NULL CHECK ("candidate_count" >= 0),
  "candidate_manifest_json" text NOT NULL CHECK (json_valid("candidate_manifest_json") AND json_type("candidate_manifest_json") = ''array''),
  "deploy_owner" text NOT NULL,
  "expires_at" integer NOT NULL,
  "release_tree_oid" text NOT NULL CHECK ((length("release_tree_oid") = 40 OR length("release_tree_oid") = 64) AND "release_tree_oid" = lower("release_tree_oid") AND "release_tree_oid" NOT GLOB ''*[^0-9a-f]*'')
)' COLLATE BINARY
					AND (
						SELECT `sql` FROM `sqlite_master`
						WHERE `type` = 'table' AND `name` = '__production_deploy_lease'
					) = 'CREATE TABLE "__production_deploy_lease" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "owner" text NOT NULL
)' COLLATE BINARY
					AND NOT EXISTS (
						SELECT 1 FROM `sqlite_master`
						WHERE `type` = 'trigger' AND `tbl_name` = '__production_deploy_lease' COLLATE BINARY
					)
				AND (
					SELECT `sql` FROM `sqlite_master`
					WHERE `type` = 'trigger'
						AND `name` = '__protocol_v3_legacy_rewrite_gate_update'
				) = 'CREATE TRIGGER "__protocol_v3_legacy_rewrite_gate_update"
AFTER UPDATE ON "__protocol_v3_cutover"
BEGIN
  DELETE FROM "__protocol_v3_legacy_rewrite_authorization" WHERE "id" = 1;
END' COLLATE BINARY
				AND (SELECT count(*) FROM `actual_gate`) = 18
				AND (
					SELECT count(*)
					FROM `actual_gate` AS `actual`
					INNER JOIN `expected_gate` AS `expected`
						ON `expected`.`type` = `actual`.`type` COLLATE BINARY
						AND `expected`.`name` = `actual`.`name` COLLATE BINARY
						AND `expected`.`table_name` = `actual`.`table_name` COLLATE BINARY
						AND `expected`.`sql` = `actual`.`sql` COLLATE BINARY
				) = 18
		) THEN 0
	ELSE 1
END
FROM `manifest`;
--> statement-breakpoint
UPDATE `session_event`
SET `source_event_id` = 'session-run-terminal:' || `run_id` || ':' || `event_type`
WHERE `event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
	AND `source_event_id` <> 'session-run-terminal:' || `run_id` || ':' || `event_type`;
--> statement-breakpoint
INSERT INTO `__session_event_v3_terminal_source_guard` (`violation_count`)
SELECT count(*)
FROM `session_event`
WHERE `event_type` IN ('run.cancelled', 'run.completed', 'run.failed')
	AND `source_event_id` <> 'session-run-terminal:' || `run_id` || ':' || `event_type`;
--> statement-breakpoint
DROP TABLE `__session_event_v3_terminal_source_guard`;
--> statement-breakpoint
ALTER TABLE `session_event` ADD `stream_id` text;
--> statement-breakpoint
ALTER TABLE `session_message` ADD `projection_format` text NOT NULL DEFAULT 'materialized'
CHECK (`projection_format` IN ('materialized', 'event_stream_v3'))
CHECK (`projection_format` <> 'event_stream_v3' OR (`role` = 'assistant' AND `session_run_id` IS NOT NULL AND `content_text` = '' AND `plan_json` IS NULL AND `segments_json` IS NULL));
--> statement-breakpoint
ALTER TABLE `session_event` ADD `semantic_hash` text CHECK (`semantic_hash` IS NULL OR (length(`semantic_hash`) = 64 AND `semantic_hash` = lower(`semantic_hash`) AND `semantic_hash` NOT GLOB '*[^0-9a-f]*'));
--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_input_delta_json` text CHECK (`tool_input_delta_json` IS NULL OR `tool_input_json` IS NULL);
--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_output_delta_text` text;
--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_output_text` text CHECK (`tool_output_delta_text` IS NULL OR `tool_output_text` IS NULL);
--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_parent_message_id` text;
--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_result_message_id` text;
--> statement-breakpoint
ALTER TABLE `session_event` ADD `tool_status` text CHECK (`tool_status` IS NULL OR `tool_status` IN ('running', 'completed', 'failed', 'cancelled'));
--> statement-breakpoint
ALTER TABLE `session_event` ADD `mcp_command_id` text
CHECK (`mcp_command_id` = upper(`mcp_command_id`) AND length(`mcp_command_id`) = 26 AND substr(`mcp_command_id`, 1, 1) GLOB '[0-7]' AND `mcp_command_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*')
CHECK (`mcp_command_id` IS NULL OR (`event_type` = 'tool.call.updated' AND `tool_status` IS NOT NULL AND `tool_status` IN ('completed', 'failed', 'cancelled')));
--> statement-breakpoint
UPDATE `session_event`
SET `stream_id` = `id`
WHERE `stream_id` IS NULL
  AND (`event_type` LIKE 'message.%' OR `event_type` LIKE 'thought.%');
--> statement-breakpoint
CREATE UNIQUE INDEX `session_event_mcp_terminal_winner_idx`
ON `session_event` (`session_id`, `mcp_command_id`)
WHERE `mcp_command_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `session_event_run_terminal_winner_idx`
ON `session_event` (`session_id`, `run_id`)
WHERE `semantic_hash` IS NOT NULL
  AND `run_id` IS NOT NULL
  AND `event_type` IN ('run.cancelled', 'run.completed', 'run.failed');
--> statement-breakpoint
CREATE INDEX `session_event_run_stream_process_seq_idx`
ON `session_event` (`run_id`, `stream_id`, `process_type`, `seq`);
--> statement-breakpoint
CREATE INDEX `session_event_run_tool_call_seq_idx`
ON `session_event` (`run_id`, `tool_call_id`, `seq`);
--> statement-breakpoint
ALTER TABLE `session_run` ADD `error_retryable` integer CHECK (`error_retryable` IS NULL OR (`error_retryable` IN (0, 1) AND `error_code` IS NOT NULL AND `error_details_json` IS NOT NULL AND `error_message` IS NOT NULL));
--> statement-breakpoint
UPDATE `session_run`
SET `error_details_json` = COALESCE(`error_details_json`, '{}'),
    `error_retryable` = 0
WHERE `error_code` IS NOT NULL
  AND `error_message` IS NOT NULL
  AND (`error_details_json` IS NULL OR `error_retryable` IS NULL);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `__protocol_v3_legacy_rewrite_gate_update`;
--> statement-breakpoint
DROP TABLE `__protocol_v3_legacy_rewrite_authorization`;
