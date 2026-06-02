import type { SessionStatus } from "@mosoo/contracts/session";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";

export const RESCHEDULING_RECONNECT_WINDOW_MS = 120_000;

export function toSessionLifecycleStatusForRunStatus(status: SessionRunStatus): SessionStatus {
  switch (status) {
    case "queued":
    case "booting":
    case "running":
    case "waiting_input": {
      return "RUNNING";
    }
    case "completed":
    case "cancelled":
    case "expired":
    case "failed": {
      return "IDLE";
    }
    default: {
      throw new Error("Unsupported session run status.");
    }
  }
}

export function enforceSessionCanAcceptEvents(session: {
  archivedAt: number | null;
  status: SessionStatus;
}): void {
  if (session.archivedAt !== null) {
    throw new Error("Session is archived.");
  }

  if (session.status === "TERMINATED") {
    throw new Error("Session is terminated.");
  }
}

export function shouldBackupSandboxSession(input: {
  lastMessageAt: number | null;
  sessionStatus: SessionStatus;
}): boolean {
  return input.lastMessageAt !== null && input.sessionStatus !== "TERMINATED";
}
