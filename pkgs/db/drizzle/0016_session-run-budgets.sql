CREATE TABLE `session_run_budget` (
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`cap_usd_micros` integer NOT NULL,
	`estimated_cost_usd_micros` integer DEFAULT 0 NOT NULL,
	`active_request_id` text,
	`blocked_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade
);
