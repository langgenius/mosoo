import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import type { AgentDriverContext } from "../agent-driver-backend";
import type { JsonObject } from "./agent-sdk-json";
import { toClaudeDiagnosticEvent, toClaudeUsageUpdatedEvents } from "./agent-sdk-message-events";

interface ClaudeAgentSdkEventWriterOptions {
  push(context: AgentDriverContext, reason: string, events: DriverEventInput[]): Promise<void>;
}

export interface ClaudeToolStartEvent {
  context: AgentDriverContext;
  parentMessageId: string;
  toolCallId: string;
  toolCallName: string;
}

export interface ClaudeTextDeltaEvent {
  context: AgentDriverContext;
  delta: string;
  messageId: string;
  reason: string;
}

export interface ClaudeThoughtDeltaEvent {
  context: AgentDriverContext;
  delta: string;
  thoughtId: string;
}

export interface ClaudeToolArgumentsEvent {
  context: AgentDriverContext;
  delta: string;
  reason: string;
  toolCallId: string;
}

export interface ClaudeToolResultEvent {
  content: string;
  context: AgentDriverContext;
  messageId: string;
  toolCallId: string;
}

export class ClaudeAgentSdkEventWriter {
  readonly #messageEnded = new Set<string>();
  readonly #messageStarted = new Set<string>();
  readonly #options: ClaudeAgentSdkEventWriterOptions;
  readonly #thoughtEnded = new Set<string>();
  readonly #thoughtStarted = new Set<string>();
  readonly #toolEnded = new Set<string>();
  readonly #toolParentMessage = new Map<string, string>();
  readonly #toolStarted = new Set<string>();

  constructor(options: ClaudeAgentSdkEventWriterOptions) {
    this.#options = options;
  }

  hasToolStarted(toolCallId: string): boolean {
    return this.#toolStarted.has(toolCallId);
  }

  resetTurnState(): void {
    this.#messageEnded.clear();
    this.#messageStarted.clear();
    this.#thoughtEnded.clear();
    this.#thoughtStarted.clear();
    this.#toolEnded.clear();
    this.#toolParentMessage.clear();
    this.#toolStarted.clear();
  }

  toolParentMessageId(toolCallId: string): string | null {
    return this.#toolParentMessage.get(toolCallId) ?? null;
  }

