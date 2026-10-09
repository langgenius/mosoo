import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

import type { SandboxNetworkConstraints } from "../../modules/runtime/domain/sandbox-network-constraints";
import { isRuntimeSandboxLocalBucketEnabled } from "../../modules/runtime/infrastructure/runtime-sandbox-bucket-mount";
import { SandboxStartup } from "../../platform/cloudflare/sandbox-startup";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { SandboxHandleGuard } from "./sandbox-handle-guard";
import {
  configureSandboxNetworkConstraints,
  restoreSandboxNetworkEnforcement,
} from "./sandbox-network-enforcement";
import type { SandboxNetworkDelegate } from "./sandbox-network-enforcement";
import { SANDBOX_RPC_FORWARD_METHODS } from "./sandbox-rpc-methods";
import type { SandboxRpcForwardMethod } from "./sandbox-rpc-methods";

interface SandboxDelegate
  extends
    SandboxNetworkDelegate,
    Pick<CloudflareSandbox, "destroy" | "getState" | "startAndWaitForPorts"> {
  alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

type SandboxContainerState = DurableObjectState<{}> & {
  readonly container?: {
    readonly running?: boolean;
  };
};

const FORWARD_SANDBOX_METHOD = Symbol("forwardSandboxMethod");

export class Sandbox extends DurableObject<ApiBindings> {
  readonly #delegate: Promise<SandboxDelegate>;
  readonly #handleGuard = new SandboxHandleGuard();
  readonly #httpsInterceptionDisabled: boolean;
  readonly #networkRestore: Promise<void>;
  readonly #startup: Promise<SandboxStartup>;

  constructor(ctx: DurableObjectState<{}>, env: ApiBindings) {
    super(ctx, env);

    this.#httpsInterceptionDisabled = isRuntimeSandboxLocalBucketEnabled(env);
    this.#delegate = import("@cloudflare/sandbox").then(
      ({ Sandbox: SandboxImplementation }) => new SandboxImplementation(ctx, env),
    );
    // Re-assert the persisted internet switch before any container start. Every
    // entry point waits for it, teardown included.
    this.#networkRestore = this.#delegate.then((delegate) =>
      restoreSandboxNetworkEnforcement(ctx.storage, delegate),
    );
    this.#startup = this.#delegate.then(
      (delegate) =>
        new SandboxStartup(delegate, {
          sandboxId: ctx.id.toString(),
          isRunning: () => (ctx as SandboxContainerState).container?.running === true,
        }),
    );
  }

  async ensureContainerReady(options: { allowRecovery: boolean }): Promise<void> {
    await this.#networkRestore;
    await (await this.#startup).ensureReady(options.allowRecovery);
  }

  async configureNetworkConstraints(constraints: SandboxNetworkConstraints): Promise<void> {
    await this.#networkRestore;
    await configureSandboxNetworkConstraints(this.ctx.storage, await this.#delegate, constraints, {
      httpsInterceptionDisabled: this.#httpsInterceptionDisabled,
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.#networkRestore;
    return (await this.#delegate).fetch(request);
  }

  override async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    await this.#networkRestore;
    await (await this.#delegate).alarm(alarmProps);
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
    await this.#networkRestore;
    const delegate = await this.#delegate;
    if (method === "destroy") await (await this.#startup).cancelAndDrain();
    const action = Reflect.get(delegate, method) as (...args: unknown[]) => Promise<unknown>;
    return await Reflect.apply(action, delegate, args);
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
export class SandboxPi extends Sandbox {}
