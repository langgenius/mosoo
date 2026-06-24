import { useExternalStoreRuntime } from "@assistant-ui/react";
import type { AppendMessage, AssistantRuntime } from "@assistant-ui/react";
import type { SessionViewMessage } from "@mosoo/ag-ui-session";
import { useCallback } from "react";

import { convertSessionMessage } from "./convert-session-message";

interface UseSessionAssistantRuntimeInput {
  // Source of truth stays the live WebSocket stream — these are passed straight
  // through from useSessionStreamActions; the runtime never owns chat state.
  messages: readonly SessionViewMessage[];
  streaming: boolean;
  // Blocks sending (config refresh / setup / stopped / reconnecting) while
  // keeping the composer input usable.
  isSendDisabled: boolean;
  // onSend already appends resource mentions + drives autotitle/session create.
  onSend: (text: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

function extractText(message: AppendMessage): string {
  let text = "";

  for (const part of message.content) {
    if (part.type === "text") {
      text += text.length > 0 ? `\n${part.text}` : part.text;
    }
  }

  return text.trim();
}

// External-store runtime: assistant-ui consumes the already-owned message array
// and pushes new turns back through onNew. `isRunning` is driven by the
// session-level streaming flag so the thread stays "running" across the gap
// between turns. Edit/reload/branch callbacks are intentionally omitted so
// assistant-ui does not render actions the backend cannot honor.
export function useSessionAssistantRuntime(
  input: UseSessionAssistantRuntimeInput,
): AssistantRuntime {
  const { onCancel, onSend } = input;

  const onNew = useCallback(
    async (message: AppendMessage): Promise<void> => {
      const text = extractText(message);

      if (text.length === 0) {
        return;
      }

      await onSend(text);
    },
    [onSend],
  );

  return useExternalStoreRuntime({
    convertMessage: convertSessionMessage,
    isRunning: input.streaming,
    isSendDisabled: input.isSendDisabled,
    messages: input.messages,
    onCancel,
    onNew,
    unstable_capabilities: { copy: true },
  });
}
