ALTER TABLE `external_tool_effect_attempt` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `native_resume_ref` ADD `committed_format_version` integer;--> statement-breakpoint
ALTER TABLE `native_resume_ref` ADD `invalidated_at` integer;--> statement-breakpoint
ALTER TABLE `native_resume_ref` ADD `invalidated_source_event_id` text;--> statement-breakpoint
ALTER TABLE `session_event` ADD `canonical_event_json` text;