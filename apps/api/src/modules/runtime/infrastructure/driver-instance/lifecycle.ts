import type {
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { driverInstancesTable } from "@mosoo/db";
import type { DriverInstanceId } from "@mosoo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import {
  LIVE_DRIVER_INSTANCE_STATUSES,
  toDriverInstanceStatusLifecycleEventName,
} from "../../domain/driver-instance-lifecycle.machine";
import { parseDriverTimestampMs, driverInstanceExpiresAt } from "./status";
import type { DriverInstanceStatus } from "./status";

export type DriverInstanceProjectionOutcome = "applied" | "replay" | "conflict";

export async function markDriverInstanceConnected(
  bindings: ApiBindings,
  input: {
    bootTokenHash: Uint8Array;
    connectedAt: number;
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    generation: number;
  },
): Promise<boolean> {
  void input.connectedAt;

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
          eq(driverInstancesTable.generation, input.generation),
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
    generation: number;
    hello: DriverHelloInput;
  },
): Promise<DriverInstanceProjectionOutcome> {
  const now = currentTimestampMs();

  if (input.hello === undefined) {
    throw new Error("Driver hello payload is required before marking the driver ready.");
  }

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
          eq(driverInstancesTable.generation, input.generation),
          eq(driverInstancesTable.status, "connecting"),
          isNull(driverInstancesTable.driverPid),
          isNull(driverInstancesTable.driverStartedAt),
          isNull(driverInstancesTable.driverVersion),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  if (row !== null) {
    return "applied";
  }

  const startedAt = parseDriverTimestampMs(input.hello.startedAt, "Driver hello startedAt");
  const existing =
    (await getAppDatabase(bindings.DB)
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
          eq(driverInstancesTable.generation, input.generation),
          inArray(driverInstancesTable.status, ["connecting", "ready"]),
          eq(driverInstancesTable.driverPid, input.hello.pid),
          eq(driverInstancesTable.driverStartedAt, startedAt),
          eq(driverInstancesTable.driverVersion, input.hello.driverVersion),
          eq(driverInstancesTable.protocolVersion, input.hello.protocolVersion),
          eq(driverInstancesTable.runtime, input.hello.runtime),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return existing === null ? "conflict" : "replay";
}

export async function markDriverInstanceReady(
  bindings: ApiBindings,
  input: Omit<DriverReadyInput, "driverInstanceId"> & {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    generation: number;
  },
): Promise<DriverInstanceProjectionOutcome> {
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
          eq(driverInstancesTable.generation, input.generation),
          eq(driverInstancesTable.status, "connecting"),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  if (row !== null) {
    return "applied";
  }

  const existing =
    (await getAppDatabase(bindings.DB)
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
          eq(driverInstancesTable.generation, input.generation),
          eq(driverInstancesTable.status, "ready"),
          eq(driverInstancesTable.driverPid, input.pid),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return existing === null ? "conflict" : "replay";
}

export async function recordDriverInstanceHeartbeat(
  bindings: ApiBindings,
  input: {
    connectionId: string;
    driverInstanceId: DriverInstanceId;
    generation: number;
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
          eq(driverInstancesTable.generation, input.generation),
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
    connectedAt?: number | null;
    driverPid?: number | null;
    driverStartedAt?: string | null;
    errorMessage?: string | null;
    generation: number;
    heartbeatCount: number;
    lastHeartbeatAt?: string | null;
    status: Extract<DriverInstanceStatus, "stopped" | "failed">;
  },
): Promise<Extract<DriverInstanceStatus, "stopped" | "failed"> | null> {
  const completedAt = currentTimestampMs();
  const connectionMatches =
    input.connectionId === null ? [] : [eq(driverInstancesTable.connectionId, input.connectionId)];

  const driverStartedAt =
    typeof input.driverStartedAt === "string" && input.driverStartedAt.length > 0
      ? parseDriverTimestampMs(input.driverStartedAt, "Driver startedAt")
      : null;
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
        driverPid: sql`COALESCE(${driverInstancesTable.driverPid}, ${input.driverPid ?? null})`,
        driverStartedAt: sql`COALESCE(${driverInstancesTable.driverStartedAt}, ${driverStartedAt})`,
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
          ...connectionMatches,
          eq(driverInstancesTable.generation, input.generation),
          inArray(driverInstancesTable.status, LIVE_DRIVER_INSTANCE_STATUSES),
        ),
      )
      .returning({ id: driverInstancesTable.id })
      .get()) ?? null;

  if (row !== null) {
    return input.status;
  }

  const existing =
    (await getAppDatabase(bindings.DB)
      .select({ status: driverInstancesTable.status })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, driverInstanceId),
          ...connectionMatches,
          eq(driverInstancesTable.generation, input.generation),
          inArray(driverInstancesTable.status, ["stopped", "failed"]),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return existing?.status === "stopped" || existing?.status === "failed" ? existing.status : null;
}

export async function getDriverInstanceLifecycleIdentity(
  bindings: ApiBindings,
  driverInstanceId: DriverInstanceId,
): Promise<{ generation: number; status: DriverInstanceStatus } | null> {
  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        generation: driverInstancesTable.generation,
        status: driverInstancesTable.status,
      })
      .from(driverInstancesTable)
      .where(eq(driverInstancesTable.id, driverInstanceId))
      .limit(1)
      .get()) ?? null;

  return row;
}
