CREATE TABLE `agent_deployment_version` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`environment_id` text CHECK ("environment_id" = upper("environment_id") AND length("environment_id") = 26 AND substr("environment_id", 1, 1) GLOB '[0-7]' AND "environment_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mcp_bindings_json` text NOT NULL,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`provider` text NOT NULL,
	`runtime_id` text NOT NULL,
	`skills_json` text NOT NULL,
	`summary` text NOT NULL,
	`version_number` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_deployment_version_agent_number_idx` ON `agent_deployment_version` (`agent_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `agent_deployment_version_agent_created_idx` ON `agent_deployment_version` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_mcp_binding` (
	`agent_credential_id` text CHECK ("agent_credential_id" = upper("agent_credential_id") AND length("agent_credential_id") = 26 AND substr("agent_credential_id", 1, 1) GLOB '[0-7]' AND "agent_credential_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`credential_mode` text DEFAULT 'runtime_resolved' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`server_id` text CHECK ("server_id" = upper("server_id") AND length("server_id") = 26 AND substr("server_id", 1, 1) GLOB '[0-7]' AND "server_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "agent_mcp_binding_agent_credential_shape_check" CHECK(
        ("agent_mcp_binding"."credential_mode" = 'agent_bound' AND "agent_mcp_binding"."agent_credential_id" IS NOT NULL)
        OR ("agent_mcp_binding"."credential_mode" = 'runtime_resolved' AND "agent_mcp_binding"."agent_credential_id" IS NULL)
      )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_mcp_binding_agent_sort_idx` ON `agent_mcp_binding` (`agent_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `agent_mcp_binding_server_idx` ON `agent_mcp_binding` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_mcp_binding_profile_server_idx` ON `agent_mcp_binding` (`agent_id`,`server_id`);--> statement-breakpoint
CREATE TABLE `agent_skill` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`skill_id` text CHECK ("skill_id" = upper("skill_id") AND length("skill_id") = 26 AND substr("skill_id", 1, 1) GLOB '[0-7]' AND "skill_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `skill_id`)
);
--> statement-breakpoint
CREATE INDEX `agent_skill_agent_sort_idx` ON `agent_skill` (`agent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `agent` (
	`config_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`description` text,
	`environment_id` text CHECK ("environment_id" = upper("environment_id") AND length("environment_id") = 26 AND substr("environment_id", 1, 1) GLOB '[0-7]' AND "environment_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'pet' NOT NULL,
	`live_deployment_version_id` text CHECK ("live_deployment_version_id" = upper("live_deployment_version_id") AND length("live_deployment_version_id") = 26 AND substr("live_deployment_version_id", 1, 1) GLOB '[0-7]' AND "live_deployment_version_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`model` text NOT NULL,
	`name` text NOT NULL,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`prompt` text NOT NULL,
	`provider` text NOT NULL,
	`runtime_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`updated_at` integer NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	CONSTRAINT "agent_published_live_deployment_version_check" CHECK("agent"."status" <> 'published' OR "agent"."live_deployment_version_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `agent_app_owner_account_idx` ON `agent` (`app_id`,`owner_account_id`);--> statement-breakpoint
CREATE INDEX `agent_app_status_idx` ON `agent` (`app_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_environment_idx` ON `agent` (`environment_id`);--> statement-breakpoint
CREATE TABLE `api_command` (
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`claim_expires_at` integer,
	`claim_owner` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`last_error_code` text,
	`last_error_message` text,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_command_dedupe_idx` ON `api_command` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `api_command_status_updated_idx` ON `api_command` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `api_command_claim_idx` ON `api_command` (`status`,`claim_expires_at`);--> statement-breakpoint
CREATE TABLE `auth_account` (
	`access_token` text,
	`access_token_expires_at` integer,
	`provider_account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`id_token` text,
	`password` text,
	`provider_id` text NOT NULL,
	`refresh_token` text,
	`refresh_token_expires_at` integer,
	`scope` text,
	`updated_at` integer NOT NULL,
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_account_provider_account_idx` ON `auth_account` (`provider_id`,`provider_account_id`);--> statement-breakpoint
CREATE INDEX `auth_account_account_id_idx` ON `auth_account` (`account_id`);--> statement-breakpoint
CREATE TABLE `auth_session` (
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`ip_address` text,
	`token` text NOT NULL,
	`updated_at` integer NOT NULL,
	`user_agent` text,
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_session_expires_at_idx` ON `auth_session` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_idx` ON `auth_session` (`token`);--> statement-breakpoint
CREATE INDEX `auth_session_account_id_idx` ON `auth_session` (`account_id`);--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`updated_at` integer NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_verification_expires_at_idx` ON `auth_verification` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `cli_oauth_flow` (
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`authorized_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`device_code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`hostname` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	`user_code` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cli_oauth_flow_status_expires_idx` ON `cli_oauth_flow` (`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cli_oauth_flow_device_code_hash_idx` ON `cli_oauth_flow` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `cli_oauth_flow_user_code_idx` ON `cli_oauth_flow` (`user_code`);--> statement-breakpoint
CREATE TABLE `personal_access_token` (
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`token_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personal_access_token_account_created_idx` ON `personal_access_token` (`account_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `personal_access_token_hash_idx` ON `personal_access_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `agent_channel_binding` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`display_metadata_json` text DEFAULT '{}' NOT NULL,
	`encrypted_creds_secret_id` text CHECK ("encrypted_creds_secret_id" = upper("encrypted_creds_secret_id") AND length("encrypted_creds_secret_id") = 26 AND substr("encrypted_creds_secret_id", 1, 1) GLOB '[0-7]' AND "encrypted_creds_secret_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`external_bot_id` text NOT NULL,
	`external_tenant_id` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`last_error_code` text,
	`provider` text NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`encrypted_creds_secret_id`) REFERENCES `vault_secret`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`app_id`) REFERENCES `app`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_channel_binding_agent_provider_idx` ON `agent_channel_binding` (`agent_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_channel_binding_provider_tenant_bot_idx` ON `agent_channel_binding` (`provider`,`external_tenant_id`,`external_bot_id`);--> statement-breakpoint
CREATE INDEX `agent_channel_binding_agent_status_idx` ON `agent_channel_binding` (`agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_channel_binding_app_status_idx` ON `agent_channel_binding` (`app_id`,`status`);--> statement-breakpoint
CREATE TABLE `channel_runtime_state` (
	`binding_id` text CHECK ("binding_id" = upper("binding_id") AND length("binding_id") = 26 AND substr("binding_id", 1, 1) GLOB '[0-7]' AND "binding_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`last_error_code` text,
	`last_heartbeat_at` integer,
	`last_inbound_at` integer,
	`last_poll_at` integer,
	`lease_expires_at` integer,
	`lease_owner_id` text,
	`provider` text NOT NULL,
	`runtime_account_id` text DEFAULT '' NOT NULL,
	`runtime_state_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`status_changed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_channel_binding`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_runtime_state_provider_binding_account_idx` ON `channel_runtime_state` (`provider`,`binding_id`,`runtime_account_id`);--> statement-breakpoint
CREATE INDEX `channel_runtime_state_status_lease_idx` ON `channel_runtime_state` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `channel_runtime_state_binding_updated_idx` ON `channel_runtime_state` (`binding_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `channel_event_receipt` (
	`binding_id` text CHECK ("binding_id" = upper("binding_id") AND length("binding_id") = 26 AND substr("binding_id", 1, 1) GLOB '[0-7]' AND "binding_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`external_event_id` text NOT NULL,
	`external_tenant_id` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_channel_binding`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_event_receipt_provider_tenant_event_idx` ON `channel_event_receipt` (`provider`,`external_tenant_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `channel_event_receipt_binding_updated_idx` ON `channel_event_receipt` (`binding_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `channel_event_receipt_expires_idx` ON `channel_event_receipt` (`expires_at`);--> statement-breakpoint
CREATE TABLE `channel_final_delivery_job` (
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`binding_id` text CHECK ("binding_id" = upper("binding_id") AND length("binding_id") = 26 AND substr("binding_id", 1, 1) GLOB '[0-7]' AND "binding_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`external_event_id` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`last_error_code` text,
	`payload_json` text NOT NULL,
	`provider` text NOT NULL,
	`run_id` text CHECK ("run_id" = upper("run_id") AND length("run_id") = 26 AND substr("run_id", 1, 1) GLOB '[0-7]' AND "run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_channel_binding`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_final_delivery_provider_binding_event_idx` ON `channel_final_delivery_job` (`provider`,`binding_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `channel_final_delivery_session_idx` ON `channel_final_delivery_job` (`session_id`);--> statement-breakpoint
CREATE INDEX `channel_final_delivery_run_idx` ON `channel_final_delivery_job` (`run_id`);--> statement-breakpoint
CREATE TABLE `channel_thread_session` (
	`binding_id` text CHECK ("binding_id" = upper("binding_id") AND length("binding_id") = 26 AND substr("binding_id", 1, 1) GLOB '[0-7]' AND "binding_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`external_thread_id` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`binding_id`) REFERENCES `agent_channel_binding`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_thread_session_provider_binding_thread_idx` ON `channel_thread_session` (`provider`,`binding_id`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `channel_thread_session_session_idx` ON `channel_thread_session` (`session_id`);--> statement-breakpoint
CREATE TABLE `wechat_channel_account` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`base_url` text NOT NULL,
	`created_at` integer NOT NULL,
	`cursor` text,
	`encrypted_creds_secret_id` text CHECK ("encrypted_creds_secret_id" = upper("encrypted_creds_secret_id") AND length("encrypted_creds_secret_id") = 26 AND substr("encrypted_creds_secret_id", 1, 1) GLOB '[0-7]' AND "encrypted_creds_secret_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`external_account_id` text NOT NULL,
	`external_bot_id` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`last_error_code` text,
	`last_heartbeat_at` integer,
	`last_inbound_at` integer,
	`last_poll_at` integer,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`runtime_state_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`status_changed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`encrypted_creds_secret_id`) REFERENCES `vault_secret`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `app`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_channel_account_agent_idx` ON `wechat_channel_account` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_channel_account_external_idx` ON `wechat_channel_account` (`external_account_id`,`external_bot_id`);--> statement-breakpoint
CREATE INDEX `wechat_channel_account_status_idx` ON `wechat_channel_account` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `wechat_channel_account_app_status_idx` ON `wechat_channel_account` (`app_id`,`status`);--> statement-breakpoint
CREATE TABLE `wechat_channel_pairing` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`expires_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`qr_token_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`app_id`) REFERENCES `app`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_channel_pairing_qr_token_hash_idx` ON `wechat_channel_pairing` (`qr_token_hash`);--> statement-breakpoint
CREATE INDEX `wechat_channel_pairing_agent_creator_idx` ON `wechat_channel_pairing` (`agent_id`,`created_by_account_id`,`consumed_at`);--> statement-breakpoint
CREATE INDEX `wechat_channel_pairing_app_creator_idx` ON `wechat_channel_pairing` (`app_id`,`created_by_account_id`,`consumed_at`);--> statement-breakpoint
CREATE INDEX `wechat_channel_pairing_expires_idx` ON `wechat_channel_pairing` (`expires_at`);--> statement-breakpoint
CREATE TABLE `wechat_context_token` (
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`context_token_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`encrypted_context_token_secret_id` text CHECK ("encrypted_context_token_secret_id" = upper("encrypted_context_token_secret_id") AND length("encrypted_context_token_secret_id") = 26 AND substr("encrypted_context_token_secret_id", 1, 1) GLOB '[0-7]' AND "encrypted_context_token_secret_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`external_account_id` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`peer_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wechat_channel_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`encrypted_context_token_secret_id`) REFERENCES `vault_secret`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_context_token_key_idx` ON `wechat_context_token` (`context_token_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `wechat_context_token_account_peer_idx` ON `wechat_context_token` (`account_id`,`external_account_id`,`peer_id`);--> statement-breakpoint
CREATE INDEX `wechat_context_token_account_updated_idx` ON `wechat_context_token` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`created_at` integer NOT NULL,
	`error_message` text,
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`recipient_domain` text,
	`recipient_masked` text NOT NULL,
	`status` text NOT NULL,
	`subject` text NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_log_created_at_idx` ON `email_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `email_log_type_status_idx` ON `email_log` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `environment_revision` (
	`allow_mcp_servers` integer NOT NULL,
	`allow_package_managers` integer NOT NULL,
	`allowed_hosts_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`env_vars_json` text NOT NULL,
	`environment_id` text CHECK ("environment_id" = upper("environment_id") AND length("environment_id") = 26 AND substr("environment_id", 1, 1) GLOB '[0-7]' AND "environment_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`network_policy` text NOT NULL,
	`packages_json` text NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`setup_script` text NOT NULL,
	CONSTRAINT "environment_revision_network_policy_check" CHECK("environment_revision"."network_policy" IN ('full', 'limited'))
);
--> statement-breakpoint
CREATE INDEX `environment_revision_environment_created_at_idx` ON `environment_revision` (`environment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `environment_revision_app_created_at_idx` ON `environment_revision` (`app_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `environment` (
	`created_at` integer NOT NULL,
	`current_revision_id` text CHECK ("current_revision_id" = upper("current_revision_id") AND length("current_revision_id") = 26 AND substr("current_revision_id", 1, 1) GLOB '[0-7]' AND "current_revision_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`description` text NOT NULL,
	`forked_from_environment_id` text CHECK ("forked_from_environment_id" = upper("forked_from_environment_id") AND length("forked_from_environment_id") = 26 AND substr("forked_from_environment_id", 1, 1) GLOB '[0-7]' AND "forked_from_environment_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`forked_from_environment_name` text,
	`forked_from_owner_name` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `environment_app_updated_at_idx` ON `environment` (`app_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `environment_owner_updated_at_idx` ON `environment` (`owner_account_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `environment_owner_name_idx` ON `environment` (`app_id`,`owner_account_id`,`name`) WHERE "environment"."owner_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `environment_system_default_idx` ON `environment` (`app_id`) WHERE "environment"."owner_account_id" IS NULL;--> statement-breakpoint
CREATE TABLE `file_record` (
	`committed` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`etag` text,
	`expires_at` integer,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`mime_type` text,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`owner_id` text CHECK ("owner_id" = upper("owner_id") AND length("owner_id") = 26 AND substr("owner_id", 1, 1) GLOB '[0-7]' AND "owner_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`owner_kind` text NOT NULL,
	`parent_path` text NOT NULL,
	`path` text NOT NULL,
	`purpose` text NOT NULL,
	`scope_id` text CHECK ("scope_id" = upper("scope_id") AND length("scope_id") = 26 AND substr("scope_id", 1, 1) GLOB '[0-7]' AND "scope_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`scope_kind` text NOT NULL,
	`session_kind` text,
	`size` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_object_key_idx` ON `file_record` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_unscoped_parent_path_name_status_idx` ON `file_record` (`scope_kind`,`parent_path`,`name`,`status`) WHERE "file_record"."scope_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_scoped_parent_path_name_status_idx` ON `file_record` (`scope_kind`,`scope_id`,`parent_path`,`name`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_unscoped_pending_path_idx` ON `file_record` (`scope_kind`,`path`) WHERE "file_record"."status" = 'pending' AND "file_record"."scope_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_scoped_pending_path_idx` ON `file_record` (`scope_kind`,`scope_id`,`path`) WHERE "file_record"."status" = 'pending' AND "file_record"."scope_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_unscoped_ready_path_idx` ON `file_record` (`scope_kind`,`path`) WHERE "file_record"."status" = 'ready' AND "file_record"."scope_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `file_record_scoped_ready_path_idx` ON `file_record` (`scope_kind`,`scope_id`,`path`) WHERE "file_record"."status" = 'ready' AND "file_record"."scope_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `file_record_governance_idx` ON `file_record` (`purpose`,`owner_kind`,`owner_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `file_record_listing_idx` ON `file_record` (`scope_kind`,`scope_id`,`parent_path`,`status`,lower("name"));--> statement-breakpoint
CREATE TABLE `file_upload` (
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`expected_size` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`file_id` text CHECK ("file_id" = upper("file_id") AND length("file_id") = 26 AND substr("file_id", 1, 1) GLOB '[0-7]' AND "file_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`if_match_etag` text,
	`multipart_upload_id` text,
	`overwrite` integer NOT NULL,
	`part_size` integer,
	`scope_id` text CHECK ("scope_id" = upper("scope_id") AND length("scope_id") = 26 AND substr("scope_id", 1, 1) GLOB '[0-7]' AND "scope_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`scope_kind` text NOT NULL,
	`status` text NOT NULL,
	`strategy` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_upload_file_id_idx` ON `file_upload` (`file_id`);--> statement-breakpoint
CREATE INDEX `file_upload_status_expires_idx` ON `file_upload` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `file_version` (
	`committed` integer NOT NULL,
	`committed_at` integer,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`file_id` text CHECK ("file_id" = upper("file_id") AND length("file_id") = 26 AND substr("file_id", 1, 1) GLOB '[0-7]' AND "file_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`mime_type` text,
	`object_key` text NOT NULL,
	`path` text NOT NULL,
	`reason` text NOT NULL,
	`scope_id` text CHECK ("scope_id" = upper("scope_id") AND length("scope_id") = 26 AND substr("scope_id", 1, 1) GLOB '[0-7]' AND "scope_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`scope_kind` text NOT NULL,
	`size` integer NOT NULL,
	`source_etag` text NOT NULL,
	`source_object_key` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_version_object_key_idx` ON `file_version` (`object_key`);--> statement-breakpoint
CREATE INDEX `file_version_scope_path_created_idx` ON `file_version` (`scope_kind`,`scope_id`,`path`,`created_at`);--> statement-breakpoint
CREATE INDEX `file_version_file_created_idx` ON `file_version` (`file_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `file_version_pending_idx` ON `file_version` (`committed`,`created_at`) WHERE "file_version"."committed" = 0;--> statement-breakpoint
CREATE TABLE `mcp_credential` (
	`account_id` text CHECK ("account_id" = upper("account_id") AND length("account_id") = 26 AND substr("account_id", 1, 1) GLOB '[0-7]' AND "account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`auth_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`last_refreshed_at` integer,
	`oauth_client_id` text,
	`oauth_client_secret_secret_id` text,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`refresh_secret_id` text,
	`scope` text NOT NULL,
	`scope_values_json` text,
	`secret_id` text NOT NULL,
	`server_id` text CHECK ("server_id" = upper("server_id") AND length("server_id") = 26 AND substr("server_id", 1, 1) GLOB '[0-7]' AND "server_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`subject_label` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mcp_credential_scope_shape_check" CHECK(
        ("mcp_credential"."scope" = 'app' AND "mcp_credential"."account_id" IS NULL AND "mcp_credential"."agent_id" IS NULL)
        OR ("mcp_credential"."scope" = 'agent' AND "mcp_credential"."account_id" IS NULL AND "mcp_credential"."agent_id" IS NOT NULL)
      ),
	CONSTRAINT "mcp_credential_scope_values_json_check" CHECK(
        "mcp_credential"."scope_values_json" IS NULL
        OR (json_valid("mcp_credential"."scope_values_json") AND json_type("mcp_credential"."scope_values_json") = 'array')
      ),
	CONSTRAINT "mcp_credential_bearer_shape_check" CHECK(
      "mcp_credential"."auth_type" != 'bearer'
      OR (
        "mcp_credential"."oauth_client_id" IS NULL
        AND "mcp_credential"."oauth_client_secret_secret_id" IS NULL
        AND "mcp_credential"."refresh_secret_id" IS NULL
      )
    )
);
--> statement-breakpoint
CREATE INDEX `mcp_credential_server_scope_status_idx` ON `mcp_credential` (`server_id`,`scope`,`status`);--> statement-breakpoint
CREATE INDEX `mcp_credential_app_scope_status_idx` ON `mcp_credential` (`app_id`,`scope`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_credential_app_scope_idx` ON `mcp_credential` (`server_id`,`scope`) WHERE "mcp_credential"."scope" = 'app';--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_credential_agent_scope_idx` ON `mcp_credential` (`server_id`,`agent_id`,`scope`) WHERE "mcp_credential"."scope" = 'agent' AND "mcp_credential"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `mcp_oauth_flow` (
	`authorization_endpoint` text NOT NULL,
	`cleanup_after` integer NOT NULL,
	`code_verifier` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`error_message` text,
	`expires_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`initiator_account_id` text CHECK ("initiator_account_id" = upper("initiator_account_id") AND length("initiator_account_id") = 26 AND substr("initiator_account_id", 1, 1) GLOB '[0-7]' AND "initiator_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`oauth_client_id` text NOT NULL,
	`oauth_client_secret_secret_id` text,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`registration_endpoint` text,
	`return_url` text,
	`scope_values_json` text,
	`server_id` text CHECK ("server_id" = upper("server_id") AND length("server_id") = 26 AND substr("server_id", 1, 1) GLOB '[0-7]' AND "server_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`subject_label` text,
	`token_endpoint` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mcp_oauth_flow_scope_values_json_check" CHECK(
        "mcp_oauth_flow"."scope_values_json" IS NULL
        OR (json_valid("mcp_oauth_flow"."scope_values_json") AND json_type("mcp_oauth_flow"."scope_values_json") = 'array')
      )
);
--> statement-breakpoint
CREATE INDEX `mcp_oauth_flow_status_cleanup_after_idx` ON `mcp_oauth_flow` (`status`,`cleanup_after`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_flow_expires_at_idx` ON `mcp_oauth_flow` (`expires_at`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_flow_server_account_idx` ON `mcp_oauth_flow` (`server_id`,`initiator_account_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_flow_app_server_account_idx` ON `mcp_oauth_flow` (`app_id`,`server_id`,`initiator_account_id`);--> statement-breakpoint
CREATE TABLE `mcp_server` (
	`auth_type` text NOT NULL,
	`byo_client_id` text,
	`byo_client_secret_secret_id` text,
	`created_at` integer NOT NULL,
	`credential_scope` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`icon_url` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`oauth_metadata_json` text,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	`url` text NOT NULL,
	CONSTRAINT "mcp_server_source_scope_check" CHECK("mcp_server"."source" = 'app' AND "mcp_server"."credential_scope" = 'app')
);
--> statement-breakpoint
CREATE INDEX `mcp_server_app_enabled_idx` ON `mcp_server` (`app_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `mcp_server_owner_app_idx` ON `mcp_server` (`owner_account_id`,`app_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_app_url_idx` ON `mcp_server` (`app_id`,`url`);--> statement-breakpoint
CREATE TABLE `vault_secret` (
	`algorithm` text DEFAULT 'AES-GCM' NOT NULL,
	`ciphertext` text NOT NULL,
	`ciphertext_iv` text NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`updated_at` integer NOT NULL,
	`wrapped_dek` text NOT NULL,
	`wrapped_dek_iv` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vault_secret_kind_created_at_idx` ON `vault_secret` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `organization` (
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`creator_account_id` text CHECK ("creator_account_id" = upper("creator_account_id") AND length("creator_account_id") = 26 AND substr("creator_account_id", 1, 1) GLOB '[0-7]' AND "creator_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_creator_account_idx` ON `organization` (`creator_account_id`) WHERE "organization"."creator_account_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `app_vibe_app` (
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`updated_at` integer NOT NULL,
	`vibe_app_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_vibe_app_app_idx` ON `app_vibe_app` (`app_id`);--> statement-breakpoint
CREATE TABLE `app` (
	`created_at` integer NOT NULL,
	`default_environment_id` text CHECK ("default_environment_id" = upper("default_environment_id") AND length("default_environment_id") = 26 AND substr("default_environment_id", 1, 1) GLOB '[0-7]' AND "default_environment_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_id` text CHECK ("organization_id" = upper("organization_id") AND length("organization_id") = 26 AND substr("organization_id", 1, 1) GLOB '[0-7]' AND "organization_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `public_api_idempotency_key` (
	`body_hash` text,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`method` text NOT NULL,
	`response_json` text,
	`response_status` integer,
	`route` text NOT NULL,
	`token_id` text CHECK ("token_id" = upper("token_id") AND length("token_id") = 26 AND substr("token_id", 1, 1) GLOB '[0-7]' AND "token_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_api_idempotency_token_key_idx` ON `public_api_idempotency_key` (`token_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `public_api_idempotency_updated_idx` ON `public_api_idempotency_key` (`updated_at`);--> statement-breakpoint
CREATE TABLE `public_api_rate_limit_window` (
	`bucket_key` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`shard` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`window_start` integer NOT NULL,
	PRIMARY KEY(`bucket_key`, `window_start`, `shard`)
);
--> statement-breakpoint
CREATE INDEX `public_api_rate_limit_window_updated_idx` ON `public_api_rate_limit_window` (`updated_at`);--> statement-breakpoint
CREATE TABLE `driver_command` (
	`acked_at` integer,
	`completed_at` integer,
	`delivery_connection_id` text,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`error_json` text,
	`expires_at` integer,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`issued_at` integer NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`seq` integer NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`driver_instance_id`) REFERENCES `driver_instance`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `driver_command_instance_seq_idx` ON `driver_command` (`driver_instance_id`,`seq`);--> statement-breakpoint
CREATE INDEX `driver_command_instance_status_idx` ON `driver_command` (`driver_instance_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `driver_instance_mcp_grant` (
	`auth_type` text NOT NULL,
	`authorization_state` text NOT NULL,
	`can_invalidate` integer DEFAULT false NOT NULL,
	`can_refresh` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`credential_id` text CHECK ("credential_id" = upper("credential_id") AND length("credential_id") = 26 AND substr("credential_id", 1, 1) GLOB '[0-7]' AND "credential_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`server_id` text CHECK ("server_id" = upper("server_id") AND length("server_id") = 26 AND substr("server_id", 1, 1) GLOB '[0-7]' AND "server_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`driver_instance_id`) REFERENCES `driver_instance`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `driver_instance_mcp_grant_instance_server_idx` ON `driver_instance_mcp_grant` (`driver_instance_id`,`server_id`);--> statement-breakpoint
CREATE INDEX `driver_instance_mcp_grant_instance_credential_idx` ON `driver_instance_mcp_grant` (`driver_instance_id`,`credential_id`);--> statement-breakpoint
CREATE TABLE `driver_instance` (
	`boot_token_expires_at` integer NOT NULL,
	`boot_token_hash` blob NOT NULL,
	`boot_token_used_at` integer,
	`close_code` integer,
	`close_reason` text,
	`connection_id` text,
	`created_at` integer NOT NULL,
	`command_seq_cursor` integer DEFAULT 0 NOT NULL,
	`driver_pid` integer,
	`driver_started_at` integer,
	`driver_version` text,
	`error_message` text,
	`expires_at` integer NOT NULL,
	`heartbeat_count` integer NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`last_heartbeat_at` integer,
	`process_id` text,
	`protocol` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`restart_count` integer DEFAULT 0 NOT NULL,
	`runtime` text NOT NULL,
	`sandbox_id` text CHECK ("sandbox_id" = upper("sandbox_id") AND length("sandbox_id") = 26 AND substr("sandbox_id", 1, 1) GLOB '[0-7]' AND "sandbox_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`sandbox_session_id` text CHECK ("sandbox_session_id" = upper("sandbox_session_id") AND length("sandbox_session_id") = 26 AND substr("sandbox_session_id", 1, 1) GLOB '[0-7]' AND "sandbox_session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`status_changed_at` integer DEFAULT 0 NOT NULL,
	`status_event` text DEFAULT 'driver.provision' NOT NULL,
	`status_operation_id` text CHECK ("status_operation_id" = upper("status_operation_id") AND length("status_operation_id") = 26 AND substr("status_operation_id", 1, 1) GLOB '[0-7]' AND "status_operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`status_seq` integer DEFAULT 0 NOT NULL,
	`status_source` text DEFAULT 'system' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "driver_instance_status_check" CHECK("driver_instance"."status" IN ('provisioning', 'connecting', 'ready', 'stopping', 'stopped', 'failed')),
	CONSTRAINT "driver_instance_status_seq_check" CHECK("driver_instance"."status_seq" >= 0)
);
--> statement-breakpoint
CREATE INDEX `driver_instance_completed_idx` ON `driver_instance` (`expires_at`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `driver_instance_connection_idx` ON `driver_instance` (`connection_id`) WHERE "driver_instance"."connection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `driver_instance_boot_token_expiry_idx` ON `driver_instance` (`status`,`boot_token_expires_at`) WHERE "driver_instance"."boot_token_used_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `driver_instance_boot_token_hash_idx` ON `driver_instance` (`boot_token_hash`);--> statement-breakpoint
CREATE INDEX `driver_instance_sandbox_session_idx` ON `driver_instance` (`sandbox_id`,`sandbox_session_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `driver_instance_live_sandbox_session_idx` ON `driver_instance` (`sandbox_id`,`sandbox_session_id`) WHERE "driver_instance"."status" IN ('provisioning', 'connecting', 'ready', 'stopping');--> statement-breakpoint
CREATE TABLE `native_resume_ref` (
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`observed_driver_instance_id` text CHECK ("observed_driver_instance_id" = upper("observed_driver_instance_id") AND length("observed_driver_instance_id") = 26 AND substr("observed_driver_instance_id", 1, 1) GLOB '[0-7]' AND "observed_driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`observed_session_run_id` text CHECK ("observed_session_run_id" = upper("observed_session_run_id") AND length("observed_session_run_id") = 26 AND substr("observed_session_run_id", 1, 1) GLOB '[0-7]' AND "observed_session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`runtime_id` text NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `native_resume_ref_runtime_updated_idx` ON `native_resume_ref` (`runtime_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `sandbox_backup` (
	`created_at` integer NOT NULL,
	`dir` text NOT NULL,
	`error_message` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`keep` integer DEFAULT false NOT NULL,
	`sandbox_id` text CHECK ("sandbox_id" = upper("sandbox_id") AND length("sandbox_id") = 26 AND substr("sandbox_id", 1, 1) GLOB '[0-7]' AND "sandbox_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`status` text NOT NULL,
	`ttl_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sandbox_backup_sandbox_status_created_idx` ON `sandbox_backup` (`sandbox_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sandbox_session` (
	`cloudflare_session_id` text CHECK ("cloudflare_session_id" = upper("cloudflare_session_id") AND length("cloudflare_session_id") = 26 AND substr("cloudflare_session_id", 1, 1) GLOB '[0-7]' AND "cloudflare_session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`cwd` text NOT NULL,
	`origin_json` text NOT NULL,
	`sandbox_id` text CHECK ("sandbox_id" = upper("sandbox_id") AND length("sandbox_id") = 26 AND substr("sandbox_id", 1, 1) GLOB '[0-7]' AND "sandbox_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sandbox_session_sandbox_status_idx` ON `sandbox_session` (`sandbox_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_session_cloudflare_session_idx` ON `sandbox_session` (`cloudflare_session_id`);--> statement-breakpoint
CREATE TABLE `sandbox` (
	`bind_mount_ready` integer DEFAULT false NOT NULL,
	`claim_expires_at` integer,
	`claim_owner` text,
	`created_at` integer NOT NULL,
	`global_mounts_json` text DEFAULT '[]' NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`inactive_deadline_at` integer,
	`kind` text NOT NULL,
	`last_backup_id` text CHECK ("last_backup_id" = upper("last_backup_id") AND length("last_backup_id") = 26 AND substr("last_backup_id", 1, 1) GLOB '[0-7]' AND "last_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`last_error` text,
	`last_error_code` text,
	`last_restore_backup_id` text CHECK ("last_restore_backup_id" = upper("last_restore_backup_id") AND length("last_restore_backup_id") = 26 AND substr("last_restore_backup_id", 1, 1) GLOB '[0-7]' AND "last_restore_backup_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`status` text NOT NULL,
	`status_changed_at` integer DEFAULT 0 NOT NULL,
	`status_event` text DEFAULT 'runtime_subject.cold' NOT NULL,
	`status_operation_id` text CHECK ("status_operation_id" = upper("status_operation_id") AND length("status_operation_id") = 26 AND substr("status_operation_id", 1, 1) GLOB '[0-7]' AND "status_operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`status_seq` integer DEFAULT 0 NOT NULL,
	`status_source` text DEFAULT 'system' NOT NULL,
	`subject_id` text CHECK ("subject_id" = upper("subject_id") AND length("subject_id") = 26 AND substr("subject_id", 1, 1) GLOB '[0-7]' AND "subject_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`subject_kind` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "sandbox_status_check" CHECK("sandbox"."status" IN ('cold', 'restoring', 'active', 'backing_up', 'destroying', 'error')),
	CONSTRAINT "sandbox_status_seq_check" CHECK("sandbox"."status_seq" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_subject_idx` ON `sandbox` (`kind`,`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `sandbox_status_deadline_idx` ON `sandbox` (`status`,`inactive_deadline_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `sandbox_claim_idx` ON `sandbox` (`claim_expires_at`,`claim_owner`);--> statement-breakpoint
CREATE TABLE `session_message` (
	`content_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`plan_json` text,
	`role` text NOT NULL,
	`segments_json` text,
	`seq` integer NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_message_session_seq_idx` ON `session_message` (`session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `session_message_run_idx` ON `session_message` (`session_run_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`archived_at` integer,
	`attributed_user_id` text CHECK ("attributed_user_id" = upper("attributed_user_id") AND length("attributed_user_id") = 26 AND substr("attributed_user_id", 1, 1) GLOB '[0-7]' AND "attributed_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`created_at` integer NOT NULL,
	`creator_account_id` text CHECK ("creator_account_id" = upper("creator_account_id") AND length("creator_account_id") = 26 AND substr("creator_account_id", 1, 1) GLOB '[0-7]' AND "creator_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`deployment_version_id` text CHECK ("deployment_version_id" = upper("deployment_version_id") AND length("deployment_version_id") = 26 AND substr("deployment_version_id", 1, 1) GLOB '[0-7]' AND "deployment_version_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`deployment_version_number` integer,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`last_message_at` integer,
	`last_run_id` text CHECK ("last_run_id" = upper("last_run_id") AND length("last_run_id") = 26 AND substr("last_run_id", 1, 1) GLOB '[0-7]' AND "last_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`message_seq_cursor` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`model` text NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`provider` text NOT NULL,
	`renamed` integer NOT NULL,
	`runtime_id` text NOT NULL,
	`status` text NOT NULL,
	`status_operation_id` text CHECK ("status_operation_id" = upper("status_operation_id") AND length("status_operation_id") = 26 AND substr("status_operation_id", 1, 1) GLOB '[0-7]' AND "status_operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`status_seq` integer DEFAULT 0 NOT NULL,
	`runtime_event_seq_cursor` integer DEFAULT 0 NOT NULL,
	`title` text,
	`type` text DEFAULT 'preview' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "session_status_check" CHECK("session"."status" IN ('IDLE', 'RUNNING', 'RESCHEDULING', 'TERMINATED')),
	CONSTRAINT "session_status_seq_check" CHECK("session"."status_seq" >= 0)
);
--> statement-breakpoint
CREATE INDEX `session_agent_updated_idx` ON `session` (`agent_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_app_creator_archived_updated_idx` ON `session` (`app_id`,`creator_account_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_app_attributed_archived_updated_idx` ON `session` (`app_id`,`attributed_user_id`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_app_creator_type_archived_updated_idx` ON `session` (`app_id`,`creator_account_id`,`type`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_app_attributed_type_archived_updated_idx` ON `session` (`app_id`,`attributed_user_id`,`type`,`archived_at`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_status_operation_updated_idx` ON `session` (`status`,`status_operation_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `session_status_updated_idx` ON `session` (`status`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `session_execution_snapshot` (
	`created_at` integer NOT NULL,
	`plan_json` text NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session_run_skill` (
	`blob_sha256` text,
	`created_at` integer NOT NULL,
	`materialization_status` text NOT NULL,
	`mount_path` text NOT NULL,
	`resolution_mode` text NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`skill_id` text CHECK ("skill_id" = upper("skill_id") AND length("skill_id") = 26 AND substr("skill_id", 1, 1) GLOB '[0-7]' AND "skill_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`skill_name` text NOT NULL,
	`snapshot_id` text CHECK ("snapshot_id" = upper("snapshot_id") AND length("snapshot_id") = 26 AND substr("snapshot_id", 1, 1) GLOB '[0-7]' AND "snapshot_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`updated_at` integer NOT NULL,
	`warning_code` text,
	PRIMARY KEY(`session_run_id`, `skill_id`),
	FOREIGN KEY (`session_run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_run_skill_run_resolution_idx` ON `session_run_skill` (`session_run_id`,`resolution_mode`);--> statement-breakpoint
CREATE TABLE `session_run` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`created_by_account_id` text CHECK ("created_by_account_id" = upper("created_by_account_id") AND length("created_by_account_id") = 26 AND substr("created_by_account_id", 1, 1) GLOB '[0-7]' AND "created_by_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`deployment_version_id` text CHECK ("deployment_version_id" = upper("deployment_version_id") AND length("deployment_version_id") = 26 AND substr("deployment_version_id", 1, 1) GLOB '[0-7]' AND "deployment_version_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`deployment_version_number` integer,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`error_code` text,
	`error_details_json` text,
	`error_message` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`model` text,
	`provider` text,
	`runtime_id` text,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`started_at` integer,
	`status` text NOT NULL,
	`status_changed_at` integer DEFAULT 0 NOT NULL,
	`status_event` text DEFAULT 'run.queue' NOT NULL,
	`status_operation_id` text CHECK ("status_operation_id" = upper("status_operation_id") AND length("status_operation_id") = 26 AND substr("status_operation_id", 1, 1) GLOB '[0-7]' AND "status_operation_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`status_seq` integer DEFAULT 0 NOT NULL,
	`status_source` text DEFAULT 'system' NOT NULL,
	`trace_id` text NOT NULL,
	`trigger` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_run_status_check" CHECK("session_run"."status" IN ('queued', 'booting', 'running', 'waiting_input', 'completed', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "session_run_status_seq_check" CHECK("session_run"."status_seq" >= 0)
);
--> statement-breakpoint
CREATE INDEX `session_run_driver_instance_idx` ON `session_run` (`driver_instance_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_run_active_driver_lease_idx` ON `session_run` (`driver_instance_id`) WHERE "session_run"."driver_instance_id" IS NOT NULL AND "session_run"."status" IN ('queued', 'booting', 'running', 'waiting_input');--> statement-breakpoint
CREATE INDEX `session_run_session_created_at_idx` ON `session_run` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_run_session_status_idx` ON `session_run` (`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `session_event` (
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`content_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`event_type` text NOT NULL,
	`family` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`process_status` text NOT NULL,
	`process_type` text NOT NULL,
	`run_id` text CHECK ("run_id" = upper("run_id") AND length("run_id") = 26 AND substr("run_id", 1, 1) GLOB '[0-7]' AND "run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`seq` integer NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`source_event_id` text NOT NULL,
	`source` text NOT NULL,
	`tokens` integer,
	`trace_id` text,
	`visibility` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_event_agent_family_created_idx` ON `session_event` (`agent_id`,`family`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_event_agent_visibility_created_idx` ON `session_event` (`agent_id`,`visibility`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_event_agent_created_idx` ON `session_event` (`agent_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `session_event_session_visibility_seq_idx` ON `session_event` (`session_id`,`visibility`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_event_session_seq_idx` ON `session_event` (`session_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_event_session_source_idx` ON `session_event` (`session_id`,`source_event_id`);--> statement-breakpoint
CREATE TABLE `session_model_call` (
	`cache_creation_tokens` integer,
	`cache_read_tokens` integer,
	`call_key` text NOT NULL,
	`completed_at` integer,
	`cost_currency` text,
	`created_at` integer NOT NULL,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`error_code` text,
	`error_message` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`input_tokens` integer,
	`metadata_json` text,
	`model` text NOT NULL,
	`native_call_id` text,
	`output_tokens` integer,
	`provider` text NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`started_at` integer,
	`status` text NOT NULL,
	`total_cost_usd_micros` integer,
	`trace_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_run_id`) REFERENCES `session_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_model_call_run_created_idx` ON `session_model_call` (`session_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `session_model_call_session_created_idx` ON `session_model_call` (`session_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_model_call_run_key_idx` ON `session_model_call` (`session_run_id`,`call_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_model_call_native_idx` ON `session_model_call` (`driver_instance_id`,`native_call_id`);--> statement-breakpoint
CREATE TABLE `session_permission_request` (
	`created_at` integer NOT NULL,
	`driver_instance_id` text CHECK ("driver_instance_id" = upper("driver_instance_id") AND length("driver_instance_id") = 26 AND substr("driver_instance_id", 1, 1) GLOB '[0-7]' AND "driver_instance_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`raw_input` text,
	`request_id` text NOT NULL,
	`run_id` text CHECK ("run_id" = upper("run_id") AND length("run_id") = 26 AND substr("run_id", 1, 1) GLOB '[0-7]' AND "run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`title` text NOT NULL,
	`tool_call_id` text,
	`tool_kind` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `request_id`),
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_permission_request_run_idx` ON `session_permission_request` (`session_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `session_readiness_snapshot` (
	`readiness_json` text NOT NULL,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `skill_snapshot_entry` (
	`entry_kind` text NOT NULL,
	`is_executable` integer NOT NULL,
	`mime_type` text,
	`path` text NOT NULL,
	`sha256` text,
	`size` integer NOT NULL,
	`snapshot_id` text CHECK ("snapshot_id" = upper("snapshot_id") AND length("snapshot_id") = 26 AND substr("snapshot_id", 1, 1) GLOB '[0-7]' AND "snapshot_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	PRIMARY KEY(`snapshot_id`, `path`)
);
--> statement-breakpoint
CREATE TABLE `skill_snapshot` (
	`author` text NOT NULL,
	`blob_key` text NOT NULL,
	`blob_sha256` text NOT NULL,
	`blob_size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`description` text NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`skill_markdown_path` text NOT NULL,
	`uncompressed_size` integer NOT NULL,
	`version` text
);
--> statement-breakpoint
CREATE INDEX `skill_snapshot_app_created_at_idx` ON `skill_snapshot` (`app_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `skill_snapshot_blob_sha256_idx` ON `skill_snapshot` (`app_id`,`blob_sha256`);--> statement-breakpoint
CREATE TABLE `skill` (
	`author` text NOT NULL,
	`created_at` integer NOT NULL,
	`current_snapshot_id` text CHECK ("current_snapshot_id" = upper("current_snapshot_id") AND length("current_snapshot_id") = 26 AND substr("current_snapshot_id", 1, 1) GLOB '[0-7]' AND "current_snapshot_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`description` text NOT NULL,
	`forked_from_owner_name` text,
	`forked_from_skill_id` text CHECK ("forked_from_skill_id" = upper("forked_from_skill_id") AND length("forked_from_skill_id") = 26 AND substr("forked_from_skill_id", 1, 1) GLOB '[0-7]' AND "forked_from_skill_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`forked_from_skill_name` text,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_account_id` text CHECK ("owner_account_id" = upper("owner_account_id") AND length("owner_account_id") = 26 AND substr("owner_account_id", 1, 1) GLOB '[0-7]' AND "owner_account_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`source_kind` text NOT NULL,
	`updated_at` integer NOT NULL,
	`version` text
);
--> statement-breakpoint
CREATE INDEX `skill_app_updated_at_idx` ON `skill` (`app_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `skill_owner_account_updated_at_idx` ON `skill` (`owner_account_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `account` (
	`created_at` integer NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`image_url` text,
	`last_active_organization_id` text CHECK ("last_active_organization_id" = upper("last_active_organization_id") AND length("last_active_organization_id") = 26 AND substr("last_active_organization_id", 1, 1) GLOB '[0-7]' AND "last_active_organization_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`name` text NOT NULL,
	`system_agent_model` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_email_idx` ON `account` (`email`);--> statement-breakpoint
CREATE INDEX `account_last_active_organization_idx` ON `account` (`last_active_organization_id`);--> statement-breakpoint
CREATE TABLE `usage_daily_rollup` (
	`actor_user_id` text CHECK ("actor_user_id" = upper("actor_user_id") AND length("actor_user_id") = 26 AND substr("actor_user_id", 1, 1) GLOB '[0-7]' AND "actor_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_owner_user_id` text CHECK ("agent_owner_user_id" = upper("agent_owner_user_id") AND length("agent_owner_user_id") = 26 AND substr("agent_owner_user_id", 1, 1) GLOB '[0-7]' AND "agent_owner_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_publication_state_at_run` text NOT NULL,
	`cache_creation_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`date` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`model` text NOT NULL,
	`organization_id` text CHECK ("organization_id" = upper("organization_id") AND length("organization_id") = 26 AND substr("organization_id", 1, 1) GLOB '[0-7]' AND "organization_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`output_tokens` integer NOT NULL,
	`provider` text NOT NULL,
	`request_count` integer NOT NULL,
	`run_purpose` text NOT NULL,
	`total_cost_usd_micros` integer NOT NULL,
	`unpriced_request_count` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `app_id`, `agent_id`, `actor_user_id`, `agent_owner_user_id`, `date`, `agent_publication_state_at_run`, `run_purpose`, `provider`, `model`)
);
--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_app_date_idx` ON `usage_daily_rollup` (`app_id`,`date`);--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_organization_date_idx` ON `usage_daily_rollup` (`organization_id`,`date`);--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_agent_date_idx` ON `usage_daily_rollup` (`agent_id`,`date`);--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_actor_date_idx` ON `usage_daily_rollup` (`actor_user_id`,`date`);--> statement-breakpoint
CREATE INDEX `usage_daily_rollup_owner_date_idx` ON `usage_daily_rollup` (`agent_owner_user_id`,`date`);--> statement-breakpoint
CREATE TABLE `usage_event` (
	`actor_user_id` text CHECK ("actor_user_id" = upper("actor_user_id") AND length("actor_user_id") = 26 AND substr("actor_user_id", 1, 1) GLOB '[0-7]' AND "actor_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_id` text CHECK ("agent_id" = upper("agent_id") AND length("agent_id") = 26 AND substr("agent_id", 1, 1) GLOB '[0-7]' AND "agent_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_owner_user_id` text CHECK ("agent_owner_user_id" = upper("agent_owner_user_id") AND length("agent_owner_user_id") = 26 AND substr("agent_owner_user_id", 1, 1) GLOB '[0-7]' AND "agent_owner_user_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`agent_publication_state_at_run` text NOT NULL,
	`agent_revision_id` text CHECK ("agent_revision_id" = upper("agent_revision_id") AND length("agent_revision_id") = 26 AND substr("agent_revision_id", 1, 1) GLOB '[0-7]' AND "agent_revision_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`cache_creation_tokens` integer NOT NULL,
	`cache_read_tokens` integer NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`input_tokens` integer NOT NULL,
	`model` text NOT NULL,
	`organization_id` text CHECK ("organization_id" = upper("organization_id") AND length("organization_id") = 26 AND substr("organization_id", 1, 1) GLOB '[0-7]' AND "organization_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`output_tokens` integer NOT NULL,
	`price_snapshot_json` text,
	`pricing_status` text NOT NULL,
	`provider` text NOT NULL,
	`run_purpose` text NOT NULL,
	`runtime_id` text,
	`session_id` text CHECK ("session_id" = upper("session_id") AND length("session_id") = 26 AND substr("session_id", 1, 1) GLOB '[0-7]' AND "session_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`session_run_id` text CHECK ("session_run_id" = upper("session_run_id") AND length("session_run_id") = 26 AND substr("session_run_id", 1, 1) GLOB '[0-7]' AND "session_run_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
	`source` text NOT NULL,
	`source_event_id` text NOT NULL,
	`total_cost_usd_micros` integer NOT NULL,
	`usage_contract` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_event_app_created_idx` ON `usage_event` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_event_organization_created_idx` ON `usage_event` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_event_agent_created_idx` ON `usage_event` (`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_event_actor_created_idx` ON `usage_event` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_event_owner_created_idx` ON `usage_event` (`agent_owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_event_session_run_idx` ON `usage_event` (`session_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `usage_event_source_event_idx` ON `usage_event` (`source`,`source_event_id`);--> statement-breakpoint
CREATE TABLE `vendor_credential` (
	`api_base` text,
	`api_key_secret_id` text CHECK ("api_key_secret_id" = upper("api_key_secret_id") AND length("api_key_secret_id") = 26 AND substr("api_key_secret_id", 1, 1) GLOB '[0-7]' AND "api_key_secret_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`created_at` integer NOT NULL,
	`id` text CHECK ("id" = upper("id") AND length("id") = 26 AND substr("id", 1, 1) GLOB '[0-7]' AND "id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') PRIMARY KEY NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`models` text,
	`name` text NOT NULL,
	`app_id` text CHECK ("app_id" = upper("app_id") AND length("app_id") = 26 AND substr("app_id", 1, 1) GLOB '[0-7]' AND "app_id" NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*') NOT NULL,
	`updated_at` integer NOT NULL,
	`vendor_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_credential_app_vendor_idx` ON `vendor_credential` (`app_id`,`vendor_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_credential_app_vendor_name_idx` ON `vendor_credential` (`app_id`,`vendor_id`,`name`);
