import type { DriverInstanceId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { driverInstanceRecordMatchesBootToken } from "../driver-instance/driver-instance-record.repository";
import type { ProvisionDriverInput } from "./runtime-sandbox-provisioning.types";

export class DriverPrewarmProvisionSkippedError extends Error {
  constructor(driverInstanceId: DriverInstanceId) {
    super(`Driver prewarm was skipped because another provision owns ${driverInstanceId}.`);
    this.name = "DriverPrewarmProvisionSkippedError";
  }
}

export function usesInsertOnlyDriverRecord(input: ProvisionDriverInput): boolean {
  return input.driverRecordConflictStrategy === "insert-only";
}

export async function getLostPrewarmOwnershipError(
  env: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    driverInstanceId: DriverInstanceId;
    generation: number;
    insertOnly: boolean;
  },
): Promise<DriverPrewarmProvisionSkippedError | null> {
  if (!input.insertOnly) {
    return null;
  }

  const stillOwnsRecord = await driverInstanceRecordMatchesBootToken(env.DB, {
    bootTokenHash: input.bootTokenHash,
    driverInstanceId: input.driverInstanceId,
    generation: input.generation,
  });

  return stillOwnsRecord ? null : new DriverPrewarmProvisionSkippedError(input.driverInstanceId);
}
