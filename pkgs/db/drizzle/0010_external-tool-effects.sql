CREATE TABLE `external_tool_effect_attempt` (
	`attempt` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`effect_id` text CHECK ("effect_id" = upper("effect_id") AND length("effect_id") = 26 AND substr("effect_id", 1, 1) GLOB '[0-7]' AND "effect_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`provider_receipt_json` text,
	`result_json` text,
	`status` text NOT NULL,
	PRIMARY KEY(`effect_id`, `attempt`),
	FOREIGN KEY (`effect_id`) REFERENCES `external_tool_effect`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_tool_effect_attempt_status_check" CHECK("external_tool_effect_attempt"."status" IN ('executing', 'succeeded', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `external_tool_effect_attempt_status_idx` ON `external_tool_effect_attempt` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `external_tool_effect` (
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`command_id` text CHECK ("command_id" = upper("command_id") AND length("command_id") = 26 AND substr("command_id", 1, 1) GLOB '[0-7]' AND "command_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`provider_receipt_json` text,
	`result_json` text,
	`server_id` text CHECK ("server_id" = upper("server_id") AND length("server_id") = 26 AND substr("server_id", 1, 1) GLOB '[0-7]' AND "server_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`tool_name` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`command_id`) REFERENCES `driver_command`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`driver_instance_id`) REFERENCES `driver_instance`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_tool_effect_status_check" CHECK("external_tool_effect"."status" IN ('intent', 'executing', 'succeeded', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_tool_effect_command_idx` ON `external_tool_effect` (`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_tool_effect_idempotency_key_idx` ON `external_tool_effect` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `external_tool_effect_run_status_idx` ON `external_tool_effect` (`session_run_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `external_tool_effect_driver_status_idx` ON `external_tool_effect` (`driver_instance_id`,`status`);
