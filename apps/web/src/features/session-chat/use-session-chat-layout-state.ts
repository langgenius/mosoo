import type { SessionViewMessage } from "@mosoo/ag-ui-session";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

function getLastMessageSignature(message: SessionViewMessage | null): string | null {
  if (message === null) {
    return null;
  }

  const lastSegment = message.segments.at(-1);
  let lastSegmentValue: number | string = "";

  if (lastSegment !== undefined) {
    switch (lastSegment.kind) {
      case "text": {
        lastSegmentValue = lastSegment.text.length;
        break;
      }
      case "tool_result": {
        lastSegmentValue = lastSegment.output.length;
        break;
      }
      case "tool_use": {
        lastSegmentValue = `${lastSegment.toolCallId}:${lastSegment.argsText.length}`;
        break;
      }
      default: {
        lastSegmentValue = "";
      }
    }
  }

  return `${message.id}:${message.content.length}:${message.segments.length}:${lastSegment?.kind ?? "none"}:${String(lastSegmentValue)}`;
}

export function useSessionChatLayoutState(
  messages: SessionViewMessage[],
  scrollSignal = "",
): {
  fileInputRef: RefObject<HTMLInputElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
} {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousLastMessageIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const previousLastMessageSignatureRef = useRef<string | null>(null);

  // Scroll position is an external browser state, so keep this sync at the hook boundary.
  useEffect(() => {
    const lastMessage = messages.at(-1) ?? null;
    const lastMessageId = lastMessage?.id ?? null;
    const lastMessageSignature = getLastMessageSignature(lastMessage);
    const messageCountChanged = previousMessageCountRef.current !== messages.length;
    const lastMessageChanged = previousLastMessageIdRef.current !== lastMessageId;
    const lastMessageContentChanged =
      previousLastMessageSignatureRef.current !== lastMessageSignature;

    previousMessageCountRef.current = messages.length;
    previousLastMessageIdRef.current = lastMessageId;
    previousLastMessageSignatureRef.current = lastMessageSignature;

    if (
      !messageCountChanged &&
      !lastMessageChanged &&
      !lastMessageContentChanged &&
      !scrollSignal
    ) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, scrollSignal]);

  return {
    fileInputRef,
    inputRef,
    messagesEndRef,
  };
}