  async endMessage(context: AgentDriverContext, messageId: string): Promise<void> {
    if (!this.#messageStarted.has(messageId) || this.#messageEnded.has(messageId)) {
      return;
    }

    this.#messageEnded.add(messageId);
    await this.#push(context, "driver.claude.message.ended", [
      {
        kind: "message.completed",
        payload: {
          messageId,
          role: "agent",
        },
      },
    ]);
  }

  async endTool(context: AgentDriverContext, toolCallId: string): Promise<void> {
    if (this.#toolEnded.has(toolCallId)) {
      return;
    }

    this.#toolEnded.add(toolCallId);
    await this.#push(context, "driver.claude.tool.ended", [
      {
        kind: "tool.call.updated",
        payload: {
          status: "completed",
          toolCallId,
        },
      },
      {
        kind: "item.completed",
        payload: {
          itemId: toolCallId,
          itemType: "tool_call",
          status: "completed",
        },
      },
    ]);
  }

  async ensureMessageStarted(context: AgentDriverContext, messageId: string): Promise<void> {
    if (this.#messageStarted.has(messageId)) {
      return;
    }

    this.#messageStarted.add(messageId);
    await this.#push(context, "driver.claude.message.started", [
      {
        kind: "message.started",
        payload: {
          messageId,
          role: "agent",
        },
      },
    ]);
  }

  async ensureToolStarted({
    context,
    parentMessageId,
    toolCallId,
    toolCallName,
  }: ClaudeToolStartEvent): Promise<void> {
    if (this.#toolStarted.has(toolCallId)) {
      return;
    }

    await this.ensureMessageStarted(context, parentMessageId);
    this.#toolStarted.add(toolCallId);
    this.#toolParentMessage.set(toolCallId, parentMessageId);
    await this.#push(context, "driver.claude.tool.started", [
      {
        kind: "item.started",
        payload: {
          itemId: toolCallId,
          itemType: "tool_call",
          parentMessageId,
          title: toolCallName,
        },
      },
      {
        kind: "tool.call.updated",
        payload: {
          kind: "tool",
          parentMessageId,
          status: "running",
          title: toolCallName,
          toolCallId,
        },
      },
    ]);
  }

  async pushDiagnostic(context: AgentDriverContext, message: SDKMessage): Promise<void> {
    await this.pushRaw(context, "driver.claude.diagnostic", toClaudeDiagnosticEvent(message));
  }

  async pushRaw(context: AgentDriverContext, reason: string, event: JsonObject): Promise<void> {
    await this.#push(context, reason, [
      {
        kind: "diagnostic.reported",
        payload: {
          message: reason,
          raw: event,
          severity: "info",
        },
        visibility: "owner_debug",
      },
    ]);
  }

  async pushRunError(context: AgentDriverContext, code: string, message: string): Promise<void> {
    await this.#push(context, "driver.claude.turn.failed", [
      {
        kind: "run.failed",
        payload: {
          error: {
            code,
            message,
          },
          recoverable: false,
        },
      },
    ]);
  }

  async pushRunFinished(context: AgentDriverContext, runId: SessionRunId): Promise<void> {
    await this.#push(context, "driver.claude.turn.completed", [
      {
        runId,
        kind: "run.completed",
        payload: {
          stopReason: "end_turn",
        },
      },
    ]);
  }

  async pushSessionInfoUpdated(context: AgentDriverContext): Promise<void> {
    await this.#push(context, "driver.claude.session.info", [
      {
        kind: "session.info.updated",
        payload: {
          updatedAt: new Date().toISOString(),
        },
      },
    ]);
  }

  async pushTextDelta({ context, delta, messageId, reason }: ClaudeTextDeltaEvent): Promise<void> {
    await this.ensureMessageStarted(context, messageId);
    await this.#push(context, reason, [
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

  async ensureThoughtStarted(context: AgentDriverContext, thoughtId: string): Promise<void> {
    if (this.#thoughtStarted.has(thoughtId)) {
      return;
    }

    this.#thoughtStarted.add(thoughtId);
    await this.#push(context, "driver.claude.thought.started", [
      {
        kind: "thought.started",
        payload: {
          channel: "summary",
          thoughtId,
        },
      },
    ]);
  }

  async pushThoughtDelta({ context, delta, thoughtId }: ClaudeThoughtDeltaEvent): Promise<void> {
    await this.ensureThoughtStarted(context, thoughtId);
    await this.#push(context, "driver.claude.thought.delta", [
      {
        delivery: "best_effort",
        kind: "thought.delta",
        payload: {
          channel: "summary",
          contentDelta: delta,
          thoughtId,
        },
      },
    ]);
  }

  async endThought(context: AgentDriverContext, thoughtId: string): Promise<void> {
    if (!this.#thoughtStarted.has(thoughtId) || this.#thoughtEnded.has(thoughtId)) {
      return;
    }

    this.#thoughtEnded.add(thoughtId);
    await this.#push(context, "driver.claude.thought.completed", [
      {
        kind: "thought.completed",
        payload: {
          channel: "summary",
          thoughtId,
        },
      },
    ]);
  }

  async pushToolArguments({
    context,
    delta,
    reason,
    toolCallId,
  }: ClaudeToolArgumentsEvent): Promise<void> {
    await this.#push(context, reason, [
      {
        delivery: "best_effort",
        kind: "tool.call.updated",
        payload: {
          rawInput: delta,
          status: "running",
          toolCallId,
        },
      },
    ]);
  }

  async pushToolResult({
    content,
    context,
    messageId,
    toolCallId,
  }: ClaudeToolResultEvent): Promise<void> {
    await this.#push(context, "driver.claude.tool.result", [
      {
        kind: "tool.call.updated",
        payload: {
          content,
          messageId,
          rawOutput: content,
          status: "completed",
          toolCallId,
        },
      },
    ]);
  }

  async pushUsage(
    context: AgentDriverContext,
    usage: JsonObject | null,
    costAmount: number | null,
  ): Promise<void> {
    const events = toClaudeUsageUpdatedEvents(usage, costAmount);

    if (events.length === 0) {
      return;
    }

    await this.#push(context, "driver.claude.usage.updated", events);
  }

  async #push(
    context: AgentDriverContext,
    reason: string,
    events: DriverEventInput[],
  ): Promise<void> {
    await this.#options.push(context, reason, events);
  }
}
