import type { DriverHeartbeatInput, DriverReadyInput } from "@mosoo/agent-driver/orpc";
import { driverInstancesTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  LIVE_DRIVER_INSTANCE_STATUSES,
  toDriverInstanceStatusLifecycleEventName,
} from "../../domain/driver-instance-lifecycle.machine";
import type { DriverHelloInput } from "./rpc-wire";
import { parseDriverTimestampMs, driverInstanceExpiresAt } from "./status";
import type { DriverInstanceStatus } from "./status";

export async function markDriverInstanceConnected(
  bindings: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    connectionId: string;
    driverInstanceId: DriverInstanceId;
  },
): Promise<boolean> {
  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        connectionId: input.connectionId,
        updatedAt: currentTimestampMs(),
      })
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.bootTokenHash, input.bootTokenHash),
          eq(driverInstancesTable.status, "connecting"),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}

export async function recordDriverInstanceHello(
  bindings: ApiBindings,
  input: {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    hello: DriverHelloInput;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        driverPid: input.hello.pid,
        driverStartedAt: parseDriverTimestampMs(input.hello.startedAt, "Driver hello startedAt"),
        driverVersion: input.hello.driverVersion,
        protocolVersion: input.hello.protocolVersion,
        updatedAt: now,
      })
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
          eq(driverInstancesTable.status, "connecting"),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}

export async function markDriverInstanceReady(
  bindings: ApiBindings,
  input: Omit<DriverReadyInput, "driverInstanceId"> & {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        driverPid: input.pid,
        status: "ready",
        statusChangedAt: now,
        statusEvent: toDriverInstanceStatusLifecycleEventName("ready"),
        statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
        statusSource: "driver",
        updatedAt: now,
      })
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
          eq(driverInstancesTable.status, "connecting"),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}

export async function recordDriverInstanceHeartbeat(
  bindings: ApiBindings,
  input: {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    heartbeat: DriverHeartbeatInput;
    heartbeatCount: number;
  },
): Promise<boolean> {
  const now = currentTimestampMs();

  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        heartbeatCount: input.heartbeatCount,
        lastHeartbeatAt: parseDriverTimestampMs(input.heartbeat.at, "Driver heartbeat timestamp"),
        updatedAt: now,
      })
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
          inArray(driverInstancesTable.status, ["connecting", "ready"]),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}

export async function finalizeDriverInstance(
  bindings: ApiBindings,
  driverInstanceId: DriverInstanceId,
  input: {
    closeCode?: number | null;
    closeReason?: string | null;
    connectionId: string | null;
    errorMessage?: string | null;
    heartbeatCount: number;
    lastHeartbeatAt?: string | null;
    status: Extract<DriverInstanceStatus, "stopped" | "failed">;
  },
): Promise<boolean> {
  const completedAt = currentTimestampMs();

  const lastHeartbeatAt =
    typeof input.lastHeartbeatAt === "string" && input.lastHeartbeatAt.length > 0
      ? parseDriverTimestampMs(input.lastHeartbeatAt, "Driver heartbeat timestamp")
      : null;

  const row =
    (await getAppDatabase(bindings.DB)
      .update(driverInstancesTable)
      .set({
        closeCode: sql`COALESCE(${driverInstancesTable.closeCode}, ${input.closeCode ?? null})`,
        closeReason: sql`COALESCE(${driverInstancesTable.closeReason}, ${input.closeReason ?? null})`,
        connectionId: sql`COALESCE(${driverInstancesTable.connectionId}, ${input.connectionId})`,
        errorMessage: sql`COALESCE(${driverInstancesTable.errorMessage}, ${input.errorMessage ?? null})`,
        expiresAt: driverInstanceExpiresAt(completedAt),
        heartbeatCount: input.heartbeatCount,
        lastHeartbeatAt,
        status: input.status,
        statusChangedAt: completedAt,
        statusEvent: toDriverInstanceStatusLifecycleEventName(input.status),
        statusSeq: sql`${driverInstancesTable.statusSeq} + 1`,
        statusSource: "driver",
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(driverInstancesTable.id, driverInstanceId),
          or(
            input.connectionId === null
              ? undefined
              : eq(driverInstancesTable.connectionId, input.connectionId),
            and(
              isNull(driverInstancesTable.connectionId),
              inArray(driverInstancesTable.status, ["provisioning", "connecting"]),
            ),
          ),
          inArray(driverInstancesTable.status, LIVE_DRIVER_INSTANCE_STATUSES),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  return row !== null;
}

export async function getTerminalDriverInstanceStatusForConnection(
  bindings: ApiBindings,
  input: { driverInstanceId: DriverInstanceId; connectionId: string | null },
): Promise<"failed" | "stopped" | null> {
  const row = await getAppDatabase(bindings.DB)
    .select({ status: driverInstancesTable.status })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        input.connectionId === null
          ? isNull(driverInstancesTable.connectionId)
          : eq(driverInstancesTable.connectionId, input.connectionId),
      ),
    )
    .get();

  return row?.status === "failed" || row?.status === "stopped" ? row.status : null;
}
