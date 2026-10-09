import { DRIVER_CONTROL_PORT_MAX, DRIVER_CONTROL_PORT_MIN } from "@mosoo/agent-driver/boot";
import type { DriverInstanceId } from "@mosoo/id";

const DRIVER_CONTROL_PORT_COUNT = DRIVER_CONTROL_PORT_MAX - DRIVER_CONTROL_PORT_MIN + 1;

// 32-bit FNV-1a over UTF-16 indexes. The port is recomputed for existing
// drivers, so the output must stay stable.
export function getDriverControlPort(driverInstanceId: DriverInstanceId): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < driverInstanceId.length; index += 1) {
    hash = Math.imul(hash ^ driverInstanceId.codePointAt(index)!, 16_777_619) >>> 0;
  }

  return DRIVER_CONTROL_PORT_MIN + (hash % DRIVER_CONTROL_PORT_COUNT);
}
