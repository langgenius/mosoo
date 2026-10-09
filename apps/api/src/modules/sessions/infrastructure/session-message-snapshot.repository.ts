import type {
  SessionMessage,
  SessionMessagePlanEntry,
  SessionMessageSegment,
} from "@mosoo/contracts/session";
import { sessionMessagesTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import {
  sanitizeAssistantMessageSegments,
  sanitizeProviderPrivateMarkup,
} from "../domain/provider-private-markup";

// plan_json and segments_json are written only by insertSessionMessage from typed arrays.
function parseStoredJsonArray<T>(raw: string | null): T[] {
  return raw === null || raw.length === 0 ? [] : (JSON.parse(raw) as T[]);
}

export async function listSessionMessages(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionMessage[]> {
  const rows = await getAppDatabase(database)
    .select({
      content_text: sessionMessagesTable.contentText,
      created_at: sessionMessagesTable.createdAt,
      created_by_account_id: sessionMessagesTable.createdByAccountId,
      id: sessionMessagesTable.id,
      plan_json: sessionMessagesTable.planJson,
      role: sessionMessagesTable.role,
      segments_json: sessionMessagesTable.segmentsJson,
    })
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, sessionId))
    .orderBy(asc(sessionMessagesTable.seq))
    .all();

  return rows.map((row) => {
    const assistantMessage = row.role === "assistant";
    const segments = parseStoredJsonArray<SessionMessageSegment>(row.segments_json);

    return {
      content: assistantMessage
        ? sanitizeProviderPrivateMarkup(row.content_text).text
        : row.content_text,
      createdAt: toIsoString(row.created_at),
      createdBy: row.created_by_account_id,
      id: row.id,
      plan: parseStoredJsonArray<SessionMessagePlanEntry>(row.plan_json),
      role: row.role,
      segments: assistantMessage ? sanitizeAssistantMessageSegments(segments) : segments,
    };
  });
}
