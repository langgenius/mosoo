import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { enqueueApiCommand } from "./api-command-ledger";
import type {
  ChannelWorkTriggerCommandPayload,
  ScheduledMaintenanceCommandPayload,
  SessionRunDispatchCommandPayload,
} from "./api-command-payload";

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

export async function enqueueSessionRunDispatchCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  payload: SessionRunDispatchCommandPayload,
): Promise<void> {
  await enqueueApiCommand(bindings, {
    dedupeKey: `session_run_dispatch:${payload.sessionRunId}`,
    kind: "session_run_dispatch",
    payload,
  });
}
