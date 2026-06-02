import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionMessageId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";

import { isTruthy } from "../../core/truthiness";
import type { AgentDriverContext } from "../agent-driver-backend";
import { RuntimeAssistantMessageIdIndex } from "../runtime-turn-transcript";
import { ClaudeAgentSdkEventWriter } from "./agent-sdk-event-writer";
import {
  isRecord,
  readNumber,
  readRecord,
  readString,
  stringifyForDisplay,
} from "./agent-sdk-json";
import type { JsonObject } from "./agent-sdk-json";
import { toClaudeFilesPersistedEvents } from "./agent-sdk-message-events";
import { isDuplicateClaudeFinalText, readClaudeSdkSessionId } from "./agent-sdk-message-state";
import { isToolUseBlock, toToolCallId, toToolCallName, toToolResultText } from "./agent-sdk-tools";
interface ClaudeMessageTranslatorOptions {
  push(context: AgentDriverContext, reason: string, events: DriverEventInput[]): Promise<void>;
  recordNativeSessionId(context: AgentDriverContext, sessionId: string): Promise<void>;
}

function toClaudeThoughtId(messageId: string): string {
  return `${messageId}:thought`;
}

export class ClaudeAgentSdkMessageTranslator {
  #activeThoughtId: string | null = null;
  readonly #assistantMessageIds = new RuntimeAssistantMessageIdIndex<SessionRunId>();
  readonly #blockIndexToToolCallId = new Map<number, string>();
  readonly #events: ClaudeAgentSdkEventWriter;
  readonly #options: ClaudeMessageTranslatorOptions;
  readonly #streamedTextMessages = new Set<string>();
  readonly #streamedTextByMessageId = new Map<string, string>();

  constructor(options: ClaudeMessageTranslatorOptions) {
    this.#options = options;
    this.#events = new ClaudeAgentSdkEventWriter({ push: options.push });
  }

  resetTurnMessageState(): void {
    this.#activeThoughtId = null;
    this.#assistantMessageIds.reset();
    this.#blockIndexToToolCallId.clear();
    this.#events.resetTurnState();
    this.#streamedTextByMessageId.clear();
    this.#streamedTextMessages.clear();
  }

  async endActiveThought(context: AgentDriverContext): Promise<void> {
    const thoughtId = this.#activeThoughtId;

    if (thoughtId === null) {
      return;
    }

    this.#activeThoughtId = null;
    await this.#events.endThought(context, thoughtId);
  }

  async handleSdkMessage(
    context: AgentDriverContext,
    message: SDKMessage,
    runId: SessionRunId,
  ): Promise<boolean> {
    const sessionId = readClaudeSdkSessionId(message);

    if (isTruthy(sessionId)) {
      await this.#options.recordNativeSessionId(context, sessionId);
    }

    switch (message.type) {
      case "assistant": {
        await this.#handleAssistantMessage(context, message, runId);
        return false;
      }
      case "auth_status":
      case "rate_limit_event":
      case "tool_progress":
      case "tool_use_summary": {
        await this.#events.pushDiagnostic(context, message);
        return false;
      }
      case "result": {
        await this.#handleResultMessage(context, message, runId);
        return true;
      }
      case "stream_event": {
        await this.#handleStreamEvent(context, message, runId);
        return false;
      }
      case "system": {
        await this.#handleSystemMessage(context, message);
        return false;
      }
      case "user": {
        await this.#handleUserMessage(context, message, runId);
        return false;
      }
      case "prompt_suggestion": {
        return false;
      }
      default: {
        return false;
      }
    }
  }

