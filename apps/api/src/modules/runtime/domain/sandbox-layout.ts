import type { DriverInstanceId } from "@mosoo/id";
import { DRIVER_CONTROL_PORT_COUNT, DRIVER_CONTROL_PORT_MIN } from "agent-driver/boot";

function xorUint32(left: number, right: number): number {
  let result = 0;
  let placeValue = 1;
  let remainingLeft = left;
  let remainingRight = right;

  for (let bitIndex = 0; bitIndex < 32; bitIndex += 1) {
    const leftBit = remainingLeft % 2;
    const rightBit = remainingRight % 2;

    if (leftBit !== rightBit) {
      result += placeValue;
    }

    remainingLeft = Math.floor(remainingLeft / 2);
    remainingRight = Math.floor(remainingRight / 2);
    placeValue *= 2;
  }

  return result;
}

export function getDriverControlPort(driverInstanceId: DriverInstanceId): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < driverInstanceId.length; index += 1) {
    hash = xorUint32(hash, driverInstanceId.codePointAt(index) ?? 0);
    const nextHash = Math.imul(hash, 16_777_619);
    hash = nextHash < 0 ? nextHash + 4_294_967_296 : nextHash;
  }

  return DRIVER_CONTROL_PORT_MIN + (hash % DRIVER_CONTROL_PORT_COUNT);
}
