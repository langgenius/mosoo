import type { SessionLiveState } from "@mosoo/ag-ui-session";
import type { AgentReadiness } from "@mosoo/contracts/agent";

import { formatReadinessIssueMessage } from "@/domains/vendor-credential/model/provider-readiness-copy";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { AgentSessionPanelModel } from "./agent-session-panel-model-types";

export type SessionPill = "Setup required" | "Ready" | "Working" | "Needs approval" | "Stopped";

export function deriveSessionPill(model: AgentSessionPanelModel): SessionPill {
  if (isTruthy(model.readinessBlockMessage)) {
    return "Setup required";
  }

  if (model.lifecycle === "TERMINATED") {
    return "Stopped";
  }

  if (model.permissionRequests.length > 0) {
    return "Needs approval";
  }

  if (model.streaming || model.lifecycle === "RUNNING" || model.lifecycle === "RESCHEDULING") {
    return "Working";
  }

  return "Ready";
}

export function readinessBlockSummary(readiness: AgentReadiness | null): string | null {
  const errors = readiness?.issues.filter((issue) => issue.severity === "error") ?? [];

  if (errors.length === 0) {
    return null;
  }

  const [primary, ...remainingErrors] = errors;

  if (primary === undefined) {
    return null;
  }

  const primaryMessage = formatReadinessIssueMessage(primary);

  if (remainingErrors.length === 0) {
    return primaryMessage;
  }

  return `${primaryMessage} ${remainingErrors.length} more blockers remain.`;
}

export function sendDisabledReasonForSession({
  configurationRefreshRequired,
  lifecycle,
  reconnecting,
  setupBlocked,
  setupSummary,
  stopped,
}: {
  configurationRefreshRequired: boolean;
  lifecycle: SessionLiveState["lifecycle"];
  reconnecting: boolean;
  setupBlocked: boolean;
  setupSummary: string | null;
  stopped: boolean;
}): string | null {
  if (setupBlocked) {
    return setupSummary ?? "Fix setup before starting a run.";
  }

  if (configurationRefreshRequired) {
    return "Start new session to test latest config";
  }

  if (reconnecting || lifecycle === "RESCHEDULING") {
    return "Agent is updating. Please wait for the session to reconnect.";
  }

  if (stopped) {
    return "This session stopped. Start a new session to continue.";
  }

  return null;
}

export function sessionIndicatorClassName(pill: SessionPill): string {
  switch (pill) {
    case "Ready": {
      return "bg-green-500";
    }
    case "Working": {
      return "bg-accent";
    }
    case "Needs approval": {
      return "bg-amber-500";
    }
    case "Setup required":
    case "Stopped": {
      return "bg-muted-foreground";
    }
    default: {
      return "bg-muted-foreground";
    }
  }
}
