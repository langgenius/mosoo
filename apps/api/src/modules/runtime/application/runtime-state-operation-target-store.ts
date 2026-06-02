import type { SessionRunStatus } from "@mosoo/contracts/session-run";
import { sandboxSessionsTable, sessionsTable } from "@mosoo/db";
import type {
  AgentId,
  PlatformId,
  RuntimeOperationId,
  SandboxId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { RESCHEDULING_RECONNECT_WINDOW_MS } from "../../sessions/domain/session-lifecycle";
import { createSessionStatusTransitionPatch } from "../infrastructure/session-runs/session-lifecycle-projection.repository";

export interface RuntimeSessionTarget {
  readonly agentId: AgentId | null;
  readonly creatorAccountId: PlatformId;
  readonly lastRunId: SessionRunId | null;
  readonly sandboxId: SandboxId;
  readonly sessionId: SessionId;
  readonly sessionStatusOperationId: RuntimeOperationId | null;
  readonly sessionStatusSeq: number;
  readonly sessionStatus: "IDLE" | "RUNNING" | "RESCHEDULING";
}

export const RUNTIME_TARGET_SESSION_STATUSES: RuntimeSessionTarget["sessionStatus"][] = [
  "IDLE",
  "RUNNING",
  "RESCHEDULING",
];
const RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE = 25;

export interface RuntimeSessionTargetTransition {
  readonly current: RuntimeSessionTarget;
  readonly previous: RuntimeSessionTarget;
}

function isTerminalRunStatus(status: SessionRunStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "expired"
  );
}

function sessionStatusOperationCondition(operationId: RuntimeOperationId | null) {
  return operationId === null
    ? [isNull(sessionsTable.statusOperationId)]
    : [eq(sessionsTable.statusOperationId, operationId)];
}

function sessionLastRunCondition(lastRunId: SessionRunId | null) {
  return lastRunId === null
    ? isNull(sessionsTable.lastRunId)
    : eq(sessionsTable.lastRunId, lastRunId);
}

function sessionTargetFreshnessCondition(
  target: RuntimeSessionTarget,
  input: {
    readonly expectedOperationId?: RuntimeOperationId | null;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
  },
) {
  const expectedOperationId =
    input.expectedOperationId === undefined
      ? target.sessionStatusOperationId
      : input.expectedOperationId;

  return and(
    eq(sessionsTable.id, target.sessionId),
    eq(sessionsTable.status, input.expectedStatus ?? target.sessionStatus),
    eq(sessionsTable.statusSeq, target.sessionStatusSeq),
    sessionLastRunCondition(target.lastRunId),
    ...sessionStatusOperationCondition(expectedOperationId),
  );
}

export async function listRuntimeSessionTargetsForSandboxIds(
  database: D1Database,
  sandboxIds: readonly SandboxId[],
): Promise<RuntimeSessionTarget[]> {
  const uniqueSandboxIds = [...new Set(sandboxIds)];

  if (uniqueSandboxIds.length === 0) {
    return [];
  }

  return getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      creatorAccountId: sessionsTable.creatorAccountId,
      lastRunId: sessionsTable.lastRunId,
      sandboxId: sandboxSessionsTable.sandboxId,
      sessionId: sessionsTable.id,
      sessionStatusOperationId: sessionsTable.statusOperationId,
      sessionStatusSeq: sessionsTable.statusSeq,
      sessionStatus: sql<RuntimeSessionTarget["sessionStatus"]>`${sessionsTable.status}`,
    })
    .from(sessionsTable)
    .innerJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .where(
      and(
        inArray(sandboxSessionsTable.sandboxId, uniqueSandboxIds),
        eq(sandboxSessionsTable.status, "active"),
        isNull(sessionsTable.archivedAt),
        inArray(sessionsTable.status, RUNTIME_TARGET_SESSION_STATUSES),
      ),
    )
    .all();
}

export async function transitionRuntimeTargetSessionStatus(
  database: D1Database,
  input: {
    readonly expectedOperationId?: RuntimeOperationId | null;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
    readonly operationId?: RuntimeOperationId | null;
    readonly status: RuntimeSessionTarget["sessionStatus"];
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTargetTransition[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const transitions: RuntimeSessionTargetTransition[] = [];

  for (
    let index = 0;
    index < input.targets.length;
    index += RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE
  ) {
    transitions.push(
      ...(await transitionRuntimeTargetSessionStatusBatch(database, {
        ...input,
        targets: input.targets.slice(index, index + RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE),
      })),
    );
  }

  return transitions;
}

async function transitionRuntimeTargetSessionStatusBatch(
  database: D1Database,
  input: {
    readonly expectedOperationId?: RuntimeOperationId | null;
    readonly expectedStatus?: RuntimeSessionTarget["sessionStatus"];
    readonly operationId?: RuntimeOperationId | null;
    readonly status: RuntimeSessionTarget["sessionStatus"];
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTargetTransition[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const timestampMs = currentTimestampMs();
  const whereClause = and(
    isNull(sessionsTable.archivedAt),
    or(...input.targets.map((target) => sessionTargetFreshnessCondition(target, input))),
  );
  const results = await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
        status: input.status,
        timestampMs,
      }),
    )
    .where(whereClause)
    .returning({
      id: sessionsTable.id,
      status_operation_id: sessionsTable.statusOperationId,
      status_seq: sessionsTable.statusSeq,
    })
    .all();

  const updatedById = new Map(results.map((row) => [row.id, row]));
  return input.targets.flatMap((target) => {
    const updated = updatedById.get(target.sessionId);

    if (!updated) {
      return [];
    }

    return [
      {
        current: {
          ...target,
          sessionStatus: input.status,
          sessionStatusOperationId: updated.status_operation_id,
          sessionStatusSeq: updated.status_seq,
        },
        previous: target,
      },
    ];
  });
}

export async function expireStaleRuntimeOperationTargets(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTarget[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const expired: RuntimeSessionTarget[] = [];

  for (
    let index = 0;
    index < input.targets.length;
    index += RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE
  ) {
    expired.push(
      ...(await expireStaleRuntimeOperationTargetsBatch(database, {
        operationId: input.operationId,
        targets: input.targets.slice(index, index + RUNTIME_TARGET_STATUS_WRITE_BATCH_SIZE),
      })),
    );
  }

  return expired;
}

async function expireStaleRuntimeOperationTargetsBatch(
  database: D1Database,
  input: {
    readonly operationId: RuntimeOperationId;
    readonly targets: readonly RuntimeSessionTarget[];
  },
): Promise<RuntimeSessionTarget[]> {
  if (input.targets.length === 0) {
    return [];
  }

  const now = currentTimestampMs();
  const whereClause = and(
    eq(sessionsTable.status, "RESCHEDULING"),
    eq(sessionsTable.statusOperationId, input.operationId),
    lte(sessionsTable.updatedAt, now - RESCHEDULING_RECONNECT_WINDOW_MS),
    or(
      ...input.targets.map((target) =>
        and(
          eq(sessionsTable.id, target.sessionId),
          eq(sessionsTable.statusSeq, target.sessionStatusSeq),
        ),
      ),
    ),
  );
  const results = await getAppDatabase(database)
    .update(sessionsTable)
    .set(
      createSessionStatusTransitionPatch({
        status: "TERMINATED",
        timestampMs: now,
      }),
    )
    .where(whereClause)
    .returning({ id: sessionsTable.id })
    .all();

  const expiredIds = new Set(results.map((row) => row.id));
  return input.targets.filter((target) => expiredIds.has(target.sessionId));
}

export { isTerminalRunStatus };