  async #handleAssistantMessage(
    context: AgentDriverContext,
    message: Extract<SDKMessage, { type: "assistant" }>,
    runId: SessionRunId,
  ): Promise<void> {
    const messageId = this.#assistantMessageId(runId);
    const content = Array.isArray(message.message.content) ? message.message.content : [];

    for (const [index, block] of content.entries()) {
      if (!isRecord(block)) {
        continue;
      }

      const blockType = readString(block, "type");

      if (blockType === "text") {
        const text = readString(block, "text");
        const isDuplicateStreamedText =
          text === null ||
          this.#streamedTextMessages.has(messageId) ||
          isDuplicateClaudeFinalText(this.#streamedTextByMessageId, messageId, text);

        if (isTruthy(text) && !isDuplicateStreamedText) {
          // Claude content blocks are protocol-ordered; push each derived event before reading the next block.
          await this.#events.pushTextDelta({
            context,
            delta: text,
            messageId,
            reason: "driver.claude.message.text",
          });
        }
        continue;
      }

      if (isToolUseBlock(block)) {
        const toolCallId = toToolCallId(block, messageId, index);
        if (this.#events.hasToolStarted(toolCallId)) {
          continue;
        }

        // Claude content blocks are protocol-ordered; keep tool start/args/end in wire order.
        await this.#events.ensureToolStarted({
          context,
          parentMessageId: messageId,
          toolCallId,
          toolCallName: toToolCallName(block),
        });
        const { input } = block;
        if (isTruthy(input)) {
          await this.#events.pushToolArguments({
            context,
            delta: stringifyForDisplay(input),
            reason: "driver.claude.tool.args",
            toolCallId,
          });
        }
        await this.#events.endTool(context, toolCallId);
      }
    }

    await this.#events.endMessage(context, messageId);
  }

  async #handleStreamEvent(
    context: AgentDriverContext,
    message: Extract<SDKMessage, { type: "stream_event" }>,
    runId: SessionRunId,
  ): Promise<void> {
    const event = isRecord(message.event) ? message.event : null;
    const eventType = readString(event, "type");

    if (eventType === "message_start") {
      return;
    }

    const messageId = this.#assistantMessageId(runId);

    if (eventType === "content_block_start") {
      await this.#handleContentBlockStart(context, messageId, event);
      return;
    }

    if (eventType === "content_block_delta") {
      await this.#handleContentBlockDelta(context, messageId, event);
      return;
    }

    if (eventType === "content_block_stop") {
      const index = readNumber(event, "index");
      const toolCallId = index === null ? null : this.#blockIndexToToolCallId.get(index);

      if (isTruthy(toolCallId) && index !== null) {
        await this.#events.endTool(context, toolCallId);
        this.#blockIndexToToolCallId.delete(index);
      }
      return;
    }

    if (eventType === "message_stop") {
      await this.endActiveThought(context);
      await this.#events.endMessage(context, messageId);
      this.#blockIndexToToolCallId.clear();
      return;
    }

    if (eventType === "message_delta") {
      const delta = readRecord(event, "delta");
      const usage = readRecord(event, "usage");
      await this.#events.pushUsage(context, usage ?? delta, null);
    }
  }

  #appendStreamedText(messageId: string, text: string): void {
    this.#streamedTextMessages.add(messageId);
    this.#streamedTextByMessageId.set(
      messageId,
      `${this.#streamedTextByMessageId.get(messageId) ?? ""}${text}`,
    );
  }

  async #handleContentBlockStart(
    context: AgentDriverContext,
    messageId: string,
    event: JsonObject | null,
  ): Promise<void> {
    const index = readNumber(event, "index");
    const block = readRecord(event, "content_block");

    if (!block) {
      return;
    }

    const blockType = readString(block, "type");

    if (blockType === "text") {
      const text = readString(block, "text");
      if (isTruthy(text)) {
        this.#appendStreamedText(messageId, text);
        await this.#events.pushTextDelta({
          context,
          delta: text,
          messageId,
          reason: "driver.claude.message.text",
        });
      }
      return;
    }

    if (blockType === "thinking") {
      const thoughtId = this.#activeThoughtId ?? toClaudeThoughtId(messageId);
      this.#activeThoughtId = thoughtId;
      await this.#events.ensureThoughtStarted(context, thoughtId);
      return;
    }

    if (!isToolUseBlock(block)) {
      return;
    }

    const toolCallId = toToolCallId(block, messageId, index ?? this.#blockIndexToToolCallId.size);
    await this.#events.ensureToolStarted({
      context,
      parentMessageId: messageId,
      toolCallId,
      toolCallName: toToolCallName(block),
    });

    if (index !== null) {
      this.#blockIndexToToolCallId.set(index, toolCallId);
    }

    const { input } = block;
    if (isTruthy(input)) {
      await this.#events.pushToolArguments({
        context,
        delta: stringifyForDisplay(input),
        reason: "driver.claude.tool.args",
        toolCallId,
      });
    }
  }

  async #handleContentBlockDelta(
    context: AgentDriverContext,
    messageId: string,
    event: JsonObject | null,
  ): Promise<void> {
    const delta = readRecord(event, "delta");
    const deltaType = readString(delta, "type");

    if (deltaType === "text_delta") {
      const text = readString(delta, "text");

      if (!isTruthy(text)) {
        return;
      }

      this.#appendStreamedText(messageId, text);
      await this.#events.pushTextDelta({
        context,
        delta: text,
        messageId,
        reason: "driver.claude.message.delta",
      });
      return;
    }

    if (deltaType === "input_json_delta") {
      const index = readNumber(event, "index");
      const partialJson = readString(delta, "partial_json");
      const toolCallId = index === null ? null : this.#blockIndexToToolCallId.get(index);

      if (isTruthy(partialJson) && isTruthy(toolCallId)) {
        await this.#events.pushToolArguments({
          context,
          delta: partialJson,
          reason: "driver.claude.tool.args.delta",
          toolCallId,
        });
      }
      return;
    }

    if (deltaType === "thinking_delta") {
      const thinkingText = readString(delta, "thinking");

      if (!isTruthy(thinkingText)) {
        return;
      }

      const thoughtId = this.#activeThoughtId ?? toClaudeThoughtId(messageId);
      this.#activeThoughtId = thoughtId;

      await this.#events.pushThoughtDelta({
        context,
        delta: thinkingText,
        thoughtId,
      });
    }
  }

  async #handleUserMessage(
    context: AgentDriverContext,
    message: Extract<SDKMessage, { type: "user" }>,
    runId: SessionRunId,
  ): Promise<void> {
    const content = isRecord(message.message) ? message.message.content : null;
    const blocks = Array.isArray(content) ? content : [];

    for (const block of blocks) {
      if (!isRecord(block)) {
        continue;
      }

      const toolCallId = readString(block, "tool_use_id");
      const resultText = toToolResultText(block);

      if (!isTruthy(toolCallId) || !isTruthy(resultText)) {
        continue;
      }

      // Tool results are emitted in transcript order so the live state reducer can attach them deterministically.
      await this.#events.pushToolResult({
        content: resultText,
        context,
        messageId: this.#events.toolParentMessageId(toolCallId) ?? this.#assistantMessageId(runId),
        toolCallId,
      });
    }
  }

  #assistantMessageId(runId: SessionRunId): SessionMessageId {
    return this.#assistantMessageIds.getOrCreate(runId);
  }

  async #handleSystemMessage(
    context: AgentDriverContext,
    message: Extract<SDKMessage, { type: "system" }>,
  ): Promise<void> {
    if (message.subtype === "init") {
      await this.#options.recordNativeSessionId(context, message.session_id);
      await this.#events.pushSessionInfoUpdated(context);
      context.logger.info("driver.claude.session.initialized", {
        mcpServerCount: message.mcp_servers.length,
        model: message.model,
        nativeSessionIdPresent: true,
        toolCount: message.tools.length,
      });
      return;
    }

    if (message.subtype === "files_persisted") {
      await this.#handleFilesPersisted(context, message);
    }
  }

  async #handleFilesPersisted(
    context: AgentDriverContext,
    message: Extract<SDKMessage, { type: "system"; subtype: "files_persisted" }>,
  ): Promise<void> {
    await this.#options.push(
      context,
      "driver.claude.files.persisted",
      toClaudeFilesPersistedEvents(message),
    );
  }

  async #handleResultMessage(
    context: AgentDriverContext,
    message: Extract<SDKMessage, { type: "result" }>,
    runId: SessionRunId,
  ): Promise<void> {
    await this.#events.pushUsage(
      context,
      isRecord(message.usage) ? message.usage : null,
      message.total_cost_usd,
    );

    if (message.subtype === "success") {
      await this.#events.pushRunFinished(context, runId);
      return;
    }

    await this.#events.pushRunError(
      context,
      `claude.${message.subtype}`,
      message.errors.join("\n") || "Claude Agent SDK turn failed.",
    );
  }
}
