CREATE TABLE wechat_channel_account (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  app_id text NOT NULL,
  owner_account_id text NOT NULL,
  external_account_id text NOT NULL,
  external_bot_id text NOT NULL,
  base_url text NOT NULL,
  encrypted_creds_secret_id text NOT NULL,
  cursor text,
  status text NOT NULL,
  last_error_code text,
  last_heartbeat_at integer,
  last_inbound_at integer,
  last_poll_at integer,
  runtime_state_json text DEFAULT '{}' NOT NULL,
  status_changed_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX wechat_channel_account_agent_idx
  ON wechat_channel_account (agent_id);

CREATE UNIQUE INDEX wechat_channel_account_external_idx
  ON wechat_channel_account (external_account_id, external_bot_id);

CREATE INDEX wechat_channel_account_status_idx
  ON wechat_channel_account (status, updated_at);

CREATE INDEX wechat_channel_account_app_status_idx
  ON wechat_channel_account (app_id, status);

CREATE TABLE wechat_channel_pairing (
  id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  app_id text NOT NULL,
  created_by_account_id text NOT NULL,
  qr_token_hash text NOT NULL,
  expires_at integer NOT NULL,
  consumed_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX wechat_channel_pairing_qr_token_hash_idx
  ON wechat_channel_pairing (qr_token_hash);

CREATE INDEX wechat_channel_pairing_agent_creator_idx
  ON wechat_channel_pairing (agent_id, created_by_account_id, consumed_at);

CREATE INDEX wechat_channel_pairing_app_creator_idx
  ON wechat_channel_pairing (app_id, created_by_account_id, consumed_at);

CREATE INDEX wechat_channel_pairing_expires_idx
  ON wechat_channel_pairing (expires_at);

CREATE TABLE wechat_context_token (
  id text PRIMARY KEY NOT NULL,
  account_id text NOT NULL,
  external_account_id text NOT NULL,
  peer_id text NOT NULL,
  to_user_id text NOT NULL,
  context_token_key text NOT NULL,
  encrypted_context_token_secret_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX wechat_context_token_key_idx
  ON wechat_context_token (context_token_key);

CREATE UNIQUE INDEX wechat_context_token_account_peer_idx
  ON wechat_context_token (account_id, external_account_id, peer_id);

CREATE INDEX wechat_context_token_account_updated_idx
  ON wechat_context_token (account_id, updated_at);

CREATE TABLE public_api_rate_limit_window (
  bucket_key text NOT NULL,
  request_count integer DEFAULT 0 NOT NULL,
  shard integer NOT NULL,
  updated_at integer NOT NULL,
  window_start integer NOT NULL,
  PRIMARY KEY (bucket_key, window_start, shard)
);

CREATE TABLE public_api_idempotency_key (
  id text PRIMARY KEY NOT NULL,
  token_id text NOT NULL,
  idempotency_key text NOT NULL,
  method text NOT NULL,
  route text NOT NULL,
  body_hash text,
  response_status integer,
  response_json text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE bound_agent_call_idempotency_key (
  id text PRIMARY KEY NOT NULL,
  subject_hash text NOT NULL,
  idempotency_key text NOT NULL,
  body_hash text NOT NULL,
  session_id text NOT NULL,
  run_id text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX bound_agent_call_idempotency_subject_key_idx
  ON bound_agent_call_idempotency_key (subject_hash, idempotency_key);

CREATE INDEX bound_agent_call_idempotency_updated_idx
  ON bound_agent_call_idempotency_key (updated_at);

CREATE TABLE session (
  id text PRIMARY KEY NOT NULL,
  app_id text NOT NULL,
  creator_account_id text NOT NULL,
  attributed_user_id text,
  agent_id text NOT NULL,
  deployment_version_id text,
  deployment_version_number integer,
  kind text NOT NULL,
  title text,
  provider text NOT NULL,
  model text NOT NULL,
  runtime_id text NOT NULL,
  status text NOT NULL,
  type text DEFAULT 'api_channel' NOT NULL,
  metadata_json text DEFAULT '{}' NOT NULL,
  last_run_id text,
  last_message_at integer,
  message_seq_cursor integer DEFAULT 0 NOT NULL,
  runtime_event_seq_cursor integer DEFAULT 0 NOT NULL,
  archived_at integer,
  renamed integer DEFAULT 0 NOT NULL,
  status_operation_id text,
  status_seq integer DEFAULT 0 NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE session_run (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  agent_id text NOT NULL,
  bound_capability_agent_id text,
  bound_capability_app_id text,
  bound_capability_binding_env text,
  bound_capability_binding_name text,
  bound_capability_deployment_id text,
  bound_capability_deployment_run_id text,
  created_by_account_id text NOT NULL,
  deployment_version_id text,
  deployment_version_number integer,
  driver_instance_id text,
  trigger text NOT NULL,
  status text NOT NULL,
  provider text,
  model text,
  runtime_id text,
  trace_id text,
  error_code text,
  error_message text,
  error_details_json text,
  started_at integer,
  completed_at integer,
  created_at integer,
  status_changed_at integer DEFAULT 0 NOT NULL,
  status_event text DEFAULT 'run.queue' NOT NULL,
  status_operation_id text,
  status_seq integer DEFAULT 0 NOT NULL,
  status_source text DEFAULT 'system' NOT NULL,
  updated_at integer
);

CREATE TABLE session_run_skill (
  session_run_id text NOT NULL,
  skill_id text NOT NULL,
  skill_name text NOT NULL,
  snapshot_id text,
  blob_sha256 text,
  mount_path text NOT NULL,
  resolution_mode text NOT NULL,
  materialization_status text NOT NULL,
  warning_code text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  PRIMARY KEY (session_run_id, skill_id)
);

CREATE TABLE session_execution_snapshot (
  session_id text PRIMARY KEY NOT NULL,
  plan_json text NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE session_message (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  session_run_id text,
  seq integer NOT NULL,
  role text NOT NULL,
  content_text text NOT NULL,
  segments_json text,
  plan_json text,
  created_by_account_id text NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE session_event (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  run_id text,
  agent_id text NOT NULL,
  seq integer NOT NULL,
  content_text text NOT NULL,
  ended_at integer NOT NULL,
  event_type text NOT NULL,
  family text NOT NULL,
  process_status text NOT NULL,
  process_type text NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  tokens integer,
  trace_id text,
  visibility text NOT NULL,
  occurred_at integer NOT NULL,
  created_at integer NOT NULL
);

CREATE TABLE session_permission_request (
  created_at integer NOT NULL,
  driver_instance_id text NOT NULL,
  raw_input text,
  request_id text NOT NULL,
  run_id text NOT NULL,
  session_id text NOT NULL,
  title text NOT NULL,
  tool_call_id text,
  tool_kind text,
  updated_at integer NOT NULL,
  PRIMARY KEY (session_id, request_id)
);

CREATE INDEX session_permission_request_run_idx
  ON session_permission_request (session_id, run_id);

CREATE TABLE session_readiness_snapshot (
  readiness_json text NOT NULL,
  session_id text PRIMARY KEY NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX session_message_session_seq_idx
  ON session_message (session_id, seq);
CREATE UNIQUE INDEX session_event_session_seq_idx
  ON session_event (session_id, seq);
CREATE UNIQUE INDEX session_event_session_source_idx
  ON session_event (session_id, source_event_id);

CREATE TABLE sandbox_session (
  cloudflare_session_id text NOT NULL,
  created_at integer NOT NULL,
  cwd text NOT NULL,
  origin_json text NOT NULL,
  sandbox_id text NOT NULL,
  session_id text PRIMARY KEY NOT NULL,
  status text NOT NULL,
  updated_at integer NOT NULL
);

CREATE INDEX sandbox_session_sandbox_status_idx
  ON sandbox_session (sandbox_id, status, updated_at);
CREATE UNIQUE INDEX sandbox_session_cloudflare_session_idx
  ON sandbox_session (cloudflare_session_id);

CREATE TABLE sandbox_backup (
  created_at integer NOT NULL,
  dir text NOT NULL,
  error_message text,
  id text PRIMARY KEY NOT NULL,
  keep integer DEFAULT 0 NOT NULL,
  sandbox_id text NOT NULL,
  status text NOT NULL,
  ttl_seconds integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE INDEX sandbox_backup_sandbox_status_created_idx
  ON sandbox_backup (sandbox_id, status, created_at);

CREATE TABLE driver_instance (
  id text PRIMARY KEY NOT NULL,
  sandbox_id text NOT NULL,
  sandbox_session_id text NOT NULL,
  runtime text NOT NULL,
  protocol text NOT NULL,
  protocol_version integer NOT NULL,
  status text NOT NULL,
  status_changed_at integer DEFAULT 0 NOT NULL,
  status_event text DEFAULT 'driver.provision' NOT NULL,
  status_operation_id text,
  status_seq integer DEFAULT 0 NOT NULL,
  status_source text DEFAULT 'system' NOT NULL,
  process_id text,
  connection_id text,
  command_seq_cursor integer DEFAULT 0 NOT NULL,
  boot_token_hash blob NOT NULL,
  boot_token_expires_at integer NOT NULL,
  boot_token_used_at integer,
  driver_pid integer,
  driver_started_at integer,
  driver_version text,
  close_code integer,
  close_reason text,
  error_message text,
  generation integer DEFAULT 0 NOT NULL,
  heartbeat_count integer NOT NULL,
  last_heartbeat_at integer,
  restart_count integer DEFAULT 0 NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE file_record (
  id text PRIMARY KEY NOT NULL,
  scope_kind text NOT NULL,
  scope_id text,
  session_kind text,
  status text NOT NULL,
  name text NOT NULL,
  path text NOT NULL,
  parent_path text NOT NULL,
  object_key text NOT NULL,
  owner_id text NOT NULL,
  owner_kind text NOT NULL,
  purpose text NOT NULL,
  expires_at integer,
  mime_type text,
  size integer NOT NULL,
  etag text,
  committed integer NOT NULL,
  version integer NOT NULL,
  created_by_account_id text NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE TABLE file_upload (
  id text PRIMARY KEY NOT NULL,
  file_id text NOT NULL,
  scope_kind text NOT NULL,
  scope_id text NOT NULL,
  strategy text NOT NULL,
  status text NOT NULL,
  content_type text NOT NULL,
  expected_size integer NOT NULL,
  overwrite integer NOT NULL,
  if_match_etag text,
  multipart_upload_id text,
  part_size integer,
  created_by_account_id text NOT NULL,
  expires_at integer NOT NULL,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
