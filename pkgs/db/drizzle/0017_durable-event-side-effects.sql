ALTER TABLE `file_record`
ADD `runtime_event_seq` integer
CHECK (`runtime_event_seq` IS NULL OR `runtime_event_seq` >= 0);
--> statement-breakpoint
CREATE INDEX `file_record_runtime_event_seq_idx`
ON `file_record` (`scope_id`, `runtime_event_seq`);
--> statement-breakpoint
CREATE TABLE `runtime_artifact_attempt` (
  `accepted_event_id` text,
  `created_at` integer NOT NULL,
  `created_by_account_id` text CHECK (`created_by_account_id` = upper(`created_by_account_id`) AND length(`created_by_account_id`) = 26 AND substr(`created_by_account_id`, 1, 1) GLOB '[0-7]' AND `created_by_account_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
  `delete_after` integer,
  `driver_connection_id` text NOT NULL,
  `driver_generation` integer NOT NULL,
  `driver_instance_id` text CHECK (`driver_instance_id` = upper(`driver_instance_id`) AND length(`driver_instance_id`) = 26 AND substr(`driver_instance_id`, 1, 1) GLOB '[0-7]' AND `driver_instance_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
  `event_type` text NOT NULL,
  `expires_at` integer,
  `id` text PRIMARY KEY NOT NULL,
  `manifest_json` text,
  `manifest_sha256` text,
  `owned_object_keys_json` text DEFAULT '[]' NOT NULL,
  `run_id` text CHECK (`run_id` = upper(`run_id`) AND length(`run_id`) = 26 AND substr(`run_id`, 1, 1) GLOB '[0-7]' AND `run_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
  `semantic_hash` text NOT NULL,
  `session_id` text CHECK (`session_id` = upper(`session_id`) AND length(`session_id`) = 26 AND substr(`session_id`, 1, 1) GLOB '[0-7]' AND `session_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
  `source_event_id` text NOT NULL,
  `status` text NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT "runtime_artifact_attempt_manifest_check" CHECK((`manifest_json` IS NULL AND `manifest_sha256` IS NULL) OR (`manifest_json` IS NOT NULL AND json_valid(`manifest_json`) = 1 AND json_extract(`manifest_json`, '$.version') IS 1 AND json_type(`manifest_json`, '$.captureStatus') IS 'text' AND json_extract(`manifest_json`, '$.captureStatus') IN ('complete', 'omitted_file_limit', 'omitted_runtime_unavailable', 'omitted_size_limit', 'omitted_source_changed', 'omitted_source_missing') AND json_type(`manifest_json`, '$.mode') IS 'text' AND json_extract(`manifest_json`, '$.mode') IN ('delta', 'snapshot') AND (json_extract(`manifest_json`, '$.captureStatus') = 'complete' OR json_array_length(`manifest_json`, '$.files') = 0) AND json_extract(`manifest_json`, '$.sourceEventId') IS `source_event_id` AND json_extract(`manifest_json`, '$.semanticHash') IS `semantic_hash` AND json_type(`manifest_json`, '$.files') IS 'array' AND `manifest_sha256` IS NOT NULL AND length(`manifest_sha256`) = 64 AND `manifest_sha256` = lower(`manifest_sha256`) AND `manifest_sha256` NOT GLOB '*[^0-9a-f]*')),
  CONSTRAINT "runtime_artifact_attempt_owned_keys_check" CHECK(json_valid(`owned_object_keys_json`) = 1 AND json_type(`owned_object_keys_json`) IS 'array'),
  CONSTRAINT "runtime_artifact_attempt_semantic_hash_check" CHECK(length(`semantic_hash`) = 64 AND `semantic_hash` = lower(`semantic_hash`) AND `semantic_hash` NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT "runtime_artifact_attempt_status_check" CHECK((`status` = 'staging' AND `manifest_json` IS NULL AND `accepted_event_id` IS NULL AND `expires_at` IS NOT NULL AND `delete_after` IS NULL) OR (`status` = 'staged' AND `manifest_json` IS NOT NULL AND `accepted_event_id` IS NULL AND `expires_at` IS NOT NULL AND `delete_after` IS NULL) OR (`status` = 'accepted' AND `manifest_json` IS NOT NULL AND `accepted_event_id` IS NOT NULL AND `expires_at` IS NULL AND `delete_after` IS NULL AND json_array_length(`owned_object_keys_json`) = 0) OR (`status` = 'deleting' AND `accepted_event_id` IS NULL AND `delete_after` IS NOT NULL)),
  CONSTRAINT "runtime_artifact_attempt_time_check" CHECK(`driver_generation` >= 0 AND (`expires_at` IS NULL OR `expires_at` >= `created_at`) AND (`delete_after` IS NULL OR `delete_after` >= `created_at`) AND `updated_at` >= `created_at`)
);
--> statement-breakpoint
CREATE INDEX `runtime_artifact_attempt_cleanup_idx`
ON `runtime_artifact_attempt` (`status`, `expires_at`, `updated_at`, `id`);
--> statement-breakpoint
CREATE INDEX `runtime_artifact_attempt_session_status_idx`
ON `runtime_artifact_attempt` (`session_id`, `status`, `id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_artifact_attempt_accepted_event_idx`
ON `runtime_artifact_attempt` (`accepted_event_id`)
WHERE `accepted_event_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `session_artifact_head` (
  `file_id` text CHECK (`file_id` = upper(`file_id`) AND length(`file_id`) = 26 AND substr(`file_id`, 1, 1) GLOB '[0-7]' AND `file_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  `runtime_event_seq` integer NOT NULL,
  `session_id` text CHECK (`session_id` = upper(`session_id`) AND length(`session_id`) = 26 AND substr(`session_id`, 1, 1) GLOB '[0-7]' AND `session_id` NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
  `source_event_id` text NOT NULL,
  `source_path` text NOT NULL,
  `updated_at` integer NOT NULL,
  CONSTRAINT "session_artifact_head_path_check" CHECK(length(`source_path`) > 8 AND substr(`source_path`, 1, 8) = 'outputs/' AND instr(`source_path`, char(0)) = 0 AND instr(`source_path`, '\') = 0 AND `source_path` NOT LIKE '%//%' AND `source_path` NOT LIKE '%/./%' AND `source_path` NOT LIKE '%/.' AND `source_path` NOT LIKE '%/../%' AND `source_path` NOT LIKE '%/..'),
  CONSTRAINT "session_artifact_head_seq_check" CHECK(`runtime_event_seq` >= 0 AND `updated_at` >= 0),
  FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_artifact_head_session_path_idx`
ON `session_artifact_head` (`session_id`, `source_path`);
--> statement-breakpoint
CREATE INDEX `session_artifact_head_session_seq_idx`
ON `session_artifact_head` (`session_id`, `runtime_event_seq`, `source_path`);
--> statement-breakpoint
WITH legacy_artifact AS (
  SELECT
    legacy_file.`id` AS `file_id`,
    legacy_file.`scope_id` AS `session_id`,
    substr(legacy_file.`parent_path`, 16, length(legacy_file.`parent_path`) - 80) AS `source_path`,
    MAX(legacy_file.`created_at`, 0) AS `updated_at`,
    row_number() OVER (
      PARTITION BY legacy_file.`scope_id`, substr(legacy_file.`parent_path`, 16, length(legacy_file.`parent_path`) - 80)
      ORDER BY legacy_file.`created_at` DESC, legacy_file.`id` DESC
    ) AS `rank`
  FROM `file_record` AS legacy_file
  INNER JOIN `session` AS legacy_session ON legacy_session.`id` = legacy_file.`scope_id`
  WHERE legacy_file.`scope_kind` = 'session'
    AND legacy_file.`scope_id` IS NOT NULL
    AND legacy_file.`session_kind` = 'artifact'
    AND legacy_file.`status` = 'ready'
    AND legacy_file.`runtime_event_seq` IS NULL
    AND substr(legacy_file.`parent_path`, 1, 15) = 'runtime-output/'
    AND length(legacy_file.`parent_path`) > 80
    AND substr(legacy_file.`parent_path`, -65, 1) = '/'
    AND length(substr(legacy_file.`parent_path`, -64)) = 64
    AND substr(legacy_file.`parent_path`, -64) = lower(substr(legacy_file.`parent_path`, -64))
    AND substr(legacy_file.`parent_path`, -64) NOT GLOB '*[^0-9a-f]*'
)
INSERT INTO `session_artifact_head` (
  `file_id`, `runtime_event_seq`, `session_id`, `source_event_id`, `source_path`, `updated_at`
)
SELECT
  `file_id`, 0, `session_id`, 'legacy-file:' || `file_id`, `source_path`, `updated_at`
FROM legacy_artifact
WHERE `rank` = 1
  AND length(`source_path`) > 8
  AND substr(`source_path`, 1, 8) = 'outputs/'
  AND instr(`source_path`, char(0)) = 0
  AND instr(`source_path`, '\') = 0
  AND `source_path` NOT LIKE '%//%'
  AND `source_path` NOT LIKE '%/./%'
  AND `source_path` NOT LIKE '%/.'
  AND `source_path` NOT LIKE '%/../%'
  AND `source_path` NOT LIKE '%/..';
--> statement-breakpoint
ALTER TABLE `native_resume_ref`
ADD `observed_event_seq` integer NOT NULL DEFAULT 0
CHECK (`observed_event_seq` >= 0);
--> statement-breakpoint
ALTER TABLE `session`
ADD `auto_title_event_seq` integer
CHECK (`auto_title_event_seq` IS NULL OR `auto_title_event_seq` >= 0);
--> statement-breakpoint
ALTER TABLE `session_event`
ADD `artifact_attempt_id` text;
--> statement-breakpoint
ALTER TABLE `session_event`
ADD `artifact_manifest_json` text;
--> statement-breakpoint
ALTER TABLE `session_event`
ADD `artifact_manifest_sha256` text
CHECK (
  (`artifact_attempt_id` IS NULL AND `artifact_manifest_json` IS NULL AND `artifact_manifest_sha256` IS NULL)
  OR (
    `artifact_attempt_id` IS NOT NULL
    AND `artifact_manifest_json` IS NOT NULL
    AND json_valid(`artifact_manifest_json`) = 1
    AND json_extract(`artifact_manifest_json`, '$.version') IS 1
    AND json_type(`artifact_manifest_json`, '$.captureStatus') IS 'text'
    AND json_extract(`artifact_manifest_json`, '$.captureStatus') IN ('complete', 'omitted_file_limit', 'omitted_runtime_unavailable', 'omitted_size_limit', 'omitted_source_changed', 'omitted_source_missing')
    AND json_type(`artifact_manifest_json`, '$.mode') IS 'text'
    AND json_extract(`artifact_manifest_json`, '$.mode') IN ('delta', 'snapshot')
    AND (json_extract(`artifact_manifest_json`, '$.captureStatus') = 'complete' OR json_array_length(`artifact_manifest_json`, '$.files') = 0)
    AND json_extract(`artifact_manifest_json`, '$.sourceEventId') IS `source_event_id`
    AND json_extract(`artifact_manifest_json`, '$.semanticHash') IS `semantic_hash`
    AND json_type(`artifact_manifest_json`, '$.files') IS 'array'
    AND `artifact_manifest_sha256` IS NOT NULL
    AND length(`artifact_manifest_sha256`) = 64
    AND `artifact_manifest_sha256` = lower(`artifact_manifest_sha256`)
    AND `artifact_manifest_sha256` NOT GLOB '*[^0-9a-f]*'
    AND `semantic_hash` IS NOT NULL
    AND `event_type` IN ('file.change.updated', 'file.changed', 'run.completed')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_event_artifact_attempt_idx`
ON `session_event` (`artifact_attempt_id`)
WHERE `artifact_attempt_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `session_event`
ADD `terminal_event_json` text
CHECK (
  (`terminal_event_json` IS NULL AND NOT (`semantic_hash` IS NOT NULL AND `event_type` IN ('run.cancelled', 'run.completed', 'run.failed')))
  OR (`terminal_event_json` IS NOT NULL AND json_valid(`terminal_event_json`) = 1 AND `semantic_hash` IS NOT NULL AND `event_type` IN ('run.cancelled', 'run.completed', 'run.failed'))
);
--> statement-breakpoint
ALTER TABLE `session_model_call`
ADD `source_event_seq` integer NOT NULL DEFAULT 0
CHECK (`source_event_seq` >= 0);
--> statement-breakpoint
ALTER TABLE `usage_event`
ADD `source_event_seq` integer NOT NULL DEFAULT 0
CHECK (`source_event_seq` >= 0);
