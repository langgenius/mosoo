import type { DriverRecoveryMessage } from "@mosoo/agent-driver/boot";
import { sessionMessagesTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { sanitizeProviderPrivateMarkup } from "../domain/provider-private-markup";

const MAX_RUNTIME_RECOVERY_MESSAGES = 100;
// Replayed history rides the driver boot payload and, for prompt-replay
// runtimes, the first turn's prompt, so the transcript stays token-bounded:
// the newest contiguous messages that fit this content budget are kept and
// older history is dropped.
const MAX_RUNTIME_RECOVERY_CONTENT_CHARS = 32_000;

export async function getSessionRuntimeRecoveryMessages(
  database: D1Database,
  input: {
    excludeRunId: SessionRunId | null;
    sessionId: SessionId;
  },
): Promise<DriverRecoveryMessage[]> {
  const rows = await getAppDatabase(database)
    .select({
      content: sessionMessagesTable.contentText,
      role: sessionMessagesTable.role,
    })
    .from(sessionMessagesTable)
    .where(
      and(
        eq(sessionMessagesTable.sessionId, input.sessionId),
        input.excludeRunId === null
          ? undefined
          : or(
              isNull(sessionMessagesTable.sessionRunId),
              ne(sessionMessagesTable.sessionRunId, input.excludeRunId),
            ),
      ),
    )
    .orderBy(desc(sessionMessagesTable.seq))
    .limit(MAX_RUNTIME_RECOVERY_MESSAGES)
    .all();

  const newestFirst: DriverRecoveryMessage[] = [];
  let remainingChars = MAX_RUNTIME_RECOVERY_CONTENT_CHARS;

  for (const row of rows) {
    const content =
      row.role === "assistant" ? sanitizeProviderPrivateMarkup(row.content).text : row.content;

    if (content.trim().length === 0) {
      continue;
    }

    if (content.length > remainingChars) {
      // Keep the window contiguous: stop at the first message that no longer
      // fits instead of skipping past it. The newest message alone is kept
      // truncated so an oversized latest exchange cannot erase all context.
      if (newestFirst.length === 0) {
        newestFirst.push({ content: content.slice(0, remainingChars), role: row.role });
      }

      break;
    }

    newestFirst.push({ content, role: row.role });
    remainingChars -= content.length;
  }

  return newestFirst.toReversed();
}
