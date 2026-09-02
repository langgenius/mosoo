import type { D1JsonRow } from "./d1-json";
import { parseD1JsonResults, requireSingleD1Row } from "./d1-json";
import { PROD_DEPLOY_LEASE_TABLE } from "./prod-deploy-lease";
import {
  MANAGED_PROD_SCHEMA_TRIGGERS,
  PROTOCOL_V3_MIGRATION_INTENT_TABLE,
  PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL,
} from "./prod-schema-guard";

export { PROTOCOL_V3_MIGRATION_INTENT_TABLE } from "./prod-schema-guard";

export const PROTOCOL_V3_MIGRATION = "0014_durable-mcp-effect-v3.sql";
export const PROTOCOL_V3_SESSION_EVENT_MIGRATION = "0015_session-event-stream-identity.sql";
export const PROTOCOL_V3_SESSION_CLEANUP_MIGRATION = "0016_session-cleanup-operation.sql";
export const PROTOCOL_V3_RUNTIME_AUTHORITY_MIGRATION =
  "0020_runtime-subject-operation-authority.sql";
export const LAST_CUTOVER_AUDITED_MIGRATION = "0021_sandbox-backup-object-authority.sql";
export const AUDITED_MIGRATION_NAMES = [
  "0000_baseline.sql",
  "0001_bound-capability-run-provenance.sql",
  "0002_bound-agent-call-idempotency.sql",
  "0003_collapse-sandbox-error-state.sql",
  "0004_usage-rollup-receipt.sql",
  "0005_public-thread-end-user.sql",
  "0006_runtime_subject_quota_scope.sql",
  "0007_app-deployment-secrets.sql",
  "0008_public-thread-tool-call-identity.sql",
  "0009_terminal_event_lookup_index.sql",
  "0010_external-tool-effects.sql",
  "0011_cattle-terminal-checkpoints.sql",
  "0012_rename_app_to_project.sql",
  "0013_agent-task-snapshot-state.sql",
  PROTOCOL_V3_MIGRATION,
  PROTOCOL_V3_SESSION_EVENT_MIGRATION,
  PROTOCOL_V3_SESSION_CLEANUP_MIGRATION,
  "0017_durable-event-side-effects.sql",
  "0018_terminal-reconciliation-scheduling.sql",
  "0019_runtime-operation-ready-authority.sql",
  PROTOCOL_V3_RUNTIME_AUTHORITY_MIGRATION,
  LAST_CUTOVER_AUDITED_MIGRATION,
] as const;
export const PROTOCOL_V3_CUTOVER_TABLE = "__protocol_v3_cutover";
export const PROD_APPLIED_MIGRATIONS_SQL = `SELECT "name" FROM "d1_migrations" ORDER BY "id";`;

const GIT_TREE_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const WORKER_VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export type ProtocolV3CutoverPhase = "draining" | "queues_resuming";

const ACTIVE_RUN_STATUSES = "'queued', 'booting', 'running', 'waiting_input'";
const ACTIVE_APP_DEPLOYMENT_RUN_STATUSES =
  "'queued', 'preparing', 'building', 'submitting', 'submitted', 'activating'";
const CUTOVER_BLOCKED_API_COMMAND_KINDS =
  "'session_run_dispatch', 'app_deployment_run_dispatch', 'environment_package_artifact_build'";

export const PROTOCOL_V3_CUTOVER_QUEUE_NAMES = [
  "api-command",
  "api-command-dlq",
  "environment-artifact-build",
] as const;

export interface ProtocolV3QueueDeliveryControl {
  list(): Promise<readonly { readonly id: string; readonly name: string }[]>;
  mutate(queueName: string, action: "pause" | "resume"): Promise<void> | void;
  read(queueId: string): Promise<{
    readonly deliveryPaused: boolean | undefined;
    readonly name: string;
  }>;
}

export async function updateAndVerifyProtocolV3QueueDelivery(
  control: ProtocolV3QueueDeliveryControl,
  action: "pause" | "resume",
): Promise<void> {
  const queueIds = new Map((await control.list()).map(({ id, name }) => [name, id]));
  const failures: unknown[] = [];

  for (const queueName of PROTOCOL_V3_CUTOVER_QUEUE_NAMES) {
    const queueId = queueIds.get(queueName);
    if (queueId === undefined) {
      failures.push(new Error(`Production queue ${queueName} was not found.`));
      continue;
    }

    try {
      await control.mutate(queueName, action);
      const queue = await control.read(queueId);
      if (queue.name !== queueName || queue.deliveryPaused !== (action === "pause")) {
        throw new Error(`Production queue ${queueName} delivery did not ${action}.`);
      }
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `Production queue ${action} and readback failed.`);
  }
}
const LIVE_DRIVER_STATUSES = "'provisioning', 'connecting', 'ready', 'stopping'";

function exactSmokeSessionSql(sessionId: string, sandboxId?: string): string {
  const sandboxJoin =
    sandboxId === undefined
      ? ""
      : `
    INNER JOIN "sandbox" AS "smoke_sandbox"
      ON "smoke_sandbox"."id" = ${sandboxId}
     AND "smoke_sandbox"."subject_kind" = 'session'
     AND "smoke_sandbox"."subject_id" = "smoke_session"."id"`;
  return `EXISTS (
    SELECT 1
    FROM "${PROTOCOL_V3_CUTOVER_TABLE}" AS "gate"
    INNER JOIN "session" AS "smoke_session"
      ON "smoke_session"."id" = ${sessionId}
     AND "smoke_session"."creator_account_id" = "gate"."smoke_account_id"
     AND "smoke_session"."end_user_id" = "gate"."smoke_request_key"${sandboxJoin}
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND ("gate"."smoke_session_id" IS NULL OR "gate"."smoke_session_id" = "smoke_session"."id")
  )`;
}

const EXACT_NEW_SESSION_SMOKE_SQL = `EXISTS (
    SELECT 1
    FROM "${PROTOCOL_V3_CUTOVER_TABLE}" AS "gate"
    WHERE "gate"."enabled" = 1
      AND "gate"."smoke_request_key" IS NOT NULL
      AND "gate"."smoke_session_id" IS NULL
      AND "gate"."smoke_account_id" = NEW."creator_account_id"
      AND "gate"."smoke_request_key" = NEW."end_user_id"
  )`;

function postMigrationSessionStaticSql(row: string): string {
  return `${row}."status" IN ('IDLE', 'TERMINATED')
  AND ${row}."status_operation_id" IS NULL
  AND (${row}."cleanup_operation_kind" IS NULL
       OR (${row}."cleanup_operation_kind" = 'archive'
           AND ${row}."status" = 'IDLE'
           AND ${row}."archived_at" IS NOT NULL))
  AND ${row}."runtime_provisioning_operation_id" IS NULL
  AND ${row}."runtime_provisioning_run_id" IS NULL
  AND ${row}."runtime_provisioning_sandbox_id" IS NULL
  AND ${row}."runtime_provisioning_sandbox_session_id" IS NULL
  AND ${row}."runtime_provisioning_sandbox_incarnation" IS NULL
  AND ${row}."runtime_provisioning_heartbeat_at" IS NULL`;
}

interface ProtocolV3CutoverObject {
  readonly name: string;
  readonly sql: string;
  readonly tableName: string;
  readonly type: "table" | "trigger";
}

