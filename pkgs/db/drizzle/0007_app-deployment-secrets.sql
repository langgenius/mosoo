CREATE TABLE `app_deployment_secret` (
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`name` text NOT NULL,
	`vault_secret_id` text CHECK ("vault_secret_id" = upper("vault_secret_id") AND length("vault_secret_id") = 26 AND substr("vault_secret_id", 1, 1) GLOB '[0-7]' AND "vault_secret_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	FOREIGN KEY (`vault_secret_id`) REFERENCES `vault_secret`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_deployment_secret_app_name_idx` ON `app_deployment_secret` (`app_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `app_deployment_secret_vault_secret_idx` ON `app_deployment_secret` (`vault_secret_id`);