import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { ReactElement } from "react";

import { ToolCallCard } from "../tool-call-card";
import type { ToolCall } from "../tool-call-card";
import { useSessionPermissionForToolCall } from "./session-permission-context";

// Renders every assistant-ui tool-call part via the existing mosoo tool card
// (registered as `tools.Override`). Status is re-derived: a matching permission
// request wins (needs_approval), otherwise a present result or a completed part
// status means done, else it is still running.
export const SessionToolPart: ToolCallMessagePartComponent = ({
  argsText,
  args,
  result,
  status,
  toolCallId,
  toolName,
}): ReactElement => {
  const approval = useSessionPermissionForToolCall(toolCallId);
  const { path } = (args ?? {}) as { path?: string | null };
  const output =
    typeof result === "string"
      ? result
      : result == null
        ? undefined
        : JSON.stringify(result, null, 2);
  const derivedStatus: ToolCall["status"] =
    approval !== null
      ? "needs_approval"
      : output !== undefined || status.type === "complete"
        ? "completed"
        : "running";

  const call: ToolCall = {
    approvalInput: approval?.rawInput ?? null,
    argsText: typeof argsText === "string" ? argsText : "",
    path: path ?? null,
    status: derivedStatus,
    tool: toolName,
    ...(output !== undefined ? { output } : {}),
  };

  return <ToolCallCard call={call} />;
};
