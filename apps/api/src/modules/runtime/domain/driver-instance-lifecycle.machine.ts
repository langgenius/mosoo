import type { DriverInstanceStatus } from "@mosoo/contracts/sandbox";

export const LIVE_DRIVER_INSTANCE_STATUSES = [
  "provisioning",
  "connecting",
  "ready",
  "stopping",
] as const satisfies readonly DriverInstanceStatus[];

export const ASSIGNABLE_DRIVER_INSTANCE_STATUSES = [
  "provisioning",
  "connecting",
  "ready",
] as const satisfies readonly DriverInstanceStatus[];

export const REUSABLE_DRIVER_INSTANCE_STATUSES = [
  "provisioning",
  "connecting",
  "ready",
] as const satisfies readonly DriverInstanceStatus[];

export type DriverInstanceLifecycleEvent =
  | { type: "driver.connect" }
  | { type: "driver.fail" }
  | { type: "driver.provision" }
  | { type: "driver.ready" }
  | { type: "driver.stop" }
  | { type: "driver.stopping" };

const DRIVER_EVENT_BY_STATUS = {
  connecting: { type: "driver.connect" },
  failed: { type: "driver.fail" },
  provisioning: { type: "driver.provision" },
  ready: { type: "driver.ready" },
  stopped: { type: "driver.stop" },
  stopping: { type: "driver.stopping" },
} as const satisfies Record<DriverInstanceStatus, DriverInstanceLifecycleEvent>;

function toDriverInstanceLifecycleEvent(
  status: DriverInstanceStatus,
): DriverInstanceLifecycleEvent {
  return DRIVER_EVENT_BY_STATUS[status];
}

export function toDriverInstanceStatusLifecycleEventName(status: DriverInstanceStatus): string {
  return toDriverInstanceLifecycleEvent(status).type;
}