const PROTOCOL_V3_CUTOVER_OBJECTS: readonly ProtocolV3CutoverObject[] = [
  {
    name: PROTOCOL_V3_CUTOVER_TABLE,
    sql: `CREATE TABLE "${PROTOCOL_V3_CUTOVER_TABLE}" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "command_freeze" integer NOT NULL DEFAULT 0 CHECK ("command_freeze" IN (0, 1)),
  "enabled" integer NOT NULL DEFAULT 1 CHECK ("enabled" IN (0, 1)),
  "phase" text NOT NULL DEFAULT 'draining' CHECK ("phase" IN ('draining', 'queues_resuming')),
  "pre_migration_bookmark" text,
  "release_tree_oid" text NOT NULL CHECK ((length("release_tree_oid") = 40 OR length("release_tree_oid") = 64) AND "release_tree_oid" = lower("release_tree_oid") AND "release_tree_oid" NOT GLOB '*[^0-9a-f]*'),
  "smoke_account_id" text,
  "smoke_request_key" text,
  "smoke_session_id" text,
  "target_container_application_version" integer,
  "target_container_image_digest" text,
  "target_worker_version_id" text,
  "started_at" integer NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT "protocol_v3_cutover_phase_check" CHECK (
    ("phase" = 'draining' AND "enabled" = 1)
    OR ("phase" = 'queues_resuming' AND "command_freeze" = 1)
  ),
  CONSTRAINT "protocol_v3_cutover_rollout_check" CHECK (
    ("target_container_application_version" IS NULL AND "target_container_image_digest" IS NULL AND "target_worker_version_id" IS NULL)
    OR ("target_container_application_version" >= 0 AND length("target_container_image_digest") = 64 AND "target_container_image_digest" = lower("target_container_image_digest") AND "target_container_image_digest" NOT GLOB '*[^0-9a-f]*' AND length(trim("target_worker_version_id")) > 0)
  )
)`.trim(),
    tableName: PROTOCOL_V3_CUTOVER_TABLE,
    type: "table",
  },
  {
    name: "__protocol_v3_cutover_session_run_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_session_run_insert"
BEFORE INSERT ON "session_run"
WHEN NEW."status" IN (${ACTIVE_RUN_STATUSES})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."session_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active Session Runs');
END`,
    tableName: "session_run",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_session_run_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_session_run_update"
BEFORE UPDATE OF "status" ON "session_run"
WHEN NEW."status" IN (${ACTIVE_RUN_STATUSES})
  AND OLD."status" NOT IN (${ACTIVE_RUN_STATUSES})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."session_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Session Run reactivation');
END`,
    tableName: "session_run",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_project_deployment_run_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_project_deployment_run_insert"
BEFORE INSERT ON "project_deployment_run"
WHEN NEW."status" IN (${ACTIVE_APP_DEPLOYMENT_RUN_STATUSES})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active App deployment Runs');
END`,
    tableName: "project_deployment_run",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_project_deployment_run_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_project_deployment_run_update"
BEFORE UPDATE OF "status" ON "project_deployment_run"
WHEN NEW."status" IN (${ACTIVE_APP_DEPLOYMENT_RUN_STATUSES})
  AND OLD."status" NOT IN (${ACTIVE_APP_DEPLOYMENT_RUN_STATUSES})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks App deployment Run reactivation');
END`,
    tableName: "project_deployment_run",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_driver_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_driver_insert"
BEFORE INSERT ON "driver_instance"
WHEN NEW."status" IN (${LIVE_DRIVER_STATUSES})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."sandbox_session_id"', 'NEW."sandbox_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new live Driver instances');
END`,
    tableName: "driver_instance",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_driver_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_driver_update"
BEFORE UPDATE OF "status" ON "driver_instance"
WHEN NEW."status" IN (${LIVE_DRIVER_STATUSES})
  AND OLD."status" NOT IN (${LIVE_DRIVER_STATUSES})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."sandbox_session_id"', 'NEW."sandbox_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Driver reactivation');
END`,
    tableName: "driver_instance",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_command_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_command_insert"
BEFORE INSERT ON "driver_command"
WHEN EXISTS (
    SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN ('input.start', 'mcp.execute'))
  )
  AND NOT (
    NEW."kind" = 'session.stop'
    AND EXISTS (
      SELECT 1
      FROM "driver_instance" AS "smoke_driver"
      WHERE "smoke_driver"."id" = NEW."driver_instance_id"
        AND ${exactSmokeSessionSql('"smoke_driver"."sandbox_session_id"', '"smoke_driver"."sandbox_id"')}
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new Driver commands');
END`,
    tableName: "driver_command",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_insert"
BEFORE INSERT ON "sandbox"
WHEN (NEW."status" <> 'cold'
      OR NEW."status_operation_id" IS NOT NULL
      OR NEW."claim_owner" IS NOT NULL
      OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = 'session' AND ${exactSmokeSessionSql('NEW."subject_id"')})
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active sandboxes');
END`,
    tableName: "sandbox",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_update"
BEFORE UPDATE OF "status", "status_operation_id", "claim_owner", "claim_expires_at" ON "sandbox"
WHEN OLD."status" = 'cold'
  AND OLD."status_operation_id" IS NULL
  AND OLD."claim_owner" IS NULL
  AND OLD."claim_expires_at" IS NULL
  AND (NEW."status" <> 'cold'
       OR NEW."status_operation_id" IS NOT NULL
       OR NEW."claim_owner" IS NOT NULL
       OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = 'session' AND ${exactSmokeSessionSql('NEW."subject_id"')})
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox activation');
END`,
    tableName: "sandbox",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_session_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_session_insert"
BEFORE INSERT ON "sandbox_session"
WHEN NEW."status" NOT IN ('closed', 'error')
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."session_id"', 'NEW."sandbox_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active sandbox Sessions');
END`,
    tableName: "sandbox_session",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_session_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_session_update"
BEFORE UPDATE OF "status" ON "sandbox_session"
WHEN OLD."status" IN ('closed', 'error')
  AND NEW."status" NOT IN ('closed', 'error')
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."session_id"', 'NEW."sandbox_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox Session reactivation');
END`,
    tableName: "sandbox_session",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_backup_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_backup_insert"
BEFORE INSERT ON "sandbox_backup"
WHEN NEW."status" NOT IN ('ready', 'pruned')
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new sandbox backup work');
END`,
    tableName: "sandbox_backup",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_backup_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_backup_update"
BEFORE UPDATE OF "status" ON "sandbox_backup"
WHEN OLD."status" IN ('ready', 'pruned')
  AND NEW."status" NOT IN ('ready', 'pruned')
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox backup reactivation');
END`,
    tableName: "sandbox_backup",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_session_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_session_insert"
BEFORE INSERT ON "session"
WHEN (NEW."status" NOT IN ('IDLE', 'TERMINATED') OR NEW."status_operation_id" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${EXACT_NEW_SESSION_SMOKE_SQL}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new Session operations');
END`,
    tableName: "session",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_session_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_session_update"
BEFORE UPDATE OF "status", "status_operation_id" ON "session"
WHEN OLD."status" IN ('IDLE', 'TERMINATED')
  AND OLD."status_operation_id" IS NULL
  AND (NEW."status" NOT IN ('IDLE', 'TERMINATED') OR NEW."status_operation_id" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Session operation acquisition');
END`,
    tableName: "session",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_api_command_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_api_command_insert"
BEFORE INSERT ON "api_command"
WHEN NEW."status" IN ('queued', 'running')
  AND EXISTS (
    SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN (${CUTOVER_BLOCKED_API_COMMAND_KINDS}))
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new nonterminal API commands');
END`,
    tableName: "api_command",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_api_command_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_api_command_update"
BEFORE UPDATE OF "kind", "status", "claim_owner", "claim_expires_at" ON "api_command"
WHEN NEW."status" IN ('queued', 'running')
  AND (OLD."status" NOT IN ('queued', 'running') OR NEW."kind" IS NOT OLD."kind")
  AND EXISTS (
    SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
    WHERE "enabled" = 1
      AND ("command_freeze" = 1 OR NEW."kind" IN (${CUTOVER_BLOCKED_API_COMMAND_KINDS}))
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks API command admission');
END`,
    tableName: "api_command",
    type: "trigger",
  },
];

export const PROTOCOL_V3_CUTOVER_OBJECT_COUNT = PROTOCOL_V3_CUTOVER_OBJECTS.length;

const POST_MIGRATION_CUTOVER_REPLACEMENTS: readonly ProtocolV3CutoverObject[] = [
  {
    name: "__protocol_v3_cutover_sandbox_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_insert"
BEFORE INSERT ON "sandbox"
WHEN (NEW."status" <> 'cold'
      OR NEW."operation_kind" IS NOT NULL
      OR NEW."status_operation_id" IS NOT NULL
      OR NEW."claim_owner" IS NOT NULL
      OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = 'session' AND ${exactSmokeSessionSql('NEW."subject_id"')})
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new active sandboxes');
END`,
    tableName: "sandbox",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_sandbox_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_update"
BEFORE UPDATE OF "status", "operation_kind", "status_operation_id", "claim_owner", "claim_expires_at" ON "sandbox"
WHEN OLD."status" = 'cold'
  AND OLD."operation_kind" IS NULL
  AND OLD."status_operation_id" IS NULL
  AND OLD."claim_owner" IS NULL
  AND OLD."claim_expires_at" IS NULL
  AND (NEW."status" <> 'cold'
       OR NEW."operation_kind" IS NOT NULL
       OR NEW."status_operation_id" IS NOT NULL
       OR NEW."claim_owner" IS NOT NULL
       OR NEW."claim_expires_at" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT (NEW."subject_kind" = 'session' AND ${exactSmokeSessionSql('NEW."subject_id"')})
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks sandbox activation');
END`,
    tableName: "sandbox",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_session_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_session_insert"
BEFORE INSERT ON "session"
WHEN NOT (${postMigrationSessionStaticSql("NEW")})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${EXACT_NEW_SESSION_SMOKE_SQL}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new Session operations');
END`,
    tableName: "session",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_session_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_session_update"
BEFORE UPDATE OF "status", "status_operation_id", "archived_at", "cleanup_operation_kind", "runtime_provisioning_operation_id", "runtime_provisioning_run_id", "runtime_provisioning_sandbox_id", "runtime_provisioning_sandbox_session_id", "runtime_provisioning_sandbox_incarnation", "runtime_provisioning_heartbeat_at" ON "session"
WHEN (${postMigrationSessionStaticSql("OLD")})
  AND NOT (${postMigrationSessionStaticSql("NEW")})
  AND EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks Session operation acquisition');
END`,
    tableName: "session",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_api_command_update",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_api_command_update"
BEFORE UPDATE OF "kind", "status", "claim_owner", "claim_expires_at", "delivery_generation" ON "api_command"
WHEN EXISTS (
    SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
    WHERE "enabled" = 1
      AND (
        ("command_freeze" = 1
         AND (
           NEW."delivery_generation" IS NOT OLD."delivery_generation"
           OR (NEW."status" IN ('queued', 'running')
               AND (OLD."status" NOT IN ('queued', 'running') OR NEW."kind" IS NOT OLD."kind"))
         ))
        OR ("command_freeze" = 0
            AND NEW."kind" IN (${CUTOVER_BLOCKED_API_COMMAND_KINDS})
            AND NEW."status" IN ('queued', 'running')
            AND (OLD."status" NOT IN ('queued', 'running') OR NEW."kind" IS NOT OLD."kind"))
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks API command admission');
END`,
    tableName: "api_command",
    type: "trigger",
  },
];

const POST_MIGRATION_CUTOVER_REPLACEMENT_BY_NAME = new Map(
  POST_MIGRATION_CUTOVER_REPLACEMENTS.map((object) => [object.name, object]),
);
const PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS: readonly ProtocolV3CutoverObject[] = [
  ...PROTOCOL_V3_CUTOVER_OBJECTS.map(
    (object) => POST_MIGRATION_CUTOVER_REPLACEMENT_BY_NAME.get(object.name) ?? object,
  ),
  {
    name: "__protocol_v3_cutover_sandbox_backup_staging_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_sandbox_backup_staging_insert"
BEFORE INSERT ON "sandbox_backup_staging"
WHEN EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT ${exactSmokeSessionSql('NEW."workspace_session_id"', 'NEW."sandbox_id"')}
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new sandbox backup staging');
END`,
    tableName: "sandbox_backup_staging",
    type: "trigger",
  },
  {
    name: "__protocol_v3_cutover_environment_artifact_backup_staging_insert",
    sql: `CREATE TRIGGER "__protocol_v3_cutover_environment_artifact_backup_staging_insert"
BEFORE INSERT ON "environment_package_artifact_backup_staging"
WHEN EXISTS (SELECT 1 FROM "${PROTOCOL_V3_CUTOVER_TABLE}" WHERE "enabled" = 1)
  AND NOT EXISTS (
    SELECT 1
    FROM "${PROTOCOL_V3_CUTOVER_TABLE}" AS "gate"
    INNER JOIN "api_command" AS "command"
      ON "command"."id" = NEW."command_id"
     AND "command"."created_at" <= "gate"."started_at"
     AND "command"."kind" = 'environment_package_artifact_build'
     AND "command"."status" = 'running'
     AND "command"."delivery_generation" = NEW."delivery_generation"
     AND "command"."attempt_count" = NEW."attempt_count"
     AND "command"."claim_owner" = NEW."claim_owner"
     AND typeof("command"."claim_expires_at") = 'integer'
     AND "command"."claim_expires_at" > unixepoch('subsec') * 1000
     AND json_valid("command"."payload_json") = 1
     AND json_extract("command"."payload_json", '$.projectId') = NEW."project_id"
     AND json_extract("command"."payload_json", '$.inputDigest') = NEW."input_digest"
    WHERE "gate"."enabled" = 1
      AND "gate"."command_freeze" = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol v3 cutover blocks new environment artifact backup staging');
END`,
    tableName: "environment_package_artifact_backup_staging",
    type: "trigger",
  },
];

export const PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT =
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS.length;

function installableCutoverObjectSql(object: ProtocolV3CutoverObject): string {
  const create = object.type === "table" ? "CREATE TABLE" : "CREATE TRIGGER";
  return object.sql.replace(create, `${create} IF NOT EXISTS`);
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const CUTOVER_RESERVED_NAMES_SQL = [
  ...new Set(PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS.map((object) => object.name)),
]
  .map(sqlString)
  .join(", ");
const PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE = "__protocol_v3_legacy_rewrite_authorization";
const PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER = "__protocol_v3_legacy_rewrite_gate_update";
export const PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_SQL = `CREATE TRIGGER "${PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER}"
AFTER UPDATE ON "${PROTOCOL_V3_CUTOVER_TABLE}"
BEGIN
  DELETE FROM "${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE}" WHERE "id" = 1;
END`;
const PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_MATCH_SQL = `(
  "type" = 'trigger'
  AND "name" = ${sqlString(PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER)} COLLATE BINARY
  AND "tbl_name" = ${sqlString(PROTOCOL_V3_CUTOVER_TABLE)} COLLATE BINARY
  AND "sql" = ${sqlString(PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_SQL)} COLLATE BINARY
)`;
const CUTOVER_PROTECTED_TABLES = [
  PROD_DEPLOY_LEASE_TABLE,
  PROTOCOL_V3_CUTOVER_TABLE,
  PROTOCOL_V3_MIGRATION_INTENT_TABLE,
  PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE,
  "api_command",
  "project_deployment_run",
  "driver_command",
  "driver_instance",
  "environment_package_artifact_backup",
  "environment_package_artifact_backup_staging",
  "sandbox",
  "sandbox_backup",
  "sandbox_backup_delete_intent",
  "sandbox_backup_staging",
  "sandbox_session",
  "session",
  "session_run",
] as const;
const CUTOVER_PROTECTED_TABLES_SQL = CUTOVER_PROTECTED_TABLES.map(sqlString).join(", ");
const CUTOVER_MANAGED_TRIGGER_NAMES = [
  "environment_package_artifact_backup_staging_authority",
  "environment_package_artifact_backup_staging_immutable",
  "environment_package_artifact_backup_authority",
  "environment_package_artifact_backup_retirement_authority",
  "environment_package_artifact_backup_retirement_tombstone",
  "environment_package_artifact_backup_rotation_authority",
  "environment_package_artifact_backup_rotation_tombstone",
  "sandbox_backup_delete_intent_attempt_clock",
  "sandbox_backup_delete_intent_authority",
  "sandbox_backup_delete_intent_blocks_environment_commit",
  "sandbox_backup_delete_intent_blocks_environment_stage_insert",
  "sandbox_backup_delete_intent_blocks_environment_stage_update",
  "sandbox_backup_delete_intent_blocks_runtime_record",
  "sandbox_backup_delete_intent_blocks_runtime_record_update",
  "sandbox_backup_delete_intent_blocks_runtime_stage_insert",
  "sandbox_backup_delete_intent_blocks_runtime_stage_update",
  "sandbox_backup_delete_intent_completion_monotonic",
  "sandbox_backup_delete_intent_identity_immutable",
  "sandbox_backup_delete_intent_permanent",
  "sandbox_backup_identity_immutable",
  "sandbox_backup_permanent",
  "sandbox_backup_staging_identity_immutable",
  "sandbox_backup_status_monotonic",
  "sandbox_identity_immutable",
] as const;
const CUTOVER_MANAGED_TRIGGER_MATCH_SQL = CUTOVER_MANAGED_TRIGGER_NAMES.map((name) => {
  const trigger = MANAGED_PROD_SCHEMA_TRIGGERS.find((candidate) => candidate.name === name);
  if (
    trigger === undefined ||
    !CUTOVER_PROTECTED_TABLES.some((tableName) => tableName === trigger.tableName)
  ) {
    throw new Error(`Managed cutover trigger ${name} is missing or protects the wrong table.`);
  }
  const canonicalSql = trigger.sql.replaceAll("`", '"');
  return `(
          "type" = 'trigger'
          AND "name" = ${sqlString(trigger.name)} COLLATE BINARY
          AND "tbl_name" = ${sqlString(trigger.tableName)} COLLATE BINARY
          AND replace("sql", char(96), '"') = ${sqlString(canonicalSql)} COLLATE BINARY
        )`;
}).join("\n        OR ");

export function installProtocolV3CutoverSql(releaseTreeOid: string): string {
  const release = requireGitTreeOid(releaseTreeOid, "Protocol v3 release tree OID");
  return `
${PROTOCOL_V3_CUTOVER_OBJECTS.map((object) => `${installableCutoverObjectSql(object)};`).join("\n")}
${PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};
INSERT INTO "${PROTOCOL_V3_CUTOVER_TABLE}" ("id", "enabled", "release_tree_oid")
VALUES (1, 1, '${release}')
ON CONFLICT ("id") DO NOTHING;
`;
}

const PROTOCOL_V3_CUTOVER_TRIGGER_NAMES = [
  ...new Set(
    PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS.filter((object) => object.type === "trigger").map(
      (object) => object.name,
    ),
  ),
];

export const DROP_PROTOCOL_V3_CUTOVER_TRIGGERS_SQL = PROTOCOL_V3_CUTOVER_TRIGGER_NAMES.toReversed()
  .map((name) => `DROP TRIGGER IF EXISTS "${name}";`)
  .join("\n");

export const INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL = `
${installableCutoverObjectSql(PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS[0])};
${PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};
${DROP_PROTOCOL_V3_CUTOVER_TRIGGERS_SQL}
${PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS.slice(1)
  .map((object) => `${installableCutoverObjectSql(object)};`)
  .join("\n")}
`;

export function installProtocolV3PostMigrationCutoverSql(releaseTreeOid: string): string {
  const release = requireGitTreeOid(releaseTreeOid, "Protocol v3 release tree OID");
  return `${INSTALL_PROTOCOL_V3_POST_MIGRATION_CUTOVER_SQL}
INSERT INTO "${PROTOCOL_V3_CUTOVER_TABLE}" ("id", "enabled", "release_tree_oid")
VALUES (1, 1, '${release}')
ON CONFLICT ("id") DO NOTHING;
`;
}

export const REMOVE_PROTOCOL_V3_CUTOVER_SQL = `
${DROP_PROTOCOL_V3_CUTOVER_TRIGGERS_SQL}
DROP TABLE IF EXISTS "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}";
DROP TABLE IF EXISTS "${PROTOCOL_V3_CUTOVER_TABLE}";
`;

export const PROTOCOL_V3_CUTOVER_PROBE_SQL = `
SELECT EXISTS(
    SELECT 1 FROM "sqlite_master"
    WHERE ("name" COLLATE NOCASE IN (${CUTOVER_RESERVED_NAMES_SQL})
      OR "name" = '${PROTOCOL_V3_MIGRATION_INTENT_TABLE}' COLLATE NOCASE)
      OR (
        "type" = 'trigger'
        AND "tbl_name" COLLATE NOCASE IN (${CUTOVER_PROTECTED_TABLES_SQL})
        AND NOT (
          ${PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_MATCH_SQL}
          OR ${CUTOVER_MANAGED_TRIGGER_MATCH_SQL}
        )
      )
  ) AS "gate_present";
`;

export const PROTOCOL_V3_LEGACY_TERMINAL_SOURCE_INVENTORY_SQL = `
WITH "terminal_events" AS (
  SELECT
    "event_type",
    "id",
    "run_id",
    "session_id",
    "source_event_id",
    'session-run-terminal:' || "run_id" || ':' || "event_type" AS "canonical_source_event_id"
  FROM "session_event"
  WHERE "event_type" IN ('run.cancelled', 'run.completed', 'run.failed')
),
"source_inventory" AS (
  SELECT
    "terminal"."event_type",
    count(*) AS "total",
    sum("terminal"."source_event_id" = "terminal"."canonical_source_event_id") AS "canonical",
    sum("terminal"."source_event_id" <> "terminal"."canonical_source_event_id") AS "noncanonical",
    sum(EXISTS (
      SELECT 1
      FROM "session_event" AS "other"
      WHERE "other"."session_id" = "terminal"."session_id"
        AND "other"."source_event_id" = "terminal"."canonical_source_event_id"
        AND "other"."id" <> "terminal"."id"
    )) AS "canonical_target_collisions"
  FROM "terminal_events" AS "terminal"
  GROUP BY "terminal"."event_type"
),
"multiple_terminal_runs" AS (
  SELECT 1
  FROM "terminal_events"
  WHERE "run_id" IS NOT NULL
  GROUP BY "session_id", "run_id"
  HAVING count(*) > 1
)
SELECT
  coalesce(max(CASE WHEN "event_type" = 'run.cancelled' THEN "total" END), 0) AS "cancelled_total",
  coalesce(max(CASE WHEN "event_type" = 'run.cancelled' THEN "canonical" END), 0) AS "cancelled_canonical",
  coalesce(max(CASE WHEN "event_type" = 'run.cancelled' THEN "noncanonical" END), 0) AS "cancelled_noncanonical",
  coalesce(max(CASE WHEN "event_type" = 'run.cancelled' THEN "canonical_target_collisions" END), 0) AS "cancelled_canonical_target_collisions",
  coalesce(max(CASE WHEN "event_type" = 'run.completed' THEN "total" END), 0) AS "completed_total",
  coalesce(max(CASE WHEN "event_type" = 'run.completed' THEN "canonical" END), 0) AS "completed_canonical",
  coalesce(max(CASE WHEN "event_type" = 'run.completed' THEN "noncanonical" END), 0) AS "completed_noncanonical",
  coalesce(max(CASE WHEN "event_type" = 'run.completed' THEN "canonical_target_collisions" END), 0) AS "completed_canonical_target_collisions",
  coalesce(max(CASE WHEN "event_type" = 'run.failed' THEN "total" END), 0) AS "failed_total",
  coalesce(max(CASE WHEN "event_type" = 'run.failed' THEN "canonical" END), 0) AS "failed_canonical",
  coalesce(max(CASE WHEN "event_type" = 'run.failed' THEN "noncanonical" END), 0) AS "failed_noncanonical",
  coalesce(max(CASE WHEN "event_type" = 'run.failed' THEN "canonical_target_collisions" END), 0) AS "failed_canonical_target_collisions",
  (
    SELECT count(*)
    FROM "terminal_events" AS "event"
    LEFT JOIN "session_run" AS "run" ON "run"."id" = "event"."run_id"
    WHERE "event"."run_id" IS NULL
       OR "run"."id" IS NULL
       OR "run"."session_id" <> "event"."session_id"
  ) AS "invalid_terminal_links",
  (
    SELECT count(*)
    FROM "terminal_events" AS "event"
    INNER JOIN "session_run" AS "run"
      ON "run"."id" = "event"."run_id"
     AND "run"."session_id" = "event"."session_id"
    WHERE NOT (
      ("run"."status" = 'completed' AND "event"."event_type" = 'run.completed')
      OR ("run"."status" = 'failed' AND "event"."event_type" = 'run.failed')
      OR ("run"."status" IN ('cancelled', 'expired') AND "event"."event_type" = 'run.cancelled')
    )
  ) AS "mismatched_terminal_events",
  (SELECT count(*) FROM "multiple_terminal_runs") AS "multiple_terminal_runs"
FROM "source_inventory";
`;

export const PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL = `
WITH "effect_source" AS (
  SELECT
    "effect"."id" AS "effect_id",
    "effect"."status" AS "effect_status",
    "effect"."provider_receipt_json" AS "effect_provider_receipt_json",
    "effect"."result_json" AS "effect_result_json",
    "command"."error_json" AS "command_error_json",
    "command"."payload_json" AS "command_payload_json",
    "command"."result_json" AS "command_result_json",
    "command"."status" AS "command_status",
    max(
      coalesce(length(CAST("effect"."result_json" AS BLOB)), 0),
      coalesce((
        SELECT max(length(CAST("attempt"."result_json" AS BLOB)))
        FROM "external_tool_effect_attempt" AS "attempt"
        WHERE "attempt"."effect_id" = "effect"."id"
          AND "attempt"."status" = 'succeeded'
      ), 0),
      coalesce(length(CAST("command"."result_json" AS BLOB)), 0)
    ) AS "original_result_bytes"
  FROM "external_tool_effect" AS "effect"
  INNER JOIN "driver_command" AS "command" ON "command"."id" = "effect"."command_id"
),
"effect_result_classified" AS (
  SELECT
    "effect_source".*,
    "effect_status" = 'succeeded' AND (
      "original_result_bytes" > 1044480
      OR length(CAST('{"kind":"succeeded","result":' || "effect_result_json" || '}' AS BLOB)) > 1044480
    ) AS "result_omitted"
  FROM "effect_source"
),
"effect_result_target" AS (
  SELECT
    "effect_result_classified".*,
    CASE
      WHEN "result_omitted" THEN
        '{"isError":true,"outputText":' || json_quote('Stored MCP result omitted because it contained ' || "original_result_bytes" || ' UTF-8 bytes.') ||
        ',"requestId":' || json_quote(json_extract("command_payload_json", '$.requestId')) ||
        ',"serverId":' || json_quote(json_extract("command_payload_json", '$.serverId')) ||
        ',"toolName":' || json_quote(json_extract("command_payload_json", '$.toolName')) || '}'
      WHEN "effect_status" = 'succeeded' THEN "effect_result_json"
      ELSE NULL
    END AS "normalized_result_json"
  FROM "effect_result_classified"
),
"effect_target" AS (
  SELECT
    "effect_result_target".*,
    CASE
      WHEN "effect_status" <> 'succeeded' THEN NULL
      WHEN "effect_provider_receipt_json" IS NULL THEN NULL
      WHEN length(CAST(
        '{"kind":"succeeded","providerReceiptJson":' || json_quote("effect_provider_receipt_json") ||
        ',"result":' || "normalized_result_json" || '}'
      AS BLOB)) > 1044480 THEN NULL
      ELSE "effect_provider_receipt_json"
    END AS "normalized_provider_receipt_json"
  FROM "effect_result_target"
),
"loss_candidates" ("category", "id") AS (
  SELECT "category"."value", "command"."id"
  FROM "driver_command" AS "command"
  CROSS JOIN json_each(json_array(
    'command_payload_conflict',
    'mcp_argument_omission',
    'input_text_omission',
    'input_start_result_omission',
    'control_reason_omission',
    'permission_payload_rewrite',
    'command_error_omission'
  )) AS "category"
  WHERE CASE "category"."value"
    WHEN 'command_payload_conflict' THEN
      EXISTS (
        SELECT "key"
        FROM json_each("command"."payload_json")
        GROUP BY "key"
        HAVING count(*) > 1
      )
      OR (
        "command"."kind" = 'input.start'
        AND EXISTS (
          SELECT "key"
          FROM json_each("command"."payload_json", '$.input')
          GROUP BY "key"
          HAVING count(*) > 1
        )
      )
    WHEN 'mcp_argument_omission' THEN
      "command"."kind" = 'mcp.execute'
      AND length(CAST(json_set(
        "command"."payload_json",
        '$.commandId', "command"."id",
        '$.runId', (
          SELECT "effect"."session_run_id"
          FROM "external_tool_effect" AS "effect"
          WHERE "effect"."command_id" = "command"."id"
          LIMIT 1
        )
      ) AS BLOB)) > 824448
    WHEN 'input_text_omission' THEN
      "command"."kind" = 'input.start'
      AND length(CAST("command"."payload_json" AS BLOB)) > 824448
    WHEN 'input_start_result_omission' THEN
      "command"."kind" = 'input.start'
      AND "command"."result_json" IS NOT NULL
      AND json_type("command"."result_json") <> 'null'
      AND (
        length(CAST("command"."payload_json" AS BLOB)) > 824448
        OR length(CAST("command"."result_json" AS BLOB)) > 1044480
      )
    WHEN 'control_reason_omission' THEN
      "command"."kind" IN ('turn.cancel', 'session.stop')
      AND length(CAST("command"."payload_json" AS BLOB)) > 824448
    WHEN 'permission_payload_rewrite' THEN
      "command"."kind" = 'permission.resolve'
      AND length(CAST("command"."payload_json" AS BLOB)) > 824448
    WHEN 'command_error_omission' THEN
      "command"."error_json" IS NOT NULL
      AND length(CAST("command"."error_json" AS BLOB)) > 1044480
      AND NOT EXISTS (
        SELECT 1
        FROM "external_tool_effect" AS "effect"
        WHERE "effect"."command_id" = "command"."id" AND "effect"."status" = 'succeeded'
      )
    ELSE 0
  END
  UNION ALL
  SELECT "category"."value", "target"."effect_id"
  FROM "effect_target" AS "target"
  CROSS JOIN json_each(json_array(
    'mcp_result_omission',
    'mcp_result_conflict',
    'provider_receipt_loss',
    'mcp_command_terminal_conflict'
  )) AS "category"
  WHERE CASE "category"."value"
    WHEN 'mcp_result_omission' THEN "target"."result_omitted"
    WHEN 'mcp_result_conflict' THEN
      (
        NOT "target"."result_omitted"
        AND (
          ("target"."effect_status" <> 'succeeded' AND "target"."effect_result_json" IS NOT NULL)
          OR (
            "target"."effect_status" = 'succeeded'
            AND "target"."command_result_json" IS NOT NULL
            AND json_type("target"."command_result_json") <> 'null'
            AND "target"."command_result_json" IS NOT "target"."effect_result_json"
          )
          OR EXISTS (
            SELECT 1
            FROM "external_tool_effect_attempt" AS "attempt"
            WHERE "attempt"."effect_id" = "target"."effect_id"
              AND "attempt"."result_json" IS NOT NULL
              AND (
                "attempt"."status" <> 'succeeded'
                OR "target"."normalized_result_json" IS NULL
                OR "attempt"."result_json" IS NOT "target"."effect_result_json"
              )
          )
        )
      )
      OR (
        "target"."effect_result_json" IS NOT NULL
        AND EXISTS (
          SELECT "key"
          FROM json_each("target"."effect_result_json")
          GROUP BY "key"
          HAVING count(*) > 1
        )
      )
      OR (
        "target"."command_result_json" IS NOT NULL
        AND EXISTS (
          SELECT "key"
          FROM json_each("target"."command_result_json")
          GROUP BY "key"
          HAVING count(*) > 1
        )
      )
      OR EXISTS (
        SELECT 1
        FROM "external_tool_effect_attempt" AS "attempt"
        WHERE "attempt"."effect_id" = "target"."effect_id"
          AND "attempt"."result_json" IS NOT NULL
          AND EXISTS (
            SELECT "key"
            FROM json_each("attempt"."result_json")
            GROUP BY "key"
            HAVING count(*) > 1
          )
      )
    WHEN 'provider_receipt_loss' THEN
      "target"."effect_provider_receipt_json" IS NOT "target"."normalized_provider_receipt_json"
      OR EXISTS (
        SELECT 1
        FROM "external_tool_effect_attempt" AS "attempt"
        WHERE "attempt"."effect_id" = "target"."effect_id"
          AND "attempt"."provider_receipt_json" IS NOT NULL
          AND "attempt"."provider_receipt_json" IS NOT CASE
            WHEN "attempt"."status" = 'succeeded' THEN "target"."normalized_provider_receipt_json"
            ELSE NULL
          END
      )
    WHEN 'mcp_command_terminal_conflict' THEN
      "target"."effect_status" = 'succeeded'
      AND (
        "target"."command_status" <> 'completed' OR "target"."command_error_json" IS NOT NULL
      )
    ELSE 0
  END
  UNION ALL
  SELECT 'orphan_effect', "effect"."id"
  FROM "external_tool_effect" AS "effect"
  WHERE NOT EXISTS (
    SELECT 1 FROM "driver_command" AS "command" WHERE "command"."id" = "effect"."command_id"
  )
  UNION ALL
  SELECT DISTINCT 'attempt_completion_time_fabrication', "attempt"."effect_id"
  FROM "external_tool_effect_attempt" AS "attempt"
  WHERE "attempt"."status" IN ('succeeded', 'unknown')
    AND "attempt"."completed_at" IS NULL
  UNION ALL
  SELECT 'session_run_error_omission', "run"."id"
  FROM "session_run" AS "run"
  WHERE "run"."error_code" IS NOT NULL
    AND "run"."error_message" IS NOT NULL
    AND length(CAST(
      '{"code":' || json_quote("run"."error_code") ||
      ',"details":' || coalesce(nullif("run"."error_details_json", ''), '{}') ||
      ',"message":' || json_quote("run"."error_message") ||
      ',"retryable":false}'
    AS BLOB)) > 1044480
)
SELECT
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'attempt_completion_time_fabrication') AS "attempt_completion_time_fabrications",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'command_payload_conflict') AS "command_payload_conflicts",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'mcp_argument_omission') AS "mcp_argument_omissions",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'input_text_omission') AS "input_text_omissions",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'input_start_result_omission') AS "input_start_result_omissions",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'control_reason_omission') AS "control_reason_omissions",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'permission_payload_rewrite') AS "permission_payload_rewrites",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'mcp_result_omission') AS "mcp_result_omissions",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'orphan_effect') AS "orphan_effects",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'mcp_result_conflict') AS "mcp_result_conflicts",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'provider_receipt_loss') AS "provider_receipt_losses",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'mcp_command_terminal_conflict') AS "mcp_command_terminal_conflicts",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'command_error_omission') AS "command_error_omissions",
  (SELECT count(*) FROM "loss_candidates" WHERE "category" = 'session_run_error_omission') AS "session_run_error_omissions",
  (SELECT count(*) FROM "loss_candidates") AS "total_candidates",
  coalesce((
    SELECT json_group_array(json_array("category", "id"))
    FROM (
      SELECT "category", "id"
      FROM "loss_candidates"
      ORDER BY "category", "id"
      LIMIT 50
    )
  ), json('[]')) AS "candidate_ids_json";
`;

export const PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL = `
WITH "terminal_events" AS (
  SELECT "event_type", "id", "run_id", "seq", "session_id", "source_event_id"
  FROM "session_event"
  WHERE "event_type" IN ('run.cancelled', 'run.completed', 'run.failed')
),
"assistant_runs" AS (
  SELECT "session_id", "session_run_id", count(*) AS "assistant_count"
  FROM "session_message"
  WHERE "role" = 'assistant' AND "session_run_id" IS NOT NULL
  GROUP BY "session_id", "session_run_id"
)
SELECT
  (
    SELECT count(*)
    FROM (
      SELECT 1
      FROM "terminal_events"
      WHERE "run_id" IS NOT NULL
      GROUP BY "session_id", "run_id"
      HAVING count(*) > 1
    )
  ) AS "duplicate_terminal_runs",
  (
    SELECT count(*)
    FROM "terminal_events" AS "event"
    INNER JOIN "session_run" AS "run"
      ON "run"."id" = "event"."run_id"
     AND "run"."session_id" = "event"."session_id"
    WHERE NOT (
      ("run"."status" = 'completed' AND "event"."event_type" = 'run.completed')
      OR ("run"."status" = 'failed' AND "event"."event_type" = 'run.failed')
      OR ("run"."status" IN ('cancelled', 'expired') AND "event"."event_type" = 'run.cancelled')
    )
  ) AS "mismatched_terminal_events",
  (
    SELECT count(*)
    FROM "terminal_events" AS "event"
    LEFT JOIN "session_run" AS "run" ON "run"."id" = "event"."run_id"
    WHERE "event"."run_id" IS NULL
       OR "run"."id" IS NULL
       OR "run"."session_id" <> "event"."session_id"
  ) AS "invalid_terminal_links",
  (
    SELECT count(*)
    FROM "terminal_events"
    WHERE "run_id" IS NULL
       OR "source_event_id" <> 'session-run-terminal:' || "run_id" || ':' || "event_type"
  ) AS "noncanonical_terminal_sources",
  (
    SELECT json_group_array(json_array(
      "id", "session_id", "run_id", "event_type", "source_event_id", "seq"
    ))
    FROM (
      SELECT "id", "session_id", "run_id", "event_type", "source_event_id", "seq"
      FROM "terminal_events"
      WHERE "run_id" IS NULL
         OR "source_event_id" <>
           'session-run-terminal:' || "run_id" || ':' || "event_type"
      ORDER BY "id" COLLATE BINARY
    )
  ) AS "rewrite_candidate_manifest_json",
  (
    SELECT count(*)
    FROM "session_run" AS "run"
    WHERE "run"."status" IN ('cancelled', 'completed', 'expired', 'failed')
      AND NOT EXISTS (
        SELECT 1
        FROM "terminal_events" AS "event"
        WHERE "event"."session_id" = "run"."session_id"
          AND "event"."run_id" = "run"."id"
      )
  ) AS "missing_terminal_events",
  (
    SELECT count(*)
    FROM "terminal_events" AS "event"
    INNER JOIN "session_run" AS "run"
      ON "run"."id" = "event"."run_id"
     AND "run"."session_id" = "event"."session_id"
    LEFT JOIN "session" ON "session"."id" = "run"."session_id"
    WHERE "session"."id" IS NULL
       OR "run"."completed_at" IS NULL
       OR "run"."status_event" <> CASE "run"."status"
         WHEN 'completed' THEN 'run.complete'
         WHEN 'failed' THEN 'run.fail'
         WHEN 'cancelled' THEN 'run.cancel'
         WHEN 'expired' THEN 'run.expire'
       END
       OR "event"."seq" > "session"."runtime_event_seq_cursor"
       OR (
         "session"."last_run_id" = "run"."id"
         AND (
           "session"."status" NOT IN ('IDLE', 'TERMINATED')
           OR "session"."status_operation_id" IS NOT NULL
         )
       )
       OR EXISTS (
         SELECT 1
         FROM "session_permission_request" AS "permission"
         WHERE "permission"."session_id" = "run"."session_id"
           AND "permission"."run_id" = "run"."id"
       )
  ) AS "partial_terminal_projections",
  (
    SELECT count(*)
    FROM "assistant_runs" AS "assistant"
    INNER JOIN "session_run" AS "run"
      ON "run"."id" = "assistant"."session_run_id"
     AND "run"."session_id" = "assistant"."session_id"
    WHERE "run"."status" = 'completed' AND "assistant"."assistant_count" > 1
  ) AS "ambiguous_assistant_runs",
  (
    SELECT count(*)
    FROM "session_message" AS "message"
    LEFT JOIN "session_run" AS "run" ON "run"."id" = "message"."session_run_id"
    LEFT JOIN "session" ON "session"."id" = "message"."session_id"
    WHERE "message"."role" = 'assistant'
      AND "message"."session_run_id" IS NOT NULL
      AND (
        "run"."id" IS NULL
        OR "run"."session_id" <> "message"."session_id"
        OR "session"."id" IS NULL
        OR "message"."seq" > "session"."message_seq_cursor"
        OR "run"."status" IN ('cancelled', 'expired', 'failed')
        OR CASE
          WHEN "message"."plan_json" IS NULL OR "message"."plan_json" = '' THEN 0
          WHEN json_valid("message"."plan_json") = 0 THEN 1
          WHEN json_type("message"."plan_json") <> 'array' THEN 1
          ELSE 0
        END = 1
        OR CASE
          WHEN "message"."segments_json" IS NULL OR "message"."segments_json" = '' THEN 0
          WHEN json_valid("message"."segments_json") = 0 THEN 1
          WHEN json_type("message"."segments_json") <> 'array' THEN 1
          ELSE 0
        END = 1
      )
  ) AS "partial_assistant_projections",
  (
    SELECT count(*)
    FROM "session_run"
    WHERE "status" = 'failed'
      AND (
        "error_code" IS NULL
        OR trim("error_code") = ''
        OR "error_message" IS NULL
        OR trim("error_message") = ''
        OR CASE
          WHEN "error_details_json" IS NULL THEN 0
          WHEN json_valid("error_details_json") = 0 THEN 1
          WHEN json_type("error_details_json") <> 'object' THEN 1
          ELSE 0
        END = 1
      )
  ) AS "invalid_failed_runs",
  (
    SELECT count(*)
    FROM "session_run"
    WHERE "status" IN ('cancelled', 'completed', 'expired')
      AND (
        "error_code" IS NOT NULL
        OR "error_details_json" IS NOT NULL
        OR "error_message" IS NOT NULL
      )
  ) AS "invalid_nonfailed_run_errors",
  (
    SELECT count(*)
    FROM "session_run"
    WHERE "status" = 'failed'
      AND "error_code" IS NOT NULL
      AND trim("error_code") <> ''
      AND "error_message" IS NOT NULL
      AND trim("error_message") <> ''
      AND CASE
        WHEN "error_details_json" IS NULL THEN 1
        WHEN json_valid("error_details_json") = 0 THEN 0
        WHEN json_type("error_details_json") = 'object' THEN 1
        ELSE 0
      END = 1
  ) AS "repairable_failed_runs",
  (
    SELECT count(*)
    FROM "driver_command"
    WHERE "status" IN ('queued', 'delivered', 'accepted')
  ) AS "nonterminal_commands",
  (
    SELECT count(*)
    FROM "external_tool_effect"
    WHERE "status" IN ('executing', 'claimed')
  ) AS "unsettled_effects",
  (SELECT count(*) FROM "session_message") AS "legacy_materialized_messages",
  (SELECT count(*) FROM "terminal_events") AS "legacy_terminal_events",
  (
    SELECT count(*)
    FROM "session_event"
    WHERE "event_type" LIKE 'message.%' OR "event_type" LIKE 'thought.%'
  ) AS "legacy_stream_rows";
`;

export const PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE_SQL = `CREATE TABLE "${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE}" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "gate_id" integer NOT NULL CHECK ("gate_id" = 1) REFERENCES "${PROTOCOL_V3_CUTOVER_TABLE}" ("id") ON DELETE CASCADE,
  "bookmark" text NOT NULL CHECK (length(trim("bookmark")) > 0),
  "candidate_count" integer NOT NULL CHECK ("candidate_count" >= 0),
  "candidate_manifest_json" text NOT NULL CHECK (json_valid("candidate_manifest_json") AND json_type("candidate_manifest_json") = 'array'),
  "deploy_owner" text NOT NULL,
  "expires_at" integer NOT NULL,
  "release_tree_oid" text NOT NULL CHECK ((length("release_tree_oid") = 40 OR length("release_tree_oid") = 64) AND "release_tree_oid" = lower("release_tree_oid") AND "release_tree_oid" NOT GLOB '*[^0-9a-f]*')
)`;

const PROTOCOL_V3_LEGACY_REWRITE_MANIFEST_SQL = `
SELECT
  count(*) AS "candidate_count",
  json_group_array(json_array(
    "id", "session_id", "run_id", "event_type", "source_event_id", "seq"
  )) AS "candidate_manifest_json"
FROM (
  SELECT "id", "session_id", "run_id", "event_type", "source_event_id", "seq"
  FROM "session_event"
  WHERE "event_type" IN ('run.cancelled', 'run.completed', 'run.failed')
    AND "source_event_id" <>
      'session-run-terminal:' || "run_id" || ':' || "event_type"
  ORDER BY "id" COLLATE BINARY
)`;

export function authorizeProtocolV3LegacyRewriteSql(
  owner: string,
  candidateCount: number,
  candidateManifestJson: string,
): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(owner)) {
    throw new Error("Protocol v3 legacy rewrite owner must be a UUID v4.");
  }
  let candidateManifest: unknown;
  try {
    candidateManifest = JSON.parse(candidateManifestJson);
  } catch {
    throw new Error("Protocol v3 legacy rewrite manifest must be valid JSON.");
  }
  if (
    !Number.isSafeInteger(candidateCount) ||
    candidateCount < 0 ||
    !Array.isArray(candidateManifest) ||
    candidateManifest.length !== candidateCount
  ) {
    throw new Error("Protocol v3 legacy rewrite manifest count is invalid.");
  }
  const quotedOwner = sqlString(owner);
  const quotedManifest = sqlString(candidateManifestJson);
  return `
${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE_SQL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS")};
${PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_SQL.replace("CREATE TRIGGER", "CREATE TRIGGER IF NOT EXISTS")};
DELETE FROM "${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE}" WHERE "id" = 1;
WITH "manifest" AS (${PROTOCOL_V3_LEGACY_REWRITE_MANIFEST_SQL})
INSERT INTO "${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE}" (
  "id", "gate_id", "bookmark", "candidate_count", "candidate_manifest_json", "deploy_owner", "expires_at", "release_tree_oid"
)
SELECT
  1,
  "gate"."id",
  "gate"."pre_migration_bookmark",
  "manifest"."candidate_count",
  "manifest"."candidate_manifest_json",
  "lease"."owner",
  unixepoch() + 600,
  "gate"."release_tree_oid"
FROM "manifest"
INNER JOIN "${PROTOCOL_V3_CUTOVER_TABLE}" AS "gate"
  ON "gate"."id" = 1
 AND "gate"."enabled" = 1
 AND "gate"."command_freeze" = 1
 AND "gate"."phase" = 'draining'
 AND length(trim("gate"."pre_migration_bookmark")) > 0
 AND "gate"."smoke_account_id" IS NULL
 AND "gate"."smoke_request_key" IS NULL
 AND "gate"."smoke_session_id" IS NULL
INNER JOIN "${PROD_DEPLOY_LEASE_TABLE}" AS "lease"
  ON "lease"."id" = 1
 AND "lease"."owner" = ${quotedOwner}
WHERE NOT EXISTS (
  SELECT 1 FROM "session_run"
  WHERE "status" IN (${ACTIVE_RUN_STATUSES})
)
AND NOT EXISTS (
  SELECT 1 FROM "driver_instance"
  WHERE "status" IN (${LIVE_DRIVER_STATUSES})
)
AND NOT EXISTS (
  SELECT 1 FROM "driver_command"
  WHERE "status" IN ('queued', 'delivered', 'accepted')
)
AND NOT EXISTS (
  SELECT 1 FROM "external_tool_effect"
  WHERE "status" IN ('executing', 'claimed')
)
AND NOT EXISTS (
  SELECT 1 FROM "api_command"
  WHERE "status" IN ('queued', 'running')
)
AND NOT EXISTS (
  SELECT 1 FROM "project_deployment_run"
  WHERE "status" IN (${ACTIVE_APP_DEPLOYMENT_RUN_STATUSES})
)
AND NOT EXISTS (
  SELECT 1 FROM "sandbox"
  WHERE "status" <> 'cold'
     OR "status_operation_id" IS NOT NULL
     OR "claim_owner" IS NOT NULL
     OR "claim_expires_at" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "sandbox_session"
  WHERE "status" NOT IN ('closed', 'error')
)
AND NOT EXISTS (
  SELECT 1 FROM "sandbox_backup"
  WHERE "status" NOT IN ('ready', 'pruned') OR "error_message" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "session"
  WHERE "status" NOT IN ('IDLE', 'TERMINATED') OR "status_operation_id" IS NOT NULL
)
AND "manifest"."candidate_count" = ${candidateCount}
AND "manifest"."candidate_manifest_json" = ${quotedManifest} COLLATE BINARY;
`;
}

export const PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_SQL = `
SELECT
  "authorization"."bookmark",
  "authorization"."candidate_count",
  "authorization"."candidate_manifest_json",
  "authorization"."deploy_owner",
  "authorization"."expires_at",
  "authorization"."release_tree_oid",
  (SELECT "sql" FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" = '${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE}') AS "authorization_table_sql",
  (SELECT "sql" FROM "sqlite_master"
    WHERE "type" = 'trigger' AND "name" = '${PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER}') AS "gate_update_trigger_sql"
FROM "${PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE}" AS "authorization"
WHERE "authorization"."id" = 1;
`;

function protocolV3CutoverDrainSql(postRuntimeAuthorityMigration: boolean): string {
  const sandboxOperation = postRuntimeAuthorityMigration
    ? '\n       OR "operation_kind" IS NOT NULL'
    : "";
  const unsafeSessions = postRuntimeAuthorityMigration
    ? `NOT (${postMigrationSessionStaticSql('"session"')})`
    : `"status" NOT IN ('IDLE', 'TERMINATED') OR "status_operation_id" IS NOT NULL`;
  const stagingCount = postRuntimeAuthorityMigration
    ? '(SELECT count(*) FROM "sandbox_backup_staging")'
    : "0";
  const environmentArtifactStagingCount = postRuntimeAuthorityMigration
    ? '(SELECT count(*) FROM "environment_package_artifact_backup_staging")'
    : "0";
  return `
SELECT
  (SELECT count(*) FROM "session_run"
    WHERE "status" IN (${ACTIVE_RUN_STATUSES})) AS "active_runs",
  (SELECT count(*) FROM "project_deployment_run"
    WHERE "status" IN (${ACTIVE_APP_DEPLOYMENT_RUN_STATUSES})) AS "active_project_deployment_runs",
  (SELECT count(*) FROM "driver_instance"
    WHERE "status" IN (${LIVE_DRIVER_STATUSES})) AS "live_drivers",
  (SELECT count(*) FROM "external_tool_effect"
    WHERE "status" IN ('executing', 'claimed')) AS "unsettled_effects",
  (SELECT count(*) FROM "driver_command"
    WHERE "status" IN ('queued', 'delivered', 'accepted')) AS "nonterminal_commands",
  (SELECT count(*) FROM "api_command"
    WHERE "status" IN ('queued', 'running')) AS "nonterminal_api_commands",
  (SELECT count(*) FROM "sandbox"
    WHERE "status" <> 'cold'
      ${sandboxOperation}
       OR "status_operation_id" IS NOT NULL
       OR "claim_owner" IS NOT NULL
       OR "claim_expires_at" IS NOT NULL) AS "unsafe_sandboxes",
  (SELECT count(*) FROM "sandbox_session"
    WHERE "status" NOT IN ('closed', 'error')) AS "unsafe_sandbox_sessions",
  (SELECT count(*) FROM "sandbox_backup"
    WHERE "status" NOT IN ('ready', 'pruned')) AS "unsafe_sandbox_backups",
  ${stagingCount} AS "unsafe_sandbox_backup_staging",
  ${environmentArtifactStagingCount} AS "unsafe_environment_artifact_backup_staging",
  (SELECT count(*) FROM "session" WHERE ${unsafeSessions}) AS "unsafe_sessions";
`;
}

export const PROTOCOL_V3_CUTOVER_DRAIN_SQL = protocolV3CutoverDrainSql(false);
export const PROTOCOL_V3_POST_MIGRATION_CUTOVER_DRAIN_SQL = protocolV3CutoverDrainSql(true);

function protocolV3UnsafeSandboxesSql(postRuntimeAuthorityMigration: boolean): string {
  const operationColumn = postRuntimeAuthorityMigration ? ', "operation_kind"' : "";
  const operationPredicate = postRuntimeAuthorityMigration
    ? '\n   OR "operation_kind" IS NOT NULL'
    : "";
  return `
SELECT "id", "status", "status_operation_id", "claim_owner", "claim_expires_at"${operationColumn}
FROM "sandbox"
WHERE "status" <> 'cold'
   ${operationPredicate}
   OR "status_operation_id" IS NOT NULL
   OR "claim_owner" IS NOT NULL
   OR "claim_expires_at" IS NOT NULL
ORDER BY "id"
LIMIT 50;
`;
}

export const PROTOCOL_V3_UNSAFE_SANDBOXES_SQL = protocolV3UnsafeSandboxesSql(false);
export const PROTOCOL_V3_POST_MIGRATION_UNSAFE_SANDBOXES_SQL = protocolV3UnsafeSandboxesSql(true);

export function protocolV3RuntimeAuthorityPreflightSql(
  sessionCleanupMigrationPending: boolean,
): string {
  const nonstaticSessionsSql = sessionCleanupMigrationPending
    ? `(SELECT count(*)
   FROM "session"
   WHERE "status" NOT IN ('IDLE', 'TERMINATED')
      OR "status_operation_id" IS NOT NULL
  )`
    : `(SELECT count(*)
   FROM "session"
   WHERE "status" NOT IN ('IDLE', 'TERMINATED')
      OR "status_operation_id" IS NOT NULL
      OR NOT (
        "cleanup_operation_kind" IS NULL
        OR (
          "cleanup_operation_kind" = 'archive'
          AND "status" = 'IDLE'
          AND "archived_at" IS NOT NULL
        )
      )
      OR "runtime_provisioning_operation_id" IS NOT NULL
      OR "runtime_provisioning_run_id" IS NOT NULL
      OR "runtime_provisioning_sandbox_id" IS NOT NULL
      OR "runtime_provisioning_heartbeat_at" IS NOT NULL
  )`;
  return `
WITH "runtime_subject_identity" (
  "sandbox_id", "kind", "subject_kind", "subject_id", "agent_id", "project_id", "owner_account_id"
) AS (
  SELECT
    "sandbox"."id", 'pet', 'agent', "sandbox"."subject_id",
    "agent"."id", "agent"."project_id", "agent"."owner_account_id"
  FROM "sandbox"
  INNER JOIN "agent"
    ON "sandbox"."kind" = 'pet'
   AND "sandbox"."subject_kind" = 'agent'
   AND "agent"."id" = "sandbox"."subject_id"
   AND "agent"."kind" = 'pet'
  INNER JOIN "project" ON "project"."id" = "agent"."project_id"
  UNION ALL
  SELECT
    "sandbox"."id", 'cattle', 'session', "sandbox"."subject_id",
    "agent"."id", "session"."project_id", "agent"."owner_account_id"
  FROM "sandbox"
  INNER JOIN "session"
    ON "sandbox"."kind" = 'cattle'
   AND "sandbox"."subject_kind" = 'session'
   AND "session"."id" = "sandbox"."subject_id"
   AND "session"."kind" = 'cattle'
  INNER JOIN "agent"
    ON "agent"."id" = "session"."agent_id"
   AND "agent"."project_id" = "session"."project_id"
   AND "agent"."kind" = 'cattle'
  INNER JOIN "project" ON "project"."id" = "session"."project_id"
)
SELECT
  (SELECT count(*)
   FROM "sandbox" AS "sandbox"
   LEFT JOIN "runtime_subject_identity" AS "identity"
     ON "identity"."sandbox_id" = "sandbox"."id"
   WHERE "identity"."sandbox_id" IS NULL
      OR NOT (
        ("sandbox"."agent_id" IS NULL
         AND "sandbox"."project_id" IS NULL
         AND "sandbox"."owner_account_id" IS NULL)
        OR ("sandbox"."agent_id" IS "identity"."agent_id"
            AND "sandbox"."project_id" IS "identity"."project_id"
            AND "sandbox"."owner_account_id" IS "identity"."owner_account_id")
      )
  ) AS "invalid_sandbox_identities",
  (SELECT count(*)
   FROM "sandbox_session" AS "workspace"
   LEFT JOIN "runtime_subject_identity" AS "identity"
     ON "identity"."sandbox_id" = "workspace"."sandbox_id"
   LEFT JOIN "session" AS "session" ON "session"."id" = "workspace"."session_id"
   WHERE "identity"."sandbox_id" IS NULL
      OR "session"."id" IS NULL
      OR "session"."kind" IS NOT "identity"."kind"
      OR "session"."agent_id" IS NOT "identity"."agent_id"
      OR "session"."project_id" IS NOT "identity"."project_id"
      OR ("identity"."subject_kind" = 'session'
          AND "workspace"."session_id" IS NOT "identity"."subject_id")
      OR ("identity"."subject_kind" = 'agent'
          AND "session"."agent_id" IS NOT "identity"."subject_id")
  ) AS "invalid_sandbox_session_authorities",
  (SELECT count(*)
   FROM "driver_instance"
   WHERE typeof("generation") <> 'integer'
      OR "generation" NOT BETWEEN 0 AND 9007199254740991
  ) AS "invalid_driver_generations",
  ((SELECT count(*)
    FROM "sandbox"
    WHERE "last_backup_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "sandbox_backup"
        WHERE "sandbox_backup"."id" = "sandbox"."last_backup_id"
          AND "sandbox_backup"."sandbox_id" = "sandbox"."id"
          AND "sandbox_backup"."status" = 'ready'
      ))
   +
   (SELECT count(*)
    FROM "sandbox"
    WHERE "last_restore_backup_id" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "sandbox_backup"
        WHERE "sandbox_backup"."id" = "sandbox"."last_restore_backup_id"
          AND "sandbox_backup"."sandbox_id" = "sandbox"."id"
          AND "sandbox_backup"."status" IN ('ready', 'pruned')
      ))) AS "invalid_sandbox_backup_pointers",
  0 AS "legacy_app_deployment_traffic",
  ${nonstaticSessionsSql} AS "nonstatic_sessions",
  (SELECT count(*) FROM pragma_foreign_key_check) AS "foreign_key_violations",
  (SELECT count(*)
   FROM "sandbox_backup" AS "backup"
   LEFT JOIN "runtime_subject_identity" AS "identity"
     ON "identity"."sandbox_id" = "backup"."sandbox_id"
   LEFT JOIN "session_run" AS "run" ON "run"."id" = "backup"."session_run_id"
   LEFT JOIN "session" AS "run_session" ON "run_session"."id" = "run"."session_id"
   WHERE "backup"."status" NOT IN ('ready', 'pruned')
      OR "backup"."error_message" IS NOT NULL
      OR typeof("backup"."dir") <> 'text'
      OR length("backup"."dir") = 0
      OR typeof("backup"."keep") <> 'integer'
      OR "backup"."keep" NOT IN (0, 1)
      OR typeof("backup"."ttl_seconds") <> 'integer'
      OR "backup"."ttl_seconds" NOT BETWEEN 1 AND 9007199254740991
      OR typeof("backup"."created_at") <> 'integer'
      OR "backup"."created_at" NOT BETWEEN 0 AND 9007199254740991
      OR typeof("backup"."updated_at") <> 'integer'
      OR "backup"."updated_at" NOT BETWEEN "backup"."created_at" AND 9007199254740991
      OR ("backup"."session_run_id" IS NOT NULL AND (
        "identity"."sandbox_id" IS NULL
        OR "run"."id" IS NULL
        OR "run"."status" IS NOT 'completed'
        OR "run"."agent_id" IS NOT "identity"."agent_id"
        OR "run_session"."id" IS NULL
        OR "run_session"."kind" IS NOT "identity"."kind"
        OR NOT EXISTS (
          SELECT 1
          FROM "sandbox_session" AS "workspace"
          WHERE "workspace"."session_id" = "run"."session_id"
            AND "workspace"."sandbox_id" = "backup"."sandbox_id"
            AND "workspace"."cwd" = "backup"."dir"
        )
        OR ("identity"."subject_kind" = 'session'
            AND "run_session"."id" IS NOT "identity"."subject_id")
        OR ("identity"."subject_kind" = 'agent' AND (
          "run_session"."agent_id" IS NOT "identity"."agent_id"
          OR "run_session"."project_id" IS NOT "identity"."project_id"
        ))
      ))
  ) AS "invalid_sandbox_backups",
  (SELECT count(*)
   FROM (
     SELECT 1
     FROM "sandbox_backup"
     WHERE "session_run_id" IS NOT NULL
     GROUP BY "sandbox_id", "dir", "session_run_id"
     HAVING count(*) > 1
   )
  ) AS "duplicate_sandbox_backups";
`;
}

export const PROTOCOL_V3_RUNTIME_AUTHORITY_PREFLIGHT_SQL =
  protocolV3RuntimeAuthorityPreflightSql(false);

export const PROTOCOL_V3_CUTOVER_BOOKMARK_SQL = `
SELECT "pre_migration_bookmark" AS "bookmark"
FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
WHERE "id" = 1;
`;

export const PROTOCOL_V3_SMOKE_SESSION_SQL = `
SELECT "smoke_session_id" AS "smoke_session_id"
FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
WHERE "id" = 1;
`;

export const PROTOCOL_V3_SMOKE_REQUEST_KEY_SQL = `
SELECT "smoke_request_key" AS "smoke_request_key"
FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
WHERE "id" = 1;
`;

export const ENTER_PROTOCOL_V3_DRAIN_SQL = `
UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}"
SET
  "command_freeze" = 0,
  "smoke_account_id" = NULL,
  "smoke_request_key" = NULL,
  "smoke_session_id" = NULL
WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining';
`;

export const ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL = `
UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}"
SET "command_freeze" = 1
WHERE "id" = 1
  AND "enabled" = 1
  AND "phase" = 'draining'
  AND NOT EXISTS (
    SELECT 1 FROM "api_command" WHERE "status" IN ('queued', 'running')
  )
  AND NOT EXISTS (
    SELECT 1 FROM "project_deployment_run"
    WHERE "status" IN (${ACTIVE_APP_DEPLOYMENT_RUN_STATUSES})
  );
`;

export const PROTOCOL_V3_COMMAND_FREEZE_SQL = `
SELECT
  "command_freeze" AS "command_freeze",
  "release_tree_oid" AS "release_tree_oid",
  "enabled" AS "enabled",
  "phase" AS "phase",
  "target_container_application_version" AS "target_container_application_version",
  "target_container_image_digest" AS "target_container_image_digest",
  "target_worker_version_id" AS "target_worker_version_id",
  EXISTS (
    SELECT 1
    FROM "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}" AS "intent"
    WHERE "intent"."id" = "gate"."id"
  ) AS "migration_started",
  (SELECT "sql" FROM "sqlite_master"
   WHERE "type" = 'table' AND "name" = '${PROTOCOL_V3_MIGRATION_INTENT_TABLE}') AS "migration_intent_table_sql",
  (SELECT count(*) FROM "sqlite_master"
   WHERE "type" = 'trigger' AND "tbl_name" = '${PROTOCOL_V3_MIGRATION_INTENT_TABLE}' COLLATE BINARY) AS "migration_intent_trigger_count"
FROM "${PROTOCOL_V3_CUTOVER_TABLE}" AS "gate"
WHERE "gate"."id" = 1;
`;

export function beginProtocolV3MigrationSql(releaseTreeOid: string): string {
  const release = requireGitTreeOid(releaseTreeOid, "Protocol v3 release tree OID");
  return `INSERT INTO "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}" ("id")
SELECT "id"
FROM "${PROTOCOL_V3_CUTOVER_TABLE}"
WHERE "id" = 1
  AND "enabled" = 1
  AND "command_freeze" = 1
  AND "phase" = 'draining'
  AND "release_tree_oid" = '${release}'
ON CONFLICT ("id") DO NOTHING;`;
}

export function storeProtocolV3RolloutSql(
  releaseTreeOid: string,
  workerVersionId: string,
  containerApplicationVersion: number,
  containerImageDigest: string,
): string {
  const release = requireGitTreeOid(releaseTreeOid, "Protocol v3 release tree OID");
  const workerVersion = requireWorkerVersionId(workerVersionId);
  if (!Number.isSafeInteger(containerApplicationVersion) || containerApplicationVersion < 0) {
    throw new Error("Protocol v3 Container application version must be a non-negative integer.");
  }
  const imageDigest = requireSha256Digest(
    containerImageDigest,
    "Protocol v3 Container image digest",
  );
  return `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}"
SET "target_container_application_version" = ${containerApplicationVersion},
    "target_container_image_digest" = '${imageDigest}',
    "target_worker_version_id" = '${workerVersion}'
WHERE "id" = 1
  AND "enabled" = 1
  AND "phase" = 'draining'
  AND "release_tree_oid" = '${release}'
  AND (
    ("target_container_application_version" IS NULL AND "target_container_image_digest" IS NULL AND "target_worker_version_id" IS NULL)
    OR (
      "target_container_application_version" = ${containerApplicationVersion}
      AND "target_container_image_digest" = '${imageDigest}'
      AND "target_worker_version_id" = '${workerVersion}'
    )
  );`;
}

export const ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL = `
UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}"
SET
  "command_freeze" = 1,
  "enabled" = 1,
  "phase" = 'queues_resuming',
  "smoke_account_id" = NULL,
  "smoke_request_key" = NULL,
  "smoke_session_id" = NULL
WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining';
`;

export const ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL = `
UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}"
SET "enabled" = 0
WHERE "id" = 1
  AND "enabled" = 1
  AND "command_freeze" = 1
  AND "phase" = 'queues_resuming';
`;

export const CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL = `
UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}"
SET
  "command_freeze" = 1,
  "smoke_account_id" = NULL,
  "smoke_request_key" = NULL,
  "smoke_session_id" = NULL
WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining';
`;

export const PROTOCOL_V3_CUTOVER_OBJECTS_SQL = `
WITH "post_schema" ("value") AS (
  SELECT EXISTS (
    SELECT 1 FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" = 'sandbox_backup_staging' COLLATE BINARY
  )
),
"pre_migration_expected" ("type", "name", "table_name", "sql") AS (
  VALUES ${PROTOCOL_V3_CUTOVER_OBJECTS.map(
    (object) =>
      `(${sqlString(object.type)}, ${sqlString(object.name)}, ${sqlString(object.tableName)}, ${sqlString(object.sql)})`,
  ).join(",\n         ")}
),
"post_migration_expected" ("type", "name", "table_name", "sql") AS (
  VALUES ${PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECTS.map(
    (object) =>
      `(${sqlString(object.type)}, ${sqlString(object.name)}, ${sqlString(object.tableName)}, ${sqlString(object.sql)})`,
  ).join(",\n         ")}
),
"expected" AS (
  SELECT * FROM "pre_migration_expected" WHERE (SELECT "value" FROM "post_schema") = 0
  UNION ALL
  SELECT * FROM "post_migration_expected" WHERE (SELECT "value" FROM "post_schema") = 1
),
"actual" AS (
  SELECT "type", "name", "tbl_name" AS "table_name", "sql"
  FROM "sqlite_master"
  WHERE "name" COLLATE NOCASE IN (${CUTOVER_RESERVED_NAMES_SQL})
    OR (
      "type" = 'trigger'
      AND "tbl_name" COLLATE NOCASE IN (${CUTOVER_PROTECTED_TABLES_SQL})
      AND NOT (
        ${PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_MATCH_SQL}
        OR ${CUTOVER_MANAGED_TRIGGER_MATCH_SQL}
      )
    )
)
SELECT
  count(*) AS "object_count",
  CASE WHEN count(*) = (SELECT count(*) FROM "expected")
    THEN coalesce(sum(EXISTS (
      SELECT 1
      FROM "expected"
      WHERE "expected"."type" = "actual"."type" COLLATE BINARY
        AND "expected"."name" = "actual"."name" COLLATE BINARY
        AND "expected"."table_name" = "actual"."table_name" COLLATE BINARY
        AND "expected"."sql" = "actual"."sql" COLLATE BINARY
    )), 0)
    ELSE 0
  END AS "exact_object_count"
FROM "actual";
`;

export interface ProtocolV3CutoverProbe {
  readonly gatePresent: boolean;
}

export function findPendingProdMigrations(
  raw: string,
  localMigrationNames: readonly string[],
): string[] {
  const validateName = (name: unknown): string => {
    if (typeof name !== "string" || !/^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)) {
      throw new Error("Production D1 migration name is invalid.");
    }
    return name;
  };
  const local = localMigrationNames.map(validateName);
  if (new Set(local).size !== local.length) {
    throw new Error("Local D1 migration names must be unique.");
  }

  const applied = parseD1JsonResults(raw).flatMap((result) =>
    result.map((row) => validateName(row.name)),
  );
  if (new Set(applied).size !== applied.length) {
    throw new Error("Production D1 migration ledger contains duplicate names.");
  }
  const appliedSet = new Set(applied);
  if (
    applied.length > local.length ||
    local.some((name, index) => appliedSet.has(name) !== index < applied.length)
  ) {
    throw new Error("Production D1 migration ledger is not an exact prefix of local history.");
  }

  return local.filter((name) => !appliedSet.has(name));
}

export function assertCutoverMigrationJournalAudited(localMigrationNames: readonly string[]): void {
  if (
    localMigrationNames.length !== AUDITED_MIGRATION_NAMES.length ||
    AUDITED_MIGRATION_NAMES.some((name, index) => localMigrationNames[index] !== name)
  ) {
    throw new Error(
      `Production cutover safety is audited only through ${LAST_CUTOVER_AUDITED_MIGRATION}; review every new migration against the gate and drain before updating that boundary.`,
    );
  }
}

export interface ProtocolV3CutoverObjects {
  readonly exactObjectCount: number;
  readonly objectCount: number;
}

export interface ProtocolV3LegacyTerminalIntegrity {
  readonly ambiguousAssistantRuns: number;
  readonly duplicateTerminalRuns: number;
  readonly invalidFailedRuns: number;
  readonly invalidNonfailedRunErrors: number;
  readonly invalidTerminalLinks: number;
  readonly legacyMaterializedMessages: number;
  readonly legacyStreamRows: number;
  readonly legacyTerminalEvents: number;
  readonly mismatchedTerminalEvents: number;
  readonly missingTerminalEvents: number;
  readonly noncanonicalTerminalSources: number;
  readonly nonterminalCommands: number;
  readonly partialAssistantProjections: number;
  readonly partialTerminalProjections: number;
  readonly repairableFailedRuns: number;
  readonly rewriteCandidateManifestJson: string;
  readonly unsettledEffects: number;
}

export interface ProtocolV3LegacyRewriteAuthorization {
  readonly bookmark: string;
  readonly candidateCount: number;
  readonly candidateManifestJson: string;
  readonly deployOwner: string;
  readonly expiresAt: number;
  readonly releaseTreeOid: string;
}

export interface ProtocolV3LegacyTerminalSourceKindInventory {
  readonly canonical: number;
  readonly canonicalTargetCollisions: number;
  readonly noncanonical: number;
  readonly total: number;
}

export interface ProtocolV3LegacyTerminalSourceInventory {
  readonly cancelled: ProtocolV3LegacyTerminalSourceKindInventory;
  readonly completed: ProtocolV3LegacyTerminalSourceKindInventory;
  readonly failed: ProtocolV3LegacyTerminalSourceKindInventory;
  readonly invalidTerminalLinks: number;
  readonly mismatchedTerminalEvents: number;
  readonly multipleTerminalRuns: number;
}

export type ProtocolV3LossyMigrationCategory =
  | "attempt_completion_time_fabrication"
  | "command_error_omission"
  | "command_payload_conflict"
  | "control_reason_omission"
  | "input_text_omission"
  | "input_start_result_omission"
  | "mcp_argument_omission"
  | "mcp_command_terminal_conflict"
  | "mcp_result_conflict"
  | "mcp_result_omission"
  | "orphan_effect"
  | "provider_receipt_loss"
  | "permission_payload_rewrite"
  | "session_run_error_omission";

export interface ProtocolV3LossyMigrationCandidateId {
  readonly category: ProtocolV3LossyMigrationCategory;
  readonly id: string;
}

export interface ProtocolV3LossyMigrationInventory {
  readonly attemptCompletionTimeFabrications: number;
  readonly candidateIds: readonly ProtocolV3LossyMigrationCandidateId[];
  readonly commandErrorOmissions: number;
  readonly commandPayloadConflicts: number;
  readonly controlReasonOmissions: number;
  readonly inputTextOmissions: number;
  readonly inputStartResultOmissions: number;
  readonly mcpArgumentOmissions: number;
  readonly mcpCommandTerminalConflicts: number;
  readonly mcpResultConflicts: number;
  readonly mcpResultOmissions: number;
  readonly orphanEffects: number;
  readonly providerReceiptLosses: number;
  readonly permissionPayloadRewrites: number;
  readonly sessionRunErrorOmissions: number;
  readonly totalCandidates: number;
}

export interface ProtocolV3CutoverDrain {
  readonly activeAppDeploymentRuns: number;
  readonly activeRuns: number;
  readonly liveDrivers: number;
  readonly nonterminalApiCommands: number;
  readonly nonterminalCommands: number;
  readonly unsafeEnvironmentArtifactBackupStaging: number;
  readonly unsafeSandboxBackups: number;
  readonly unsafeSandboxBackupStaging: number;
  readonly unsafeSandboxes: number;
  readonly unsafeSandboxSessions: number;
  readonly unsafeSessions: number;
  readonly unsettledEffects: number;
}

export interface ProtocolV3CutoverState {
  readonly commandFreeze: boolean;
  readonly containerApplicationVersion: number | null;
  readonly containerImageDigest: string | null;
  readonly enabled: boolean;
  readonly migrationStarted: boolean;
  readonly phase: ProtocolV3CutoverPhase;
  readonly releaseTreeOid: string;
  readonly workerVersionId: string | null;
}

export interface ProtocolV3RuntimeAuthorityPreflight {
  readonly duplicateSandboxBackups: number;
  readonly foreignKeyViolations: number;
  readonly invalidDriverGenerations: number;
  readonly invalidSandboxBackupPointers: number;
  readonly invalidSandboxBackups: number;
  readonly invalidSandboxIdentities: number;
  readonly invalidSandboxSessionAuthorities: number;
  readonly legacyAppDeploymentTraffic: number;
  readonly nonstaticSessions: number;
}

export interface ProtocolV3WorkerDeployment {
  readonly versionId: string;
}

export interface ProtocolV3SmokeStatus {
  readonly bootTokenUsedAt: number | null;
  readonly connectionId: string | null;
  readonly driverPid: number | null;
  readonly driverStartedAt: number | null;
  readonly driverStatus: string | null;
  readonly driverVersion: string | null;
  readonly protocolVersion: number | null;
  readonly statusEvent: string | null;
}

export interface ProtocolV3ContainerInstance {
  readonly state: string;
  readonly version: string | number | null;
}

export interface ProtocolV3ContainerApplication {
  readonly id: string;
  readonly imageDigest: string;
  readonly imageRepository: string;
  readonly name: string;
  readonly state: "active" | "degraded" | "provisioning" | "ready";
  readonly version: number;
}

interface ProtocolV3ContainerPage<T> {
  readonly items: readonly T[];
  readonly nextPageToken: string | null;
  readonly pageToken: string | null;
}

export interface ProtocolV3CutoverRecoveryState {
  readonly bookmark: string | null;
  readonly initialPendingMigrations: readonly string[];
  readonly migrationStarted: boolean;
  readonly originalError: unknown;
  readonly queuesVerified: boolean;
}

export interface ProtocolV3CutoverRecoveryEffects {
  readonly commitQueueAcceptance: () => void;
  readonly pauseAndVerifyQueues: () => Promise<void>;
  readonly printBookmark: (bookmark: string) => void;
  readonly probe: () => ProtocolV3CutoverProbe;
  readonly readBookmark: () => string | null;
  readonly readPendingMigrations: () => readonly string[];
  readonly removeMarker: () => void;
  readonly resumeAndVerifyQueues: () => Promise<void>;
  readonly write: (message: string) => void;
}

export interface ProtocolV3QueueResumeEffects {
  readonly commitAcceptance: () => void;
  readonly removeMarker: () => void;
  readonly resumeAndVerifyQueues: () => Promise<void>;
}

type JsonRow = D1JsonRow;
const MAX_PROTOCOL_V3_CONTAINER_PAGES = 100;

function requireNonNegativeInteger(row: JsonRow, key: string): number {
  const value = row[key];

  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`D1 JSON field ${key} must be a non-negative safe integer.`);
  }

  return value as number;
}

