import type { SessionViewMessage } from "@mosoo/ag-ui-session";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

// Once the user scrolls more than this far from the bottom, treat them as having
// taken over scroll control and stop forcing the view back down on new content.
const STICK_TO_BOTTOM_THRESHOLD_PX = 32;

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
  // Whether new content should keep pinning the view to the bottom. Flips to false
  // as soon as the user scrolls up (takes over control via the mouse wheel) and back
  // to true once they return to the bottom.
  const stickToBottomRef = useRef(true);

  // Track the user's scroll position so we know whether they have taken over control.
  useEffect(() => {
    const viewport = messagesEndRef.current?.closest<HTMLElement>(
      "[data-slot=scroll-area-viewport]",
    );

    if (!viewport) {
      return;
    }

    const syncStickToBottom = (): void => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };

    // Don't sync on mount: the default (stick to bottom) preserves the initial
    // scroll-to-bottom even when a session loads with history above the fold.
    // Only a real user scroll should hand control over.
    viewport.addEventListener("scroll", syncStickToBottom, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", syncStickToBottom);
    };
  }, []);

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

    // The user has scrolled up to read earlier content; don't yank them back to the
    // bottom on new events or streaming output until they return there themselves.
    if (!stickToBottomRef.current) {
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
