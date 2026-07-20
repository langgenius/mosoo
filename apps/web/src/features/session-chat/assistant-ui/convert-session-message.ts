import type { ThreadMessageLike } from "@assistant-ui/react";
import type { SessionViewMessage, SessionViewSegment } from "@mosoo/ag-ui-session";

// Assistant content parts we emit for assistant-ui. The tool-call part keeps the
// mosoo `path` on `args` so the ported tool card can render it; permission status
// is resolved separately in the renderer (see session-permission-context).
type AssistantContentPart =
  | { type: "text"; text: string }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: { path: string | null };
      argsText?: string;
      result?: string;
    };

// Collapses mosoo's flat segment stream into assistant-ui content parts.
// Consecutive text segments merge into one markdown part; tool_use absorbs its
// matching tool_result (paired by toolCallId). Order is preserved exactly. This
// is the relocated `sessionMessageSegmentsToBlocks` logic — the only behavioural
// bridge that moves from the view layer into the runtime adapter.
function sessionSegmentsToParts(segments: readonly SessionViewSegment[]): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  const indexByCallId = new Map<string, number>();

  for (const segment of segments) {
    if (segment.kind === "text") {
      const last = parts.at(-1);

      if (last?.type === "text") {
        last.text += segment.text;
      } else {
        parts.push({ type: "text", text: segment.text });
      }

      continue;
    }

    if (segment.kind === "tool_use") {
      const existingIndex = indexByCallId.get(segment.toolCallId);

      if (existingIndex !== undefined) {
        const existing = parts[existingIndex];

        if (existing?.type === "tool-call") {
          parts[existingIndex] = {
            ...existing,
            argsText: segment.argsText,
            args: { path: segment.path ?? existing.args.path },
            toolName: segment.tool,
          };
        }

        continue;
      }

      parts.push({
        type: "tool-call",
        toolCallId: segment.toolCallId,
        toolName: segment.tool,
        args: { path: segment.path ?? null },
        argsText: segment.argsText,
      });
      indexByCallId.set(segment.toolCallId, parts.length - 1);
      continue;
    }

    // tool_result
    const existingIndex = indexByCallId.get(segment.toolCallId);

    if (existingIndex !== undefined) {
      const existing = parts[existingIndex];

      if (existing?.type === "tool-call") {
        parts[existingIndex] = { ...existing, result: segment.output, toolName: segment.tool };
      }

      continue;
    }

    parts.push({
      type: "tool-call",
      toolCallId: segment.toolCallId,
      toolName: segment.tool,
      args: { path: null },
      result: segment.output,
    });
    indexByCallId.set(segment.toolCallId, parts.length - 1);
  }

  return parts;
}

// External-store converter: SessionViewMessage -> ThreadMessageLike. Stable `id`
// keeps assistant-ui's per-message memo + keys aligned with the live stream.
// Permission/needs_approval is intentionally NOT folded here (this conversion is
// identity-cached and permissionRequests live in a separate array).
export function convertSessionMessage(message: SessionViewMessage): ThreadMessageLike {
  if (message.role === "user") {
    return { role: "user", id: message.id, content: message.content };
  }

  const parts = sessionSegmentsToParts(message.segments);
  const hasText = parts.some((part) => part.type === "text" && part.text.trim().length > 0);

  // Fallback: hydrated/persisted assistant turns can carry their prose only in
  // `content` (segments holding just the tool calls). Without this, that text
  // silently vanishes once a turn is reloaded from history. Append it after the
  // tool parts so the prose is never dropped.
  if (!hasText && message.content.trim().length > 0) {
    parts.push({ type: "text", text: message.content });
  }

  return { role: "assistant", id: message.id, content: parts };
}
