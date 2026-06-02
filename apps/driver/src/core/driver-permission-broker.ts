import type { DriverEventInput } from "@mosoo/driver-protocol";
import { createPromiseDeferred, settlePromiseWithTimeout } from "@mosoo/effects";
import type { Logger } from "@mosoo/observability";

import { summarizeDriverPermissionRequest } from "../infrastructure/logging/driver-debug";
import type { DriverInstanceSocket } from "../infrastructure/runtime/driver-instance-socket";

const PERMISSION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export type PermissionDecision = "allow_once" | "reject_once";

export interface DriverPermissionRequest {
  rawInput: string | null;
  requestId: string;
  title: string;
  toolCallId: string | null;
  toolKind: string | null;
}

export interface DriverPermissionBrokerOptions {
  interactiveRequests?: boolean;
  requestTimeoutMs?: number;
}

export class DriverPermissionBroker {
  readonly #interactiveRequests: boolean;
  readonly #logger: () => Logger | null;
  readonly #requestTimeoutMs: number;
  readonly #resolvers = new Map<string, (decision: PermissionDecision) => void>();

  constructor(logger: () => Logger | null, options: DriverPermissionBrokerOptions = {}) {
    this.#interactiveRequests = options.interactiveRequests ?? true;
    this.#logger = logger;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? PERMISSION_REQUEST_TIMEOUT_MS;
  }

  capabilityStatus(): "supported" | "unsupported" {
    return this.#interactiveRequests ? "supported" : "unsupported";
  }

  resolve(requestId: string, decision: PermissionDecision): boolean {
    const resolve = this.#resolvers.get(requestId);

    if (!resolve) {
      return false;
    }

    this.#resolvers.delete(requestId);
    resolve(decision);
    return true;
  }

  rejectAll(): void {
    for (const requestId of this.#resolvers.keys()) {
      this.resolve(requestId, "reject_once");
    }
  }

  async request(
    socket: DriverInstanceSocket,
    input: DriverPermissionRequest,
  ): Promise<PermissionDecision> {
    if (!this.#interactiveRequests) {
      this.#logger()?.debug("driver.runtime.permission.request.rejected", {
        ...summarizeDriverPermissionRequest(input),
        reason: "interactive_permission_unsupported",
      });
      return "reject_once";
    }

    const events: DriverEventInput[] = [
      {
        kind: "permission.requested",
        payload: {
          details: input.rawInput,
          options: [],
          requestId: input.requestId,
          targetItemId: input.toolCallId,
          title: input.title,
          toolCall: {
            kind: input.toolKind,
            toolCallId: input.toolCallId,
          },
        },
      },
    ];
    const deferred = createPromiseDeferred<PermissionDecision>();
    this.#resolvers.set(input.requestId, deferred.resolve);

    try {
      this.#logger()?.debug("driver.runtime.permission.request.sending", {
        ...summarizeDriverPermissionRequest(input),
        timeoutMs: this.#requestTimeoutMs,
      });

      await socket.pushEvents({ events });
      this.#logger()?.debug("driver.runtime.permission.request.sent", {
        requestId: input.requestId,
        timeoutMs: this.#requestTimeoutMs,
        toolCallId: input.toolCallId,
        toolKind: input.toolKind,
      });

      const result = await settlePromiseWithTimeout(deferred.promise, {
        label: `Driver permission request ${input.requestId}`,
        timeoutMs: this.#requestTimeoutMs,
      });

      if (result.status === "failed") {
        throw result.error;
      }

      const decision = result.status === "timed_out" ? "reject_once" : result.value;

      if (result.status === "timed_out") {
        this.#logger()?.debug("driver.runtime.permission.request.timed_out", {
          requestId: input.requestId,
          timeoutMs: this.#requestTimeoutMs,
        });
      }

      await socket.pushEvents({
        events: [
          {
            kind: "permission.resolved",
            payload: {
              outcome: decision,
              permissionRequests: [],
              requestId: input.requestId,
            },
          },
        ],
      });

      this.#logger()?.debug("driver.runtime.permission.request.resolved", {
        decision,
        requestId: input.requestId,
      });

      return decision;
    } finally {
      this.#resolvers.delete(input.requestId);
    }
  }
}
