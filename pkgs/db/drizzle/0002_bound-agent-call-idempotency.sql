CREATE TABLE `bound_agent_call_idempotency_key` (
	`body_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`run_id` text CHECK ("run_id" = upper("run_id") AND length("run_id") = 26 AND substr("run_id", 1, 1) GLOB '[0-7]' AND "run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`subject_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bound_agent_call_idempotency_subject_key_idx` ON `bound_agent_call_idempotency_key` (`subject_hash`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `bound_agent_call_idempotency_updated_idx` ON `bound_agent_call_idempotency_key` (`updated_at`);
