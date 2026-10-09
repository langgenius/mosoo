import type { SessionLiveState } from "@mosoo/ag-ui-session";
import type { AgentReadiness } from "@mosoo/contracts/agent";

import { formatReadinessIssueMessage } from "@/domains/vendor-credential/model/provider-readiness-copy";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { AgentSessionPanelModel } from "./agent-session-panel-model-types";

type Translate = (key: string, variables?: Record<string, string>) => string;

export type SessionPill = "Setup required" | "Ready" | "Working" | "Stopped";

export function deriveSessionPill(model: AgentSessionPanelModel): SessionPill {
  if (isTruthy(model.readinessBlockMessage)) {
    return "Setup required";
  }

  if (model.lifecycle === "TERMINATED") {
    return "Stopped";
  }

  if (model.streaming || model.lifecycle === "RUNNING" || model.lifecycle === "RESCHEDULING") {
    return "Working";
  }

  return "Ready";
}

export function readinessBlockSummary(
  readiness: AgentReadiness | null,
  t: Translate,
): string | null {
  const errors = readiness?.issues.filter((issue) => issue.severity === "error") ?? [];

  if (errors.length === 0) {
    return null;
  }

  const [primary, ...remainingErrors] = errors;

  if (primary === undefined) {
    return null;
  }

  const primaryMessage = formatReadinessIssueMessage(primary, t);

  if (remainingErrors.length === 0) {
    return primaryMessage;
  }

  return `${primaryMessage} ${t("agent.moreBlockersRemain", {
    count: String(remainingErrors.length),
  })}`;
}

export function sendDisabledReasonForSession(
  {
    lifecycle,
    reconnecting,
    setupBlocked,
    setupSummary,
    stopped,
  }: {
    lifecycle: SessionLiveState["lifecycle"];
    reconnecting: boolean;
    setupBlocked: boolean;
    setupSummary: string | null;
    stopped: boolean;
  },
  t: Translate,
): string | null {
  if (setupBlocked) {
    return setupSummary ?? t("agent.fixSetupBeforeRun");
  }

  if (reconnecting || lifecycle === "RESCHEDULING") {
    return t("agent.updatingWaitForReconnect");
  }

  if (stopped) {
    return t("agent.sessionStoppedStartNew");
  }

  return null;
}
