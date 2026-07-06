import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverInstanceId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type {
  DriverInstanceHelloResult,
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
} from "./state";

const DRIVER_INSTANCE_ID_HEADER = "x-driver-instance-id";
export const RUNTIME_TRACEPARENT_HEADER = "x-traceparent";

type DriverConnectionBinding = NonNullable<ApiBindings["DriverConnection"]>;
type DriverConnectionStub = ReturnType<DriverConnectionBinding["get"]>;

function requireDriverConnectionBinding(env: ApiBindings): DriverConnectionBinding {
  const binding = env.DriverConnection;

  if (binding === undefined) {
    throw new Error("DriverConnection binding is not configured.");
  }

  return binding;
}

function getDriverConnectionStub(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
): DriverConnectionStub {
  const binding = requireDriverConnectionBinding(env);
  return binding.get(binding.idFromName(driverInstanceId));
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json<{ error?: string }>();
    return body.error ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function expectJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json<T>();
}

function createDoRequest(
  driverInstanceId: DriverInstanceId,
  path: string,
  init?: RequestInit,
): Request {
  const headers = new Headers(init?.headers);
  headers.set(DRIVER_INSTANCE_ID_HEADER, driverInstanceId);

  return new Request(`https://driver-instance.internal${path}`, {
    ...init,
    headers,
  });
}

export async function upgradeDriverInstanceSocket(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  request: Request,
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL("https://driver-instance.internal/driver-socket");

  for (const [key, value] of incoming.searchParams) {
    target.searchParams.set(key, value);
  }

  const headers = new Headers(request.headers);
  headers.set(DRIVER_INSTANCE_ID_HEADER, driverInstanceId);

  return getDriverConnectionStub(env, driverInstanceId).fetch(
    new Request(target.toString(), {
      headers,
      method: "GET",
    }),
  );
}

export async function waitForDriverInstanceHello(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  timeoutMs: number,
): Promise<DriverInstanceHelloResult> {
  return expectJson<DriverInstanceHelloResult>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, `/wait/hello?timeoutMs=${timeoutMs}`),
    ),
  );
}

export async function waitForDriverInstanceReady(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  timeoutMs: number,
): Promise<DriverInstanceReadyResult> {
  return expectJson<DriverInstanceReadyResult>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, `/wait/ready?timeoutMs=${timeoutMs}`),
    ),
  );
}

export async function waitForDriverInstanceClose(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  timeoutMs: number,
): Promise<DriverInstanceWaitForCloseResult> {
  return expectJson<DriverInstanceWaitForCloseResult>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, `/wait/close?timeoutMs=${timeoutMs}`),
    ),
  );
}

export async function getDriverInstanceSnapshot(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
): Promise<DriverInstanceSnapshot> {
  return expectJson<DriverInstanceSnapshot>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, "/snapshot"),
    ),
  );
}

export async function sendDriverInstanceCommand(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  command: RuntimeCommand,
): Promise<void> {
  await expectJson<{ ok: true }>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, "/control/send", {
        body: JSON.stringify(command),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    ),
  );
}

export async function failDriverInstance(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  message: string,
): Promise<void> {
  await expectJson<{ ok: true }>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, "/control/fail", {
        body: JSON.stringify({ message }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    ),
  );
}

export async function destroyDriverInstanceDurableObject(
  env: ApiBindings,
  driverInstanceId: DriverInstanceId,
  reason: string,
): Promise<void> {
  await expectJson<{ ok: true }>(
    await getDriverConnectionStub(env, driverInstanceId).fetch(
      createDoRequest(driverInstanceId, "/control/destroy", {
        body: JSON.stringify({ reason }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    ),
  );
}
