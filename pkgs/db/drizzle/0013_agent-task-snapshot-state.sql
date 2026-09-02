CREATE TABLE `session_agent_task_snapshot` (
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`run_id` text CHECK ("run_id" = upper("run_id") AND length("run_id") = 26 AND substr("run_id", 1, 1) GLOB '[0-7]' AND "run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`seq` integer NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`tasks_json` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
