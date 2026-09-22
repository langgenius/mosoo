import { DurableObject } from "cloudflare:workers";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { SandboxHandleGuard } from "./sandbox-handle-guard";
import {
  configureSandboxNetworkConstraints,
  restoreSandboxNetworkEnforcement,
} from "./sandbox-network-enforcement";
import type { SandboxNetworkDelegate } from "./sandbox-network-enforcement";
import { waitForSandboxNetworkRestore } from "./sandbox-network-restore-gate";
import { SANDBOX_RPC_FORWARD_METHODS } from "./sandbox-rpc-methods";
import type { SandboxRpcForwardMethod } from "./sandbox-rpc-methods";

interface SandboxDelegate extends SandboxNetworkDelegate {
  alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

type SandboxContainerState = DurableObjectState<{}> & {
  readonly container?: {
    readonly running?: boolean;
  };
};

const FORWARD_SANDBOX_METHOD = Symbol("forwardSandboxMethod");

export interface SandboxContainerObservation {
  readonly state: "running" | "stopped" | "unavailable";
  readonly observedAt: number;
}

export class Sandbox extends DurableObject<ApiBindings> {
  readonly #handleGuard = new SandboxHandleGuard();
  #initialization?: {
    delegate: Promise<SandboxDelegate>;
    networkRestore: Promise<void>;
  };
  readonly #httpsInterceptionDisabled: boolean;

  constructor(ctx: DurableObjectState<{}>, env: ApiBindings) {
    super(ctx, env);

    this.#httpsInterceptionDisabled = env.SANDBOX_FILE_BUCKET_LOCAL === "true";
  }

  getContainerObservation(): SandboxContainerObservation {
    const running = (this.ctx as SandboxContainerState).container?.running;
    return {
      state: running === true ? "running" : running === false ? "stopped" : "unavailable",
      observedAt: Date.now(),
    };
  }

  #initializeDelegate() {
    if (this.#initialization) return this.#initialization;

    // Observation must not initialize the SDK: its constructor restores lifetime
    // settings and schedules alarms, even when the container is stopped.
    const delegate = import("@cloudflare/sandbox").then(
      ({ Sandbox: SandboxImplementation }) => new SandboxImplementation(this.ctx, this.env),
    );
    // Re-assert the persisted internet switch before any container start. A
    // rejected restore blocks every access/start RPC, while teardown remains
    // available so lifecycle repair can remove the untrusted container.
    const networkRestore = delegate.then((sandbox) =>
      restoreSandboxNetworkEnforcement(this.ctx.storage, sandbox, {
        httpsInterceptionDisabled: this.#httpsInterceptionDisabled,
      }),
    );
    this.#initialization = { delegate, networkRestore };
    return this.#initialization;
  }

  async configureNetworkConstraints(constraints: unknown): Promise<void> {
    const initialization = this.#initializeDelegate();
    await initialization.networkRestore;
    const delegate = await initialization.delegate;

    await configureSandboxNetworkConstraints(this.ctx.storage, delegate, constraints, {
      containerRunning: (this.ctx as SandboxContainerState).container?.running === true,
      httpsInterceptionDisabled: this.#httpsInterceptionDisabled,
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const initialization = this.#initializeDelegate();
    await initialization.networkRestore;
    return (await initialization.delegate).fetch(request);
  }

  override async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    const initialization = this.#initializeDelegate();
    await initialization.networkRestore;
    await (await initialization.delegate).alarm(alarmProps);
  }

  async [FORWARD_SANDBOX_METHOD](
    method: SandboxRpcForwardMethod,
    args: readonly unknown[],
  ): Promise<unknown> {
    const action = () => this.#invokeDelegate(method, args);
    return method === "destroy"
      ? this.#handleGuard.destroy(action)
      : this.#handleGuard.capture(action);
  }

  async #invokeDelegate(
    method: SandboxRpcForwardMethod,
    args: readonly unknown[],
  ): Promise<unknown> {
    const initialization = this.#initializeDelegate();
    await waitForSandboxNetworkRestore(initialization.networkRestore, method, args);
    const delegate = await initialization.delegate;
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

// Distinct physical namespaces share the exact same lifecycle and network
// enforcement. Wrangler selects the preinstalled native runtime for each class.
export class SandboxClaude extends Sandbox {}
export class SandboxOpenAI extends Sandbox {}
export class SandboxOpenCode extends Sandbox {}
