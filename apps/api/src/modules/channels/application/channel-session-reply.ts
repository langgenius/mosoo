import { sessionMessagesTable, sessionRunsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { ChannelAgentReplyResult } from "./channel-agent-reply";

export async function getSessionRunReply(
  database: D1Database,
  input: { runId: SessionRunId; sessionId: SessionId },
): Promise<ChannelAgentReplyResult | null> {
  const run =
    (await getAppDatabase(database)
      .select({
        errorMessage: sessionRunsTable.errorMessage,
        status: sessionRunsTable.status,
      })
      .from(sessionRunsTable)
      .where(
        and(eq(sessionRunsTable.id, input.runId), eq(sessionRunsTable.sessionId, input.sessionId)),
      )
      .limit(1)
      .get()) ?? null;

  if (!run) {
    return null;
  }

  if (run.status === "failed" || run.status === "cancelled" || run.status === "expired") {
    return {
      status: "failed",
      text: run.errorMessage ?? `Run ended with status ${run.status}.`,
    };
  }

  if (run.status !== "completed") {
    return null;
  }

  const message =
    (await getAppDatabase(database)
      .select({ content: sessionMessagesTable.contentText })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, input.sessionId),
          eq(sessionMessagesTable.sessionRunId, input.runId),
          eq(sessionMessagesTable.role, "assistant"),
        ),
      )
      .orderBy(desc(sessionMessagesTable.seq))
      .limit(1)
      .get()) ?? null;

  return {
    status: "completed",
    text: message?.content ?? null,
  };
}
