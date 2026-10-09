import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverInstanceId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { DriverInstanceSnapshot } from "./state";

function getDriverConnectionStub(env: ApiBindings, driverInstanceId: DriverInstanceId) {
  return env.DriverConnection.get(env.DriverConnection.idFromName(driverInstanceId));
}

export async function upgradeDriverInstanceSocket(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  request: Request,
): Promise<Response> {
  const target = new URL("https://driver-instance.internal/driver-socket");
  target.search = new URL(request.url).search;
  target.searchParams.set("driverInstanceId", driverInstanceId);

  return getDriverConnectionStub(env, driverInstanceId).fetch(
    new Request(target, {
      headers: request.headers,
      method: "GET",
    }),
  );
}

export async function waitForDriverInstanceReady(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  timeoutMs: number,
): Promise<void> {
  await getDriverConnectionStub(env, driverInstanceId).waitForReady(driverInstanceId, timeoutMs);
}

export async function waitForDriverInstanceClose(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  timeoutMs: number,
): Promise<void> {
  await getDriverConnectionStub(env, driverInstanceId).waitForClose(driverInstanceId, timeoutMs);
}

export async function getDriverInstanceSnapshot(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
): Promise<DriverInstanceSnapshot> {
  return getDriverConnectionStub(env, driverInstanceId).snapshot(driverInstanceId);
}

export async function sendDriverInstanceCommand(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  command: RuntimeCommand,
): Promise<void> {
  await getDriverConnectionStub(env, driverInstanceId).sendControlCommand(
    driverInstanceId,
    command,
  );
}

export async function failDriverInstance(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  message: string,
): Promise<void> {
  await getDriverConnectionStub(env, driverInstanceId).fail(driverInstanceId, message);
}

export async function destroyDriverInstanceDurableObject(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  reason: string,
): Promise<void> {
  await getDriverConnectionStub(env, driverInstanceId).destroy(driverInstanceId, reason);
}
