import type { SessionLiveState } from "./live-state";
import { createLiveStateMessage } from "./live-state-message-core.reducer";
import { touchSessionLiveState } from "./live-state.reducer-core";

export function appendTextDelta(
  state: SessionLiveState,
  messageId: string,
  delta: string,
): SessionLiveState {
  const messages = [...state.messages];
  const index = messages.findIndex((message) => message.id === messageId);

  if (index === -1) {
    messages.push(
      createLiveStateMessage({
        content: delta,
        id: messageId,
        role: "assistant",
        segments: [{ kind: "text", text: delta }],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const current = messages[index];

  if (!current) {
    messages.push(
      createLiveStateMessage({
        content: delta,
        id: messageId,
        role: "assistant",
        segments: [{ kind: "text", text: delta }],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const segments = [...current.segments];
  const lastSegment = segments.at(-1);

  if (lastSegment?.kind === "text") {
    segments[segments.length - 1] = {
      kind: "text",
      text: `${lastSegment.text}${delta}`,
    };
  } else {
    segments.push({ kind: "text", text: delta });
  }

  messages[index] = {
    ...current,
    content: `${current.content}${delta}`,
    segments,
  };

  return touchSessionLiveState({
    ...state,
    messages,
  });
}