function requireNullableNonNegativeInteger(row: JsonRow, key: string): number | null {
  return row[key] === null ? null : requireNonNegativeInteger(row, key);
}

function requireNullableString(row: JsonRow, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Error(`D1 JSON field ${key} must be a string or null.`);
  }
  return value;
}

function requireJsonArrayString(row: JsonRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`D1 JSON field ${key} must be a string.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`D1 JSON field ${key} must contain valid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`D1 JSON field ${key} must contain an array.`);
  return value;
}

function requirePageToken(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    throw new Error(`${label} must be a valid opaque token or null.`);
  }
  return value;
}

function requirePlatformId(value: string, label: string): string {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/iu.test(value)) {
    throw new Error(`${label} must be a ULID.`);
  }
  return value;
}

function requireGitTreeOid(value: string, label: string): string {
  if (!GIT_TREE_OID_PATTERN.test(value)) throw new Error(`${label} must be a Git tree OID.`);
  return value;
}

function requireSha256Digest(value: string, label: string): string {
  if (!SHA256_DIGEST_PATTERN.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}

function requireWorkerVersionId(value: string): string {
  if (!WORKER_VERSION_ID_PATTERN.test(value)) {
    throw new Error("Protocol v3 Worker version ID must be a UUID.");
  }
  return value;
}

export function parseCleanGitTreeOid(
  treeOutput: string,
  statusOutput: string,
  indexOutput = "",
  ignoredBuildInputOutput = "",
  environmentKeys: readonly string[] = [],
): string {
  if (statusOutput.trim().length > 0 || /^(?:S|[a-z]) /mu.test(indexOutput)) {
    throw new Error("Production deploy requires a clean Git worktree and clean submodules.");
  }
  if (
    ignoredBuildInputOutput.trim().length > 0 ||
    environmentKeys.some((key) => key.startsWith("VITE_"))
  ) {
    throw new Error("Production deploy rejects local or process-level Vite build inputs.");
  }
  return requireGitTreeOid(treeOutput.trim(), "Production release tree OID");
}

export function protocolV3ReleaseTag(releaseTreeOid: string): string {
  return `protocol-v3-${requireGitTreeOid(releaseTreeOid, "Protocol v3 release tree OID")}`;
}

export function assertProtocolV3Release(
  state: ProtocolV3CutoverState,
  releaseTreeOid: string,
): void {
  if (state.releaseTreeOid !== requireGitTreeOid(releaseTreeOid, "Protocol v3 release tree OID")) {
    throw new Error(
      `Protocol v3 cutover belongs to release tree ${state.releaseTreeOid}, not ${releaseTreeOid}.`,
    );
  }
}

export function parseProtocolV3WorkerDeployment(raw: string): ProtocolV3WorkerDeployment {
  const deployment = JSON.parse(raw) as { versions?: unknown };
  if (!Array.isArray(deployment.versions) || deployment.versions.length !== 1) {
    throw new Error("Protocol v3 requires exactly one deployed Worker version.");
  }
  const [version] = deployment.versions as Array<Record<string, unknown>>;
  if (version?.percentage !== 100 || typeof version.version_id !== "string") {
    throw new Error("Protocol v3 Worker release must receive 100% of production traffic.");
  }
  return { versionId: requireWorkerVersionId(version.version_id) };
}

export function assertProtocolV3WorkerVersion(
  raw: string,
  expectedVersionId: string,
  releaseTreeOid: string,
): void {
  const version = JSON.parse(raw) as {
    annotations?: Record<string, unknown>;
    id?: unknown;
  };
  const versionId = requireWorkerVersionId(expectedVersionId);
  if (
    version.id !== versionId ||
    version.annotations?.["workers/tag"] !== protocolV3ReleaseTag(releaseTreeOid)
  ) {
    throw new Error("Production Worker version is not the exact protocol v3 release.");
  }
}

export function protocolV3ContainerImageTag(
  imageRepository: string,
  workerVersionId: string,
): string {
  if (imageRepository.trim() !== imageRepository || !imageRepository.includes("/")) {
    throw new Error("Protocol v3 Container image repository is invalid.");
  }
  return `${imageRepository}:${requireWorkerVersionId(workerVersionId).slice(0, 8)}`;
}

export function parseProtocolV3ContainerManifestDigest(raw: string): string {
  const manifest = JSON.parse(raw) as { Descriptor?: { digest?: unknown } };
  const digest = manifest.Descriptor?.digest;
  if (typeof digest !== "string" || !digest.startsWith("sha256:")) {
    throw new Error("Protocol v3 Container manifest is missing its SHA-256 digest.");
  }
  return requireSha256Digest(digest.slice("sha256:".length), "Protocol v3 Container manifest");
}

function requireSmokeRequestKey(value: string): string {
  if (
    !/^protocol-v3-cutover-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  ) {
    throw new Error("Protocol v3 smoke request key must contain a UUID v4.");
  }
  return value;
}

export function parseProtocolV3CutoverProbe(raw: string): ProtocolV3CutoverProbe {
  const row = requireSingleD1Row(raw);
  const gatePresent = requireNonNegativeInteger(row, "gate_present");
  if (gatePresent > 1) throw new Error("D1 cutover probe field must be zero or one.");
  return { gatePresent: gatePresent === 1 };
}

export function parseProtocolV3LegacyTerminalIntegrity(
  raw: string,
): ProtocolV3LegacyTerminalIntegrity {
  const row = requireSingleD1Row(raw);
  const noncanonicalTerminalSources = requireNonNegativeInteger(
    row,
    "noncanonical_terminal_sources",
  );
  const rewriteCandidateManifestJson = requireJsonArrayString(
    row,
    "rewrite_candidate_manifest_json",
  );
  if (
    (JSON.parse(rewriteCandidateManifestJson) as unknown[]).length !== noncanonicalTerminalSources
  ) {
    throw new Error("Legacy rewrite candidate count and manifest disagree.");
  }

  return {
    ambiguousAssistantRuns: requireNonNegativeInteger(row, "ambiguous_assistant_runs"),
    duplicateTerminalRuns: requireNonNegativeInteger(row, "duplicate_terminal_runs"),
    invalidFailedRuns: requireNonNegativeInteger(row, "invalid_failed_runs"),
    invalidNonfailedRunErrors: requireNonNegativeInteger(row, "invalid_nonfailed_run_errors"),
    invalidTerminalLinks: requireNonNegativeInteger(row, "invalid_terminal_links"),
    legacyMaterializedMessages: requireNonNegativeInteger(row, "legacy_materialized_messages"),
    legacyStreamRows: requireNonNegativeInteger(row, "legacy_stream_rows"),
    legacyTerminalEvents: requireNonNegativeInteger(row, "legacy_terminal_events"),
    mismatchedTerminalEvents: requireNonNegativeInteger(row, "mismatched_terminal_events"),
    missingTerminalEvents: requireNonNegativeInteger(row, "missing_terminal_events"),
    noncanonicalTerminalSources,
    nonterminalCommands: requireNonNegativeInteger(row, "nonterminal_commands"),
    partialAssistantProjections: requireNonNegativeInteger(row, "partial_assistant_projections"),
    partialTerminalProjections: requireNonNegativeInteger(row, "partial_terminal_projections"),
    repairableFailedRuns: requireNonNegativeInteger(row, "repairable_failed_runs"),
    rewriteCandidateManifestJson,
    unsettledEffects: requireNonNegativeInteger(row, "unsettled_effects"),
  };
}

export function parseProtocolV3LegacyRewriteAuthorization(
  raw: string,
): ProtocolV3LegacyRewriteAuthorization {
  const row = requireSingleD1Row(raw);
  if (row.authorization_table_sql !== PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_TABLE_SQL) {
    throw new Error("Protocol v3 legacy rewrite authorization table schema is invalid.");
  }
  if (row.gate_update_trigger_sql !== PROTOCOL_V3_LEGACY_REWRITE_GATE_UPDATE_TRIGGER_SQL) {
    throw new Error("Protocol v3 legacy rewrite gate update guard is invalid.");
  }
  const candidateCount = requireNonNegativeInteger(row, "candidate_count");
  const candidateManifestJson = requireJsonArrayString(row, "candidate_manifest_json");
  if ((JSON.parse(candidateManifestJson) as unknown[]).length !== candidateCount) {
    throw new Error("Legacy rewrite authorization count and manifest disagree.");
  }
  const bookmark = row.bookmark;
  if (typeof bookmark !== "string" || !/^[0-9a-z-]{1,256}$/iu.test(bookmark)) {
    throw new Error("Protocol v3 legacy rewrite authorization has an invalid bookmark.");
  }
  const deployOwner = row.deploy_owner;
  if (
    typeof deployOwner !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(deployOwner)
  ) {
    throw new Error("Protocol v3 legacy rewrite authorization has an invalid owner.");
  }
  return {
    bookmark,
    candidateCount,
    candidateManifestJson,
    deployOwner,
    expiresAt: requireNonNegativeInteger(row, "expires_at"),
    releaseTreeOid: requireGitTreeOid(
      typeof row.release_tree_oid === "string" ? row.release_tree_oid : "",
      "Protocol v3 legacy rewrite release tree OID",
    ),
  };
}

export function parseProtocolV3LegacyTerminalSourceInventory(
  raw: string,
): ProtocolV3LegacyTerminalSourceInventory {
  const row = requireSingleD1Row(raw);
  const readKind = (kind: "cancelled" | "completed" | "failed") => {
    const inventory = {
      canonical: requireNonNegativeInteger(row, `${kind}_canonical`),
      canonicalTargetCollisions: requireNonNegativeInteger(
        row,
        `${kind}_canonical_target_collisions`,
      ),
      noncanonical: requireNonNegativeInteger(row, `${kind}_noncanonical`),
      total: requireNonNegativeInteger(row, `${kind}_total`),
    };
    if (
      inventory.canonical + inventory.noncanonical !== inventory.total ||
      inventory.canonicalTargetCollisions > inventory.total
    ) {
      throw new Error(`Legacy ${kind} terminal source inventory is inconsistent.`);
    }
    return inventory;
  };

  return {
    cancelled: readKind("cancelled"),
    completed: readKind("completed"),
    failed: readKind("failed"),
    invalidTerminalLinks: requireNonNegativeInteger(row, "invalid_terminal_links"),
    mismatchedTerminalEvents: requireNonNegativeInteger(row, "mismatched_terminal_events"),
    multipleTerminalRuns: requireNonNegativeInteger(row, "multiple_terminal_runs"),
  };
}

const PROTOCOL_V3_LOSSY_MIGRATION_CATEGORIES = new Set<ProtocolV3LossyMigrationCategory>([
  "attempt_completion_time_fabrication",
  "command_error_omission",
  "command_payload_conflict",
  "control_reason_omission",
  "input_text_omission",
  "input_start_result_omission",
  "mcp_argument_omission",
  "mcp_command_terminal_conflict",
  "mcp_result_conflict",
  "mcp_result_omission",
  "orphan_effect",
  "provider_receipt_loss",
  "permission_payload_rewrite",
  "session_run_error_omission",
]);

export function parseProtocolV3LossyMigrationInventory(
  raw: string,
): ProtocolV3LossyMigrationInventory {
  const row = requireSingleD1Row(raw);
  const inventory = {
    attemptCompletionTimeFabrications: requireNonNegativeInteger(
      row,
      "attempt_completion_time_fabrications",
    ),
    commandErrorOmissions: requireNonNegativeInteger(row, "command_error_omissions"),
    commandPayloadConflicts: requireNonNegativeInteger(row, "command_payload_conflicts"),
    controlReasonOmissions: requireNonNegativeInteger(row, "control_reason_omissions"),
    inputTextOmissions: requireNonNegativeInteger(row, "input_text_omissions"),
    inputStartResultOmissions: requireNonNegativeInteger(row, "input_start_result_omissions"),
    mcpArgumentOmissions: requireNonNegativeInteger(row, "mcp_argument_omissions"),
    mcpCommandTerminalConflicts: requireNonNegativeInteger(row, "mcp_command_terminal_conflicts"),
    mcpResultConflicts: requireNonNegativeInteger(row, "mcp_result_conflicts"),
    mcpResultOmissions: requireNonNegativeInteger(row, "mcp_result_omissions"),
    orphanEffects: requireNonNegativeInteger(row, "orphan_effects"),
    providerReceiptLosses: requireNonNegativeInteger(row, "provider_receipt_losses"),
    permissionPayloadRewrites: requireNonNegativeInteger(row, "permission_payload_rewrites"),
    sessionRunErrorOmissions: requireNonNegativeInteger(row, "session_run_error_omissions"),
    totalCandidates: requireNonNegativeInteger(row, "total_candidates"),
  };
  const countedCandidates =
    inventory.attemptCompletionTimeFabrications +
    inventory.commandErrorOmissions +
    inventory.commandPayloadConflicts +
    inventory.controlReasonOmissions +
    inventory.inputTextOmissions +
    inventory.inputStartResultOmissions +
    inventory.mcpArgumentOmissions +
    inventory.mcpCommandTerminalConflicts +
    inventory.mcpResultConflicts +
    inventory.mcpResultOmissions +
    inventory.orphanEffects +
    inventory.providerReceiptLosses +
    inventory.permissionPayloadRewrites +
    inventory.sessionRunErrorOmissions;
  if (countedCandidates !== inventory.totalCandidates) {
    throw new Error("Lossy migration inventory category counts are inconsistent.");
  }

  const parsedIds = JSON.parse(requireJsonArrayString(row, "candidate_ids_json")) as unknown[];
  if (parsedIds.length !== Math.min(inventory.totalCandidates, 50)) {
    throw new Error("Lossy migration inventory candidate ID count is inconsistent.");
  }
  let previousKey: string | null = null;
  const candidateIds = parsedIds.map((entry): ProtocolV3LossyMigrationCandidateId => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("Lossy migration inventory candidate IDs are invalid.");
    }
    const [category, id] = entry;
    if (
      typeof category !== "string" ||
      !PROTOCOL_V3_LOSSY_MIGRATION_CATEGORIES.has(category as ProtocolV3LossyMigrationCategory) ||
      typeof id !== "string"
    ) {
      throw new Error("Lossy migration inventory candidate IDs are invalid.");
    }
    const key = `${category}\0${requirePlatformId(id, "Lossy migration candidate ID")}`;
    if (previousKey !== null && previousKey >= key) {
      throw new Error("Lossy migration inventory candidate IDs are not stable and unique.");
    }
    previousKey = key;
    return { category: category as ProtocolV3LossyMigrationCategory, id };
  });

  return { ...inventory, candidateIds };
}

