import { parseSSEStream } from "@cloudflare/sandbox";
import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import type { AccountId, AgentId, DriverInstanceId, SessionId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import {
  createErrorLogContext,
  logError,
  logInfo,
  logWarn,
} from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  appendSessionRuntimeEvents,
  createSessionRuntimeEvent,
} from "../../sessions/application/session-event-write.service";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
} from "../application/runtime-diagnostic-events";
import type {
  RuntimeArtifactSummaryChange,
  RuntimeFileChangeInput,
} from "./runtime-space-file-changes";
import type { ExecutionSessionHandle, SandboxHandle } from "./sandbox-handles";
import { syncSandboxSpaceFileMutation } from "./sandbox-space-file-sync.service";

const FILE_WATCH_CHANGE_FLUSH_MS = 250;

type SandboxFileWatchEvent =
  | {
      path: string;
      type: "watching";
      watchId: string;
    }
  | {
      eventType: "attrib" | "create" | "delete" | "modify" | "move_from" | "move_to";
      isDirectory: boolean;
      path: string;
      type: "event";
    }
  | {
      error: string;
      type: "error";
    }
  | {
      reason: string;
      type: "stopped";
    };
type SandboxFileWatchEventType = Extract<SandboxFileWatchEvent, { type: "event" }>["eventType"];

interface RuntimeFileWatchTarget {
  handle: ExecutionSessionHandle;
  kind: "space";
  path: string;
  watchOptions?: {
    exclude?: string[];
    recursive?: boolean;
  };
}

interface RuntimeFileWatchInput {
  agentId: AgentId;
  bindings: ApiBindings;
  executionOwnerUserId: AccountId;
  driverInstanceId: DriverInstanceId;
  sandbox: SandboxHandle;
  sessionId: SessionId;
  signal: AbortSignal;
  spaceAliases: SpaceAliasBinding[];
}

function toFileChangeKind(
  eventType: SandboxFileWatchEventType,
): RuntimeFileChangeInput["change"] | null {
  switch (eventType) {
    case "create":
    case "modify":
    case "attrib":
    case "move_to": {
      return "upsert";
    }
    case "delete":
    case "move_from": {
      return "delete";
    }
    default: {
      return null;
    }
  }
}

function toRuntimeFileChange(
  event: Extract<SandboxFileWatchEvent, { type: "event" }>,
): RuntimeFileChangeInput | null {
  if (event.isDirectory) {
    return null;
  }

  const change = toFileChangeKind(event.eventType);

  if (!change) {
    return null;
  }

  return {
    change,
    path: event.path,
  };
}

async function publishFileChange(
  input: RuntimeFileWatchInput,
  artifactChange: RuntimeArtifactSummaryChange,
): Promise<void> {
  if (!artifactChange) {
    return;
  }

  await appendSessionRuntimeEvents({
    bindings: input.bindings,
    events: [
      createSessionRuntimeEvent({
        kind: "session.files.updated",
        origin: "file",
        payload: {
          change: artifactChange,
        },
        sessionId: input.sessionId,
      }),
    ],
    sessionId: input.sessionId,
  });
}

