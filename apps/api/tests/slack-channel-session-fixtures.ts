import { sessionRunsTable, sessionsTable } from "@mosoo/db";
import { desc, eq } from "drizzle-orm";

import type { SlackWorkTrigger } from "../src/modules/channels/slack/slack-events";
import { readFetchUrl } from "./helpers/fetch-request-url";
import type { createPublicHttpContractDatabase } from "./helpers/published-agent-http-test-fixture";

export { OWNER_VIEWER, parseJsonRecord, readRecord } from "./channel-session-fixtures";

type SlackTriggerInput = {
  eventId: string;
  messageTs: string;
  text: string;
  triggerType?: SlackWorkTrigger["triggerType"];
} & (
  | {
      requiresExistingSession: true;
      threadTs: string;
    }
  | {
      requiresExistingSession?: false;
      threadTs?: string;
    }
);

export function buildSlackTrigger(input: SlackTriggerInput): SlackWorkTrigger {
  return {
    botUserId: "U-BOT",
    channelId: "C123",
    enterpriseId: null,
    eventId: input.eventId,
    isEnterpriseInstall: false,
    messageTs: input.messageTs,
    requiresExistingSession: input.requiresExistingSession ?? false,
    teamId: "T123",
    text: input.text,
    threadTs: input.threadTs ?? input.messageTs,
    triggerType: input.triggerType ?? "app_mention",
    userId: "U-ALICE",
  };
}

export async function withChannelFetchMock<T>(
  operation: () => Promise<T>,
  authTestResponse: Record<string, unknown> = {
    ok: true,
    team: "Growth HQ",
    team_id: "T123",
    user: "mosoobot",
    user_id: "U-BOT",
  },
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (readFetchUrl(url) === "https://slack.com/api/auth.test") {
      return Response.json(authTestResponse);
    }

    return Response.json({
      data: [{ id: "gpt-5.4" }],
    });
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function markLatestSessionRunCompleted(
  database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
  sessionId: string,
): Promise<void> {
  const run = await database
    .app()
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .where(eq(sessionRunsTable.sessionId, sessionId))
    .orderBy(desc(sessionRunsTable.createdAt))
    .limit(1)
    .get();

  if (!run) {
    throw new Error("Expected latest session run.");
  }

  await database
    .app()
    .update(sessionRunsTable)
    .set({ completedAt: Date.now(), status: "completed", updatedAt: Date.now() })
    .where(eq(sessionRunsTable.id, run.id))
    .run();
  await database
    .app()
    .update(sessionsTable)
    .set({ lastRunId: run.id, status: "IDLE", updatedAt: Date.now() })
    .where(eq(sessionsTable.id, sessionId))
    .run();
}
