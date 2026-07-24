import type { AppDeploymentRunId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { admitApiCommand, enqueueApiCommand } from "./api-command-ledger";
import type { ApiCommandAdmission, EnqueueApiCommandInput } from "./api-command-ledger";
import type {
  AppDeploymentRunDispatchCommandPayload,
  ChannelWorkTriggerCommandPayload,
  CostLedgerReconciliationCommandPayload,
  ScheduledMaintenanceCommandPayload,
  SessionRunDispatchCommandPayload,
} from "./api-command-payload";

export const APP_DEPLOYMENT_RUN_DISPATCH_DEDUPE_PREFIX = "app_deployment_run_dispatch:" as const;

export function createAppDeploymentRunDispatchDedupeKey(runId: AppDeploymentRunId): string {
  return `${APP_DEPLOYMENT_RUN_DISPATCH_DEDUPE_PREFIX}${runId}`;
}

export async function enqueueAppDeploymentRunDispatchCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: AppDeploymentRunDispatchCommandPayload,
): Promise<void> {
  await enqueueApiCommand(bindings, {
    dedupeKey: createAppDeploymentRunDispatchDedupeKey(payload.appDeploymentRunId),
    kind: "app_deployment_run_dispatch",
    payload,
  });
}

function createChannelWorkTriggerDedupeKey(input: ChannelWorkTriggerCommandPayload): string {
  return `channel_work_trigger:${input.provider}:${input.bindingId}:${input.trigger.eventId}`;
}

export async function enqueueChannelWorkTriggerCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: ChannelWorkTriggerCommandPayload,
): Promise<void> {
  await enqueueApiCommand(bindings, {
    dedupeKey: createChannelWorkTriggerDedupeKey(payload),
    kind: "channel_work_trigger",
    payload,
  });
}

export async function enqueueCostLedgerReconciliationCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: CostLedgerReconciliationCommandPayload,
): Promise<void> {
  await enqueueApiCommand(bindings, {
    dedupeKey: [
      "cost_ledger_reconciliation",
      payload.scheduledTime,
      payload.mode,
      payload.cursor ?? "start",
    ].join(":"),
    kind: "cost_ledger_reconciliation",
    payload,
  });
}

export async function enqueueScheduledMaintenanceCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: ScheduledMaintenanceCommandPayload,
): Promise<void> {
  await enqueueApiCommand(bindings, {
    dedupeKey: `scheduled_maintenance:${payload.scheduledTime}`,
    kind: "scheduled_maintenance",
    payload,
  });
}

export async function admitSessionRunDispatchCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: SessionRunDispatchCommandPayload,
): Promise<ApiCommandAdmission> {
  return admitApiCommand(bindings, createSessionRunDispatchApiCommandInput(payload));
}

export function createSessionRunDispatchApiCommandInput(
  payload: SessionRunDispatchCommandPayload,
): EnqueueApiCommandInput {
  return {
    dedupeKey: `session_run_dispatch:${payload.sessionRunId}`,
    kind: "session_run_dispatch",
    payload,
  };
}
