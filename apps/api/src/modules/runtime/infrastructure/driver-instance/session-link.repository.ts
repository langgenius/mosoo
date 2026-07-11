import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import {
  agentsTable,
  driverInstancesTable,
  sandboxSessionsTable,
  sandboxesTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import type {
  AccountId,
  AgentId,
  DriverInstanceId,
  PlatformId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { parseSandboxConversationOrigin } from "../sandbox-session/sandbox-conversation-session-codec";
import type { RuntimeSessionLink } from "./event-types";

interface RuntimeSessionLinkRow {
  agent_id: AgentId | null;
  agent_owner_account_id: AccountId | null;
  caller_account_id: AccountId | null;
  creator_account_id: PlatformId | null;
  origin_json: string | null;
  sandbox_id: SandboxId | null;
  sandbox_kind: AgentKind | null;
  sandbox_subject_kind: SandboxSubjectKind | null;
  session_id: SessionId | null;
  session_run_id: SessionRunId | null;
  session_run_status: SessionRunStatus | null;
  trace_id: string | null;
}

export interface GetRuntimeSessionLinkOptions {
  sessionRunId?: SessionRunId;
}

function resolveRuntimeSessionPrincipalIds(row: RuntimeSessionLinkRow | null): {
  callerId: PlatformId | null;
  executionOwnerId: AccountId | null;
} {
  const joinedCallerId = row?.caller_account_id ?? row?.creator_account_id ?? null;
  const joinedExecutionOwnerId =
    row?.agent_owner_account_id ??
    (joinedCallerId === null
      ? null
      : parsePlatformId<AccountId>(joinedCallerId, "runtime session execution owner id"));

  if (typeof row?.origin_json !== "string" || row.origin_json.length === 0) {
    return {
      callerId: joinedCallerId,
      executionOwnerId: joinedExecutionOwnerId,
    };
  }

  const origin = parseSandboxConversationOrigin(row.origin_json);

  return {
    callerId: origin.callerUserId,
    executionOwnerId: origin.executionOwnerUserId,
  };
}

export async function getRuntimeSessionLink(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  options: GetRuntimeSessionLinkOptions = {},
): Promise<RuntimeSessionLink> {
  const linkedSessionId = sql<SessionId | null>`coalesce(${sessionRunsTable.sessionId}, ${sandboxSessionsTable.sessionId})`;
  const linkedSessionRun =
    options.sessionRunId === undefined
      ? and(
          eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        )
      : and(
          eq(sessionRunsTable.driverInstanceId, driverInstancesTable.id),
          eq(sessionRunsTable.id, options.sessionRunId),
        );
  const row =
    (await getAppDatabase(database)
      .select({
        agent_id: sessionsTable.agentId,
        agent_owner_account_id: agentsTable.ownerId,
        caller_account_id: sessionRunsTable.createdByAccountId,
        creator_account_id: sessionsTable.creatorAccountId,
        origin_json: sandboxSessionsTable.originJson,
        sandbox_id: driverInstancesTable.sandboxId,
        sandbox_kind: sandboxesTable.kind,
        sandbox_subject_kind: sandboxesTable.subjectKind,
        session_id: linkedSessionId.as("session_id"),
        session_run_id: sessionRunsTable.id,
        session_run_status: sessionRunsTable.status,
        trace_id: sessionRunsTable.traceId,
      })
      .from(driverInstancesTable)
      .leftJoin(sessionRunsTable, linkedSessionRun)
      .leftJoin(
        sandboxSessionsTable,
        eq(sandboxSessionsTable.sessionId, driverInstancesTable.sandboxSessionId),
      )
      .leftJoin(sessionsTable, eq(sessionsTable.id, linkedSessionId))
      .leftJoin(agentsTable, eq(agentsTable.id, sessionsTable.agentId))
      .leftJoin(sandboxesTable, eq(sandboxesTable.id, driverInstancesTable.sandboxId))
      .where(eq(driverInstancesTable.id, driverInstanceId))
      .limit(1)
      .get()) ?? null;
  const principals = resolveRuntimeSessionPrincipalIds(row ?? null);

  return {
    agentId: row?.agent_id ?? null,
    callerId: principals.callerId,
    creatorId: row?.creator_account_id ?? null,
    executionOwnerId: principals.executionOwnerId,
    sandboxId: row?.sandbox_id ?? null,
    sandboxKind: row?.sandbox_kind ?? null,
    sandboxSubjectKind: row?.sandbox_subject_kind ?? null,
    sessionId: row?.session_id ?? null,
    sessionRunId: row?.session_run_id ?? null,
    sessionRunStatus: row?.session_run_status ?? null,
    traceId: row?.trace_id ?? null,
  };
}
