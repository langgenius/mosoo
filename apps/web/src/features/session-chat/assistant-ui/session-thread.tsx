import { ThreadPrimitive } from "@assistant-ui/react";
import type { ReactElement } from "react";

import { AssistantMessage, UserMessage } from "./session-message-parts";

// Message viewport built from assistant-ui primitives. Viewport's built-in
// autoScroll replaces the bespoke use-session-chat-layout-state stick-to-bottom
// hook; the centered width + spacing mirror the previous SessionMessageList.
export function SessionThread(): ReactElement {
  return (
    <ThreadPrimitive.Root className="h-full min-h-0">
      <ThreadPrimitive.Viewport autoScroll className="h-full min-h-0 overflow-y-auto">
        <div className="min-h-full p-6">
          <div className="mx-auto flex w-2/3 min-w-0 flex-col gap-2">
            <ThreadPrimitive.Messages components={{ AssistantMessage, UserMessage }} />
          </div>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
