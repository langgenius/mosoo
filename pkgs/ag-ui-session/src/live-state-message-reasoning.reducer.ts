import type { MosooSessionReasoningUpdatedValue } from "./custom-event-values";
import type { SessionLiveState } from "./live-state";
import { createLiveStateMessage, upsertMessage } from "./live-state-message-core.reducer";
import { touchSessionLiveState } from "./live-state.reducer-core";

// Reasoning streams (REASONING_MESSAGE_*) get their own assistant message keyed
// by the reasoning messageId, holding a single growing `reasoning` segment.
// Thinking models can reason for minutes before the first visible token; without
// this the whole phase renders as dead air. The text is intentionally NOT added
// to `content`, so copy actions and text fallbacks ignore it.
export function appendReasoningDelta(
  state: SessionLiveState,
  input: { delta: string; messageId: string },
): SessionLiveState {
  const messages = [...state.messages];
  const index = messages.findIndex((message) => message.id === input.messageId);
  const current = index === -1 ? undefined : messages[index];

  if (current === undefined) {
    messages.push(
      createLiveStateMessage({
        content: "",
        id: input.messageId,
        role: "assistant",
        segments: [{ kind: "reasoning", status: "streaming", text: input.delta }],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  if (input.delta.length === 0) {
    return state;
  }

  const segments = [...current.segments];
  const lastSegment = segments.at(-1);

  if (lastSegment?.kind === "reasoning") {
    if (lastSegment.status !== "streaming") return state;
    segments[segments.length - 1] = {
      kind: "reasoning",
      status: "streaming",
      text: `${lastSegment.text}${input.delta}`,
    };
  } else {
    segments.push({ kind: "reasoning", status: "streaming", text: input.delta });
  }

  messages[index] = {
    ...current,
    segments,
  };

  return touchSessionLiveState({
    ...state,
    messages,
  });
}

export function updateReasoningSnapshot(
  state: SessionLiveState,
  input: MosooSessionReasoningUpdatedValue,
): SessionLiveState {
  const current = state.messages.find((message) => message.id === input.messageId);
  // A bounded history window can omit the first chunk of an older thought.
  if (current === undefined && input.offset !== 0) return state;
  const reasoning = current?.segments.find((segment) => segment.kind === "reasoning");
  let text = input.content;

  if (reasoning !== undefined && reasoning.status !== "streaming") {
    if (
      input.offset + input.content.length <= reasoning.text.length &&
      reasoning.text.slice(input.offset, input.offset + input.content.length) === input.content
    ) {
      return state;
    }
    if (reasoning.status === "completed" || input.offset !== reasoning.text.length) {
      throw new Error("Reasoning snapshot chunks must be contiguous and immutable.");
    }
    text = reasoning.text + input.content;
  } else if (input.offset !== 0) {
    throw new Error("Reasoning snapshot must start at offset zero.");
  }

  return upsertMessage(state, {
    ...(current ?? createLiveStateMessage({ content: "", id: input.messageId, role: "assistant" })),
    segments: [{ kind: "reasoning", status: "snapshot", text }],
  });
}

export function completeReasoning(state: SessionLiveState, messageId: string): SessionLiveState {
  const current = state.messages.find((message) => message.id === messageId);
  const reasoning = current?.segments.find((segment) => segment.kind === "reasoning");
  if (current === undefined || reasoning === undefined || reasoning.status === "completed") {
    return state;
  }

  return upsertMessage(state, {
    ...current,
    segments: [{ ...reasoning, status: "completed" }],
  });
}

export function startReasoning(
  state: SessionLiveState,
  input: { messageId: string },
): SessionLiveState {
  const exists = state.messages.some((message) => message.id === input.messageId);

  if (exists) {
    return state;
  }

  return appendReasoningDelta(state, { delta: "", messageId: input.messageId });
}
