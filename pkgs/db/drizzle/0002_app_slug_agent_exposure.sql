ALTER TABLE `agent` ADD `exposed_via_api` integer;--> statement-breakpoint
ALTER TABLE `app` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `app_slug_idx` ON `app` (`slug`) WHERE "app"."slug" IS NOT NULL;
