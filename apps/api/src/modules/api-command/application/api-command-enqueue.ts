import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { admitApiCommand, enqueueApiCommand } from "./api-command-ledger";
import type { ApiCommandAdmission, EnqueueApiCommandInput } from "./api-command-ledger";
import type {
  CostLedgerReconciliationCommandPayload,
  ScheduledMaintenanceCommandPayload,
  SessionRunDispatchCommandPayload,
} from "./api-command-payload";

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
