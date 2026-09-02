import { isAsyncTimeoutError, promiseWithTimeout } from "@mosoo/effects";
import { DurableObject } from "cloudflare:workers";

import { hashSandboxNetworkConstraints } from "../../modules/runtime/domain/sandbox-network-constraints";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
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
  createBackup(options: {
    dir: string;
    excludes?: string[];
    localBucket?: boolean;
    name?: string;
    ttl?: number;
  }): Promise<{ dir: string; id: string }>;
  createSession(options: { id: string }): Promise<{
    readFile(path: string, options?: { encoding?: "utf8" }): Promise<{ content: string }>;
    terminal(request: Request, options?: unknown): Promise<Response>;
  }>;
  deleteSession(sessionId: string): Promise<unknown>;
  destroy(): Promise<void>;
  exists(path: string): Promise<{
    exists: boolean;
    path: string;
    success: boolean;
    timestamp: string;
  }>;
  fetch(request: Request): Promise<Response>;
  getContainerPlacementId(): Promise<string | null | undefined>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string, options?: { encoding?: "utf8" }): Promise<{ content: string }>;
  setKeepAlive(keepAlive: boolean): Promise<void>;
  writeFile(path: string, content: string): Promise<unknown>;
}

type SandboxContainerState = DurableObjectState<{}> & {
  readonly container?: {
    readonly running?: boolean;
  };
};

const FORWARD_SANDBOX_METHOD = Symbol("forwardSandboxMethod");
const RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY = "mosooRuntimeSubjectIncarnation";
const RUNTIME_SUBJECT_NETWORK_CONSTRAINTS_HASH_STORAGE_KEY =
  "mosooRuntimeSubjectNetworkConstraintsHash";
const RUNTIME_SUBJECT_READY_PLACEMENT_STORAGE_KEY = "mosooRuntimeSubjectReadyPlacement";
const RUNTIME_SUBJECT_RETIRED_STORAGE_KEY = "mosooRuntimeSubjectRetiredAt";
const RUNTIME_SUBJECT_SENTINEL_PATH = "/tmp/.mosoo-runtime-subject-incarnation";
const RUNTIME_SUBJECT_RETIRED_RETRY_DELAY_MS = 5_000;
const RUNTIME_SUBJECT_RETIRED_DESTROY_TIMEOUT_MS = 15_000;

function assertRuntimeSubjectIncarnation(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Runtime subject incarnation must be a non-negative safe integer.");
  }
}

function assertRuntimeSubjectNetworkConstraintsHash(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("Runtime subject network constraints hash must be a SHA-256 digest.");
  }
}

function isRuntimeSubjectSentinelMissing(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && Reflect.get(error, "code") === "FILE_NOT_FOUND"
  );
}

