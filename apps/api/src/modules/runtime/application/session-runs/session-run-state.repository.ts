import type { RunError, SessionRunSummary } from "@mosoo/contracts/session-run";
import { sessionRunsTable } from "@mosoo/db";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import { isTerminalSessionRunStatus } from "../../domain/session-run-status";
import { setSessionRunStatus } from "../../infrastructure/session-runs/session-run-store.repository";

export interface SessionRunState {
  driverInstanceId: DriverInstanceId | null;
  status: SessionRunSummary["status"];
}

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
  const state = await getSessionRunState(database, runId);

  if (!state) {
    throw new Error("Session run not found.");
  }

  if (isTerminalSessionRunStatus(state.status)) {
    throw new SessionRunNoLongerActiveError(state.status);
  }
}

export async function getSessionRunState(
  database: D1Database,
  runId: SessionRunId,
): Promise<SessionRunState | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        driverInstanceId: sessionRunsTable.driverInstanceId,
        status: sessionRunsTable.status,
      })
      .from(sessionRunsTable)
      .where(eq(sessionRunsTable.id, runId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return row;
}

export async function updateSessionRunStatusIfActive(
  database: D1Database,
  input: {
    error?: RunError | null;
    runId: SessionRunId;
    status: SessionRunSummary["status"];
  },
): Promise<SessionRunSummary | null> {
  const outcome = await setSessionRunStatus(database, {
    ...(input.error !== undefined ? { error: input.error } : {}),
    runId: input.runId,
    source: "api",
    status: input.status,
  });

  switch (outcome.kind) {
    case "applied":
    case "duplicate": {
      return outcome.run;
    }
    case "repair_needed": {
      throw new Error("Session lifecycle projection needs repair.");
    }
    case "rejected":
    case "stale": {
      return null;
    }
  }
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

  switch (outcome.kind) {
    case "applied": {
      return outcome.run;
    }
    case "duplicate":
    case "rejected":
    case "stale": {
      return null;
    }
    case "repair_needed": {
      throw new Error("Session lifecycle projection needs repair.");
    }
  }
}
