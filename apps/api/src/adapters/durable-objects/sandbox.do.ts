import { DurableObject } from "cloudflare:workers";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { SANDBOX_RPC_FORWARD_METHODS } from "./sandbox-rpc-methods";
import type { SandboxRpcForwardMethod } from "./sandbox-rpc-methods";

interface SandboxDelegate {
  alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

const FORWARD_SANDBOX_METHOD = Symbol("forwardSandboxMethod");

export class Sandbox extends DurableObject {
  readonly #delegatePromise: Promise<SandboxDelegate>;

  constructor(ctx: DurableObjectState<{}>, env: ApiBindings) {
    super(ctx, env);

    this.#delegatePromise = import("@cloudflare/sandbox").then(
      ({ Sandbox: SandboxImplementation }) => new SandboxImplementation(ctx, env),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    return (await this.#delegatePromise).fetch(request);
  }

  override async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    await (await this.#delegatePromise).alarm(alarmProps);
  }

  async [FORWARD_SANDBOX_METHOD](
    method: SandboxRpcForwardMethod,
    args: readonly unknown[],
  ): Promise<unknown> {
    const delegate = await this.#delegatePromise;
    const action = Reflect.get(delegate, method);

    if (typeof action !== "function") {
      throw new TypeError(`Cloudflare Sandbox delegate is missing ${method}.`);
    }

    return await (Reflect.apply(action, delegate, args) as Promise<unknown>);
  }
}

for (const method of SANDBOX_RPC_FORWARD_METHODS) {
  Object.defineProperty(Sandbox.prototype, method, {
    configurable: true,
    value(this: Sandbox, ...args: unknown[]): Promise<unknown> {
      return this[FORWARD_SANDBOX_METHOD](method, args);
    },
  });
}
