CREATE TABLE `usage_event_rollup_receipt` (
	`rolled_up_at` integer NOT NULL,
	`source` text NOT NULL,
	`source_event_id` text NOT NULL,
	PRIMARY KEY(`source`, `source_event_id`)
);
--> statement-breakpoint
CREATE INDEX `usage_event_rollup_receipt_rolled_up_at_idx` ON `usage_event_rollup_receipt` (`rolled_up_at`);
