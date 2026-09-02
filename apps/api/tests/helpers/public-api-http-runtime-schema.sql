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

CREATE TABLE session (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL,
  creator_account_id text NOT NULL,
  attributed_user_id text,
  end_user_id text,
  agent_id text NOT NULL,
  deployment_version_id text,
  deployment_version_number integer,
  kind text NOT NULL,
  title text,
  provider text NOT NULL,
  model text NOT NULL,
  runtime_id text NOT NULL,
  status text NOT NULL,
  type text DEFAULT 'ui' NOT NULL,
  metadata_json text DEFAULT '{}' NOT NULL,
  last_run_id text,
  last_message_at integer,
  message_seq_cursor integer DEFAULT 0 NOT NULL,
  runtime_event_seq_cursor integer DEFAULT 0 NOT NULL,
  workspace_checkpoint_required integer DEFAULT 0 NOT NULL,
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
  tool_call_id text,
  tool_input_json text,
  tool_name text,
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
  session_run_id text,
  status text NOT NULL,
  ttl_seconds integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE INDEX sandbox_backup_sandbox_status_created_idx
  ON sandbox_backup (sandbox_id, status, created_at);

CREATE UNIQUE INDEX sandbox_backup_terminal_checkpoint_idx
  ON sandbox_backup (sandbox_id, dir, session_run_id)
  WHERE session_run_id IS NOT NULL AND status = 'ready';

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

CREATE TABLE external_tool_effect (
  attempt_count integer DEFAULT 0 NOT NULL,
  command_id text NOT NULL,
  created_at integer NOT NULL,
  driver_instance_id text NOT NULL,
  id text PRIMARY KEY NOT NULL,
  idempotency_key text NOT NULL,
  provider_receipt_json text,
  result_json text,
  server_id text NOT NULL,
  session_run_id text NOT NULL,
  status text NOT NULL,
  tool_name text NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX external_tool_effect_command_idx
  ON external_tool_effect (command_id);
CREATE UNIQUE INDEX external_tool_effect_idempotency_key_idx
  ON external_tool_effect (idempotency_key);
CREATE INDEX external_tool_effect_run_status_idx
  ON external_tool_effect (session_run_id, status, id);
CREATE INDEX external_tool_effect_driver_status_idx
  ON external_tool_effect (driver_instance_id, status);

CREATE TABLE external_tool_effect_attempt (
  attempt integer NOT NULL,
  completed_at integer,
  created_at integer NOT NULL,
  effect_id text NOT NULL,
  provider_receipt_json text,
  result_json text,
  status text NOT NULL,
  PRIMARY KEY (effect_id, attempt)
);

CREATE INDEX external_tool_effect_attempt_status_idx
  ON external_tool_effect_attempt (status, created_at);

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
