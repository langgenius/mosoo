import type { Sandbox } from "@cloudflare/sandbox";
import { promiseWithTimeout, sleepPromise } from "@mosoo/effects";

import { createErrorLogContext, logInfo, logWarn } from "./logger";

// Keep the existing 15s attempt deadline. A cold, pre-Driver subject may use
// one more attempt after confirmed teardown; this is not a Run/input retry.
const STARTUP_ATTEMPT_TIMEOUT_MS = 15_000;
export const SANDBOX_STARTUP_RPC_TIMEOUT_MS = 60_000;

type SandboxStartupDelegate = Pick<Sandbox, "destroy" | "getState" | "startAndWaitForPorts">;

function canRetryContainerStartup(error: unknown): boolean {
  // @cloudflare/containers 0.3.7 can throw undefined when its failed startup
  // monitor was already cleared. Production logged this from doStartContainer.
  if (error === undefined) return true;
  if (!(error instanceof Error)) return false;
  return /internal error|network connection lost|container suddenly disconnected|no container instance|container did not start|container request aborted|cancellation signal|timed out/i.test(
    error.message,
  );
}

/** Own startup cancellation so teardown cannot race a still-starting container. */
export class SandboxStartup {
  #pending: { controller: AbortController; promise: Promise<void> } | null = null;

  readonly #delegate: SandboxStartupDelegate;
  readonly #context: { sandboxId: string; isRunning: () => boolean };
  readonly #attemptTimeoutMs: number;

  constructor(
    delegate: SandboxStartupDelegate,
    context: { sandboxId: string; isRunning: () => boolean },
    attemptTimeoutMs = STARTUP_ATTEMPT_TIMEOUT_MS,
  ) {
    this.#delegate = delegate;
    this.#context = context;
    this.#attemptTimeoutMs = attemptTimeoutMs;
  }

  async ensureReady(allowRecovery: boolean): Promise<void> {
    if (this.#pending) return this.#pending.promise;

    const controller = new AbortController();
    const promise = this.#start(allowRecovery, controller.signal);
    const pending = { controller, promise };
    this.#pending = pending;
    try {
      await promise;
    } finally {
      if (this.#pending === pending) this.#pending = null;
    }
  }

  async cancelAndDrain(): Promise<void> {
    const pending = this.#pending;
    if (!pending) return;
    pending.controller.abort();
    // If cancellation does not settle, do not confirm destroy/cold and do not
    // start another attempt. The lifecycle repair loop retains ownership.
    await promiseWithTimeout(
      pending.promise.catch(() => undefined),
      { label: "Runtime subject startup cancellation", timeoutMs: STARTUP_ATTEMPT_TIMEOUT_MS },
    );
  }

  async #start(allowRecovery: boolean, signal: AbortSignal): Promise<void> {
    const state = await this.#delegate.getState();
    signal.throwIfAborted();
    if (state.status === "healthy" && this.#context.isRunning()) return;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      signal.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const startedAt = Date.now();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.#attemptTimeoutMs);
      let failure: { error: unknown } | null = null;

      try {
        // Starting explicitly keeps SDK HTTP/default-session retries out of
        // mkdir. Unlike a caller-side Promise.race, the signal reaches the
        // actual instance/port waits before cleanup or recovery can begin.
        await this.#delegate.startAndWaitForPorts({
          ports: 3000,
          cancellationOptions: {
            abort: controller.signal,
            instanceGetTimeoutMS: this.#attemptTimeoutMs,
            portReadyTimeoutMS: this.#attemptTimeoutMs,
          },
        });
        signal.throwIfAborted();
        if (timedOut) throw new Error("Container startup timed out.");
      } catch (error) {
        failure = { error };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }

      const metadata = {
        attempt,
        durationMs: Date.now() - startedAt,
        containerRunning: this.#context.isRunning(),
        sandboxId: this.#context.sandboxId,
        timedOut,
      };
      if (!failure) {
        logInfo("runtime.subject.container_start.ready", metadata);
        return;
      }

      logWarn("runtime.subject.container_start.failed", {
        ...metadata,
        ...createErrorLogContext(failure.error),
      });
      const detail = timedOut
        ? `timed out after ${this.#attemptTimeoutMs}ms`
        : failure.error instanceof Error
          ? failure.error.message
          : "Cloudflare returned no startup error detail";
      const error = new Error(`Runtime subject container startup attempt ${attempt} ${detail}.`, {
        cause: failure.error,
      });
      if (
        signal.aborted ||
        !allowRecovery ||
        attempt === 2 ||
        (!timedOut && !canRetryContainerStartup(failure.error))
      ) {
        throw error;
      }

      await promiseWithTimeout(this.#delegate.destroy(), {
        label: "Runtime subject startup recovery destroy",
        timeoutMs: STARTUP_ATTEMPT_TIMEOUT_MS,
      });
      logInfo("runtime.subject.container_start.recovering", metadata);
      await sleepPromise(1_000);
    }
  }
}