export function assertProtocolV3LossyMigrationInventory(
  inventory: ProtocolV3LossyMigrationInventory,
): void {
  if (inventory.totalCandidates === 0) return;
  throw new Error(
    `Migration 0013 would discard or overwrite production history: ${[
      ["attemptCompletionTimeFabrications", inventory.attemptCompletionTimeFabrications],
      ["mcpArgumentOmissions", inventory.mcpArgumentOmissions],
      ["commandPayloadConflicts", inventory.commandPayloadConflicts],
      ["inputTextOmissions", inventory.inputTextOmissions],
      ["inputStartResultOmissions", inventory.inputStartResultOmissions],
      ["controlReasonOmissions", inventory.controlReasonOmissions],
      ["mcpResultOmissions", inventory.mcpResultOmissions],
      ["orphanEffects", inventory.orphanEffects],
      ["mcpResultConflicts", inventory.mcpResultConflicts],
      ["providerReceiptLosses", inventory.providerReceiptLosses],
      ["permissionPayloadRewrites", inventory.permissionPayloadRewrites],
      ["mcpCommandTerminalConflicts", inventory.mcpCommandTerminalConflicts],
      ["commandErrorOmissions", inventory.commandErrorOmissions],
      ["sessionRunErrorOmissions", inventory.sessionRunErrorOmissions],
    ]
      .filter(([, count]) => count !== 0)
      .map(([category, count]) => `${category}=${count}`)
      .join(" ")}. No lossy migration candidates are authorized.`,
  );
}

