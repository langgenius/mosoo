import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { enqueueApiCommand } from "./api-command-ledger";
import type { EnqueueApiCommandInput } from "./api-command-ledger";
import type {
  CostLedgerReconciliationCommandPayload,
  SandboxBackupReconciliationCommandPayload,
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

export async function enqueueSandboxBackupReconciliationCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: SandboxBackupReconciliationCommandPayload,
): Promise<void> {
  await enqueueApiCommand(bindings, {
    dedupeKey: [
      "sandbox_backup_reconciliation",
      payload.scheduledTime,
      payload.databasePage,
      payload.cursor ?? "start",
    ].join(":"),
    kind: "sandbox_backup_reconciliation",
    payload,
  });
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
