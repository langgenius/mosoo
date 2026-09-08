ALTER TABLE `personal_access_token` ADD `project_id` text CHECK ("project_id" = upper("project_id") AND length("project_id") = 26 AND substr("project_id", 1, 1) GLOB '[0-7]' AND "project_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*');--> statement-breakpoint
CREATE INDEX `personal_access_token_project_idx` ON `personal_access_token` (`project_id`,`id`);
