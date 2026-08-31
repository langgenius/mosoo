import type { DriverRecoveryMessage } from "@mosoo/agent-driver/boot";
import { sessionMessagesTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { sanitizeProviderPrivateMarkup } from "../domain/provider-private-markup";
import { resolveStoredSessionMessageContentReferences } from "../infrastructure/session-message-reference.repository";

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
      content_text: sessionMessagesTable.contentText,
      id: sessionMessagesTable.id,
      projection_format: sessionMessagesTable.projectionFormat,
      role: sessionMessagesTable.role,
      session_run_id: sessionMessagesTable.sessionRunId,
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
    const resolvedRows = await resolveStoredSessionMessageContentReferences(
      database,
      input.sessionId,
      [row],
      remainingChars + 1,
    );

    const [resolved] = resolvedRows;
    if (resolved === undefined) {
      continue;
    }
    const content =
      resolved.role === "assistant"
        ? sanitizeProviderPrivateMarkup(resolved.content_text).text
        : resolved.content_text;

    if (content.trim().length === 0) {
      continue;
    }

    if (content.length > remainingChars) {
      if (newestFirst.length === 0) {
        newestFirst.push({ content: content.slice(0, remainingChars), role: resolved.role });
      }
      return newestFirst.toReversed();
    }

    newestFirst.push({ content, role: resolved.role });
    remainingChars -= content.length;
    if (remainingChars === 0) {
      return newestFirst.toReversed();
    }
  }

  return newestFirst.toReversed();
}
