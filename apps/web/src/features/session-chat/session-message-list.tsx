import React, { useMemo } from "react";

import type { ChatMessage } from "@/domains/runtime/use-session-stream";
import { cn } from "@/shared/lib/class-names";
import { Markdown } from "@/shared/ui/markdown";
import { ScrollArea } from "@/shared/ui/scroll-area";

import {
  isRenderableSessionMessage,
  sessionMessageSegmentsToBlocks,
} from "./session-message-rendering";
import { ToolCallCard } from "./tool-call-card";

export interface SessionMessageListProps {
  messages: ChatMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  streaming: boolean;
}

interface AssistantMessageBodyProps {
  message: ChatMessage;
  showCaret: boolean;
}

interface PlainMessageTextProps {
  children: string;
}

interface MessageRowProps {
  message: ChatMessage;
  showCaret: boolean;
}

function createStreamingPlaceholderMessage(messages: ChatMessage[]): ChatMessage {
  const anchor = messages.at(-1);

  return {
    content: "",
    createdAt: anchor?.createdAt ?? "",
    id: `streaming-placeholder:${anchor?.id ?? "empty"}`,
    plan: [],
    role: "assistant",
    segments: [],
  };
}

export function SessionMessageList({
  messages,
  messagesEndRef,
  streaming,
}: SessionMessageListProps): React.ReactElement {
  const visibleMessages = useMemo(() => {
    const renderableMessages = messages.filter(
      (message, index) =>
        isRenderableSessionMessage(message) ||
        (streaming && message.role === "assistant" && index === messages.length - 1),
    );
    const lastVisibleMessage = renderableMessages.at(-1);

    if (streaming && lastVisibleMessage?.role !== "assistant") {
      return [...renderableMessages, createStreamingPlaceholderMessage(messages)];
    }

    return renderableMessages;
  }, [messages, streaming]);

  return (
    <ScrollArea className="h-full min-h-0 [&>[data-slot=scroll-area-viewport]>div]:block!">
      <div className="min-h-full p-6">
        <div className="mx-auto flex w-2/3 min-w-0 flex-col gap-3.5">
          {visibleMessages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              showCaret={
                message.role === "assistant" && streaming && index === visibleMessages.length - 1
              }
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </ScrollArea>
  );
}

function AssistantMessageBody({ message, showCaret }: AssistantMessageBodyProps): React.ReactNode {
  const blocks = useMemo(
    () =>
      message.role === "assistant" && message.segments.length > 0
        ? sessionMessageSegmentsToBlocks(message.segments)
        : [],
    [message.role, message.segments],
  );

  if (message.role === "user") {
    return <PlainMessageText>{message.content}</PlainMessageText>;
  }

  if (showCaret && message.content.length === 0 && blocks.length === 0) {
    return <ToolStreamCaret />;
  }

  if (blocks.length > 0) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        {blocks.map((block, blockIndex) => {
          if (block.kind === "text") {
            const isLastBlock = blockIndex === blocks.length - 1;

            if (showCaret && isLastBlock) {
              return (
                <Markdown key={block.id} streaming>
                  {block.text}
                </Markdown>
              );
            }

            return <Markdown key={block.id}>{block.text}</Markdown>;
          }

          return <ToolCallCard key={block.id} call={block.call} />;
        })}
        {showCaret && blocks.length > 0 && blocks.at(-1)?.kind !== "text" ? (
          <ToolStreamCaret />
        ) : null}
        {showCaret && blocks.length === 0 ? <ToolStreamCaret /> : null}
      </div>
    );
  }

  return showCaret ? <ToolStreamCaret /> : null;
}

function ToolStreamCaret(): React.ReactElement {
  return (
    <span aria-hidden className="animate-pulse text-[18px] leading-none text-current">
      ▋
    </span>
  );
}

function PlainMessageText({ children }: PlainMessageTextProps): React.ReactElement {
  return <div className="break-words whitespace-pre-wrap">{children}</div>;
}

const MessageRow = React.memo(function MessageRow({
  message,
  showCaret,
}: MessageRowProps): React.ReactElement {
  return (
    <div className="flex min-w-0 justify-start">
      <div
        className={cn(
          "min-w-0 text-[14.5px] leading-[1.55]",
          message.role === "user"
            ? "max-w-[82%] rounded-lg rounded-tl-[4px] bg-ink-100 px-4 py-3 text-ink-900"
            : "w-full text-fg-1",
        )}
      >
        <AssistantMessageBody message={message} showCaret={showCaret} />
      </div>
    </div>
  );
});