export function assertProtocolV3LegacyTerminalSourceInventory(
  inventory: ProtocolV3LegacyTerminalSourceInventory,
): void {
  if (
    inventory.invalidTerminalLinks > 0 ||
    inventory.mismatchedTerminalEvents > 0 ||
    inventory.multipleTerminalRuns > 0 ||
    [inventory.cancelled, inventory.completed, inventory.failed].some(
      (entry) => entry.canonicalTargetCollisions > 0,
    )
  ) {
    throw new Error(
      "Legacy terminal source inventory is not ready for the protocol v3 production cutover.",
    );
  }
}

export function assertProtocolV3LegacyTerminalIntegrity(
  integrity: ProtocolV3LegacyTerminalIntegrity,
): void {
  const blockers = {
    ambiguousAssistantRuns: integrity.ambiguousAssistantRuns,
    duplicateTerminalRuns: integrity.duplicateTerminalRuns,
    invalidFailedRuns: integrity.invalidFailedRuns,
    invalidNonfailedRunErrors: integrity.invalidNonfailedRunErrors,
    invalidTerminalLinks: integrity.invalidTerminalLinks,
    mismatchedTerminalEvents: integrity.mismatchedTerminalEvents,
    missingTerminalEvents: integrity.missingTerminalEvents,
    nonterminalCommands: integrity.nonterminalCommands,
    partialAssistantProjections: integrity.partialAssistantProjections,
    partialTerminalProjections: integrity.partialTerminalProjections,
    unsettledEffects: integrity.unsettledEffects,
  };

  if (Object.values(blockers).some((count) => count > 0)) {
    throw new Error(
      `Legacy terminal integrity is ambiguous and cannot be migrated: ${Object.entries(blockers)
        .map(([name, count]) => `${name}=${count}`)
        .join(" ")}.`,
    );
  }
}