class SpaceFileChangeQueue {
  readonly #input: RuntimeFileWatchInput;
  readonly #pending = new Map<string, RuntimeFileChangeInput>();
  readonly #target: RuntimeFileWatchTarget;
  #flushing: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(input: RuntimeFileWatchInput, target: RuntimeFileWatchTarget) {
    this.#input = input;
    this.#target = target;
  }

  enqueue(fileChange: RuntimeFileChangeInput): void {
    this.#pending.set(fileChange.path, fileChange);

    if (this.#timer !== null || this.#flushing !== null) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush().catch((error: unknown) => {
        this.#logQueueError(error);
      });
    }, FILE_WATCH_CHANGE_FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    while (this.#pending.size > 0) {
      if (this.#flushing !== null) {
        await this.#flushing;
        continue;
      }

      const changes = [...this.#pending.values()];
      this.#pending.clear();
      const flushing = this.#syncAll(changes);

      this.#flushing = flushing;

      try {
        await flushing;
      } finally {
        if (this.#flushing === flushing) {
          this.#flushing = null;
        }
      }
    }
  }

  async #syncAll(changes: RuntimeFileChangeInput[]): Promise<void> {
    for (const fileChange of changes) {
      await this.#sync(fileChange);
    }
  }

  async #sync(fileChange: RuntimeFileChangeInput): Promise<void> {
    try {
      const artifactChange = await syncSandboxSpaceFileMutation(
        {
          bindings: this.#input.bindings,
          executionOwnerUserId: this.#input.executionOwnerUserId,
          fileReader: this.#target.handle,
          spaceAliases: this.#input.spaceAliases,
        },
        fileChange,
      );

      await publishFileChange(this.#input, artifactChange);
    } catch (error) {
      logError("runtime.file_watch.event_failed", {
        ...createErrorLogContext(error),
        driverInstanceId: this.#input.driverInstanceId,
        path: fileChange.path,
        sessionId: this.#input.sessionId,
        targetKind: this.#target.kind,
      });
    }
  }

  #logQueueError(error: unknown): void {
    logError("runtime.file_watch.flush_failed", {
      ...createErrorLogContext(error),
      driverInstanceId: this.#input.driverInstanceId,
      sessionId: this.#input.sessionId,
      targetKind: this.#target.kind,
    });
  }
}

async function watchTarget(input: RuntimeFileWatchInput, target: RuntimeFileWatchTarget) {
  const stream = await target.handle.watch(target.path, target.watchOptions);
  const changes = new SpaceFileChangeQueue(input, target);

  try {
    for await (const event of parseSSEStream<SandboxFileWatchEvent>(stream, input.signal)) {
      if (event.type === "watching") {
        logInfo("runtime.file_watch.started", {
          driverInstanceId: input.driverInstanceId,
          path: event.path,
          sessionId: input.sessionId,
          targetKind: target.kind,
          watchId: event.watchId,
        });
        continue;
      }

      if (event.type === "stopped") {
        try {
          await appendRuntimeDiagnosticEvent(input.bindings, {
            eventName: RUNTIME_DIAGNOSTIC_EVENT.transportFileWatchStopped.name,
            sessionId: input.sessionId,
            value: {
              ...toRuntimeDiagnosticBaseValue({
                agentId: input.agentId,
                sessionId: input.sessionId,
              }),
              reason: event.reason,
            },
          });
        } catch (error) {
          logWarn("runtime.file_watch.stopped_event.emit_failed", {
            ...createErrorLogContext(error),
            driverInstanceId: input.driverInstanceId,
            sessionId: input.sessionId,
            targetKind: target.kind,
          });
        }
        logInfo("runtime.file_watch.stopped", {
          driverInstanceId: input.driverInstanceId,
          reason: event.reason,
          sessionId: input.sessionId,
          targetKind: target.kind,
        });
        return;
      }

      if (event.type === "error") {
        logWarn("runtime.file_watch.stream_error", {
          driverInstanceId: input.driverInstanceId,
          error: event.error,
          path: target.path,
          sessionId: input.sessionId,
          targetKind: target.kind,
        });
        continue;
      }

      const fileChange = toRuntimeFileChange(event);

      if (fileChange !== null) {
        changes.enqueue(fileChange);
      }
    }
  } finally {
    await changes.flush();
  }
}

export async function watchRuntimeSandboxFiles(input: RuntimeFileWatchInput): Promise<void> {
  const targets: RuntimeFileWatchTarget[] = input.spaceAliases.map((alias) => ({
    handle: input.sandbox,
    kind: "space" as const,
    path: alias.globalMountPath,
  }));

  await Promise.all(targets.map(async (target) => watchTarget(input, target)));
}
