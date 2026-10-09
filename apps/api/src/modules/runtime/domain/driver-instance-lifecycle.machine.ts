import type { DriverInstanceStatus } from "@mosoo/contracts/sandbox";

export const LIVE_DRIVER_INSTANCE_STATUSES = [
  "provisioning",
  "connecting",
  "ready",
] as const satisfies readonly DriverInstanceStatus[];

export const ASSIGNABLE_DRIVER_INSTANCE_STATUSES = [
  "provisioning",
  "connecting",
  "ready",
] as const satisfies readonly DriverInstanceStatus[];

const DRIVER_INSTANCE_STATUS_EVENT_NAMES = {
  connecting: "driver.connect",
  failed: "driver.fail",
  provisioning: "driver.provision",
  ready: "driver.ready",
  stopped: "driver.stop",
} as const satisfies Record<DriverInstanceStatus, string>;

export function toDriverInstanceStatusLifecycleEventName(status: DriverInstanceStatus): string {
  return DRIVER_INSTANCE_STATUS_EVENT_NAMES[status];
}
