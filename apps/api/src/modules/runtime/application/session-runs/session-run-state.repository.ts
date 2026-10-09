import type { RunError, SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import type { SessionRunId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTerminalSessionRunStatus } from "../../domain/session-run-lifecycle.machine";
import { setSessionRunStatus } from "../../infrastructure/session-runs/session-run-store.repository";

export class SessionRunNoLongerActiveError extends Error {
  readonly status: SessionRunSummary["status"];

  constructor(status: SessionRunSummary["status"]) {
    super(`Session run is already ${status}.`);
    this.name = "SessionRunNoLongerActiveError";
    this.status = status;
  }
}

export async function ensureSessionRunIsActive(
  database: D1Database,
  runId: SessionRunId,
): Promise<void> {
  const status = await getSessionRunStatus(database, runId);

  if (status === null) {
    throw new Error("Session run not found.");
  }

  if (isTerminalSessionRunStatus(status)) {
    throw new SessionRunNoLongerActiveError(status);
  }
}

export async function getSessionRunStatus(
  database: D1Database,
  runId: SessionRunId,
): Promise<SessionRunSummary["status"] | null> {
  const row =
    (await getAppDatabase(database)
      .select({ status: sessionRunsTable.status })
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.id, runId))
      .limit(1)
      .get()) ?? null;

  return row?.status ?? null;
}

export async function updateSessionRunStatusIfActive(
  database: D1Database,
  input: {
    error?: RunError | null;
    expectedCurrentStatus?: SessionRunSummary["status"];
    runId: SessionRunId;
    status: SessionRunSummary["status"];
  },
): Promise<SessionRunSummary | null> {
  const outcome = await setSessionRunStatus(database, {
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.expectedCurrentStatus !== undefined
      ? { expectedCurrentStatus: input.expectedCurrentStatus }
      : {}),
    runId: input.runId,
    source: "api",
    status: input.status,
  });

  return outcome.kind === "applied" || outcome.kind === "duplicate" ? outcome.run : null;
}

export async function acquireSessionRunDispatch(
  database: D1Database,
  runId: SessionRunId,
): Promise<SessionRunSummary | null> {
  const outcome = await setSessionRunStatus(database, {
    runId,
    source: "api",
    status: "booting",
  });

  return outcome.kind === "applied" ? outcome.run : null;
}
