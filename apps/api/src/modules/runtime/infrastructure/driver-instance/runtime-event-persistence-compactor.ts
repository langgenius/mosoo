import {
  readRuntimeEventMessageKey,
  readRuntimeEventMessageRole,
  readRuntimeEventPayload,
  readRuntimeEventString,
  readRuntimeEventToolCallId,
  readRuntimeEventToolName,
  readRuntimeEventToolStatusFromEvent,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope, RuntimeEventToolStatus } from "@mosoo/runtime-events";

import type { ProjectedRuntimeEventRecord } from "./event-types";
import {
  createCompactedRecord,
  isTerminalRunEvent,
  mergeDeliveredText,
  mergeTextEventContent,
  readPayloadString,
  readRuntimeEventMessageRoleUpdate,
  readToolItemId,
  toStreamKey,
  toTerminalToolStatus,
} from "./runtime-event-compaction";
import type {
  RuntimeEventPayloadRecord,
  TextStreamAccumulator,
  TextStreamKind,
  ToolCallAccumulator,
} from "./runtime-event-compaction";

export class RuntimeEventPersistenceCompactor {
  readonly #messages = new Map<string, TextStreamAccumulator>();
  readonly #thoughts = new Map<string, TextStreamAccumulator>();
  readonly #tools = new Map<string, ToolCallAccumulator>();

  compact(records: ProjectedRuntimeEventRecord[]): ProjectedRuntimeEventRecord[] {
    const output: ProjectedRuntimeEventRecord[] = [];

    for (const record of records) {
      if (this.#applyMessage(record, output)) {
        continue;
      }

      if (this.#applyThought(record, output)) {
        continue;
      }

      if (this.#applyTool(record)) {
        continue;
      }

      if (isTerminalRunEvent(record.event)) {
        output.push(...this.#flushRun(record.event, toTerminalToolStatus(record.event)));
        output.push(record);
        continue;
      }

      output.push(record);
    }

    output.push(...this.#flushReadyTools());
    return output;
  }

  #applyMessage(
    record: ProjectedRuntimeEventRecord,
    output: ProjectedRuntimeEventRecord[],
  ): boolean {
    const event = record.event;

    if (
      event.kind !== "message.added" &&
      event.kind !== "message.completed" &&
      event.kind !== "message.delta" &&
      event.kind !== "message.started"
    ) {
      return false;
    }

    const key = readRuntimeEventMessageKey(event);

    if (key === null) {
      return true;
    }

    const streamKey = toStreamKey({
      id: key,
      kind: "message",
      runId: event.runId ?? null,
      sessionId: event.sessionId,
    });
    const accumulator = this.#upsertTextAccumulator(this.#messages, {
      key: streamKey,
      kind: "message",
      record,
    });
    mergeTextEventContent(accumulator, event);

    if (event.kind === "message.added" || event.kind === "message.completed") {
      this.#messages.delete(streamKey);
      const compacted = this.#createMessageRecord(accumulator);

      if (compacted !== null) {
        output.push(compacted);
      } else if (event.kind === "message.added") {
        output.push(record);
      }
    }

