CREATE TABLE `session_run_artifact` (
	`committed_event_id` text CHECK ("committed_event_id" = upper("committed_event_id") AND length("committed_event_id") = 26 AND substr("committed_event_id", 1, 1) GLOB '[0-7]' AND "committed_event_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`file_id` text CHECK ("file_id" = upper("file_id") AND length("file_id") = 26 AND substr("file_id", 1, 1) GLOB '[0-7]' AND "file_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`mime_type` text,
	`name` text NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`session_run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_run_artifact_committed_event_idx` ON `session_run_artifact` (`committed_event_id`);--> statement-breakpoint
CREATE INDEX `session_run_artifact_run_created_idx` ON `session_run_artifact` (`session_run_id`,`created_at`,`file_id`);