function parseProtocolV3ContainerApplicationPage(
  value: unknown,
): ProtocolV3ContainerPage<ProtocolV3ContainerApplication> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Container applications API output must be an object.");
  }

  const applications = "result" in value ? value.result : null;
  const resultInfo = "result_info" in value ? value.result_info : null;
  if (
    !("success" in value) ||
    value.success !== true ||
    !Array.isArray(applications) ||
    typeof resultInfo !== "object" ||
    resultInfo === null
  ) {
    throw new Error("Container applications API output is missing pagination fields.");
  }

  return {
    items: applications.map((application) => {
      if (
        typeof application !== "object" ||
        application === null ||
        !("id" in application) ||
        typeof application.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(application.id) ||
        !("name" in application) ||
        typeof application.name !== "string" ||
        application.name.length === 0 ||
        !("version" in application) ||
        !("health" in application) ||
        typeof application.health !== "object" ||
        application.health === null ||
        !("instances" in application.health) ||
        typeof application.health.instances !== "object" ||
        application.health.instances === null
      ) {
        throw new Error("Container application API output is invalid.");
      }

      const configuration = "configuration" in application ? application.configuration : null;
      const image =
        typeof configuration === "object" &&
        configuration !== null &&
        "image" in configuration &&
        typeof configuration.image === "string"
          ? configuration.image
          : "";
      const imageMatch = /^(.+)@sha256:([0-9a-f]{64})$/u.exec(image);
      if (imageMatch === null || imageMatch[1]?.trim() !== imageMatch[1]) {
        throw new Error("Container application image is not content-addressed.");
      }

      const health = application.health.instances as JsonRow;
      const active = requireNonNegativeInteger(health, "active");
      const failed = requireNonNegativeInteger(health, "failed");
      requireNonNegativeInteger(health, "healthy");
      const scheduling = requireNonNegativeInteger(health, "scheduling");
      const starting = requireNonNegativeInteger(health, "starting");
      const version = requireNonNegativeInteger(application as JsonRow, "version");
      const state =
        failed > 0
          ? "degraded"
          : starting > 0 || scheduling > 0
            ? "provisioning"
            : active > 0
              ? "active"
              : "ready";

      return {
        id: application.id,
        imageDigest: requireSha256Digest(imageMatch[2] ?? "", "Container application image"),
        imageRepository: imageMatch[1] ?? "",
        name: application.name,
        state,
        version,
      };
    }),
    nextPageToken: requirePageToken(
      "next_page_token" in resultInfo ? resultInfo.next_page_token : undefined,
      "Container application next page token",
    ),
    pageToken: requirePageToken(
      "page_token" in resultInfo ? resultInfo.page_token : undefined,
      "Container application page token",
    ),
  };
}

