import type { DriverEventInput } from "@mosoo/driver-protocol";

import type { AgentDriverContext } from "../agent-driver-backend";
import { toOpenAiPlanStatus } from "./app-server-event-mapping";
import type {
  OpenAiEventPush,
  OpenAiItemState,
  OpenAiMessageState,
  OpenAiPlanState,
  OpenAiToolState,
} from "./app-server-event-state";
import { isRecord, readArray, readNonEmptyString, readRecord, readString } from "./app-server-json";
import type { JsonObject } from "./app-server-json";
import {
  toOpenAiFileChangeEvents,
  toOpenAiToolName,
  toOpenAiToolResultText,
} from "./event-translator";

export class OpenAiAppServerItemEventBridge {
  readonly #items: OpenAiItemState;
  readonly #messages: OpenAiMessageState;
  readonly #plans: OpenAiPlanState;
  readonly #push: OpenAiEventPush;
  readonly #tools: OpenAiToolState;

  constructor(input: {
    items: OpenAiItemState;
    messages: OpenAiMessageState;
    plans: OpenAiPlanState;
    push: OpenAiEventPush;
    tools: OpenAiToolState;
  }) {
    this.#items = input.items;
    this.#messages = input.messages;
    this.#plans = input.plans;
    this.#push = input.push;
    this.#tools = input.tools;
  }

