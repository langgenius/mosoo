import type { SessionMessageSegment } from "@mosoo/contracts/session";
import { sessionMessagesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  PlatformId,
  SessionId,
  SessionMessageId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type {
  SessionLiveState,
  SessionLiveStateMessage,
  SessionViewSegment,
} from "../../../sessions/application/session-live-state.service";
import { insertSessionMessage } from "../../../sessions/application/session-message-write.service";

function toSessionMessageSegments(segments: SessionViewSegment[]): SessionMessageSegment[] {
  const result: SessionMessageSegment[] = [];

  for (const segment of segments) {
    switch (segment.kind) {
      case "text": {
        result.push({ kind: "text", text: segment.text });
        break;
      }
      case "tool_use": {
        result.push({
          argsText: segment.argsText,
          kind: "tool_use",
          path: segment.path,
          tool: segment.tool,
          toolCallId: segment.toolCallId,
        });
        break;
      }
      case "tool_result": {
        result.push({
          kind: "tool_result",
          output: segment.output,
          tool: segment.tool,
          toolCallId: segment.toolCallId,
        });
        break;
      }
      default: {
        const exhaustiveSegment: never = segment;

        throw new Error(`Unsupported session segment kind: ${String(exhaustiveSegment)}`);
      }
    }
  }

  return result;
}

function findLastAssistantMessage(
  messages: SessionLiveStateMessage[],
): SessionLiveStateMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "assistant") {
      return message;
    }
  }

  return null;
}

export async function persistAssistantMessageProjection(
  database: D1Database,
  input: {
    createdByAccountId: PlatformId;
    driverInstanceId: DriverInstanceId;
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    state: SessionLiveState;
  },
): Promise<void> {
  const message = findLastAssistantMessage(input.state.messages);

  if (message === null) {
    logWarn("runtime.assistant.message.skipped", {
      driverInstanceId: input.driverInstanceId,
      reason: "RUN_FINISHED received without assistant projection",
      sessionId: input.sessionId,
      sessionRunId: input.sessionRunId,
    });
    return;
  }

  const segments = toSessionMessageSegments(message.segments);
  const hasProjection =
    message.content.length > 0 || message.plan.length > 0 || segments.length > 0;

  if (!hasProjection) {
    logWarn("runtime.assistant.message.skipped", {
      driverInstanceId: input.driverInstanceId,
      reason: "RUN_FINISHED received without assistant projection",
      sessionId: input.sessionId,
      sessionRunId: input.sessionRunId,
    });
    return;
  }

  if (await hasPersistedAssistantMessage(database, input.sessionRunId)) {
    return;
  }

  logInfo("runtime.assistant.message.persisting", {
    driverInstanceId: input.driverInstanceId,
    planEntries: message.plan.length,
    segmentCount: segments.length,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
    textLength: message.content.length,
  });

  await insertSessionMessage(database, {
    content: message.content,
    createdByAccountId: input.createdByAccountId,
    id: parsePlatformId<SessionMessageId>(message.id, "assistant message id"),
    plan: message.plan,
    role: "assistant",
    segments,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
  });
}

async function hasPersistedAssistantMessage(
  database: D1Database,
  sessionRunId: SessionRunId,
): Promise<boolean> {
  const row =
    (await getAppDatabase(database)
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionRunId, sessionRunId),
          eq(sessionMessagesTable.role, "assistant"),
        ),
      )
      .limit(1)
      .get()) ?? null;

  return Boolean(row);
}
