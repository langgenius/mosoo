import {
  getExpectedDriverNativeRuntimeRefKind,
  parseDriverNativeRuntimeRef,
} from "@mosoo/agent-driver/runtime";
import {
  agentDeploymentVersionsTable,
  agentsTable,
  nativeResumeRefsTable,
  sandboxBackupsTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionExecutionSnapshotsTable,
  sessionMessagesTable,
  sessionsTable,
} from "@mosoo/db";
import { retiredSessionRunsPhysicalStorage } from "@mosoo/db/migration-schema";
import { parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId } from "@mosoo/id";
import { getTableConfig } from "drizzle-orm/sqlite-core";

import { parseAgentStoredConfig } from "../../agents/application/agent-stored-config.service";
import { sessionIsolationClaimOwner } from "../../sessions/infrastructure/session-isolation-barrier.repository";
import { parseSessionExecutionPlanJson } from "../application/session-definition/session-execution.repository";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../domain/driver-instance-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../domain/session-run-lifecycle.machine";
import { decodeSandboxBackupIdForPlatform } from "./sandbox-backup-id";
import { parseSandboxConversationOrigin } from "./sandbox-session/sandbox-conversation-session-codec";

type Scalar = string | number | null;
type Row = Record<string, Scalar>;
export interface TransitionStatement {
  sql: string;
  params: Scalar[];
}

// These are complete SELECT * before-images, never arbitrary table/column names.
const SOURCE_TABLES = {
  session: sessionsTable,
  sandbox: sandboxesTable,
  workspace: sandboxSessionsTable,
  native: nativeResumeRefsTable,
  snapshot: sessionExecutionSnapshotsTable,
  // The operator reads physical SELECT * rows, including inert history omitted
  // from the runtime table. Compare it too; never discard part of a before-image.
  run: retiredSessionRunsPhysicalStorage,
  sourceBackup: sandboxBackupsTable,
  latestBackup: sandboxBackupsTable,
  agent: agentsTable,
  deployment: agentDeploymentVersionsTable,
  unmatchedInput: sessionMessagesTable,
  priorBackup: sandboxBackupsTable,
} as const;
type SourceName = keyof typeof SOURCE_TABLES;
type OptionalSourceName = "deployment" | "unmatchedInput" | "priorBackup";
type Source = Record<Exclude<SourceName, OptionalSourceName>, Row> &
  Record<OptionalSourceName, Row | null>;

