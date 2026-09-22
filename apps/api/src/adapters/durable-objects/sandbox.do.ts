import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

import { SandboxStartup } from "../../platform/cloudflare/sandbox-startup";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import {
  configureSandboxNetworkConstraints,
  restoreSandboxNetworkEnforcement,
} from "./sandbox-network-enforcement";
import type { SandboxNetworkDelegate } from "./sandbox-network-enforcement";
import { waitForSandboxNetworkRestore } from "./sandbox-network-restore-gate";
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

export class Sandbox extends DurableObject {
  readonly #delegatePromise: Promise<SandboxDelegate>;
  readonly #httpsInterceptionDisabled: boolean;
  readonly #networkRestorePromise: Promise<void>;
  readonly #startupPromise: Promise<SandboxStartup>;

  constructor(ctx: DurableObjectState<{}>, env: ApiBindings) {
    super(ctx, env);

    this.#httpsInterceptionDisabled = env.SANDBOX_FILE_BUCKET_LOCAL === "true";
    this.#delegatePromise = import("@cloudflare/sandbox").then(
      ({ Sandbox: SandboxImplementation }) => new SandboxImplementation(ctx, env),
    );
    // Re-assert the persisted internet switch before any container start. A
    // rejected restore blocks every access/start RPC, while teardown remains
    // available so lifecycle repair can remove the untrusted container.
    this.#networkRestorePromise = this.#delegatePromise.then((delegate) =>
      restoreSandboxNetworkEnforcement(ctx.storage, delegate, {
        httpsInterceptionDisabled: this.#httpsInterceptionDisabled,
      }),
    );
    this.#startupPromise = this.#delegatePromise.then(
      (delegate) =>
        new SandboxStartup(delegate, {
          sandboxId: ctx.id.toString(),
          isRunning: () => (ctx as SandboxContainerState).container?.running === true,
        }),
    );
  }

  async ensureContainerReady(options: { allowRecovery: boolean }): Promise<void> {
    await this.#networkRestorePromise;
    await (await this.#startupPromise).ensureReady(options.allowRecovery);
  }

  async configureNetworkConstraints(constraints: unknown): Promise<void> {
    await this.#networkRestorePromise;
    const delegate = await this.#delegatePromise;

    await configureSandboxNetworkConstraints(this.ctx.storage, delegate, constraints, {
      containerRunning: (this.ctx as SandboxContainerState).container?.running === true,
      httpsInterceptionDisabled: this.#httpsInterceptionDisabled,
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.#networkRestorePromise;
    return (await this.#delegatePromise).fetch(request);
  }

  override async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    await this.#networkRestorePromise;
    await (await this.#delegatePromise).alarm(alarmProps);
  }

  async [FORWARD_SANDBOX_METHOD](
    method: SandboxRpcForwardMethod,
    args: readonly unknown[],
  ): Promise<unknown> {
    await waitForSandboxNetworkRestore(this.#networkRestorePromise, method, args);
    const delegate = await this.#delegatePromise;
    if (method === "destroy") await (await this.#startupPromise).cancelAndDrain();
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
