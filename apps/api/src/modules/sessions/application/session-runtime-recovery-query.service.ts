import type { DriverRecoveryMessage } from "@mosoo/agent-driver/boot";
import { sessionMessagesTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { sanitizeProviderPrivateMarkup } from "../domain/provider-private-markup";

const MAX_RUNTIME_RECOVERY_MESSAGES = 100;

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

  return rows.toReversed().flatMap((row) => {
    const content =
      row.role === "assistant" ? sanitizeProviderPrivateMarkup(row.content).text : row.content;

    return content.trim().length === 0 ? [] : [{ content, role: row.role }];
  });
}
