import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import { readNonEmptyString, readNullableString, readString } from "./acp-types";
import type { JsonObject } from "./acp-types";

export type RuntimeToolStatus = "completed" | "failed" | "running";

const TERMINAL_TOOL_STATUSES = new Set(["cancelled", "completed", "failed"]);

export class AcpToolEventState {
  readonly #completed = new Set<string>();
  readonly #started = new Set<string>();

  clear(): void {
    this.#completed.clear();
    this.#started.clear();
  }

  complete(input: {
    runId: SessionRunId;
    status: RuntimeToolStatus;
    toolCallId: string;
    update: JsonObject | null;
  }): DriverEventInput | null {
    if (this.#completed.has(input.toolCallId)) {
      return null;
    }

    this.#completed.add(input.toolCallId);
    return {
      kind: "item.completed",
      payload: {
        error: input.status === "failed" ? readString(input.update, "error") : undefined,
        itemId: input.toolCallId,
        itemType: "tool_call",
        result: input.update?.["rawOutput"],
        status: input.status,
      },
      runId: input.runId,
    };
  }

  completeOpen(input: {
    error?: string;
    runId: SessionRunId;
    status: RuntimeToolStatus;
  }): DriverEventInput[] {
    const events: DriverEventInput[] = [];

    for (const itemId of this.#started) {
      if (this.#completed.has(itemId)) {
        continue;
      }

      this.#completed.add(itemId);
      events.push({
        kind: "item.completed",
        payload: {
          ...(input.error === undefined ? {} : { error: input.error }),
          itemId,
          itemType: "tool_call",
          status: input.status,
        },
        runId: input.runId,
      });
    }

    return events;
  }

  ensureStarted(input: {
    parentMessageId: string | undefined;
    runId: SessionRunId;
    title: string;
    toolCallId: string;
  }): DriverEventInput[] {
    if (this.#started.has(input.toolCallId)) {
      return [];
    }

    this.#started.add(input.toolCallId);
    return [
      {
        kind: "item.started",
        payload: {
          itemId: input.toolCallId,
          itemType: "tool_call",
          parentMessageId: input.parentMessageId,
          title: input.title,
        },
        runId: input.runId,
      },
    ];
  }
}

export function isTerminalToolStatus(status: string | null): boolean {
  return status !== null && TERMINAL_TOOL_STATUSES.has(status);
}

export function toRuntimeToolStatus(status: string | null): RuntimeToolStatus {
  if (status === "completed") {
    return "completed";
  }

  if (status === "failed" || status === "cancelled") {
    return "failed";
  }

  return "running";
}

export function toToolCallPayload(
  toolCallId: string,
  status: RuntimeToolStatus,
  update: JsonObject | null,
): JsonObject {
  return {
    content: update?.["content"],
    kind: readNonEmptyString(update, "kind") ?? "tool",
    locations: update?.["locations"],
    rawInput: update?.["rawInput"],
    rawOutput: update?.["rawOutput"],
    status,
    title: readNullableString(update, "title") ?? null,
    toolCallId,
  };
}
