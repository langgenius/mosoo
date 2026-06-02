import type { AgentKind } from "@mosoo/contracts/agent";
import { sandboxSessionsTable, sandboxesTable, sessionsTable } from "@mosoo/db";
import type { AgentId, SandboxId, SessionId } from "@mosoo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { RuntimeSubjectScope } from "../domain/runtime-kind-policy";
import type { RuntimePolicySubjectKind } from "../domain/runtime-kind-policy";
import { getRuntimeKindPolicy } from "../domain/runtime-kind-policy";
import { resolveStableAgentRuntimeSubject } from "../domain/runtime-sandbox-subject";
import { getRuntimeSubjectIdByTuple } from "../infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import {
  RUNTIME_TARGET_SESSION_STATUSES,
  listRuntimeSessionTargetsForSandboxIds,
} from "./runtime-state-operation-target-store";
import type { RuntimeSessionTarget } from "./runtime-state-operation-target-store";

export interface RuntimeOperationSubject {
  readonly runtimeSubjectId: SandboxId;
  readonly targets: readonly RuntimeSessionTarget[];
}

export interface RuntimeOperationScope {
  readonly subjects: RuntimeOperationSubject[];
  readonly targets: RuntimeSessionTarget[];
}

interface RuntimeOperationAgentSubjectInput {
  readonly id: AgentId;
  readonly kind: AgentKind;
}

function toRuntimeOperationSubjects(subjectIds: readonly SandboxId[]): RuntimeOperationSubject[] {
  return [...new Set(subjectIds)].map((runtimeSubjectId) => ({ runtimeSubjectId, targets: [] }));
}

function assertCompleteSubjectAdmission(input: {
  readonly admittedSessionIds: ReadonlySet<SessionId>;
  readonly subjectId: SandboxId;
  readonly targets: readonly RuntimeSessionTarget[];
}): boolean {
  const admittedTargets = input.targets.filter((target) =>
    input.admittedSessionIds.has(target.sessionId),
  );

  if (admittedTargets.length === 0) {
    return false;
  }

  if (admittedTargets.length !== input.targets.length) {
    throw new Error(
      `Runtime operation target admission changed concurrently for subject ${input.subjectId}.`,
    );
  }

  return true;
}

async function resolveLeaseScopedRuntimeOperationScope(
  database: D1Database,
  input: {
    agentId: AgentId;
    subjectKind: RuntimePolicySubjectKind;
  },
): Promise<RuntimeOperationScope> {
  const rows = await getAppDatabase(database)
    .select({
      agentId: sessionsTable.agentId,
      creatorAccountId: sessionsTable.creatorAccountId,
      lastRunId: sessionsTable.lastRunId,
      runtimeSubjectId: sandboxesTable.id,
      sandboxId: sandboxSessionsTable.sandboxId,
      sessionId: sessionsTable.id,
      sessionStatusOperationId: sessionsTable.statusOperationId,
      sessionStatusSeq: sessionsTable.statusSeq,
      sessionStatus: sql<RuntimeSessionTarget["sessionStatus"]>`${sessionsTable.status}`,
    })
    .from(sessionsTable)
    .innerJoin(sandboxSessionsTable, eq(sandboxSessionsTable.sessionId, sessionsTable.id))
    .innerJoin(sandboxesTable, eq(sandboxesTable.id, sandboxSessionsTable.sandboxId))
    .where(
      and(
        eq(sessionsTable.agentId, input.agentId),
        isNull(sessionsTable.archivedAt),
        inArray(sessionsTable.status, RUNTIME_TARGET_SESSION_STATUSES),
        eq(sandboxesTable.subjectKind, input.subjectKind),
        eq(sandboxSessionsTable.status, "active"),
      ),
    )
    .all();

  return {
    subjects: toRuntimeOperationSubjects(rows.map((row) => row.runtimeSubjectId)),
    targets: rows.map((row) => ({
      agentId: row.agentId,
      creatorAccountId: row.creatorAccountId,
      lastRunId: row.lastRunId,
      sandboxId: row.sandboxId,
      sessionId: row.sessionId,
      sessionStatusOperationId: row.sessionStatusOperationId,
      sessionStatusSeq: row.sessionStatusSeq,
      sessionStatus: row.sessionStatus,
    })),
  };
}

async function resolveStableRuntimeOperationSubjects(
  database: D1Database,
  agent: RuntimeOperationAgentSubjectInput,
): Promise<RuntimeOperationSubject[]> {
  const subject = resolveStableAgentRuntimeSubject({
    agentId: agent.id,
    kind: agent.kind,
  });

  const runtimeSubjectId = await getRuntimeSubjectIdByTuple(database, subject);

  return runtimeSubjectId === null ? [] : [{ runtimeSubjectId, targets: [] }];
}

export async function resolveRuntimeOperationScope(
  database: D1Database,
  agent: RuntimeOperationAgentSubjectInput,
): Promise<RuntimeOperationScope> {
  const policy = getRuntimeKindPolicy(agent.kind);

  if (policy.subject.scope === "session") {
    return resolveLeaseScopedRuntimeOperationScope(database, {
      agentId: agent.id,
      subjectKind: policy.subject.subjectKind,
    });
  }

  const subjects = await resolveStableRuntimeOperationSubjects(database, agent);
  const targets = await listRuntimeSessionTargetsForSandboxIds(
    database,
    subjects.map((subject) => subject.runtimeSubjectId),
  );

  return { subjects, targets };
}

export function selectAdmittedRuntimeOperationSubjects(input: {
  readonly admittedTargets: readonly RuntimeSessionTarget[];
  readonly scope: RuntimeSubjectScope;
  readonly subjects: readonly RuntimeOperationSubject[];
  readonly targets: readonly RuntimeSessionTarget[];
}): RuntimeOperationSubject[] {
  const admittedSessionIds = new Set(input.admittedTargets.map((target) => target.sessionId));

  if (input.scope === "agent") {
    if (input.targets.length !== input.admittedTargets.length) {
      throw new Error("Runtime operation target admission changed concurrently.");
    }

    return input.subjects.map((subject) => ({
      ...subject,
      targets: input.admittedTargets,
    }));
  }

  const targetsBySubjectId = new Map<SandboxId, RuntimeSessionTarget[]>();

  for (const target of input.targets) {
    const targets = targetsBySubjectId.get(target.sandboxId) ?? [];
    targets.push(target);
    targetsBySubjectId.set(target.sandboxId, targets);
  }

  return input.subjects.flatMap((subject) => {
    const targets = targetsBySubjectId.get(subject.runtimeSubjectId) ?? [];

    return assertCompleteSubjectAdmission({
      admittedSessionIds,
      subjectId: subject.runtimeSubjectId,
      targets,
    })
      ? [
          {
            ...subject,
            targets: targets.filter((target) => admittedSessionIds.has(target.sessionId)),
          },
        ]
      : [];
  });
}

export function summarizeRuntimeOperationSubjects(
  subjects: readonly RuntimeOperationSubject[],
): string {
  if (subjects.length === 0) {
    return "";
  }

  if (subjects.length === 1) {
    return subjects[0]?.runtimeSubjectId ?? "";
  }

  return subjects.map((subject) => subject.runtimeSubjectId).join(", ");
}
