import type {
  SessionPermissionRequestView,
  SessionViewMessage,
  SessionViewSegment,
} from "@mosoo/ag-ui-session";

import type { ToolCall } from "./tool-call-card";

export type AssistantMessageBlock =
  | { id: string; kind: "text"; text: string }
  | { call: ToolCall; id: string; kind: "tool" };

export interface SessionMessageRenderingOptions {
  permissionRequests?: readonly SessionPermissionRequestView[];
}

export function isRenderableSessionMessage(message: SessionViewMessage): boolean {
  if (message.content.trim().length > 0) {
    return true;
  }

  return message.segments.some((segment) => {
    if (segment.kind === "text") {
      return segment.text.trim().length > 0;
    }

    return segment.kind === "tool_use" || segment.kind === "tool_result";
  });
}

// Collapses a flat segment stream into render blocks.
// Consecutive text segments become one markdown block.
// Tool_use segments can absorb matching tool_result segments.
// Order is preserved exactly.
export function sessionMessageSegmentsToBlocks(
  segments: SessionViewSegment[],
  options: SessionMessageRenderingOptions = {},
): AssistantMessageBlock[] {
  const blocks: AssistantMessageBlock[] = [];
  const completedByCallId = new Map<string, { blockIndex: number }>();
  const pendingByCallId = new Map<string, { blockIndex: number }>();
  const approvalByCallId = new Map<string, SessionPermissionRequestView>();
  let textBlockSeq = 0;

  for (const request of options.permissionRequests ?? []) {
    if (request.toolCallId !== null) {
      approvalByCallId.set(request.toolCallId, request);
    }
  }

  for (const segment of segments) {
    if (segment.kind === "text") {
      const { text } = segment;
      const last = blocks.at(-1);

      if (last?.kind === "text") {
        last.text += text;
      } else {
        textBlockSeq += 1;
        blocks.push({ id: `text-${textBlockSeq}`, kind: "text", text });
      }

      continue;
    }

    if (segment.kind === "tool_use") {
      const approval = approvalByCallId.get(segment.toolCallId);
      const completed = completedByCallId.get(segment.toolCallId);

      if (completed) {
        const target = blocks[completed.blockIndex];

        if (target?.kind === "tool") {
          blocks[completed.blockIndex] = {
            call: {
              ...target.call,
              argsText: segment.argsText,
              path: segment.path ?? target.call.path,
              status: "completed",
              tool: segment.tool,
            },
            id: target.id,
            kind: "tool",
          };
        }

        continue;
      }

      const block: AssistantMessageBlock = {
        call: {
          approvalInput: approval?.rawInput ?? null,
          argsText: segment.argsText,
          path: segment.path ?? null,
          status: approval === undefined ? "running" : "needs_approval",
          tool: segment.tool,
        },
        id: `tool-${segment.toolCallId}`,
        kind: "tool",
      };
      blocks.push(block);
      pendingByCallId.set(segment.toolCallId, { blockIndex: blocks.length - 1 });
      continue;
    }

    const pending = pendingByCallId.get(segment.toolCallId);

    if (pending) {
      const target = blocks[pending.blockIndex];

      if (target?.kind === "tool") {
        blocks[pending.blockIndex] = {
          call: {
            output: segment.output,
            argsText: target.call.argsText,
            path: target.call.path,
            status: "completed",
            tool: segment.tool,
          },
          id: target.id,
          kind: "tool",
        };
      }

      pendingByCallId.delete(segment.toolCallId);
      continue;
    }

    blocks.push({
      call: {
        argsText: "",
        output: segment.output,
        path: null,
        status: "completed",
        tool: segment.tool,
      },
      id: `tool-${segment.toolCallId}`,
      kind: "tool",
    });
    completedByCallId.set(segment.toolCallId, { blockIndex: blocks.length - 1 });
  }

  return blocks;
}
