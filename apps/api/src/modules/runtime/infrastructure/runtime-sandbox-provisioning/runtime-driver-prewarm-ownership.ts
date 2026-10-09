import type { DriverInstanceId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { driverInstanceRecordMatchesBootToken } from "../driver-instance/driver-instance-record.repository";

export class DriverPrewarmProvisionSkippedError extends Error {
  constructor(driverInstanceId: DriverInstanceId) {
    super(`Driver prewarm was skipped because another provision owns ${driverInstanceId}.`);
    this.name = "DriverPrewarmProvisionSkippedError";
  }
}

export async function getLostPrewarmOwnershipError(
  env: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    driverInstanceId: DriverInstanceId;
    generation: number;
  },
): Promise<DriverPrewarmProvisionSkippedError | null> {
  const stillOwnsRecord = await driverInstanceRecordMatchesBootToken(env.DB, input);

  return stillOwnsRecord ? null : new DriverPrewarmProvisionSkippedError(input.driverInstanceId);
}
