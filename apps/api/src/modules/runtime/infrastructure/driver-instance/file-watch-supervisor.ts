import type { AccountId, AgentId, DriverInstanceId, SandboxId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { getRuntimeConversationSession } from "../runtime-subject-lifecycle/runtime-subject-store";
import { watchRuntimeSandboxFiles } from "../sandbox-file-watch.service";
import { parseSandboxConversationSpaceAliases } from "../sandbox-session/sandbox-conversation-session-codec";
import type { RuntimeSessionLink } from "./events";

interface DriverInstanceFileWatchSupervisorOptions {
  env: ApiBindings;
  getDriverInstanceId: () => DriverInstanceId;
  onFailure: (error: unknown, link: RuntimeSessionLink) => Promise<void> | void;
}

export class DriverInstanceFileWatchSupervisor {
  #abortController: AbortController | null = null;
  readonly #env: ApiBindings;
  readonly #getDriverInstanceId: () => DriverInstanceId;
  readonly #onFailure: (error: unknown, link: RuntimeSessionLink) => Promise<void> | void;
  #task: Promise<void> | null = null;

  constructor(options: DriverInstanceFileWatchSupervisorOptions) {
    this.#env = options.env;
    this.#getDriverInstanceId = options.getDriverInstanceId;
    this.#onFailure = options.onFailure;
  }

  ensureStarted(link: RuntimeSessionLink): void {
    if (this.#task) {
      return;
    }

    if (!hasFileWatchLinkFields(link)) {
      return;
    }

    const controller = new AbortController();
    this.#abortController = controller;
    const task = this.#runSafely(link, controller);

    this.#task = task;
  }

  stop(): void {
    this.#abortController?.abort();
    this.#abortController = null;
  }

  async #run(link: RuntimeSessionLink, signal: AbortSignal): Promise<void> {
    if (!hasFileWatchLinkFields(link)) {
      return;
    }

    const sandboxSession = await getRuntimeConversationSession(this.#env.DB, link.sessionId);

    if (sandboxSession?.status !== "active") {
      return;
    }

    const sandbox = await getRuntimeSubjectKeepAliveHandle(this.#env, link.sandboxId);
    const spaceAliases = parseSandboxConversationSpaceAliases(sandboxSession.spaceAliasesJson);

    await watchRuntimeSandboxFiles({
      bindings: this.#env,
      agentId: link.agentId,
      driverInstanceId: this.#getDriverInstanceId(),
      executionOwnerUserId: link.executionOwnerId,
      sandbox,
      sessionId: link.sessionId,
      signal,
      spaceAliases,
    });
  }

  async #runSafely(link: RuntimeSessionLink, controller: AbortController): Promise<void> {
    try {
      await this.#run(link, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        await this.#onFailure(error, link);
      }
    } finally {
      if (this.#abortController === controller) {
        this.#task = null;
        this.#abortController = null;
      }
    }
  }
}

function hasFileWatchLinkFields(link: RuntimeSessionLink): link is RuntimeSessionLink & {
  agentId: AgentId;
  executionOwnerId: AccountId;
  sandboxId: SandboxId;
  sessionId: SessionId;
} {
  return (
    hasNonEmptyString(link.agentId) &&
    hasNonEmptyString(link.executionOwnerId) &&
    hasNonEmptyString(link.sandboxId) &&
    hasNonEmptyString(link.sessionId)
  );
}

function hasNonEmptyString<TValue extends string>(value: TValue | null): value is TValue {
  return typeof value === "string" && value.length > 0;
}