  async handleAgentMessageDelta(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const turnId = readNonEmptyString(params, "turnId");
    const delta = readNonEmptyString(params, "delta");

    if (turnId === null || delta === null) {
      return;
    }

    const messageId = await this.#messages.ensureTurnMessage(context, turnId, this.#push);
    this.#messages.appendText(messageId, delta);
    await this.#push(context, "driver.openai.agent.delta", [
      {
        delivery: "best_effort",
        kind: "message.delta",
        payload: {
          contentDelta: delta,
          messageId,
          role: "agent",
        },
      },
    ]);
  }

  async handleFileChangePatchUpdated(
    context: AgentDriverContext,
    params: JsonObject,
  ): Promise<void> {
    const itemId = readNonEmptyString(params, "itemId");
    const turnId = readNonEmptyString(params, "turnId");

    if (itemId === null || turnId === null) {
      return;
    }

    const changes = readArray(params, "changes");
    const item = {
      changes,
      id: itemId,
      type: "fileChange",
    };
    const parentMessageId =
      this.#tools.parentMessage(itemId) ??
      (await this.#messages.ensureTurnMessage(context, turnId, this.#push));

    await this.#tools.ensureStarted(context, this.#push, {
      parentMessageId,
      reason: "driver.openai.file_change.patch_updated.synthetic_start",
      toolCallId: itemId,
      toolCallName: "File change",
    });

    const resultText = toOpenAiToolResultText(item);
    const events: DriverEventInput[] = [];

    if (resultText !== null && resultText.length > 0) {
      events.push({
        kind: "tool.call.updated",
        payload: {
          content: resultText,
          messageId: parentMessageId,
          rawOutput: resultText,
          status: "completed",
          toolCallId: itemId,
        },
      });
    }

    events.push(...toOpenAiFileChangeEvents(item));

    if (events.length > 0) {
      await this.#push(context, "driver.openai.file_change.patch_updated", events);
    }
  }

  async handleItemCompleted(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const item = readRecord(params, "item");
    const itemId = item === null ? null : readNonEmptyString(item, "id");
    const turnId = readNonEmptyString(params, "turnId");

    if (item === null || itemId === null || turnId === null) {
      return;
    }

    if (!this.#items.markCompleted(itemId)) {
      return;
    }

    const events: DriverEventInput[] = [];
    await this.#appendCompletedMessageEvents(context, events, item, itemId, turnId);
    this.#appendCompletedPlanEvents(events, item, itemId);
    this.#appendCompletedReasoningEvents(events, item, itemId);
    await this.#appendCompletedToolEvents(context, events, item, itemId, turnId);

    events.push(...toOpenAiFileChangeEvents(item));

    if (events.length > 0) {
      await this.#push(context, "driver.openai.item.completed", events);
    }
  }

  async handleItemStarted(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const item = readRecord(params, "item");
    const turnId = readNonEmptyString(params, "turnId");

    if (item === null || turnId === null) {
      return;
    }

    const toolName = toOpenAiToolName(item);
    const itemId = readNonEmptyString(item, "id");

    if (toolName === null || itemId === null) {
      return;
    }

    await this.#tools.ensureStarted(context, this.#push, {
      parentMessageId: await this.#messages.ensureTurnMessage(context, turnId, this.#push),
      reason: "driver.openai.item.started",
      toolCallId: itemId,
      toolCallName: toolName,
    });
  }

  async handlePlanDelta(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const itemId = readNonEmptyString(params, "itemId");
    const delta = readString(params, "delta");

    if (itemId === null || delta === null || delta.length === 0) {
      return;
    }

    this.#plans.appendDelta(itemId, delta);
    await this.#push(context, "driver.openai.plan.delta", [this.#plans.createUpdatedEvent()]);
  }

  async handleReasoningSummaryDelta(
    context: AgentDriverContext,
    params: JsonObject,
  ): Promise<void> {
    const itemId = readNonEmptyString(params, "itemId");
    const delta = readString(params, "delta") ?? readString(params, "part");

    if (itemId === null || delta === null || delta.length === 0) {
      return;
    }

    const messageId = `reasoning:${itemId}`;
    const events: DriverEventInput[] = [];

    this.#messages.ensureReasoningStarted(messageId, events);
    events.push({
      delivery: "best_effort",
      kind: "thought.delta",
      payload: {
        channel: "summary",
        contentDelta: delta,
        thoughtId: messageId,
      },
    });

    await this.#push(context, "driver.openai.reasoning.summary", events);
  }

  async handleToolOutputDelta(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const itemId = readNonEmptyString(params, "itemId");
    const delta = readNonEmptyString(params, "delta");

    if (itemId === null || delta === null) {
      return;
    }

    const parentMessageId = this.#tools.parentMessage(itemId);

    if (parentMessageId === null) {
      return;
    }

    await this.#push(context, "driver.openai.tool.output", [
      {
        delivery: "best_effort",
        kind: "tool.call.updated",
        payload: {
          content: delta,
          messageId: parentMessageId,
          rawOutput: delta,
          status: "completed",
          toolCallId: itemId,
        },
      },
    ]);
  }

  async handleTurnCompletedItems(
    context: AgentDriverContext,
    params: JsonObject,
    turnId: string,
  ): Promise<void> {
    const turn = readRecord(params, "turn");

    for (const item of readArray(turn, "items")) {
      if (!isRecord(item)) {
        continue;
      }

      await this.handleItemCompleted(context, {
        item,
        threadId: readString(params, "threadId"),
        turnId,
      });
    }
  }

  async handleTurnPlanUpdated(context: AgentDriverContext, params: JsonObject): Promise<void> {
    const plan = readArray(params, "plan").flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      const content = readNonEmptyString(entry, "step");

      if (content === null) {
        return [];
      }

      return [
        {
          content,
          priority: "medium" as const,
          status: toOpenAiPlanStatus(readString(entry, "status")),
        },
      ];
    });

    await this.#push(context, "driver.openai.turn.plan.updated", [
      {
        kind: "plan.updated",
        payload: {
          entries: plan,
          source: "driver",
        },
      },
    ]);
  }

  async #appendCompletedMessageEvents(
    context: AgentDriverContext,
    events: DriverEventInput[],
    item: JsonObject,
    itemId: string,
    turnId: string,
  ): Promise<void> {
    if (readString(item, "type") !== "agentMessage") {
      return;
    }

    const finalText = readString(item, "text");
    const messageId = await this.#messages.ensureTurnMessage(context, turnId, this.#push);
    const currentText = this.#messages.currentText(messageId);

    if (finalText !== null && finalText.length > currentText.length) {
      if (finalText.startsWith(currentText)) {
        const delta = finalText.slice(currentText.length);
        this.#messages.appendText(messageId, delta);
        events.push({
          delivery: "best_effort",
          kind: "message.delta",
          payload: {
            contentDelta: delta,
            messageId,
            role: "agent",
          },
        });
      } else if (currentText.length === 0) {
        this.#messages.appendText(messageId, finalText);
        events.push({
          delivery: "best_effort",
          kind: "message.delta",
          payload: {
            contentDelta: finalText,
            messageId,
            role: "agent",
          },
        });
      } else {
        context.logger.warn("driver.openai.agent.final_text.mismatch", {
          currentLength: currentText.length,
          finalLength: finalText.length,
          itemId,
        });
      }
    }

    if (this.#messages.markEnded(messageId)) {
      events.push({
        kind: "message.completed",
        payload: {
          messageId,
          role: "agent",
        },
      });
    }
  }

  #appendCompletedPlanEvents(events: DriverEventInput[], item: JsonObject, itemId: string): void {
    if (readString(item, "type") !== "plan") {
      return;
    }

    const planText = readString(item, "text");

    if (planText === null || planText.trim().length === 0) {
      return;
    }

    this.#plans.setCompleted(itemId, planText);
    events.push(this.#plans.createUpdatedEvent());
  }

  #appendCompletedReasoningEvents(
    events: DriverEventInput[],
    item: JsonObject,
    itemId: string,
  ): void {
    if (readString(item, "type") !== "reasoning") {
      return;
    }

    const summary = Array.isArray(item["summary"])
      ? item["summary"].filter((entry): entry is string => typeof entry === "string")
      : [];
    const messageId = `reasoning:${itemId}`;

    if (summary.length > 0) {
      this.#messages.ensureReasoningStarted(messageId, events);
      events.push({
        delivery: "best_effort",
        kind: "thought.delta",
        payload: {
          channel: "summary",
          contentDelta: summary.join("\n"),
          thoughtId: messageId,
        },
      });
    }

    events.push({
      kind: "thought.completed",
      payload: {
        channel: "summary",
        thoughtId: messageId,
      },
    });
  }

  async #appendCompletedToolEvents(
    context: AgentDriverContext,
    events: DriverEventInput[],
    item: JsonObject,
    itemId: string,
    turnId: string,
  ): Promise<void> {
    const toolName = toOpenAiToolName(item);
    const parentMessageId =
      this.#tools.parentMessage(itemId) ??
      this.#messages.messageForTurn(turnId) ??
      (toolName === null
        ? null
        : await this.#messages.ensureTurnMessage(context, turnId, this.#push));

    if (parentMessageId === null || toolName === null) {
      return;
    }

    await this.#tools.ensureStarted(context, this.#push, {
      parentMessageId,
      reason: "driver.openai.item.completed.synthetic_start",
      toolCallId: itemId,
      toolCallName: toolName,
    });

    events.push({
      kind: "tool.call.updated",
      payload: {
        status: "completed",
        toolCallId: itemId,
      },
    });
    events.push({
      kind: "item.completed",
      payload: {
        itemId,
        itemType: "tool_call",
        status: "completed",
      },
    });

    const toolResult = toOpenAiToolResultText(item);

    if (toolResult !== null && toolResult.length > 0) {
      events.push({
        kind: "tool.call.updated",
        payload: {
          content: toolResult,
          messageId: parentMessageId,
          rawOutput: toolResult,
          status: "completed",
          toolCallId: itemId,
        },
      });
    }
  }
}