// Finite operator qualification, pinned to the independently rehearsed reader.
// Receipts remain private, declarative inputs; this does not inspect their files.
function hasVerifiedNativeTerminal(
  source: Source,
  workspaceEvidence: Record<string, unknown>,
): boolean {
  if (workspaceEvidence["terminalEvidence"] === undefined) {
    requireValue(
      source.unmatchedInput === null && source.priorBackup === null,
      "An unmatched input requires independently verified native terminal evidence.",
    );
    return false;
  }
  const evidence = record(workspaceEvidence["terminalEvidence"]);
  const { session, run, native } = source;
  requireValue(
    session["runtime_id"] === "acp-fallback" &&
      evidence["version"] === 1 &&
      evidence["runId"] === run["id"] &&
      evidence["status"] === run["status"] &&
      (run["status"] === "completed" || run["status"] === "failed") &&
      evidence["completedAt"] === run["completed_at"] &&
      evidence["observedRunId"] === native["observed_session_run_id"] &&
      evidence["sourceRevision"] === "2bda2d940acf382dfc718745619ecc54797ce793" &&
      evidence["driverRevision"] === "16e47258aab1ac1d9dde3cd9d55f6374a4ce9a50" &&
      evidence["harnessVersion"] === "1.18.4" &&
      evidence["nativeLoadImage"] ===
        "sha256:e2e1722e39655ae4e46d86bbce49888fbc62c74e8d748a6f5dd2f4a8b2f49eac",
    "Native terminal evidence does not match this ACP boundary or rehearsed reader.",
  );
  let preexistingUnmatchedCount = 0;
  const { unmatchedInput, priorBackup, sourceBackup, workspace } = source;
  if (evidence["preexistingInputGap"] !== undefined) {
    const gap = record(evidence["preexistingInputGap"]);
    requireValue(
      run["status"] === "failed" &&
        unmatchedInput !== null &&
        priorBackup !== null &&
        unmatchedInput["id"] === gap["messageId"] &&
        unmatchedInput["session_id"] === session["id"] &&
        unmatchedInput["session_run_id"] === run["id"] &&
        unmatchedInput["role"] === "user" &&
        text(unmatchedInput["content_text"]).trim().length > 0 &&
        Number(unmatchedInput["created_at"]) >= Number(run["created_at"]) &&
        Number(unmatchedInput["created_at"]) <= Number(run["completed_at"]) &&
        priorBackup["id"] !== sourceBackup["id"] &&
        priorBackup["sandbox_id"] === workspace["sandbox_id"] &&
        priorBackup["dir"] === workspace["cwd"] &&
        priorBackup["status"] === "ready" &&
        Number(priorBackup["created_at"]) < Number(unmatchedInput["created_at"]) &&
        gap["priorNativeRowsSha256"] === evidence["nativeRowsSha256"],
      "Only an unchanged, independently audited failed user input may remain unmatched.",
    );
    for (const key of ["priorArchiveSha256", "comparisonReceiptSha256"]) {
      requireValue(
        /^[a-f0-9]{64}$/.test(text(gap[key])),
        "Pre-existing input differences require bound archive and comparison receipts.",
      );
    }
    preexistingUnmatchedCount = 1;
  } else {
    requireValue(
      unmatchedInput === null && priorBackup === null,
      "An unmatched input cannot be supplied without its comparison evidence.",
    );
  }
  for (const [total, matched] of [
    ["canonicalTextCount", "matchedCanonicalTextCount"],
    ["nativeTextCount", "replayedNativeTextCount"],
  ] as const) {
    const count = evidence[total];
    const matchedCount = evidence[matched];
    requireValue(
      typeof count === "number" &&
        Number.isSafeInteger(count) &&
        count > 0 &&
        typeof matchedCount === "number" &&
        Number.isSafeInteger(matchedCount) &&
        matchedCount > 0 &&
        count === matchedCount + (total === "canonicalTextCount" ? preexistingUnmatchedCount : 0),
      "Native terminal evidence requires complete canonical history and native replay.",
    );
  }
  for (const key of [
    "nativeMessageRowsPreserved",
    "nativePartRowsPreserved",
    "workspaceFilesPreserved",
  ]) {
    requireValue(
      evidence[key] === true,
      "Native terminal evidence requires unchanged durable state.",
    );
  }
  for (const key of [
    "nativeLoadReceiptSha256",
    "canonicalHistoryReceiptSha256",
    "workspaceReceiptSha256",
    "nativeRowsSha256",
  ]) {
    requireValue(
      /^[a-f0-9]{64}$/.test(text(evidence[key])),
      "Native terminal evidence needs bound SHA-256 receipts.",
    );
  }
  return true;
}

function requireValue(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): Record<string, unknown> {
  requireValue(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Expected an object.",
  );
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  requireValue(typeof value === "string", "Expected a string.");
  return value;
}

function readRow(name: SourceName, value: unknown): Row {
  const raw = record(value);
  const columns = getTableConfig(SOURCE_TABLES[name]).columns;
  requireValue(
    Object.keys(raw).length === columns.length,
    `${name} requires a complete before-image.`,
  );
  const row: Row = {};
  for (const column of columns) {
    const field = raw[column.name];
    requireValue(
      typeof field === "string" ||
        (typeof field === "number" && Number.isSafeInteger(field)) ||
        (field === null && !column.notNull),
      `${name}.${column.name} is missing or invalid.`,
    );
    row[column.name] = field;
  }
  return row;
}

