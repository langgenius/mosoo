import { driverInstancesTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { toDriverInstanceStatusLifecycleEventName } from "../../domain/driver-instance-lifecycle.machine";
import type { DriverInstanceStatus } from "./status";

interface DriverInstanceTokenRow {
  boot_token_expires_at: number;
  boot_token_used_at: number | null;
  connection_id: string | null;
  generation: number;
  id: DriverInstanceId;
  status: DriverInstanceStatus;
}

interface DriverInstanceTokenValidation {
  driverInstanceId: DriverInstanceId | null;
  error: string | null;
  generation: number | null;
}

export async function validateDriverInstanceBootTokenHash(
  bindings: ApiBindings,
  bootTokenHash: Uint8Array,
): Promise<DriverInstanceTokenValidation> {
  return validateDriverInstanceTokenRow(
    await readDriverInstanceTokenRow(bindings, bootTokenHash),
    currentTimestampMs(),
  );
}

export async function claimDriverInstanceByBootTokenHash(
  bindings: ApiBindings,
  bootTokenHash: Uint8Array,
): Promise<DriverInstanceTokenValidation> {
  const now = currentTimestampMs();
  const claimed =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        bootTokenUsedAt: now,
        status: "connecting",
        statusChangedAt: now,
        statusEvent: toDriverInstanceStatusLifecycleEventName("connecting"),
        statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
        statusSource: "driver",
        updatedAt: now,
      })
      .where(
        and(
          eq(driverInstancesTable.bootTokenHash, bootTokenHash),
          eq(driverInstancesTable.status, "provisioning"),
          isNull(driverInstancesTable.bootTokenUsedAt),
          gt(driverInstancesTable.bootTokenExpiresAt, now),
        ),
      )
      .returning({
        generation: driverInstancesTable.generation,
        id: driverInstancesTable.id,
      })
      .get()) ?? null;

  if (claimed) {
    return {
      driverInstanceId: claimed.id,
      error: null,
      generation: claimed.generation,
    };
  }

  return validateDriverInstanceTokenRow(
    await readDriverInstanceTokenRow(bindings, bootTokenHash),
    now,
  );
}

function validateDriverInstanceTokenRow(
  row: DriverInstanceTokenRow | null,
  now: number,
): DriverInstanceTokenValidation {
  if (!row) {
    return {
      driverInstanceId: null,
      error: "Boot token is invalid.",
      generation: null,
    };
  }

  if (isExpiredProvisioningToken(row, now)) {
    return {
      driverInstanceId: null,
      error: "Boot token has expired.",
      generation: null,
    };
  }

  if (row.status === "connecting" && row.boot_token_used_at !== null) {
    return {
      driverInstanceId: row.id,
      error: null,
      generation: row.generation,
    };
  }

  if (row.boot_token_used_at !== null || row.status !== "provisioning") {
    return {
      driverInstanceId: null,
      error: "Boot token has already been used.",
      generation: null,
    };
  }

  return {
    driverInstanceId: row.id,
    error: null,
    generation: row.generation,
  };
}

function isExpiredProvisioningToken(row: DriverInstanceTokenRow, now: number): boolean {
  return (
    row.status === "provisioning" &&
    row.boot_token_used_at === null &&
    row.boot_token_expires_at <= now
  );
}

async function readDriverInstanceTokenRow(
  bindings: ApiBindings,
  bootTokenHash: Uint8Array,
): Promise<DriverInstanceTokenRow | null> {
  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        bootTokenExpiresAt: driverInstancesTable.bootTokenExpiresAt,
        bootTokenUsedAt: driverInstancesTable.bootTokenUsedAt,
        connectionId: driverInstancesTable.connectionId,
        generation: driverInstancesTable.generation,
        id: driverInstancesTable.id,
        status: driverInstancesTable.status,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.bootTokenHash, bootTokenHash))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    boot_token_expires_at: row.bootTokenExpiresAt,
    boot_token_used_at: row.bootTokenUsedAt,
    connection_id: row.connectionId,
    generation: row.generation,
    id: row.id,
    status: row.status,
  };
}
