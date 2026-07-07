CREATE TABLE account (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  email_verified integer NOT NULL,
  image_url text,
  last_active_organization_id text,
  name text NOT NULL,
  system_agent_model text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE personal_access_token (
  id text PRIMARY KEY NOT NULL,
  account_id text NOT NULL,
  label text NOT NULL,
  token_hash text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  last_used_at integer,
  revoked_at integer
);

CREATE TABLE organization (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  avatar_url text,
  creator_account_id text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE app (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL,
  owner_account_id text NOT NULL,
  name text NOT NULL,
  slug text,
  default_environment_id text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX app_slug_idx ON app (slug) WHERE slug IS NOT NULL;

CREATE TABLE agent (
  id text PRIMARY KEY NOT NULL,
  app_id text NOT NULL,
  owner_account_id text NOT NULL,
  name text NOT NULL,
  description text,
  environment_id text,
  exposed_via_api integer,
  live_deployment_version_id text,
  kind text NOT NULL,
  runtime_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  config_json text NOT NULL,
  status text NOT NULL,
  visibility text NOT NULL
);

CREATE TABLE agent_deployment_version (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  version_number integer NOT NULL,
  summary text NOT NULL,
  kind text NOT NULL,
  runtime_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt text NOT NULL,
  config_json text NOT NULL,
  environment_id text,
  skills_json text NOT NULL,
  mcp_bindings_json text NOT NULL,
  created_by_account_id text NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE skill (
  author text NOT NULL,
  created_at integer NOT NULL,
  current_snapshot_id text NOT NULL,
  description text NOT NULL,
  forked_from_owner_name text,
  forked_from_skill_id text,
  forked_from_skill_name text,
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  owner_account_id text NOT NULL,
  app_id text NOT NULL,
  source_kind text NOT NULL,
  updated_at integer NOT NULL,
  version text
);

CREATE TABLE agent_skill (
  agent_id text NOT NULL,
  skill_id text NOT NULL,
  sort_order integer NOT NULL,
  created_at integer NOT NULL,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE mcp_server (
  id text PRIMARY KEY NOT NULL,
  owner_account_id text NOT NULL,
  name text NOT NULL,
  description text,
  source text DEFAULT 'app' NOT NULL,
  auth_type text DEFAULT 'bearer' NOT NULL,
  credential_scope text DEFAULT 'app' NOT NULL,
  icon_url text,
  byo_client_id text,
  byo_client_secret_secret_id text,
  oauth_metadata_json text,
  app_id text NOT NULL,
  url text NOT NULL,
  enabled integer DEFAULT 1 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE agent_mcp_binding (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  server_id text NOT NULL,
  agent_credential_id text,
  credential_mode text DEFAULT 'runtime_resolved' NOT NULL,
  enabled integer DEFAULT 1 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE environment (
  id text PRIMARY KEY NOT NULL,
  app_id text NOT NULL,
  owner_account_id text,
  current_revision_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  forked_from_environment_id text,
  forked_from_environment_name text,
  forked_from_owner_name text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE environment_revision (
  id text PRIMARY KEY NOT NULL,
  environment_id text NOT NULL,
  app_id text NOT NULL,
  created_by_account_id text,
  setup_script text NOT NULL,
  packages_json text NOT NULL,
  env_vars_json text NOT NULL,
  network_policy text NOT NULL,
  allowed_hosts_json text NOT NULL,
  allow_mcp_servers integer NOT NULL,
  allow_package_managers integer NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE vendor_credential (
  id text PRIMARY KEY NOT NULL,
  app_id text NOT NULL,
  vendor_id text NOT NULL,
  name text NOT NULL,
  api_key_secret_id text NOT NULL,
  api_base text,
  is_default integer DEFAULT false NOT NULL,
  models text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE sandbox (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  status text NOT NULL,
  status_event text DEFAULT 'runtime_subject.cold' NOT NULL,
  status_source text DEFAULT 'system' NOT NULL,
  status_seq integer DEFAULT 0 NOT NULL,
  status_operation_id text,
  status_changed_at integer DEFAULT 0 NOT NULL,
  last_error text,
  last_error_code text,
  last_backup_id text,
  last_restore_backup_id text,
  bind_mount_ready integer DEFAULT 0 NOT NULL,
  global_mounts_json text DEFAULT '[]' NOT NULL,
  claim_owner text,
  claim_expires_at integer,
  inactive_deadline_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE vault_secret (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  algorithm text DEFAULT 'AES-GCM' NOT NULL,
  ciphertext text NOT NULL,
  ciphertext_iv text NOT NULL,
  wrapped_dek text NOT NULL,
  wrapped_dek_iv text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE api_command (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  dedupe_key text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  claim_owner text,
  claim_expires_at integer,
  last_error_code text,
  last_error_message text,
  completed_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX api_command_dedupe_idx
  ON api_command (dedupe_key);

CREATE INDEX api_command_status_updated_idx
  ON api_command (status, updated_at);

CREATE INDEX api_command_claim_idx
  ON api_command (status, claim_expires_at);

CREATE TABLE agent_channel_binding (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  app_id text NOT NULL,
  provider text NOT NULL,
  encrypted_creds_secret_id text NOT NULL,
  external_bot_id text NOT NULL,
  external_tenant_id text NOT NULL,
  display_metadata_json text DEFAULT '{}' NOT NULL,
  status text NOT NULL,
  last_error_code text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX agent_channel_binding_agent_provider_idx
  ON agent_channel_binding (agent_id, provider);

CREATE UNIQUE INDEX agent_channel_binding_provider_tenant_bot_idx
  ON agent_channel_binding (provider, external_tenant_id, external_bot_id);

CREATE INDEX agent_channel_binding_app_status_idx
  ON agent_channel_binding (app_id, status);

CREATE TABLE channel_event_receipt (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  external_tenant_id text NOT NULL,
  external_event_id text NOT NULL,
  binding_id text NOT NULL,
  session_id text,
  created_at integer NOT NULL,
  expires_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX channel_event_receipt_provider_tenant_event_idx
  ON channel_event_receipt (provider, external_tenant_id, external_event_id);

CREATE INDEX channel_event_receipt_binding_updated_idx
  ON channel_event_receipt (binding_id, updated_at);

CREATE INDEX channel_event_receipt_expires_idx
  ON channel_event_receipt (expires_at);

CREATE TABLE channel_thread_session (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  binding_id text NOT NULL,
  external_thread_id text NOT NULL,
  session_id text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX channel_thread_session_provider_binding_thread_idx
  ON channel_thread_session (provider, binding_id, external_thread_id);

CREATE INDEX channel_thread_session_session_idx
  ON channel_thread_session (session_id);

CREATE TABLE channel_final_delivery_job (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  binding_id text NOT NULL,
  external_event_id text NOT NULL,
  session_id text NOT NULL,
  run_id text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  last_error_code text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX channel_final_delivery_provider_binding_event_idx
  ON channel_final_delivery_job (provider, binding_id, external_event_id);

CREATE INDEX channel_final_delivery_session_idx
  ON channel_final_delivery_job (session_id);

CREATE INDEX channel_final_delivery_run_idx
  ON channel_final_delivery_job (run_id);

CREATE TABLE channel_runtime_state (
  id text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  binding_id text NOT NULL,
  runtime_account_id text DEFAULT '' NOT NULL,
  status text NOT NULL,
  lease_owner_id text,
  lease_expires_at integer,
  last_heartbeat_at integer,
  last_inbound_at integer,
  last_poll_at integer,
  last_error_code text,
  runtime_state_json text DEFAULT '{}' NOT NULL,
  status_changed_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX channel_runtime_state_provider_binding_account_idx
  ON channel_runtime_state (provider, binding_id, runtime_account_id);

CREATE INDEX channel_runtime_state_status_lease_idx
  ON channel_runtime_state (status, lease_expires_at);

CREATE INDEX channel_runtime_state_binding_updated_idx
  ON channel_runtime_state (binding_id, updated_at);