function parseProtocolV3ContainerInstancePage(
  raw: string,
): ProtocolV3ContainerPage<ProtocolV3ContainerInstance> {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Container instances JSON output must be a paginated object.");
  }

  const instances = "instances" in value ? value.instances : null;
  const resultInfo = "result_info" in value ? value.result_info : null;
  if (!Array.isArray(instances) || typeof resultInfo !== "object" || resultInfo === null) {
    throw new Error("Container instances JSON output is missing pagination fields.");
  }

  return {
    items: instances.map((instance) => {
      if (
        typeof instance !== "object" ||
        instance === null ||
        !("state" in instance) ||
        typeof instance.state !== "string" ||
        !("version" in instance) ||
        (instance.version !== null &&
          typeof instance.version !== "string" &&
          typeof instance.version !== "number")
      ) {
        throw new Error("Container instance JSON output is invalid.");
      }
      return { state: instance.state, version: instance.version };
    }),
    nextPageToken: requirePageToken(
      "next_page_token" in resultInfo ? resultInfo.next_page_token : undefined,
      "Container next page token",
    ),
    pageToken: requirePageToken(
      "page_token" in resultInfo ? resultInfo.page_token : undefined,
      "Container page token",
    ),
  };
}

async function collectPages<T, Raw>(
  readPage: (pageToken: string | null) => Promise<Raw> | Raw,
  parsePage: (raw: Raw) => ProtocolV3ContainerPage<T>,
  label: string,
): Promise<T[]> {
  const items: T[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  let pageCount = 0;

  while (true) {
    pageCount += 1;
    if (pageCount > MAX_PROTOCOL_V3_CONTAINER_PAGES) {
      throw new Error(`${label} pagination exceeded its safety limit.`);
    }
    if (pageToken !== null && seenPageTokens.has(pageToken)) {
      throw new Error(`${label} pagination returned a repeated page token.`);
    }
    if (pageToken !== null) seenPageTokens.add(pageToken);

    const page = parsePage(await readPage(pageToken));
    if (page.pageToken !== pageToken) {
      throw new Error(`${label} pagination returned the wrong page token.`);
    }
    items.push(...page.items);
    if (page.nextPageToken === null) return items;
    pageToken = page.nextPageToken;
  }
}

export function collectProtocolV3ContainerInstances(
  readPage: (pageToken: string | null) => Promise<string> | string,
): Promise<ProtocolV3ContainerInstance[]> {
  return collectPages(readPage, parseProtocolV3ContainerInstancePage, "Container instance");
}

export function collectProtocolV3ContainerApplications(
  readPage: (pageToken: string | null) => Promise<unknown> | unknown,
): Promise<ProtocolV3ContainerApplication[]> {
  return collectPages(readPage, parseProtocolV3ContainerApplicationPage, "Container application");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function recoverProtocolV3CutoverFailure(
  state: ProtocolV3CutoverRecoveryState,
  effects: ProtocolV3CutoverRecoveryEffects,
): Promise<void> {
  if (state.queuesVerified) {
    try {
      await effects.resumeAndVerifyQueues();
      if (!effects.probe().gatePresent) {
        effects.write("  protocol v3 queue and marker recovery was already complete");
        return;
      }
      effects.commitQueueAcceptance();
      effects.removeMarker();
      effects.write("  protocol v3 queue and marker recovery completed after acceptance");
      return;
    } catch (recoveryError) {
      effects.write(
        `✗ Protocol v3 was accepted, but final queue/marker confirmation failed: ${errorMessage(recoveryError)}`,
      );
      effects.write(
        "  Queue delivery was already verified open and will not be re-paused after this commit point.",
      );
      effects.write(
        "  Rerun this exact v3 release to repeat queue verification and marker cleanup.",
      );
      throw new AggregateError(
        [state.originalError, recoveryError],
        "Protocol v3 post-acceptance cleanup remains incomplete.",
        { cause: recoveryError },
      );
    }
  }

  let migrationMayHaveCommitted =
    state.initialPendingMigrations.length === 0 || state.migrationStarted;
  if (!migrationMayHaveCommitted) {
    try {
      const stillPending = new Set(effects.readPendingMigrations());
      migrationMayHaveCommitted = state.initialPendingMigrations.some(
        (name) => !stillPending.has(name),
      );
    } catch (migrationProbeError) {
      migrationMayHaveCommitted = true;
      effects.write(
        `✗ Could not prove every initially pending migration remained unapplied; keeping production closed: ${errorMessage(migrationProbeError)}`,
      );
    }
  }

  const reportFailures = (label: string, failures: readonly string[]) => {
    if (failures.length === 0) return;
    effects.write(`✗ ${label}:`);
    for (const failure of failures) effects.write(`  ${failure}`);
  };

  if (!migrationMayHaveCommitted) {
    const failures: string[] = [];
    try {
      await effects.resumeAndVerifyQueues();
      effects.removeMarker();
    } catch (recoveryError) {
      failures.push(`queue or gate recovery: ${errorMessage(recoveryError)}`);
      try {
        await effects.pauseAndVerifyQueues();
      } catch (pauseError) {
        failures.push(`queue re-pause verification: ${errorMessage(pauseError)}`);
      }
      try {
        if (!effects.probe().gatePresent) {
          try {
            await effects.resumeAndVerifyQueues();
            failures.length = 0;
          } catch (resumeError) {
            failures.push(`old service queue resume verification: ${errorMessage(resumeError)}`);
            try {
              await effects.pauseAndVerifyQueues();
            } catch (pauseError) {
              failures.push(`final queue re-pause verification: ${errorMessage(pauseError)}`);
            }
          }
        }
      } catch (probeError) {
        failures.push(`gate cleanup readback: ${errorMessage(probeError)}`);
      }
    }
    reportFailures("Old service recovery was incomplete", failures);
    if (failures.length === 0) {
      effects.write("  no migration committed; the old service admission and queues were restored");
    }
  } else {
    try {
      await effects.pauseAndVerifyQueues();
    } catch (pauseError) {
      reportFailures("Failed to re-pause and verify every queue", [errorMessage(pauseError)]);
    }
    let bookmark = state.bookmark;
    if (bookmark === null) {
      try {
        bookmark = effects.readBookmark();
      } catch {
        // The bookmark is an emergency destructive backup, not a roll-forward prerequisite.
      }
    }
    effects.write(
      "✗ A migration request may have committed; queue delivery remains paused. Do not roll back only the Worker.",
    );
    effects.write("  Repair only by rolling forward this exact v3 release.");
    if (bookmark !== null) effects.printBookmark(bookmark);
  }

  throw state.originalError;
}

export async function completeProtocolV3QueueResume(
  state: ProtocolV3CutoverState,
  effects: ProtocolV3QueueResumeEffects,
): Promise<void> {
  if (state.phase !== "queues_resuming" || !state.commandFreeze) {
    throw new Error("Protocol v3 queue resume requires its durable frozen phase.");
  }
  await effects.resumeAndVerifyQueues();
  if (state.enabled) effects.commitAcceptance();
  effects.removeMarker();
}

export function isProtocolV3ContainerRolloutConverged(
  application: { readonly state: string; readonly version: string | number },
  instances: readonly ProtocolV3ContainerInstance[],
): boolean {
  if (application.state !== "active" && application.state !== "ready") return false;

  return instances.every(
    (instance) =>
      instance.state === "inactive" ||
      (instance.state === "running" && String(instance.version) === String(application.version)),
  );
}

export function parseProtocolV3CutoverDrain(raw: string): ProtocolV3CutoverDrain {
  const row = requireSingleD1Row(raw);

  return {
    activeAppDeploymentRuns: requireNonNegativeInteger(row, "active_project_deployment_runs"),
    activeRuns: requireNonNegativeInteger(row, "active_runs"),
    liveDrivers: requireNonNegativeInteger(row, "live_drivers"),
    nonterminalApiCommands: requireNonNegativeInteger(row, "nonterminal_api_commands"),
    nonterminalCommands: requireNonNegativeInteger(row, "nonterminal_commands"),
    unsafeEnvironmentArtifactBackupStaging: requireNonNegativeInteger(
      row,
      "unsafe_environment_artifact_backup_staging",
    ),
    unsafeSandboxBackups: requireNonNegativeInteger(row, "unsafe_sandbox_backups"),
    unsafeSandboxBackupStaging: requireNonNegativeInteger(row, "unsafe_sandbox_backup_staging"),
    unsafeSandboxes: requireNonNegativeInteger(row, "unsafe_sandboxes"),
    unsafeSandboxSessions: requireNonNegativeInteger(row, "unsafe_sandbox_sessions"),
    unsafeSessions: requireNonNegativeInteger(row, "unsafe_sessions"),
    unsettledEffects: requireNonNegativeInteger(row, "unsettled_effects"),
  };
}

export function parseProtocolV3RuntimeAuthorityPreflight(
  raw: string,
): ProtocolV3RuntimeAuthorityPreflight {
  const row = requireSingleD1Row(raw);
  return {
    duplicateSandboxBackups: requireNonNegativeInteger(row, "duplicate_sandbox_backups"),
    foreignKeyViolations: requireNonNegativeInteger(row, "foreign_key_violations"),
    invalidDriverGenerations: requireNonNegativeInteger(row, "invalid_driver_generations"),
    invalidSandboxBackupPointers: requireNonNegativeInteger(row, "invalid_sandbox_backup_pointers"),
    invalidSandboxBackups: requireNonNegativeInteger(row, "invalid_sandbox_backups"),
    invalidSandboxIdentities: requireNonNegativeInteger(row, "invalid_sandbox_identities"),
    invalidSandboxSessionAuthorities: requireNonNegativeInteger(
      row,
      "invalid_sandbox_session_authorities",
    ),
    legacyAppDeploymentTraffic: requireNonNegativeInteger(row, "legacy_app_deployment_traffic"),
    nonstaticSessions: requireNonNegativeInteger(row, "nonstatic_sessions"),
  };
}

export function assertProtocolV3RuntimeAuthorityPreflight(
  state: ProtocolV3RuntimeAuthorityPreflight,
): void {
  const violations = Object.entries(state).filter(([, count]) => count !== 0);
  if (violations.length === 0) return;
  throw new Error(
    `Runtime authority migration preflight failed: ${violations
      .map(([name, count]) => `${name}=${count}`)
      .join(
        ", ",
      )}. Migration 0020 remains the atomic authority and will not apply until these rows are repaired through supported lifecycle paths.`,
  );
}

export function isProtocolV3CutoverDrained(state: ProtocolV3CutoverDrain): boolean {
  return isProtocolV3RuntimeDrained(state) && state.nonterminalCommands === 0;
}

export function isProtocolV3RuntimeDrained(state: ProtocolV3CutoverDrain): boolean {
  return (
    state.activeAppDeploymentRuns === 0 &&
    state.activeRuns === 0 &&
    state.liveDrivers === 0 &&
    state.nonterminalApiCommands === 0 &&
    state.unsafeEnvironmentArtifactBackupStaging === 0 &&
    state.unsafeSandboxBackups === 0 &&
    state.unsafeSandboxBackupStaging === 0 &&
    state.unsafeSandboxes === 0 &&
    state.unsafeSandboxSessions === 0 &&
    state.unsafeSessions === 0 &&
    state.unsettledEffects === 0
  );
}

export function parseTimeTravelBookmark(raw: string): string {
  const parsed = JSON.parse(raw) as { bookmark?: unknown } | null;
  const bookmark = parsed?.bookmark;

  if (typeof bookmark !== "string" || !/^[0-9a-z-]{1,256}$/iu.test(bookmark)) {
    throw new Error("D1 Time Travel returned an invalid bookmark.");
  }

  return bookmark;
}

export function parseStoredProtocolV3CutoverBookmark(raw: string): string | null {
  const bookmark = requireSingleD1Row(raw).bookmark;

  if (bookmark === null) {
    return null;
  }
  if (typeof bookmark !== "string" || !/^[0-9a-z-]{1,256}$/iu.test(bookmark)) {
    throw new Error("The stored D1 Time Travel bookmark is invalid.");
  }

  return bookmark;
}

export function parseProtocolV3CutoverObjects(raw: string): ProtocolV3CutoverObjects {
  const row = requireSingleD1Row(raw);
  const objectCount = requireNonNegativeInteger(row, "object_count");
  const exactObjectCount = requireNonNegativeInteger(row, "exact_object_count");
  if (exactObjectCount > objectCount) {
    throw new Error("D1 cutover exact object count exceeds its reserved object count.");
  }
  return { exactObjectCount, objectCount };
}

export function parseProtocolV3CutoverState(raw: string): ProtocolV3CutoverState {
  const row = requireSingleD1Row(raw);
  const enabled = requireNonNegativeInteger(row, "enabled");
  const freeze = requireNonNegativeInteger(row, "command_freeze");
  const containerApplicationVersion = requireNullableNonNegativeInteger(
    row,
    "target_container_application_version",
  );
  const containerImage = requireNullableString(row, "target_container_image_digest");
  const workerVersion = requireNullableString(row, "target_worker_version_id");
  const migrationStarted = requireNonNegativeInteger(row, "migration_started");
  const migrationIntentTriggerCount = requireNonNegativeInteger(
    row,
    "migration_intent_trigger_count",
  );
  const phase = row.phase;
  if (enabled > 1) throw new Error("D1 cutover gate enabled field must be zero or one.");
  if (freeze > 1) throw new Error("D1 command freeze field must be zero or one.");
  if (migrationStarted > 1) {
    throw new Error("D1 migration intent field must be zero or one.");
  }
  if (
    row.migration_intent_table_sql !== PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL ||
    migrationIntentTriggerCount !== 0
  ) {
    throw new Error("D1 migration intent authority is invalid.");
  }
  if (phase !== "draining" && phase !== "queues_resuming") {
    throw new Error("D1 cutover phase is invalid.");
  }
  if (
    (phase === "draining" && enabled !== 1) ||
    (phase === "queues_resuming" && freeze !== 1) ||
    new Set([containerApplicationVersion === null, containerImage === null, workerVersion === null])
      .size !== 1
  ) {
    throw new Error("D1 cutover phase state is inconsistent.");
  }

  return {
    commandFreeze: freeze === 1,
    containerApplicationVersion,
    containerImageDigest:
      containerImage === null
        ? null
        : requireSha256Digest(containerImage, "Stored protocol v3 Container image"),
    enabled: enabled === 1,
    migrationStarted: migrationStarted === 1,
    phase,
    releaseTreeOid: requireGitTreeOid(
      typeof row.release_tree_oid === "string" ? row.release_tree_oid : "",
      "Stored protocol v3 release tree OID",
    ),
    workerVersionId: workerVersion === null ? null : requireWorkerVersionId(workerVersion),
  };
}

export function parseProtocolV3CommandFreeze(raw: string): boolean {
  return parseProtocolV3CutoverState(raw).commandFreeze;
}

export function parseProtocolV3SmokeStatus(raw: string): ProtocolV3SmokeStatus {
  const row = requireSingleD1Row(raw);

  return {
    bootTokenUsedAt: requireNullableNonNegativeInteger(row, "boot_token_used_at"),
    connectionId: requireNullableString(row, "connection_id"),
    driverPid: requireNullableNonNegativeInteger(row, "driver_pid"),
    driverStartedAt: requireNullableNonNegativeInteger(row, "driver_started_at"),
    driverStatus: requireNullableString(row, "driver_status"),
    driverVersion: requireNullableString(row, "driver_version"),
    protocolVersion: requireNullableNonNegativeInteger(row, "protocol_version"),
    statusEvent: requireNullableString(row, "status_event"),
  };
}

export function parseStoredProtocolV3SmokeSession(raw: string): string | null {
  const sessionId = requireSingleD1Row(raw).smoke_session_id;
  if (sessionId === null) return null;
  if (typeof sessionId !== "string") {
    throw new Error("The stored protocol v3 smoke Session ID is invalid.");
  }
  return requirePlatformId(sessionId, "Stored protocol v3 smoke Session ID");
}

export function parseStoredProtocolV3SmokeRequestKey(raw: string): string | null {
  const requestKey = requireSingleD1Row(raw).smoke_request_key;
  if (requestKey === null) return null;
  if (typeof requestKey !== "string") {
    throw new Error("The stored protocol v3 smoke request key is invalid.");
  }
  return requireSmokeRequestKey(requestKey);
}

export function protocolV3SmokeAgentSql(agentId: string): string {
  const validated = requirePlatformId(agentId, "Protocol v3 smoke Agent ID");
  return `SELECT
  (SELECT "kind" FROM "agent" WHERE "id" = '${validated}') AS "kind",
  (SELECT "status" FROM "agent" WHERE "id" = '${validated}') AS "status";`;
}

export function assertProtocolV3SmokeAgent(raw: string): void {
  const row = requireSingleD1Row(raw);
  if (row.kind !== "cattle" || row.status !== "published") {
    throw new Error(
      "Protocol v3 smoke configuration must identify an existing published cattle Agent.",
    );
  }
}

export function isProtocolV3SmokeReady(status: ProtocolV3SmokeStatus): boolean {
  return (
    status.driverStatus === "ready" &&
    status.statusEvent === "driver.ready" &&
    status.protocolVersion === 3 &&
    status.bootTokenUsedAt !== null &&
    status.connectionId !== null &&
    status.connectionId.length > 0 &&
    status.driverPid !== null &&
    status.driverPid > 0 &&
    status.driverStartedAt !== null &&
    status.driverVersion !== null &&
    status.driverVersion.length > 0
  );
}

export function openProtocolV3SmokeWindowSql(accountId: string): string {
  const validated = requirePlatformId(accountId, "Protocol v3 smoke account ID");
  return `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET "command_freeze" = 1, "smoke_account_id" = '${validated}' WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining';`;
}

export function storeProtocolV3SmokeRequestKeySql(requestKey: string): string {
  const validated = requireSmokeRequestKey(requestKey);
  return `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET "smoke_request_key" = '${validated}' WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining';`;
}

export function storeProtocolV3SmokeSessionSql(sessionId: string): string {
  const validated = requirePlatformId(sessionId, "Protocol v3 smoke Session ID");
  return `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET "smoke_session_id" = '${validated}' WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining';`;
}

export function protocolV3SmokeStatusSql(sessionId: string): string {
  const validated = requirePlatformId(sessionId, "Protocol v3 smoke Session ID");
  return `
WITH "latest" AS (
  SELECT *
  FROM "driver_instance"
  WHERE "sandbox_session_id" = '${validated}'
  ORDER BY "created_at" DESC
  LIMIT 1
)
SELECT
  "latest"."status" AS "driver_status",
  "latest"."status_event" AS "status_event",
  "latest"."protocol_version" AS "protocol_version",
  "latest"."driver_pid" AS "driver_pid",
  "latest"."driver_started_at" AS "driver_started_at",
  "latest"."driver_version" AS "driver_version",
  "latest"."connection_id" AS "connection_id",
  "latest"."boot_token_used_at" AS "boot_token_used_at"
FROM (SELECT 1) AS "singleton"
LEFT JOIN "latest" ON 1 = 1;
`;
}

export function storeProtocolV3CutoverBookmarkSql(bookmark: string): string {
  if (!/^[0-9a-z-]{1,256}$/iu.test(bookmark)) {
    throw new Error("Cannot persist an invalid D1 Time Travel bookmark.");
  }

  return `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET "pre_migration_bookmark" = '${bookmark}' WHERE "id" = 1 AND "enabled" = 1 AND "phase" = 'draining' AND "pre_migration_bookmark" IS NULL;`;
}