function sourceFrom(value: unknown): Source {
  const input = record(value);
  return {
    session: readRow("session", input["session"]),
    sandbox: readRow("sandbox", input["sandbox"]),
    workspace: readRow("workspace", input["workspace"]),
    native: readRow("native", input["native"]),
    snapshot: readRow("snapshot", input["snapshot"]),
    run: readRow("run", input["run"]),
    sourceBackup: readRow("sourceBackup", input["sourceBackup"]),
    latestBackup: readRow("latestBackup", input["latestBackup"]),
    agent: readRow("agent", input["agent"]),
    deployment: input["deployment"] === null ? null : readRow("deployment", input["deployment"]),
    unmatchedInput:
      input["unmatchedInput"] == null ? null : readRow("unmatchedInput", input["unmatchedInput"]),
    priorBackup: input["priorBackup"] == null ? null : readRow("priorBackup", input["priorBackup"]),
  };
}

function quote(name: string): string {
  return `"${name}"`;
}

function insert(name: SourceName, row: Row): TransitionStatement {
  const table = getTableConfig(SOURCE_TABLES[name]).name;
  const columns = Object.keys(row);
  return {
    sql: `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    params: columns.map((column) => row[column]!),
  };
}

function update(name: SourceName, row: Row, fields: string[]): TransitionStatement {
  const table = getTableConfig(SOURCE_TABLES[name]).name;
  const key = "id" in row ? "id" : "session_id";
  return {
    sql: `UPDATE ${quote(table)} SET ${fields.map((field) => `${quote(field)} = ?`).join(", ")} WHERE ${quote(key)} = ?`,
    params: [...fields.map((field) => row[field]!), row[key]!],
  };
}

function guard(source: Source, original?: Source): TransitionStatement {
  const expected = { ...source, ...(original ? { original } : {}) };
  const entries = [
    ...Object.entries(source).map(([key, row]) => ({ key, row, prefix: "" })),
    ...(original
      ? ["sandbox", "sourceBackup", "latestBackup"].map((key) => ({
          key,
          row: original[key as SourceName],
          prefix: "original.",
        }))
      : []),
  ];
  const predicates = entries.flatMap(({ key, row, prefix }) => {
    if (row === null) return [];
    const name = key as SourceName;
    const table = getTableConfig(SOURCE_TABLES[name]).name;
    return [
      `EXISTS (SELECT 1 FROM ${quote(table)} AS current WHERE ${Object.keys(row)
        .map(
          (column) =>
            `current.${quote(column)} IS json_extract(expected.value, '$.${prefix}${name}.${column}')`,
        )
        .join(" AND ")})`,
    ];
  });
  const activeRuns = ACTIVE_SESSION_RUN_STATUSES.map((status) => `'${status}'`).join(",");
  const liveDrivers = LIVE_DRIVER_INSTANCE_STATUSES.map((status) => `'${status}'`).join(",");
  predicates.push(
    `NOT EXISTS (SELECT 1 FROM session_run WHERE agent_id = json_extract(expected.value, '$.session.agent_id') AND status IN (${activeRuns}))`,
    `EXISTS (SELECT 1 FROM session_event WHERE run_id = json_extract(expected.value, '$.run.id') AND event_type = 'run.' || json_extract(expected.value, '$.run.status'))`,
    `NOT EXISTS (SELECT 1 FROM session_event WHERE run_id = json_extract(expected.value, '$.run.id') AND event_type IN ('run.completed', 'run.failed', 'run.cancelled') AND event_type <> 'run.' || json_extract(expected.value, '$.run.status'))`,
  );
  if (source.unmatchedInput !== null) {
    predicates.push(
      `NOT EXISTS (SELECT 1 FROM session_message WHERE session_run_id = json_extract(expected.value, '$.run.id') AND id <> json_extract(expected.value, '$.unmatchedInput.id'))`,
      `NOT EXISTS (SELECT 1 FROM session_message WHERE session_id = json_extract(expected.value, '$.session.id') AND seq > json_extract(expected.value, '$.unmatchedInput.seq'))`,
    );
  }
  for (const prefix of original ? ["", "original."] : [""]) {
    // Agent provenance and a terminal Driver status do not release a Run.
    // Inspect both workspace membership and the actual Driver lease, including
    // peers with missing/reassigned provenance, on both sides of rollback.
    predicates.push(
      `NOT EXISTS (SELECT 1 FROM driver_instance WHERE sandbox_id = json_extract(expected.value, '$.${prefix}sandbox.id') AND status IN (${liveDrivers}))`,
      `NOT EXISTS (SELECT 1 FROM session_run AS active_run INNER JOIN sandbox_session AS bound_workspace ON bound_workspace.session_id = active_run.session_id WHERE bound_workspace.sandbox_id = json_extract(expected.value, '$.${prefix}sandbox.id') AND active_run.status IN (${activeRuns}))`,
      `NOT EXISTS (SELECT 1 FROM session_run AS leased_run INNER JOIN driver_instance AS leased_driver ON leased_driver.id = leased_run.driver_instance_id WHERE leased_driver.sandbox_id = json_extract(expected.value, '$.${prefix}sandbox.id') AND leased_run.status IN (${activeRuns}))`,
      `NOT EXISTS (SELECT 1 FROM sandbox_session WHERE sandbox_id = json_extract(expected.value, '$.${prefix}sandbox.id') AND status <> 'closed')`,
      `(SELECT id FROM sandbox_backup WHERE sandbox_id = json_extract(expected.value, '$.${prefix}sandbox.id') AND dir = json_extract(expected.value, '$.${prefix}workspace.cwd') AND status = 'ready' ORDER BY created_at DESC LIMIT 1) IS json_extract(expected.value, '$.${prefix}latestBackup.id')`,
      `NOT EXISTS (SELECT 1 FROM sandbox_backup WHERE sandbox_id = json_extract(expected.value, '$.${prefix}sandbox.id') AND dir = json_extract(expected.value, '$.${prefix}workspace.cwd') AND status = 'ready' AND created_at = json_extract(expected.value, '$.${prefix}latestBackup.created_at') AND id <> json_extract(expected.value, '$.${prefix}latestBackup.id'))`,
    );
  }
  // SQLite has no ASSERT statement. The false branch deliberately raises an
  // error so D1 batch rolls back, rather than letting later statements proceed.
  return {
    sql: `WITH expected(value) AS (SELECT ?) SELECT CASE WHEN ${predicates.join(" AND ")} THEN 1 ELSE json('session isolation precondition failed') END AS ready FROM expected`,
    params: [JSON.stringify(expected)],
  };
}

export interface SessionIsolationPlan {
  forward: TransitionStatement[];
  rollback: TransitionStatement[];
  // Source and destination objects must be verified independently before use.
  before: Source;
  after: Source;
  rollbackBackup: Row;
  workspaceEvidence: Record<string, unknown>;
}

/** Preserve concurrent attachment activity and renames; migration-owned state must still match. */
export function prepareSessionIsolationRollback(
  plan: SessionIsolationPlan,
  currentSession: unknown,
  currentAgent: unknown,
): TransitionStatement[] {
  const session = readRow("session", currentSession);
  const agent = readRow("agent", currentAgent);
  const mutable = new Set(["metadata_json", "renamed", "title", "updated_at"]);
  for (const [column, value] of Object.entries(plan.after.session)) {
    requireValue(
      mutable.has(column) || session[column] === value,
      "Session isolation rollback encountered changed execution state.",
    );
  }
  for (const column of ["id", "project_id", "owner_account_id", "kind", "created_at"]) {
    requireValue(
      agent[column] === plan.after.agent[column],
      "Session isolation rollback ownership changed.",
    );
  }
  const retainedSource = {
    ...plan.before,
    sourceBackup: { ...plan.before.sourceBackup, keep: 1 },
    latestBackup: { ...plan.before.latestBackup, keep: 1 },
  };
  // Current Agent edits are not the admitted configuration. Keep them intact;
  // the snapshot and its original immutable deployment remain fully guarded.
  return [guard({ ...plan.after, session, agent }, retainedSource), ...plan.rollback.slice(1)];
}

/** Offline operator plan only: does not read resources, call models or write D1. */
export function buildSessionIsolationPlan(value: unknown): SessionIsolationPlan {
  const input = record(value);
  const operationId =
    input["operationId"] === undefined
      ? null
      : parsePlatformId<RuntimeOperationId>(input["operationId"], "isolation operation");
  const before = sourceFrom(input["source"]);
  const workspaceEvidence = record(input["workspaceEvidence"]);
  const verifiedNativeTerminal = hasVerifiedNativeTerminal(before, workspaceEvidence);
  const {
    session,
    sandbox,
    workspace,
    native,
    snapshot,
    run,
    sourceBackup,
    latestBackup,
    agent,
    deployment,
  } = before;
  const now = input["preparedAt"];
  requireValue(
    typeof now === "number" &&
      Number.isSafeInteger(now + 1) &&
      now > Number(latestBackup["created_at"]),
    "Preparation must follow the latest source backup.",
  );
  requireValue(
    session["kind"] === "pet" &&
      session["status"] === "IDLE" &&
      (session["archived_at"] === null || verifiedNativeTerminal) &&
      session["status_operation_id"] === operationId,
    "Source Session is not an idle legacy Session with a qualified archive state.",
  );
  requireValue(
    sandbox["kind"] === "pet" &&
      sandbox["subject_kind"] === "agent" &&
      sandbox["subject_id"] === session["agent_id"] &&
      sandbox["status"] === "cold" &&
      sandbox["claim_owner"] ===
        (operationId === null ? null : sessionIsolationClaimOwner(operationId)) &&
      sandbox["claim_expires_at"] === null &&
      sandbox["status_event"] === "runtime_subject.cold",
    "Source Sandbox must be drained and cold.",
  );
  requireValue(
    workspace["session_id"] === session["id"] &&
      workspace["sandbox_id"] === sandbox["id"] &&
      workspace["status"] === "closed",
    "Workspace binding does not match the drained Session.",
  );
  requireValue(
    agent["id"] === session["agent_id"] &&
      agent["project_id"] === session["project_id"] &&
      (sandbox["agent_id"] === null || sandbox["agent_id"] === session["agent_id"]) &&
      (sandbox["project_id"] === null || sandbox["project_id"] === session["project_id"]) &&
      (sandbox["owner_account_id"] === null ||
        sandbox["owner_account_id"] === agent["owner_account_id"]),
    "Source ownership does not match.",
  );
  const origin = parseSandboxConversationOrigin(text(workspace["origin_json"]));
  requireValue(
    origin.executionOwnerUserId === agent["owner_account_id"],
    "Delegated execution owner does not match.",
  );
  requireValue(
    run["id"] === session["last_run_id"] &&
      run["session_id"] === session["id"] &&
      run["agent_id"] === session["agent_id"] &&
      run["model"] === session["model"] &&
      run["provider"] === session["provider"] &&
      run["runtime_id"] === session["runtime_id"] &&
      (run["status"] === "completed" || verifiedNativeTerminal) &&
      run["status_operation_id"] === null,
    "Latest Run must be completely committed before conversion.",
  );
  requireValue(
    native["session_id"] === session["id"] &&
      (native["observed_session_run_id"] === run["id"] || verifiedNativeTerminal) &&
      native["runtime_id"] === session["runtime_id"],
    "Native reference does not match the successful boundary.",
  );
  const nativeRef = parseDriverNativeRuntimeRef({
    kind: native["kind"],
    runtimeId: native["runtime_id"],
    value: native["value"],
  });
  requireValue(
    nativeRef.kind === getExpectedDriverNativeRuntimeRefKind(nativeRef.runtimeId),
    "Native reference kind does not match its runtime.",
  );
  requireValue(
    snapshot["session_id"] === session["id"],
    "Execution snapshot scope does not match.",
  );
  for (const backup of [sourceBackup, latestBackup]) {
    requireValue(
      backup["sandbox_id"] === sandbox["id"] &&
        backup["dir"] === workspace["cwd"] &&
        backup["status"] === "ready",
      "Source backup ownership does not match.",
    );
  }
  requireValue(
    Number(sourceBackup["created_at"]) >= Number(run["completed_at"]) &&
      run["completed_at"] !== null,
    "Source backup predates the completed turn.",
  );
  const frozen = parseSessionExecutionPlanJson(text(snapshot["plan_json"]));
  requireValue(
    frozen.binding.agentId === session["agent_id"] &&
      frozen.binding.kind === "pet" &&
      frozen.binding.runtimeId === session["runtime_id"] &&
      frozen.binding.model === session["model"] &&
      frozen.binding.provider === session["provider"],
    "Frozen binding does not match the Session.",
  );
  const configJson = frozen.configJson ?? (deployment === null ? null : deployment["config_json"]);
  if (frozen.configJson === undefined) {
    requireValue(
      deployment !== null &&
        deployment["id"] === frozen.binding.deploymentVersionId &&
        deployment["agent_id"] === session["agent_id"] &&
        deployment["runtime_id"] === frozen.binding.runtimeId &&
        deployment["model"] === frozen.binding.model &&
        deployment["provider"] === frozen.binding.provider &&
        deployment["prompt"] === frozen.binding.prompt,
      "Original immutable configuration is required; current Agent settings are not a substitute.",
    );
  }
  parseAgentStoredConfig(text(configJson));
  requireValue(
    workspaceEvidence["sessionId"] === session["id"] &&
      workspaceEvidence["sourceBackupId"] === sourceBackup["id"] &&
      workspaceEvidence[run["status"] === "completed" ? "completedRunId" : "terminalRunId"] ===
        run["id"] &&
      workspaceEvidence["cwd"] === workspace["cwd"] &&
      workspaceEvidence["nativeValue"] === native["value"] &&
      workspaceEvidence["runtimeId"] === native["runtime_id"],
    "Workspace evidence does not describe this source and committed turn.",
  );
  for (const name of ["sourceArchiveSha256", "preparedArchiveSha256", "rollbackArchiveSha256"]) {
    requireValue(
      /^[a-f0-9]{64}$/.test(text(workspaceEvidence[name])),
      "Archive evidence needs SHA-256 values.",
    );
  }
  const destination = record(input["destination"]);
  const sandboxId = parsePlatformId(destination["sandboxId"], "destination sandbox");
  const executionId = parsePlatformId(
    destination["executionSessionId"],
    "destination execution session",
  );
  const rollbackExecutionId = parsePlatformId(
    destination["rollbackExecutionSessionId"],
    "rollback execution session",
  );
  const backupId = parsePlatformId(destination["backupId"], "destination backup");
  const rollbackBackupId = parsePlatformId(destination["rollbackBackupId"], "rollback backup");
  decodeSandboxBackupIdForPlatform(backupId);
  decodeSandboxBackupIdForPlatform(rollbackBackupId);
  requireValue(
    sandboxId !== sandbox["id"] &&
      executionId !== workspace["cloudflare_session_id"] &&
      rollbackExecutionId !== executionId &&
      rollbackExecutionId !== workspace["cloudflare_session_id"] &&
      backupId !== sourceBackup["id"] &&
      backupId !== latestBackup["id"] &&
      rollbackBackupId !== backupId &&
      rollbackBackupId !== sourceBackup["id"] &&
      rollbackBackupId !== latestBackup["id"],
    "Destination and rollback identifiers must be fresh.",
  );
  const targetSandbox: Row = {
    ...sandbox,
    id: sandboxId,
    agent_id: session["agent_id"],
    project_id: session["project_id"]!,
    owner_account_id: agent["owner_account_id"],
    kind: "cattle",
    subject_kind: "session",
    subject_id: session["id"]!,
    bind_mount_ready: 0,
    global_mounts_json: "[]",
    inactive_deadline_at: null,
    last_backup_id: null,
    last_restore_backup_id: null,
    last_error: null,
    last_error_code: null,
    status_operation_id: null,
    status_seq: 0,
    status_changed_at: now,
    status_event: "runtime_subject.cold",
    status_source: "runtime",
    created_at: now,
    updated_at: now,
  };
  const rawPlan = record(JSON.parse(text(snapshot["plan_json"])));
  const newPlan = {
    ...rawPlan,
    binding: { ...record(rawPlan["binding"]), kind: "cattle" },
    configJson,
  };
  // An imported failed boundary is durable native state, never a successful Run.
  const successfulRunId = run["status"] === "completed" ? run["id"]! : null;
  const targetBackup: Row = {
    ...sourceBackup,
    id: backupId,
    sandbox_id: sandboxId,
    session_run_id: successfulRunId,
    keep: 1,
    error_message: null,
    ttl_seconds: Math.max(Number(sourceBackup["ttl_seconds"]), 30 * 24 * 60 * 60),
    created_at: now,
    updated_at: now,
  };
  const after: Source = {
    ...before,
    session: { ...session, kind: "cattle", workspace_checkpoint_required: 1 },
    sandbox: targetSandbox,
    workspace: {
      ...workspace,
      sandbox_id: sandboxId,
      cloudflare_session_id: executionId,
      updated_at: now,
    },
    native: {
      ...native,
      committed_value: native["value"]!,
      committed_session_run_id: successfulRunId,
    },
    snapshot: { ...snapshot, plan_json: JSON.stringify(newPlan) },
    sourceBackup: targetBackup,
    latestBackup: targetBackup,
  };
  const changed: Array<[SourceName, string[]]> = [
    ["session", ["kind", "workspace_checkpoint_required"]],
    ["workspace", ["sandbox_id", "cloudflare_session_id", "updated_at"]],
    ["native", ["committed_value", "committed_session_run_id"]],
    ["snapshot", ["plan_json"]],
  ];
  const rollbackBackup: Row = {
    ...sourceBackup,
    id: rollbackBackupId,
    session_run_id: null,
    keep: 1,
    created_at: now + 1,
    updated_at: now + 1,
  };
  const retainedSource: Source = {
    ...before,
    sourceBackup: { ...sourceBackup, keep: 1 },
    latestBackup: { ...latestBackup, keep: 1 },
  };
  const rollbackState: Source = {
    ...before,
    workspace: { ...workspace, cloudflare_session_id: rollbackExecutionId, updated_at: now + 1 },
  };
  return {
    before,
    after,
    rollbackBackup,
    workspaceEvidence,
    forward: [
      guard(before),
      insert("sandbox", targetSandbox),
      insert("sourceBackup", targetBackup),
      ...changed.map(([name, fields]) => update(name, after[name]!, fields)),
      update("sourceBackup", retainedSource.sourceBackup, ["keep"]),
      update("latestBackup", retainedSource.latestBackup, ["keep"]),
    ],
    rollback: [
      guard(after, retainedSource),
      // Preserve all copied/source resources. This verified original-layout copy
      // supersedes an empty latest backup under the old reader after rollback.
      insert("sourceBackup", rollbackBackup),
      ...changed.map(([name, fields]) => update(name, rollbackState[name]!, fields)),
    ],
  };
}
