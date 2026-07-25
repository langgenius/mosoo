import type { SessionLiveState } from "./live-state";
import { createLiveStateMessage } from "./live-state-message-core.reducer";
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
        segments: [{ kind: "reasoning", text: input.delta }],
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
    segments[segments.length - 1] = {
      kind: "reasoning",
      text: `${lastSegment.text}${input.delta}`,
    };
  } else {
    segments.push({ kind: "reasoning", text: input.delta });
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