export class Sandbox extends DurableObject {
  readonly #backupCreations = new Map<string, Promise<{ dir: string; id: string }>>();
  readonly #delegatePromise: Promise<SandboxDelegate>;
  readonly #httpsInterceptionDisabled: boolean;
  readonly #networkRestorePromise: Promise<void>;

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
  }

  async configureNetworkConstraints(constraints: unknown): Promise<void> {
    await this.#runUnlessRuntimeSubjectRetired(async () => {
      const networkConstraintsHash = await hashSandboxNetworkConstraints(constraints);
      const admittedHash = await this.ctx.storage.get<string>(
        RUNTIME_SUBJECT_NETWORK_CONSTRAINTS_HASH_STORAGE_KEY,
      );
      if (admittedHash !== networkConstraintsHash) {
        throw new Error("Sandbox network constraints do not match the admitted incarnation.");
      }
      await this.#networkRestorePromise;
      const delegate = await this.#delegatePromise;

      await configureSandboxNetworkConstraints(this.ctx.storage, delegate, constraints, {
        containerRunning: (this.ctx as SandboxContainerState).container?.running === true,
        httpsInterceptionDisabled: this.#httpsInterceptionDisabled,
      });
    });
  }

  override async fetch(request: Request): Promise<Response> {
    return this.#runUnlessRuntimeSubjectRetired(async () => {
      await this.#networkRestorePromise;
      return (await this.#delegatePromise).fetch(request);
    });
  }

  override async alarm(alarmProps?: { isRetry: boolean; retryCount: number }): Promise<void> {
    try {
      if (await this.#isRuntimeSubjectRetired()) {
        return;
      }

      await this.#networkRestorePromise;
      await (await this.#delegatePromise).alarm(alarmProps);
    } finally {
      await this.#destroyRuntimeSubjectContainerIfRetired();
    }
  }

  async activateRuntimeSubjectIncarnation(
    incarnation: number,
    networkConstraintsHash: string,
  ): Promise<void> {
    assertRuntimeSubjectIncarnation(incarnation);
    assertRuntimeSubjectNetworkConstraintsHash(networkConstraintsHash);

    await this.ctx.blockConcurrencyWhile(async () => {
      this.#assertRuntimeSubjectNotRetired(
        await this.ctx.storage.get<number>(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY),
      );
      const [current, currentNetworkConstraintsHash] = await Promise.all([
        this.ctx.storage.get<number>(RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY),
        this.ctx.storage.get<string>(RUNTIME_SUBJECT_NETWORK_CONSTRAINTS_HASH_STORAGE_KEY),
      ]);

      if (current === incarnation && currentNetworkConstraintsHash === networkConstraintsHash) {
        return;
      }
      if (current === undefined && currentNetworkConstraintsHash === undefined) {
        await this.ctx.storage.put({
          [RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY]: incarnation,
          [RUNTIME_SUBJECT_NETWORK_CONSTRAINTS_HASH_STORAGE_KEY]: networkConstraintsHash,
        });
        return;
      }
      throw new Error("Runtime subject incarnation identity does not match this Durable Object.");
    });
  }

  async createRuntimeSubjectBackup(
    incarnation: number,
    options: {
      dir: string;
      excludes?: string[];
      forbiddenPaths?: string[];
      localBucket?: boolean;
      name: string;
      ttl?: number;
    },
  ): Promise<{ dir: string; id: string }> {
    assertRuntimeSubjectIncarnation(incarnation);
    if (options.name.length === 0) {
      throw new TypeError("Runtime subject backup name must not be empty.");
    }

    const key = `${incarnation}:${options.name}`;
    let creation = this.#backupCreations.get(key);
    if (creation === undefined) {
      creation = this.#runUnlessRuntimeSubjectRetired(async () => {
        const current = await this.ctx.storage.get<number>(RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY);
        if (current !== incarnation) {
          throw new Error("Runtime subject backup targeted a stale incarnation.");
        }
        await this.#networkRestorePromise;
        const delegate = await this.#delegatePromise;
        for (const path of options.forbiddenPaths ?? []) {
          const result = await delegate.exists(path);
          if (!result.success) {
            throw new Error("Runtime subject backup secret preflight failed.");
          }
          if (result.exists) {
            throw new Error("Runtime subject backup contains legacy persistent credentials.");
          }
        }
        await delegate.mkdir(options.dir, { recursive: true });
        const { forbiddenPaths: _, ...backupOptions } = options;
        return delegate.createBackup(backupOptions);
      });
      this.#backupCreations.set(key, creation);
    }
    try {
      const backup = await creation;
      if (backup.dir !== options.dir) {
        throw new Error("Runtime subject backup name was reused for a different directory.");
      }
      return backup;
    } finally {
      if (this.#backupCreations.get(key) === creation) {
        this.#backupCreations.delete(key);
      }
    }
  }

  async inspectRuntimeSubjectIncarnation(
    incarnation: number,
    networkConstraintsHash: string,
  ): Promise<{ kind: "healthy" | "missing" | "retired" | "stale" | "unknown" }> {
    assertRuntimeSubjectIncarnation(incarnation);
    assertRuntimeSubjectNetworkConstraintsHash(networkConstraintsHash);
    const before = await this.#readRuntimeSubjectReadyState();
    if (before.retired) {
      return { kind: "retired" };
    }
    if (
      before.incarnation !== incarnation ||
      before.networkConstraintsHash !== networkConstraintsHash
    ) {
      return { kind: "stale" };
    }
    if (before.placement === undefined) {
      return { kind: "unknown" };
    }

    let health: "healthy" | "missing" | "unknown";
    try {
      health = await this.#readyRuntimeSubjectHealth(
        incarnation,
        networkConstraintsHash,
        before.placement,
      );
    } finally {
      await this.#destroyRuntimeSubjectContainerIfRetired();
    }
    const after = await this.#readRuntimeSubjectReadyState();
    if (after.retired) {
      return { kind: "retired" };
    }
    if (
      after.incarnation !== incarnation ||
      after.networkConstraintsHash !== networkConstraintsHash
    ) {
      return { kind: "stale" };
    }
    return { kind: after.placement === before.placement ? health : "unknown" };
  }

  async markRuntimeSubjectIncarnationReady(
    incarnation: number,
    networkConstraintsHash: string,
  ): Promise<void> {
    assertRuntimeSubjectIncarnation(incarnation);
    assertRuntimeSubjectNetworkConstraintsHash(networkConstraintsHash);

    const before = await this.#readRuntimeSubjectReadyState();
    if (before.retired) {
      throw new Error("Runtime subject incarnation is retired.");
    }
    if (
      before.incarnation !== incarnation ||
      before.networkConstraintsHash !== networkConstraintsHash
    ) {
      throw new Error("Runtime subject readiness targeted a stale incarnation.");
    }
    if ((this.ctx as SandboxContainerState).container?.running !== true) {
      throw new Error("Runtime subject container stopped before readiness was recorded.");
    }

    try {
      await this.#networkRestorePromise;
      const delegate = await this.#delegatePromise;
      await delegate.writeFile(
        RUNTIME_SUBJECT_SENTINEL_PATH,
        `${incarnation}:${networkConstraintsHash}`,
      );
      const placement = await delegate.getContainerPlacementId();
      if (placement === undefined) {
        throw new Error("Runtime subject container placement is not available.");
      }

      await this.ctx.blockConcurrencyWhile(async () => {
        this.#assertRuntimeSubjectNotRetired(
          await this.ctx.storage.get<number>(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY),
        );
        const [current, currentNetworkConstraintsHash] = await Promise.all([
          this.ctx.storage.get<number>(RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY),
          this.ctx.storage.get<string>(RUNTIME_SUBJECT_NETWORK_CONSTRAINTS_HASH_STORAGE_KEY),
        ]);
        if (current !== incarnation || currentNetworkConstraintsHash !== networkConstraintsHash) {
          throw new Error("Runtime subject readiness targeted a stale incarnation.");
        }
        if ((this.ctx as SandboxContainerState).container?.running !== true) {
          throw new Error("Runtime subject container stopped before readiness was recorded.");
        }
        await this.ctx.storage.put(RUNTIME_SUBJECT_READY_PLACEMENT_STORAGE_KEY, placement);
      });
    } finally {
      await this.#destroyRuntimeSubjectContainerIfRetired();
    }
  }

  async destroyRuntimeSubjectIncarnation(
    incarnation: number,
  ): Promise<{ kind: "destroyed" | "stale" }> {
    assertRuntimeSubjectIncarnation(incarnation);

    const stale = await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.ctx.storage.get<number>(RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY);

      if (current !== undefined && current !== incarnation) {
        return true;
      }
      if (current === undefined) {
        await this.ctx.storage.put(RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY, incarnation);
      }

      await this.ctx.storage.put(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY, Date.now());
      await this.ctx.storage.setAlarm(Date.now() + RUNTIME_SUBJECT_RETIRED_RETRY_DELAY_MS);
      return false;
    });
    if (stale) {
      return { kind: "stale" };
    }

    await this.#destroyRetiredRuntimeSubjectContainer();
    return { kind: "destroyed" };
  }

  async #isRuntimeSubjectRetired(): Promise<boolean> {
    return (await this.ctx.storage.get<number>(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY)) !== undefined;
  }

  async #readyRuntimeSubjectHealth(
    incarnation: number,
    networkConstraintsHash: string,
    readyPlacement: string | null,
  ): Promise<"healthy" | "missing" | "unknown"> {
    if ((this.ctx as SandboxContainerState).container?.running !== true) {
      return "missing";
    }

    const delegate = await this.#delegatePromise;
    try {
      await this.#networkRestorePromise;
      // The SDK placement id is cached in DO storage and survives onStop.
      // A sentinel read forces a real container handshake before we trust it.
      const sentinel = await delegate.readFile(RUNTIME_SUBJECT_SENTINEL_PATH, {
        encoding: "utf8",
      });
      const placement = await delegate.getContainerPlacementId();
      if ((this.ctx as SandboxContainerState).container?.running !== true) {
        return "missing";
      }
      if (sentinel.content !== `${incarnation}:${networkConstraintsHash}`) {
        return "missing";
      }
      if (typeof placement === "string" && typeof readyPlacement === "string") {
        return placement === readyPlacement ? "healthy" : "missing";
      }
      if (placement !== null || readyPlacement !== null) {
        return "unknown";
      }
      return "healthy";
    } catch (error) {
      if ((this.ctx as SandboxContainerState).container?.running !== true) {
        return "missing";
      }
      try {
        const placement = await delegate.getContainerPlacementId();
        if (
          typeof placement === "string" &&
          typeof readyPlacement === "string" &&
          placement !== readyPlacement
        ) {
          return "missing";
        }
      } catch {
        // Preserve the original, more informative health failure below.
      }
      return isRuntimeSubjectSentinelMissing(error) ? "missing" : "unknown";
    }
  }

  #assertRuntimeSubjectNotRetired(retiredAt: number | undefined): void {
    if (retiredAt !== undefined) {
      throw new Error("Runtime subject incarnation is retired.");
    }
  }

  async #destroyRetiredRuntimeSubjectContainer(): Promise<void> {
    try {
      const delegate = await this.#delegatePromise;
      await promiseWithTimeout(
        (async () => {
          await delegate.setKeepAlive(false);
          await delegate.destroy();
        })(),
        {
          label: "Runtime subject retired container destroy",
          timeoutMs: RUNTIME_SUBJECT_RETIRED_DESTROY_TIMEOUT_MS,
        },
      );
    } catch (error) {
      await this.ctx.storage.setAlarm(Date.now() + RUNTIME_SUBJECT_RETIRED_RETRY_DELAY_MS);
      if (isAsyncTimeoutError(error)) {
        this.ctx.abort("Runtime subject retired container destroy timed out.", {
          retryAlarm: true,
        });
      }
      throw error;
    }
  }

  async #destroyRuntimeSubjectContainerIfRetired(): Promise<void> {
    if (await this.#isRuntimeSubjectRetired()) {
      await this.#destroyRetiredRuntimeSubjectContainer();
    }
  }

  async #assertReadyRuntimeSubjectContainerHealthy(): Promise<{
    readonly incarnation: number | undefined;
    readonly networkConstraintsHash: string | undefined;
    readonly placement: string | null | undefined;
    readonly retired: boolean;
  }> {
    const before = await this.#readRuntimeSubjectReadyState();
    if (before.retired) {
      throw new Error("Runtime subject incarnation is retired.");
    }
    if (before.incarnation === undefined || before.placement === undefined) {
      return before;
    }
    let health: "healthy" | "missing" | "unknown";
    try {
      if (before.networkConstraintsHash === undefined) {
        throw new Error("Runtime subject ready container has no network identity.");
      }
      health = await this.#readyRuntimeSubjectHealth(
        before.incarnation,
        before.networkConstraintsHash,
        before.placement,
      );
    } finally {
      await this.#destroyRuntimeSubjectContainerIfRetired();
    }
    const after = await this.#readRuntimeSubjectReadyState();
    if (
      after.retired ||
      after.incarnation !== before.incarnation ||
      after.networkConstraintsHash !== before.networkConstraintsHash ||
      after.placement !== before.placement
    ) {
      throw new Error("Runtime subject incarnation changed during its health probe.");
    }
    if (health === "healthy") {
      return after;
    }
    if (health === "unknown") {
      throw new Error("Runtime subject ready container health is unknown.");
    }

    await this.ctx.blockConcurrencyWhile(async () => {
      const current = await this.#readRuntimeSubjectReadyStateWithoutGate();
      if (
        current.retired ||
        current.incarnation !== before.incarnation ||
        current.networkConstraintsHash !== before.networkConstraintsHash ||
        current.placement !== before.placement
      ) {
        throw new Error("Runtime subject incarnation changed before retirement.");
      }
      await this.ctx.storage.put(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY, Date.now());
      await this.ctx.storage.setAlarm(Date.now() + RUNTIME_SUBJECT_RETIRED_RETRY_DELAY_MS);
    });
    throw new Error("Runtime subject ready container was replaced or stopped.");
  }

  async #readRuntimeSubjectReadyState(): Promise<{
    readonly incarnation: number | undefined;
    readonly networkConstraintsHash: string | undefined;
    readonly placement: string | null | undefined;
    readonly retired: boolean;
  }> {
    return this.ctx.blockConcurrencyWhile(() => this.#readRuntimeSubjectReadyStateWithoutGate());
  }

  async #readRuntimeSubjectReadyStateWithoutGate(): Promise<{
    readonly incarnation: number | undefined;
    readonly networkConstraintsHash: string | undefined;
    readonly placement: string | null | undefined;
    readonly retired: boolean;
  }> {
    const [incarnation, networkConstraintsHash, placement, retiredAt] = await Promise.all([
      this.ctx.storage.get<number>(RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY),
      this.ctx.storage.get<string>(RUNTIME_SUBJECT_NETWORK_CONSTRAINTS_HASH_STORAGE_KEY),
      this.ctx.storage.get<string | null>(RUNTIME_SUBJECT_READY_PLACEMENT_STORAGE_KEY),
      this.ctx.storage.get<number>(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY),
    ]);
    return { incarnation, networkConstraintsHash, placement, retired: retiredAt !== undefined };
  }

  #guardRuntimeSubjectProcess(process: unknown): unknown {
    if (typeof process !== "object" || process === null) {
      throw new TypeError("Cloudflare Sandbox process handle is not an object.");
    }
    return this.#guardRuntimeSubjectRpcTarget(process);
  }

  #guardRuntimeSubjectForwardResult(method: string, result: unknown): unknown {
    if (method === "createSession" || method === "getSession") {
      return this.#guardRuntimeSubjectExecutionSession(result);
    }
    if (method === "startProcess") {
      return this.#guardRuntimeSubjectProcess(result);
    }
    if (method === "getProcess") {
      return result === null ? null : this.#guardRuntimeSubjectProcess(result);
    }
    if (method === "listProcesses") {
      if (!Array.isArray(result)) {
        throw new TypeError("Cloudflare Sandbox process list is not an array.");
      }
      return result.map((process) => this.#guardRuntimeSubjectProcess(process));
    }
    return result;
  }

  #guardRuntimeSubjectExecutionSession(session: unknown): unknown {
    if (typeof session !== "object" || session === null) {
      throw new TypeError("Cloudflare Sandbox execution session is not an object.");
    }
    return this.#guardRuntimeSubjectRpcTarget(session);
  }

  #guardRuntimeSubjectRpcTarget(target: object): object {
    const facade: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(target)) {
      const value = Reflect.get(target, key);
      Reflect.set(
        facade,
        key,
        typeof value === "function"
          ? (...args: unknown[]) =>
              this.#runUnlessRuntimeSubjectRetired(async () => {
                const result = await (Reflect.apply(
                  value,
                  target,
                  this.#guardRuntimeSubjectInvocationArgs(String(key), args),
                ) as Promise<unknown>);
                return this.#guardRuntimeSubjectForwardResult(String(key), result);
              })
          : value,
      );
    }
    return facade;
  }

  #guardRuntimeSubjectInvocationArgs(method: string, args: readonly unknown[]): readonly unknown[] {
    if (method !== "startProcess") {
      return args;
    }
    const options = args[1];
    if (typeof options !== "object" || options === null) {
      return args;
    }
    const onStart = Reflect.get(options, "onStart");
    if (typeof onStart !== "function") {
      return args;
    }
    const guardedOptions = {
      ...options,
      onStart: (process: unknown) =>
        Reflect.apply(onStart, options, [this.#guardRuntimeSubjectProcess(process)]),
    };
    return [args[0], guardedOptions, ...args.slice(2)];
  }

  async #runUnlessRuntimeSubjectRetired<T>(task: () => Promise<T>): Promise<T> {
    const failures: unknown[] = [];
    let retired = false;
    let result: T | undefined;
    try {
      const before = await this.#assertReadyRuntimeSubjectContainerHealthy();

      try {
        result = await task();
      } catch (error) {
        failures.push(error);
      }

      try {
        retired = await this.#isRuntimeSubjectRetired();
        if (!retired) {
          const after = await this.#assertReadyRuntimeSubjectContainerHealthy();
          if (
            before.incarnation !== after.incarnation ||
            before.networkConstraintsHash !== after.networkConstraintsHash ||
            before.placement !== after.placement
          ) {
            await this.ctx.blockConcurrencyWhile(async () => {
              await this.ctx.storage.put(RUNTIME_SUBJECT_RETIRED_STORAGE_KEY, Date.now());
              await this.ctx.storage.setAlarm(Date.now() + RUNTIME_SUBJECT_RETIRED_RETRY_DELAY_MS);
            });
            throw new Error("Runtime subject incarnation changed during the operation.");
          }
        }
      } catch (error) {
        failures.push(error);
      }
    } catch (error) {
      failures.push(error);
    }

    if (!retired) {
      try {
        retired = await this.#isRuntimeSubjectRetired();
      } catch (error) {
        failures.push(error);
      }
    }
    if (retired) {
      if (failures.length === 0) {
        failures.push(new Error("Runtime subject incarnation was retired during the operation."));
      }
      try {
        await this.#destroyRetiredRuntimeSubjectContainer();
      } catch (error) {
        failures.push(error);
      }
    }

    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, "Runtime subject operation failed in multiple phases.");
    }
    return result as T;
  }

  async [FORWARD_SANDBOX_METHOD](
    method: SandboxRpcForwardMethod,
    args: readonly unknown[],
  ): Promise<unknown> {
    return this.#runUnlessRuntimeSubjectRetired(async () => {
      await waitForSandboxNetworkRestore(this.#networkRestorePromise, method, args);
      const delegate = await this.#delegatePromise;
      const action = Reflect.get(delegate, method);

      if (typeof action !== "function") {
        throw new TypeError(`Cloudflare Sandbox delegate is missing ${method}.`);
      }

      const result = await (Reflect.apply(
        action,
        delegate,
        this.#guardRuntimeSubjectInvocationArgs(method, args),
      ) as Promise<unknown>);
      const runtimeSubjectIncarnation = await this.ctx.storage.get<number>(
        RUNTIME_SUBJECT_INCARNATION_STORAGE_KEY,
      );
      if (runtimeSubjectIncarnation !== undefined) {
        return this.#guardRuntimeSubjectForwardResult(method, result);
      }
      return result;
    });
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
