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
import { and, desc, eq } from "drizzle-orm";

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

function findAssistantMessage(
  messages: SessionLiveStateMessage[],
  messageId: string,
): SessionLiveStateMessage | null {
  return (
    messages.find((message) => message.id === messageId && message.role === "assistant") ?? null
  );
}

export async function persistAssistantMessageProjection(
  database: D1Database,
  input: {
    createdByAccountId: PlatformId;
    driverInstanceId: DriverInstanceId;
    messageId: string;
    messageText: string;
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    state: SessionLiveState;
  },
): Promise<void> {
  const message = findAssistantMessage(input.state.messages, input.messageId);
  const useStructuredProjection = message?.content === input.messageText;

  if (message !== null && !useStructuredProjection) {
    logWarn("runtime.assistant.message.snapshot_mismatch", {
      driverInstanceId: input.driverInstanceId,
      finalMessageId: input.messageId,
      projectedTextLength: message.content.length,
      reason: "RUN_FINISHED final assistant snapshot did not match the live projection",
      sessionId: input.sessionId,
      sessionRunId: input.sessionRunId,
      snapshotTextLength: input.messageText.length,
    });
  }

  const messageId = parsePlatformId<SessionMessageId>(input.messageId, "assistant message id");
  const plan = useStructuredProjection && message !== null ? message.plan : [];
  const segments =
    useStructuredProjection && message !== null
      ? toSessionMessageSegments(message.segments)
      : [{ kind: "text" as const, text: input.messageText }];
  const persistedMessage = await readPersistedAssistantMessage(database, input.sessionRunId);

  if (persistedMessage !== null) {
    if (persistedMessage.content !== input.messageText) {
      throw new Error(
        `Canonical final assistant message conflicts with the persisted projection for run ${input.sessionRunId}.`,
      );
    }

    // Provider reconnects can replay the same canonical snapshot after the
    // driver process has generated a new message id. The run-level text is the
    // durable identity here: preserve the first canonical transcript row.
    return;
  }

  logInfo("runtime.assistant.message.persisting", {
    driverInstanceId: input.driverInstanceId,
    planEntries: plan.length,
    segmentCount: segments.length,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
    textLength: input.messageText.length,
  });

  await insertSessionMessage(database, {
    content: input.messageText,
    createdByAccountId: input.createdByAccountId,
    id: messageId,
    plan,
    role: "assistant",
    segments,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
  });
}

async function readPersistedAssistantMessage(
  database: D1Database,
  sessionRunId: SessionRunId,
): Promise<{ content: string; id: SessionMessageId } | null> {
  const row =
    (await getAppDatabase(database)
      .select({ content: sessionMessagesTable.contentText, id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionRunId, sessionRunId),
          eq(sessionMessagesTable.role, "assistant"),
        ),
      )
      .orderBy(desc(sessionMessagesTable.seq))
      .limit(1)
      .get()) ?? null;

  return row;
}
