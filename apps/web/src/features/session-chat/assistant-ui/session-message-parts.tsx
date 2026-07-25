import { ActionBarPrimitive, MessagePrimitive, useMessage } from "@assistant-ui/react";
import type { ReasoningMessagePartComponent, TextMessagePartComponent } from "@assistant-ui/react";
import { ChevronRight, Copy } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { Markdown } from "@/shared/ui/markdown";

import { SessionToolPart } from "./session-tool-part";

// Assistant text renders through mosoo's hardened Markdown (sanitize/harden,
// <img> disallowed), streaming-animated while the part is still running.
const AssistantText: TextMessagePartComponent = ({ status, text }) => (
  <Markdown streaming={status.type === "running"}>{text}</Markdown>
);

// User text stays plain (whitespace-preserved), matching the previous bubble.
const UserText: TextMessagePartComponent = ({ text }) => (
  <div className="break-words whitespace-pre-wrap">{text}</div>
);

// "Thinking…" indicator shown only while an assistant turn is actively
// generating with no text yet. Gated on `status.type === "running"` and paired
// with `unstable_showEmptyOnNonTextEnd={false}` so it never persists after a
// turn completes or lingers on a message that ends with a tool call. The label
// shimmers left-to-right (see `.mosoo-thinking` in app.css).
function ThinkingIndicator({ status }: { status: { readonly type: string } }): ReactElement | null {
  if (status.type !== "running") {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[14px] font-medium">
      <span className="mosoo-thinking">Thinking</span>
      <span
        aria-hidden
        className="mosoo-thinking-dots text-fg-3 inline-flex items-center gap-[3px]"
      >
        <span className="size-1 rounded-full bg-current" />
        <span className="size-1 rounded-full bg-current" />
        <span className="size-1 rounded-full bg-current" />
      </span>
    </span>
  );
}

// Reasoning stream from thinking models (e.g. DeepSeek V4 Pro reasons for
// minutes before the first visible token). Rendered as a collapsed disclosure
// so the user sees live progress — shimmering "Thinking" plus a growing
// character count — instead of dead air, and can expand the raw thought text.
const AssistantReasoning: ReasoningMessagePartComponent = ({ status, text }) => {
  const [expanded, setExpanded] = useState(false);
  const running = status.type === "running";
  const charCount = text.length;

  return (
    <div className="text-fg-3 min-w-0 text-[13px]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="hover:text-fg-1 inline-flex items-center gap-1 font-medium transition-colors"
      >
        <ChevronRight className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        {running ? <span className="mosoo-thinking">Thinking</span> : <span>Thought</span>}
        <span className="font-normal tabular-nums">· {charCount.toLocaleString()} chars</span>
        {running ? (
          <span aria-hidden className="mosoo-thinking-dots inline-flex items-center gap-[3px]">
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
            <span className="size-1 rounded-full bg-current" />
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="border-ink-900/10 mt-1.5 max-h-64 overflow-y-auto border-l-2 pl-3 leading-[1.5] break-words whitespace-pre-wrap">
          {text}
        </div>
      ) : null}
    </div>
  );
};

export function UserMessage(): ReactElement {
  return (
    <MessagePrimitive.Root className="flex min-w-0 justify-start">
      <div className="bg-ink-100 text-ink-900 max-w-[82%] min-w-0 rounded-lg rounded-tl-[4px] px-4 py-3 text-[14.5px] leading-[1.55]">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage(): ReactElement {
  // Copy only makes sense when the turn actually produced prose. Tool-only turns
  // (e.g. a file write that emits just tool cards) have nothing to copy, so we
  // drop the action bar entirely rather than render an empty copy button under
  // the card. This also reclaims the h-6 slot the bar used to reserve even while
  // hidden — that reserved space was what inflated the gap between consecutive
  // tool cards.
  const hasCopyableText = useMessage((message) =>
    message.content.some((part) => part.type === "text" && part.text.trim().length > 0),
  );

  return (
    <MessagePrimitive.Root className="group/aui-msg flex min-w-0 justify-start">
      <div className="text-fg-1 w-full min-w-0 text-[14.5px] leading-[1.55]">
        <div className="flex min-w-0 flex-col gap-2">
          <MessagePrimitive.Parts
            unstable_showEmptyOnNonTextEnd={false}
            components={{
              Empty: ThinkingIndicator,
              Reasoning: AssistantReasoning,
              Text: AssistantText,
              tools: { Override: SessionToolPart },
            }}
          />
        </div>
        {/* In-flow, compact, hover-revealed — kept off the next message so it
            neither overlaps it nor inflates the gap the way the old layout did. */}
        {hasCopyableText ? (
          <ActionBarPrimitive.Root
            hideWhenRunning
            className="text-fg-3 mt-1 flex h-6 gap-1 opacity-0 transition-opacity group-hover/aui-msg:opacity-100"
          >
            <ActionBarPrimitive.Copy
              aria-label="Copy message"
              className="hover:bg-ink-900/[0.05] hover:text-fg-1 inline-flex size-6 items-center justify-center rounded-md transition-colors"
            >
              <Copy className="size-3.5" />
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  );
}
