CREATE TABLE `workspace_api_key` (
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`token_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_api_key_app_created_idx` ON `workspace_api_key` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workspace_api_key_account_app_idx` ON `workspace_api_key` (`account_id`,`app_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_api_key_hash_idx` ON `workspace_api_key` (`token_hash`);
