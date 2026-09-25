INSERT INTO session (id, agent_id, project_id, creator_account_id, kind, model, provider, runtime_id, status, renamed, created_at, updated_at, metadata_json)
VALUES ('01J00000000000000000000001', '01J00000000000000000000002', '01J00000000000000000000003', '01J00000000000000000000004', 'cattle', 'model', 'provider', 'runtime', 'IDLE', 0, 1, 2, '{"retained":"metadata"}');
INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, status, trigger, trace_id, created_at, updated_at)
VALUES ('01J00000000000000000000005', '01J00000000000000000000001', '01J00000000000000000000002', '01J00000000000000000000004', 'completed', 'user_prompt', 'migration-trace', 1, 2);
INSERT INTO session_message (id, session_id, session_run_id, role, content_text, seq, created_by_account_id, created_at)
VALUES ('01J00000000000000000000007', '01J00000000000000000000001', '01J00000000000000000000005', 'user', 'Preserve this history.', 1, '01J00000000000000000000004', 1);
INSERT INTO session_event (id, session_id, run_id, agent_id, event_type, family, content_text, seq, created_at, ended_at, occurred_at, process_status, process_type, source_event_id, source, visibility)
VALUES ('01J00000000000000000000006', '01J00000000000000000000001', '01J00000000000000000000005', '01J00000000000000000000002', 'run.completed', 'run', 'Original event.', 1, 2, 2, 2, 'completed', 'run', 'event-one', 'driver', 'user');
INSERT INTO session_execution_snapshot (session_id, plan_json, created_at)
VALUES ('01J00000000000000000000001', '{"configJson":"frozen configuration"}', 1);
INSERT INTO session_readiness_snapshot (session_id, readiness_json, updated_at)
VALUES ('01J00000000000000000000001', '{"ready":true}', 2);
INSERT INTO session_run_budget (session_run_id, cap_usd_micros, created_at, updated_at)
VALUES ('01J00000000000000000000005', 100000, 1, 2);
INSERT INTO session_run_skill (session_run_id, skill_id, skill_name, mount_path, resolution_mode, materialization_status, created_at, updated_at)
VALUES ('01J00000000000000000000005', '01J0000000000000000000000B', 'retained-skill', '/workspace/skill', 'explicit', 'ready', 1, 2);
INSERT INTO session_model_call (id, session_id, session_run_id, call_key, model, provider, status, trace_id, input_tokens, output_tokens, created_at, updated_at)
VALUES ('01J00000000000000000000008', '01J00000000000000000000001', '01J00000000000000000000005', 'call-one', 'model', 'provider', 'completed', 'migration-trace', 20, 10, 1, 2);
INSERT INTO session_permission_request (session_id, run_id, driver_instance_id, request_id, title, created_at, updated_at)
VALUES ('01J00000000000000000000001', '01J00000000000000000000005', '01J00000000000000000000009', 'permission-one', 'Original permission', 1, 2);
INSERT INTO native_resume_ref (session_id, runtime_id, kind, value, created_at, updated_at)
VALUES ('01J00000000000000000000001', 'runtime', 'native', 'original-native-context', 1, 2);
INSERT INTO sandbox_session (session_id, sandbox_id, cloudflare_session_id, cwd, origin_json, status, created_at, updated_at)
VALUES ('01J00000000000000000000001', '01J0000000000000000000000A', '01J0000000000000000000000C', '/workspace/original', '{"executionOwnerUserId":"01J00000000000000000000004"}', 'idle', 1, 2);
INSERT INTO usage_event (id, actor_user_id, agent_id, agent_owner_user_id, agent_publication_state_at_run, cache_creation_tokens, cache_read_tokens, created_at, input_tokens, model, organization_id, project_id, output_tokens, pricing_status, provider, run_purpose, session_id, session_run_id, source, source_event_id, total_cost_usd_micros, usage_contract)
VALUES ('01J0000000000000000000000D', '01J00000000000000000000004', '01J00000000000000000000002', '01J00000000000000000000004', 'published', 0, 0, 2, 20, 'model', '01J0000000000000000000000E', '01J00000000000000000000003', 10, 'priced', 'provider', 'production', '01J00000000000000000000001', '01J00000000000000000000005', 'runtime_driver', 'usage-one', 1000, 'anthropic_bucketed');
INSERT INTO usage_daily_rollup (actor_user_id, agent_id, agent_owner_user_id, agent_publication_state_at_run, cache_creation_tokens, cache_read_tokens, date, input_tokens, model, organization_id, project_id, output_tokens, provider, request_count, run_purpose, total_cost_usd_micros, unpriced_request_count)
VALUES ('01J00000000000000000000004', '01J00000000000000000000002', '01J00000000000000000000004', 'published', 0, 0, '2026-09-20', 20, 'model', '01J0000000000000000000000E', '01J00000000000000000000003', 10, 'provider', 1, 'production', 1000, 0);