    return true;
  }

  #applyThought(
    record: ProjectedRuntimeEventRecord,
    output: ProjectedRuntimeEventRecord[],
  ): boolean {
    const event = record.event;

    if (
      event.kind !== "thought.completed" &&
      event.kind !== "thought.delta" &&
      event.kind !== "thought.started"
    ) {
      return false;
    }

    const key = readRuntimeEventMessageKey(event);

    if (key === null) {
      return true;
    }

    const streamKey = toStreamKey({
      id: key,
      kind: "thought",
      runId: event.runId ?? null,
      sessionId: event.sessionId,
    });
    const accumulator = this.#upsertTextAccumulator(this.#thoughts, {
      key: streamKey,
      kind: "thought",
      record,
    });
    mergeTextEventContent(accumulator, event);

    if (event.kind === "thought.completed") {
      this.#thoughts.delete(streamKey);
      const compacted = this.#createThoughtRecord(accumulator);

      if (compacted !== null) {
        output.push(compacted);
      }
    }

    return true;
  }

  #applyTool(record: ProjectedRuntimeEventRecord): boolean {
    const event = record.event;
    const toolCallId = readRuntimeEventToolCallId(event) ?? readToolItemId(event);

    if (toolCallId === null) {
      return false;
    }

    const key = toStreamKey({
      id: toolCallId,
      kind: "tool",
      runId: event.runId ?? null,
      sessionId: event.sessionId,
    });
    const accumulator = this.#upsertToolAccumulator(key, record, toolCallId);
    const payload = readRuntimeEventPayload(event);

    accumulator.lastRecord = record;
    this.#mergeToolPayload(accumulator, payload);
    accumulator.content =
      mergeDeliveredText(
        accumulator.content,
        readPayloadString(payload, "content"),
        event.delivery,
      ) ?? "";
    accumulator.rawInput = mergeDeliveredText(
      accumulator.rawInput,
      readPayloadString(payload, "rawInput"),
      event.delivery,
    );
    accumulator.rawOutput = mergeDeliveredText(
      accumulator.rawOutput,
      readPayloadString(payload, "rawOutput"),
      event.delivery,
    );
    accumulator.status = readRuntimeEventToolStatusFromEvent(event);

    const name = readRuntimeEventToolName(event);

    if (name !== null) {
      accumulator.name = name;
    }

    if (event.kind === "item.completed") {
      accumulator.itemCompleted = true;
      const status = readRuntimeEventString(payload, "status");
      accumulator.status = status === "failed" ? "failed" : "completed";
    }

    return true;
  }

  #upsertTextAccumulator(
    map: Map<string, TextStreamAccumulator>,
    input: {
      key: string;
      kind: TextStreamKind;
      record: ProjectedRuntimeEventRecord;
    },
  ): TextStreamAccumulator {
    const existing = map.get(input.key);

    if (existing !== undefined) {
      existing.lastRecord = input.record;
      existing.role = readRuntimeEventMessageRoleUpdate(input.record.event) ?? existing.role;
      return existing;
    }

    const accumulator: TextStreamAccumulator = {
      content: "",
      firstRecord: input.record,
      key: input.key,
      kind: input.kind,
      lastRecord: input.record,
      role: readRuntimeEventMessageRole(input.record.event),
      runId: input.record.event.runId ?? null,
      sessionId: input.record.event.sessionId,
    };
    map.set(input.key, accumulator);
    return accumulator;
  }

  #upsertToolAccumulator(
    key: string,
    record: ProjectedRuntimeEventRecord,
    toolCallId: string,
  ): ToolCallAccumulator {
    const existing = this.#tools.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const accumulator: ToolCallAccumulator = {
      content: "",
      firstRecord: record,
      itemCompleted: false,
      key,
      lastRecord: record,
      name: readRuntimeEventToolName(record.event),
      payload: {},
      rawInput: null,
      rawOutput: null,
      runId: record.event.runId ?? null,
      sessionId: record.event.sessionId,
      status: readRuntimeEventToolStatusFromEvent(record.event),
      toolCallId,
    };
    this.#tools.set(key, accumulator);
    return accumulator;
  }

  #createMessageRecord(accumulator: TextStreamAccumulator): ProjectedRuntimeEventRecord | null {
    if (accumulator.content.length === 0) {
      return null;
    }

    const payload: RuntimeEventPayloadRecord = {
      ...readRuntimeEventPayload(accumulator.lastRecord.event),
      content: accumulator.content,
      messageId: readRuntimeEventMessageKey(accumulator.lastRecord.event) ?? accumulator.key,
      role: accumulator.role,
    };
    delete payload["contentDelta"];

    return createCompactedRecord(accumulator, {
      kind: "message.added",
      payload,
    });
  }

  #createThoughtRecord(accumulator: TextStreamAccumulator): ProjectedRuntimeEventRecord | null {
    if (accumulator.content.length === 0) {
      return null;
    }

    const payload: RuntimeEventPayloadRecord = {
      ...readRuntimeEventPayload(accumulator.lastRecord.event),
      content: accumulator.content,
      thoughtId: readRuntimeEventMessageKey(accumulator.lastRecord.event) ?? accumulator.key,
    };
    delete payload["contentDelta"];

    return createCompactedRecord(accumulator, {
      kind: "thought.completed",
      payload,
    });
  }

  #createToolRecord(accumulator: ToolCallAccumulator): ProjectedRuntimeEventRecord {
    const payload = {
      ...this.#mergeToolPayloads(accumulator),
      status: accumulator.status,
      toolCallId: accumulator.toolCallId,
    };

    return createCompactedRecord(accumulator, {
      kind: "tool.call.updated",
      payload,
    });
  }

  #mergeToolPayloads(accumulator: ToolCallAccumulator): RuntimeEventPayloadRecord {
    const merged: RuntimeEventPayloadRecord = { ...accumulator.payload };

    if (accumulator.name !== null) {
      merged["title"] ??= accumulator.name;
    }

    if (accumulator.content.length > 0) {
      merged["content"] = accumulator.content;
    }

    if (accumulator.rawInput !== null) {
      merged["rawInput"] = accumulator.rawInput;
    }

    if (accumulator.rawOutput !== null) {
      merged["rawOutput"] = accumulator.rawOutput;
    }

    return merged;
  }

  #mergeToolPayload(accumulator: ToolCallAccumulator, payload: RuntimeEventPayloadRecord): void {
    for (const [key, value] of Object.entries(payload)) {
      if (key !== "content" && key !== "rawInput" && key !== "rawOutput") {
        accumulator.payload[key] = value;
      }
    }
  }

  #flushReadyTools(): ProjectedRuntimeEventRecord[] {
    const output: ProjectedRuntimeEventRecord[] = [];

    for (const [key, accumulator] of this.#tools) {
      if (!accumulator.itemCompleted) {
        continue;
      }

      this.#tools.delete(key);
      output.push(this.#createToolRecord(accumulator));
    }

    return output;
  }

  #flushRun(
    terminalEvent: RuntimeEventEnvelope,
    terminalToolStatus: RuntimeEventToolStatus,
  ): ProjectedRuntimeEventRecord[] {
    const output: ProjectedRuntimeEventRecord[] = [];
    const runId = terminalEvent.runId ?? null;

    for (const [key, accumulator] of this.#messages) {
      if (accumulator.sessionId !== terminalEvent.sessionId || accumulator.runId !== runId) {
        continue;
      }

      this.#messages.delete(key);
      const compacted = this.#createMessageRecord(accumulator);

      if (compacted !== null) {
        output.push(compacted);
      }
    }

    for (const [key, accumulator] of this.#thoughts) {
      if (accumulator.sessionId !== terminalEvent.sessionId || accumulator.runId !== runId) {
        continue;
      }

      this.#thoughts.delete(key);
      const compacted = this.#createThoughtRecord(accumulator);

      if (compacted !== null) {
        output.push(compacted);
      }
    }

    for (const [key, accumulator] of this.#tools) {
      if (accumulator.sessionId !== terminalEvent.sessionId || accumulator.runId !== runId) {
        continue;
      }

      this.#tools.delete(key);

      if (accumulator.status === "running") {
        accumulator.status = terminalToolStatus;
      }

      output.push(this.#createToolRecord(accumulator));
    }

    return output;
  }
}
